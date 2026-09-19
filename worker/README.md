# Study Buddy API proxy

Keeps the Anthropic API key off the student's device. The app calls this worker;
the worker adds the key and forwards the request to Anthropic.

## Deploy from the Cloudflare dashboard (no tooling needed)

1. Create a free account at https://dash.cloudflare.com/sign-up
2. **Compute (Workers)** → **Create** → **Start from Hello World** → name it `study-buddy-api` → **Deploy**
3. **Edit code**, replace everything with the contents of `worker.js`, → **Deploy**
4. **Settings → Variables and Secrets → Add** → type **Secret**, name `ANTHROPIC_API_KEY`,
   value = a freshly rotated key from console.anthropic.com → **Deploy**
5. Copy the worker URL (`https://study-buddy-api.<subdomain>.workers.dev`)

Check it:

```bash
curl -s https://study-buddy-api.<subdomain>.workers.dev/health
# {"ok":true,"keyConfigured":true}
```

## Or deploy from the command line

```bash
cd worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put ANTHROPIC_API_KEY
```

## Wiring the app to it

Set a repository **variable** (not a secret; the URL is not sensitive) named
`STUDY_BUDDY_API` on `commonrule/Core_Knowledge_Buddy` with the worker URL. The deploy
workflow writes it into `config.js`, and the app calls `<STUDY_BUDDY_API>/v1/messages`
instead of Anthropic directly. No key is injected into the site any more.

## What this does and does not protect

- The key never leaves Cloudflare, so nobody can read it from the page source.
- `ALLOWED_ORIGINS` stops other web pages from using the proxy, but anyone who finds
  the URL can still call it directly. The model allowlist, the token cap and the body
  size cap bound what that would cost.
- Add a spend limit on the Anthropic key, and optionally a rate-limiting rule in the
  Cloudflare dashboard (Security → WAF → Rate limiting rules) for a second layer.
