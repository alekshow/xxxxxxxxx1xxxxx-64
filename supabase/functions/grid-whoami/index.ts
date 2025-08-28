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

    // Optional allowlist via secret GRID_VALID_KEYS (comma-separated)
    const allowList = (Deno.env.get("GRID_VALID_KEYS") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowList.length && !allowList.includes(key)) {
      return new Response(
        JSON.stringify({ ok: false, error: "API key not allowlisted" }),
        { status: 401, headers: corsHeaders }
      );
    }

    const useGridPanel = body?.useGridPanel === true || body?.provider === 'gridpanel';

    if (useGridPanel) {
      try {
        const url = `https://gridpanel.net/api/user?api_key=${encodeURIComponent(key)}`;
        const resp = await fetch(url, { method: 'GET' });
        if (resp.status === 200) {
          const data = await resp.json().catch(() => ({}));
          const identityId = data?.id || data?.user?.id || data?.user_id || data?.account?.id;
          return new Response(
            JSON.stringify({ ok: true, identity: data, identityId, provider: 'gridpanel' }),
            { headers: corsHeaders }
          );
        } else if (resp.status === 401 || resp.status === 403) {
          return new Response(
            JSON.stringify({ ok: false, error: 'API key inválida ou sem permissão (gridpanel)' }),
            { status: resp.status, headers: corsHeaders }
          );
        } else {
          return new Response(
            JSON.stringify({ ok: false, error: `Erro inesperado do gridpanel: ${resp.status}` }),
            { status: resp.status, headers: corsHeaders }
          );
        }
      } catch (e: any) {
        return new Response(
          JSON.stringify({ ok: false, error: `Erro de conexão com gridpanel: ${e?.message || 'desconhecido'}` }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    const apiHeaders: HeadersInit = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };

    const endpoints = [
      "https://api.grid.gg/v1/user",
      "https://api.grid.gg/v1/account",
      "https://api.grid.gg/v1/me",
    ];

    let identity: any | undefined;
    let account: any | undefined;
    let scopes: string[] | undefined;
    let lastError: string | undefined;

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { headers: apiHeaders });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const headerScopes =
            res.headers.get("x-oauth-scopes") || res.headers.get("x-scopes");
          if (headerScopes && !scopes) {
            scopes = headerScopes
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          }
          if (url.endsWith("/user") || url.endsWith("/me")) identity = identity || data;
          if (url.endsWith("/account")) account = account || data;
        } else {
          lastError = `${res.status} ${res.statusText}`;
        }
      } catch (e: any) {
        lastError = e?.message || "Network error";
      }
    }

    if (identity || account) {
      const identityId = identity?.id || identity?.userId || account?.id || account?.accountId;
      return new Response(
        JSON.stringify({ ok: true, identity, account, scopes, identityId }),
        { headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ ok: false, error: lastError || "Unauthorized or unsupported" }),
      { status: 401, headers: corsHeaders }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "Internal error" }),
      { status: 500, headers: corsHeaders }
    );
  }
});
