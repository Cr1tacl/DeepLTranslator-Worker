# Translator API — Cloudflare Worker

## Setup (one-time)

```bash
# 1. Install Wrangler CLI
npm install -g wrangler

# 2. Login to Cloudflare (create a free account first at cloudflare.com)
wrangler login

# 3. Create D1 database
wrangler d1 create translator-db
# → Copy the database_id output and paste it into wrangler.toml:
#   database_id = "your-id-here"

# 4. Create KV namespace
wrangler kv:namespace create CACHE
# → Copy both the id and preview_id into wrangler.toml:
#   id = "your-kv-id"
#   preview_id = "your-preview-kv-id"

# 5. Apply database schema (creates tables for licenses, usage tracking)
wrangler d1 execute translator-db --file=schema.sql

# 6. Set your DeepL API key as a secret (never committed to git)
wrangler secret put DEEPL_KEY
# → Paste your DeepL key when prompted

# 7. (Optional) Enable April Fools mode — only activates on April 1
wrangler secret put JOKE_MODE
# → Set to "true" on April 1, "false" the rest of the year

# 8. Deploy
npm run deploy
# → Your Worker URL will be: https://translator-api.your-subdomain.workers.dev
```

## Update Extensions

After deploying, replace the placeholder URL in both extensions:

**Beta** (`widget.js`):
```js
const WORKER_URL = "https://translator-api.your-subdomain.workers.dev";
```

**Full** (`background.js`):
```js
const WORKER_URL = "https://translator-api.your-subdomain.workers.dev";
const LICENSE_KEY = ""; // leave empty for free users, or set their key
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
  "provider": "deepl"
}
```

Response:
```json
{
  "text": "hola mundo",
  "provider": "deepl",
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

## April Fools Mode

Set `JOKE_MODE=true` as a secret. On April 1 only, the Worker will randomly intercept one word in the translation and replace it with a joke:
- `"hello"` → `"hewwo"`
- `"coffee"` → `"bean juice"`
- `"fire"` → `"spicy air"`
- `"time"` → `"the thing you're wasting right now"`

Safe, harmless, and only active for 24 hours. Turn it off by setting `JOKE_MODE=false`.
