-- LinkedIn pipeline (search/open-profile only; never automate actions)
ALTER TABLE users ADD COLUMN IF NOT EXISTS li_access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS li_token_expiry TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS li_followups (
  id SERIAL PRIMARY KEY,
  person_name TEXT NOT NULL,
  company TEXT,
  profile_url TEXT,
  owner_name TEXT,
  status TEXT DEFAULT 'to_contact',         -- to_contact / connected / messaged / replied / done
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
