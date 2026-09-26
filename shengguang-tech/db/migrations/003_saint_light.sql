-- Apply before deploying the Saint Light chat API. Stores quota counters only.
CREATE TABLE IF NOT EXISTS forum_ai_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS forum_ai_limits_expiry ON forum_ai_limits(reset_at);
