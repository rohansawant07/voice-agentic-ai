CREATE TABLE IF NOT EXISTS roam_sessions (
  id text PRIMARY KEY,
  history jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS roam_sessions_expiry ON roam_sessions (expires_at);
CREATE TABLE IF NOT EXISTS roam_events (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS roam_events_session ON roam_events (session_id, id);
CREATE INDEX IF NOT EXISTS roam_events_expiry ON roam_events (created_at);
