/**
 * Study Buddy API proxy (Cloudflare Worker).
 *
 * The Anthropic API key lives here as a Worker secret and never reaches the browser.
 * The app posts the same request body it used to send to Anthropic directly; this
 * worker adds the key and streams the response straight back.
 *
 * Routes:
 *   GET  /health       → {ok, keyConfigured}          (no origin check, no cost)
 *   POST /v1/messages  → proxied to api.anthropic.com (origin-checked)
 */

// Browsers on these origins may call the proxy. This stops other web pages from
// using it; it does not stop someone calling the URL directly with curl, so the
// caps below and a spend limit on the Anthropic key are the real protection.
const ALLOWED_ORIGINS = [
  'https://commonrule.github.io',
  'http://localhost:8080',
];

// Bounds what an abuser could run up if they find the URL.
const ALLOWED_MODELS = [
  'claude-sonnet-4-6',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
];
const MAX_BODY_BYTES = 8 * 1024 * 1024; // homework photos arrive as base64
const MAX_TOKENS_CAP = 4096;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const originAllowed = ALLOWED_ORIGINS.includes(origin);

    if (url.pathname === '/health') {
      return json({ ok: true, keyConfigured: Boolean(env.ANTHROPIC_API_KEY) }, 200, origin);
    }

    if (request.method === 'OPTIONS') {
      if (!originAllowed) return new Response('Forbidden origin', { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    if (!originAllowed) {
      return new Response('Forbidden origin', { status: 403 });
    }
    if (url.pathname !== '/v1/messages') {
      return json({ error: { message: 'Not found' } }, 404, origin);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: { message: 'The tutor is not configured yet. Ask a parent to finish setup.' } }, 500, origin);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ error: { message: 'That request is too large. Try a smaller photo.' } }, 413, origin);
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: { message: 'Invalid request.' } }, 400, origin);
    }

    if (!ALLOWED_MODELS.includes(body.model)) {
      return json({ error: { message: 'Model not allowed by this proxy.' } }, 400, origin);
    }
    body.max_tokens = Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS_CAP);

    let upstream;
    try {
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return json({ error: { message: 'Could not reach the tutor service.' } }, 502, origin);
    }

    // Stream the response (including SSE) straight through to the browser.
    const headers = new Headers(corsHeaders(origin));
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    headers.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
