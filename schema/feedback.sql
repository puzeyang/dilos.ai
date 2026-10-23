-- Product-page feedback (functions/api/feedback.js). Run once against the D1 database bound
-- to the site as FEEDBACK_DB.
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  product     TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  message     TEXT    NOT NULL,
  name        TEXT,
  email       TEXT,
  country     TEXT,
  user_agent  TEXT,
  -- One-way hash of the sender's IP address, used only to limit repeated submissions.
  ip_hash     TEXT
);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback (created_at);
CREATE INDEX IF NOT EXISTS feedback_ip_recent ON feedback (ip_hash, created_at);
