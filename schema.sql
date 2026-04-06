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

-- Admin intercepts (one-time fake results for specific users)
CREATE TABLE IF NOT EXISTS admin_intercepts (
  user_id TEXT PRIMARY KEY,
  fake_result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
