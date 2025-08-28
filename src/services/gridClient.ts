// Lightweight front-end client for GRID/GridPanel
// All requests are made directly from the browser (no Supabase)

export interface ValidacaoResultado {
  valido: boolean;
  dados?: any;
  erro?: string;
}

// Função para validar a API Key usando /api/user (GridPanel)
export default async function validarGridAPIKey(input: { api_key: string }): Promise<ValidacaoResultado> {
  const apiKey = input.api_key;
  const endpoint = `https://gridpanel.net/api/user?api_key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 200) {
      const data = await response.json();
      return { valido: true, dados: data };
    } else if (response.status === 401 || response.status === 403) {
      return {
        valido: false,
        erro: `API key inválida ou sem permissão (status: ${response.status})`,
      };
    } else {
      return { valido: false, erro: `Erro inesperado (status: ${response.status})` };
    }
  } catch (erro: any) {
    return { valido: false, erro: `Erro de conexão: ${erro?.message || "desconhecido"}` };
  }
}

// Interface para dados específicos de League of Legends
export interface LoLMatchData {
  id: string;
  startTime?: string;
  endTime?: string;
  state: string;
  tournament?: {
    id: string;
    name: string;
  };
  teams: LoLTeamData[];
  games: LoLGameData[];
}

export interface LoLTeamData {
  id: string;
  name: string;
  placement?: number;
  score?: number;
  players: LoLPlayerData[];
}

export interface LoLPlayerData {
  id: string;
  handle: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  creepScore?: number;
  gold?: number;
}

export interface LoLGameData {
  id: string;
  state: string;
  endState?: {
    teams: LoLTeamData[];
  };
}

// Busca lista de séries da organização usando GraphQL Central Data
export async function fetchOrganizationSeries(
  apiKey: string,
  opts?: { limit?: number; offset?: number }
): Promise<{ seriesIds: string[]; hasMore: boolean }> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  
  // Query GraphQL para buscar séries da organização
  const query = `
    query getOrganizationSeries($limit: Int!, $offset: Int!) {
      organization {
        id
        name
        teams {
          id
          name
          allSeries(limit: $limit, offset: $offset) {
            id
            startTime
            endTime
            state
            tournament {
              id
              name
            }
            teams {
              id
              name
            }
          }
        }
      }
    }
  `;

  try {
    console.log('Usando GraphQL Central Data endpoint para buscar séries...');
    
    const response = await fetch('https://api.grid.gg/central-data/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { limit, offset }
      })
    });

    if (!response.ok) {
      throw new Error(`GraphQL Central Data error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log('Resposta GraphQL Central Data:', result);
    
    if (result.errors) {
      throw new Error(`GraphQL errors: ${result.errors.map((e: any) => e.message).join(', ')}`);
    }

    // Extrai IDs das séries de todos os times da organização
    const seriesIds: string[] = [];
    if (result.data?.organization?.teams) {
      for (const team of result.data.organization.teams) {
        if (team.allSeries) {
          for (const series of team.allSeries) {
            if (series.id && !seriesIds.includes(series.id)) {
              seriesIds.push(series.id);
            }
          }
        }
      }
    }

    const hasMore = seriesIds.length === limit;
    return { seriesIds, hasMore };

  } catch (error: any) {
    console.error('Erro na busca GraphQL Central Data:', error);
    throw new Error(`Erro ao buscar séries: ${error.message}`);
  }
}

// Busca todas as partidas da organização usando REST API
export async function fetchOrganizationMatches(
  apiKey: string,
  opts?: { limit?: number; onProgress?: (current: number, total: number) => void }
): Promise<LoLMatchData[]> {
  const allMatches: LoLMatchData[] = [];
  let offset = 0;
  const limit = 50; // Limite por página
  let hasMore = true;
  
  try {
    while (hasMore && (opts?.limit ? allMatches.length < opts.limit : true)) {
      console.log(`Buscando séries - offset: ${offset}`);
      
      const { seriesIds, hasMore: moreAvailable } = await fetchOrganizationSeries(apiKey, { 
        limit, 
        offset 
      });
      
      hasMore = moreAvailable;
      
      if (seriesIds.length === 0) {
        break;
      }

      // Processa cada série individualmente
      for (let i = 0; i < seriesIds.length; i++) {
        const seriesId = seriesIds[i];
        
        try {
          console.log(`Processando série ${i + 1}/${seriesIds.length}: ${seriesId}`);
          
          const seriesData = await fetchSeriesData(apiKey, seriesId);
          
          if (seriesData && isValidLoLMatch(seriesData)) {
            const matchData = transformToLoLMatch(seriesData);
            allMatches.push(matchData);
          }
          
          // Callback de progresso
          if (opts?.onProgress) {
            const currentTotal = offset + i + 1;
            opts.onProgress(currentTotal, currentTotal + (hasMore ? 10 : 0)); // Estimativa
          }
          
          // Rate limiting para não sobrecarregar a API
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          console.warn(`Erro ao processar série ${seriesId}:`, error);
          continue; // Continua com as próximas séries
        }
        
        // Para se atingiu o limite solicitado
        if (opts?.limit && allMatches.length >= opts.limit) {
          break;
        }
      }
      
      offset += limit;
    }

    return allMatches;
  } catch (error: any) {
    console.error('Error fetching organization matches:', error);
    throw new Error(`Erro ao buscar partidas: ${error.message}`);
  }
}

// Valida se os dados são de uma partida válida de LoL
export function isValidLoLMatch(data: any): boolean {
  return data && 
         data.id && 
         data.games && 
         Array.isArray(data.games) &&
         data.games.length > 0;
}

// Transforma dados da API para o formato LoLMatchData
export function transformToLoLMatch(data: any): LoLMatchData {
  return {
    id: data.id,
    startTime: data.startTime,
    endTime: data.endTime,
    state: data.state || 'completed',
    tournament: data.tournament,
    teams: (data.teams || []).map((team: any) => ({
      id: team.id || team.teamId,
      name: team.name,
      placement: team.placement,
      score: team.score,
      players: (team.players || []).map((player: any) => ({
        id: player.id || player.playerId,
        handle: player.handle || player.name,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        creepScore: player.creepScore || player.cs,
        gold: player.gold
      }))
    })),
    games: (data.games || []).map((game: any) => ({
      id: game.id,
      state: game.state,
      endState: game.endState
    }))
  };
}

// Busca dados específicos de uma série/partida usando File Download API
export async function fetchSeriesData(apiKey: string, seriesId: string): Promise<any> {
  const url = `https://api.grid.gg/file-download/end-state/grid/series/${encodeURIComponent(seriesId)}`;
  
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      'x-api-key': apiKey,
      Accept: "application/json",
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`GRID API error: ${resp.status} ${resp.statusText}${text ? " - " + text : ""}`);
  }

  return await resp.json();
}

// Função legacy mantida para compatibilidade - agora usa fetchOrganizationMatches
export async function fetchPlayerDataDirect(
  apiKey: string,
  playerId: string,
  opts?: { limit?: number }
): Promise<any[]> {
  return fetchOrganizationMatches(apiKey, opts);
}
