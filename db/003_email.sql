-- Email queue + Google OAuth token columns on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gsc_access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gsc_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gsc_token_expiry TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS email_queue (
  id SERIAL PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  outreach_id INTEGER REFERENCES outreach(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'queued',             -- queued / sent / failed
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ
);
