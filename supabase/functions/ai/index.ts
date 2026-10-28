// Reads khata photos on the owner's AI key. The key never reaches a shopkeeper's phone: the app
// sends its request here with the shop's login and the ticket start_scan() gave it, and this
// passes the request on to Google with the key added (the key is set on the অ্যাডমিন page and kept
// in public.app_secrets). One file with no imports, so it can also be pasted into the Supabase
// dashboard's function editor.
//
// Deploy: npx supabase functions deploy ai --project-ref <project>

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_KEY;

/** the older keys are JWTs and go in both headers; the newer "sb_secret_…" ones only as apikey */
const asServer: Record<string, string> = SERVICE_KEY.split('.').length === 3
  ? { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  : { apikey: SERVICE_KEY };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-goog-api-key, x-goog-api-client, x-scan-ticket',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** An error in Google's own shape, so the app reads it like any other; `reason` is what the app looks for. */
function fail(status: number, reason: string) {
  return new Response(JSON.stringify({ error: { code: status, message: `EASYLEDGER_${reason}`, status: reason } }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const path = /\/(v1beta|v1)\/models\/(gemini-[\w.-]+):generateContent$/.exec(new URL(req.url).pathname);
  if (req.method !== 'POST' || !path) return fail(404, 'NOT_ALLOWED');

  try {
    // who is asking
    const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON_KEY } });
    if (!who.ok) return fail(401, 'LOGIN');
    const user = (await who.json()) as { id?: string };
    if (!user.id) return fail(401, 'LOGIN');

    // the ticket for this scan: this shop's, fresh, and not asked too many times
    const ticket = req.headers.get('x-scan-ticket') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(ticket)) return fail(403, 'TICKET');
    const checked = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_ticket`, {
      method: 'POST',
      headers: { ...asServer, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_ticket: ticket, p_shop: user.id }),
    });
    const grant = checked.ok ? ((await checked.json()) as { key?: string; model?: string } | null) : null;
    if (!grant) return fail(403, 'TICKET');
    if (!grant.key) return fail(503, 'NO_KEY');

    // the owner may have fixed the model; otherwise the one the app asked for
    const model = grant.model || path[2];
    const upstream = await fetch(`https://generativelanguage.googleapis.com/${path[1]}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': grant.key },
      body: await req.arrayBuffer(),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return fail(502, 'FAILED');
  }
});
