-- Users / License keys
CREATE TABLE IF NOT EXISTS licenses (
  key TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  tier TEXT DEFAULT 'full',
  activated_at INTEGER NOT NULL
);

-- Beta usage tracking (per device)
CREATE TABLE IF NOT EXISTS beta_usage (
  id TEXT PRIMARY KEY,
  beta_uses INTEGER DEFAULT 0
);

-- Usage analytics (optional, for licensed users)
CREATE TABLE IF NOT EXISTS usage_log (
  license_key TEXT PRIMARY KEY,
  uses INTEGER DEFAULT 0
);

-- Translation log (who translated what and when)
CREATE TABLE IF NOT EXISTS translation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  original_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  source_lang TEXT,
  target_lang TEXT,
  provider TEXT,
  is_beta INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Admin intercepts (one-time fake results for specific users)
CREATE TABLE IF NOT EXISTS admin_intercepts (
  user_id TEXT PRIMARY KEY,
  fake_result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Index for fast recent lookups
CREATE INDEX IF NOT EXISTS idx_translation_log_created ON translation_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_translation_log_user ON translation_log(user_id);
