import fetch from 'node-fetch';

const API_KEY = process.env.GRID_API_KEY || 'YOUR_API_KEY_HERE'; // Substitua pela env do Lovable
const GRAPHQL_ENDPOINT = 'https://api.grid.gg/central-data/graphql';

/**
 * Faz consulta GraphQL para converter externalMatchId (Riot) para seriesId (GRID)
 */
async function getSeriesIdByExternalId(externalMatchId: string): Promise<string> {
  const query = `
    query {
      seriesIdByExternalId (
        dataProviderName: "LOL"
        externalSeriesId: "${externalMatchId}"
      )
    }
  `;

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({ query }),
  });

  const json = await response.json();

  if (!json.data?.seriesIdByExternalId) {
    throw new Error(`Series ID not found for external ID: ${externalMatchId}`);
  }

  return json.data.seriesIdByExternalId;
}

/**
 * Faz download do summary e details da GRID para um seriesId e gameNumber
 */
async function fetchMatchFiles(seriesId: string, gameNumber = 1): Promise<{
  summary: any;
  details: any;
}> {
  const headers = { 'x-api-key': API_KEY };

  const summaryUrl = `https://api.grid.gg/file-download/end-state/riot/series/${seriesId}/games/${gameNumber}/summary`;
  const detailsUrl = `https://api.grid.gg/file-download/end-state/riot/series/${seriesId}/games/${gameNumber}/details`;

  const [summaryRes, detailsRes] = await Promise.all([
    fetch(summaryUrl, { headers }),
    fetch(detailsUrl, { headers }),
  ]);

  if (!summaryRes.ok || !detailsRes.ok) {
    throw new Error(`Failed to download match files for seriesId: ${seriesId}`);
  }

  const summary = await summaryRes.json();
  const details = await detailsRes.json();

  return { summary, details };
}

/**
 * Combina summary e details num objeto unificado
 */
function transformToLoLMatch(seriesId: string, summary: any, details: any) {
  return {
    seriesId,
    matchId: summary.matchId || null,
    gameId: summary.gameId || null,
    startTime: summary.gameStart,
    endTime: summary.gameEnd,
    durationSeconds: summary.duration,
    teams: summary.teams || [],
    players: summary.players || [],
    events: details.events || [],
    metadata: {
      patch: summary.patchVersion,
      map: summary.map,
      tournament: summary.tournament,
    },
  };
}

/**
 * Verifica se o match é válido
 */
function isValidLoLMatch(match: any): boolean {
  return (
    match &&
    match.teams?.length === 2 &&
    match.players?.length >= 10 &&
    match.events?.length > 0
  );
}

/**
 * Função principal para buscar um match da GRID a partir de um externalMatchId
 */
export async function fetchSeriesData(externalMatchId: string) {
  try {
    const seriesId = await getSeriesIdByExternalId(externalMatchId);
    const { summary, details } = await fetchMatchFiles(seriesId, 1);

    const match = transformToLoLMatch(seriesId, summary, details);

    if (!isValidLoLMatch(match)) {
      throw new Error(`Match is invalid or incomplete for seriesId ${seriesId}`);
    }

    return match;
  } catch (error) {
    console.error('Erro ao buscar dados da série:', error.message);
    throw error;
  }
}
