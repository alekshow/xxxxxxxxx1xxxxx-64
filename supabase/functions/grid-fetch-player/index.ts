import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders: Record<string, string> = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const body = await req.json().catch(() => ({} as any));

    // Prefer secret, fallback to Authorization header, then body.apiKey (dev only)
    const key = Deno.env.get("GRID_API_KEY") || bearerMatch?.[1] || body.apiKey;

    if (!key) {
      return new Response(
        JSON.stringify({ ok: false, error: "GRID API key not provided" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const playerId: string = body.playerId || "player1";
    const gameId: string | undefined = body.gameId;

    // Basic endpoint used by current front-end; adjust as needed later
    const url = `https://api.grid.gg/v1/players/${encodeURIComponent(playerId)}/matches` + (gameId ? `?gameId=${encodeURIComponent(gameId)}` : "");

    const apiRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    });

    if (!apiRes.ok) {
      const text = await apiRes.text().catch(() => "");
      return new Response(
        JSON.stringify({ ok: false, error: `${apiRes.status} ${apiRes.statusText}${text ? ` - ${text}` : ""}` }),
        { status: apiRes.status, headers: corsHeaders }
      );
    }

    const data = await apiRes.json().catch(() => ({}));

    return new Response(
      JSON.stringify({ ok: true, data }),
      { headers: corsHeaders }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "Internal error" }),
      { status: 500, headers: corsHeaders }
    );
  }
});
