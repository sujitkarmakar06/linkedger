-- Singleton-per-purpose integration token store (single-tenant shared login)
CREATE TABLE IF NOT EXISTS integration_tokens (
  purpose TEXT PRIMARY KEY,                 -- gsc / gmail / linkedin
  access_token TEXT,
  refresh_token TEXT,
  expiry TIMESTAMPTZ,
  meta JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);
