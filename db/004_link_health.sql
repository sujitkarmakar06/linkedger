-- Link-check health
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS verdict TEXT;
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS last_check_state TEXT;     -- alive / missing / unverifiable
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS found_via TEXT;
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS link_check_runs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  total INTEGER DEFAULT 0,
  alive INTEGER DEFAULT 0,
  missing INTEGER DEFAULT 0,
  unverifiable INTEGER DEFAULT 0,
  run_by TEXT
);
