# Translator API — Cloudflare Worker

## Setup (one-time)

```bash
# 1. Install Wrangler CLI
npm install -g wrangler

# 2. Login to Cloudflare
wrangler login

# 3. Create D1 database
wrangler d1 create translator-db
# → Copy the database_id into wrangler.toml

# 4. Create KV namespace
wrangler kv:namespace create CACHE
# → Copy the IDs into wrangler.toml

# 5. Apply database schema
wrangler d1 execute translator-db --file=schema.sql

# 6. Set your DeepL API key (secret, never exposed to client)
wrangler secret put DEEPL_KEY

# 7. Deploy
npm run deploy
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health check |
| POST | `/activate` | Create a license key (body: `{ email, name }`) |
| POST | `/check` | Validate a license key (body: `{ key }`) |
| POST | `/translate` | Translate text (body: `{ text, source?, target?, provider?, licenseKey? }`) |

## Example: Translation Request

```json
POST https://translator-api.your-subdomain.workers.dev/translate

{
  "text": "hello world",
  "source": "EN",
  "target": "ES",
  "provider": "mymemory"
}
```

Response:
```json
{
  "text": "hola mundo",
  "provider": "mymemory",
  "uses_left": 9,
  "is_beta": true
}
```

## Architecture

```
Extension → Cloudflare Worker → DeepL / MyMemory
              ↑
        D1 (SQLite): licenses, usage tracking
        KV (optional): translation cache
```

The Worker enforces the 10-use beta limit server-side, validates license keys, and proxies all API calls. Your DeepL key never leaves the server.
