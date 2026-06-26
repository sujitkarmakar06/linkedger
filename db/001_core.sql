-- Core schema: members, websites, exchanges, users
CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS websites (
  id SERIAL PRIMARY KEY,
  website_name TEXT NOT NULL,
  domain TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exchanges (
  id SERIAL PRIMARY KEY,
  prospect_domain TEXT NOT NULL,
  our_target_url TEXT,
  anchor_text TEXT,
  link_type TEXT DEFAULT 'dofollow',        -- dofollow / nofollow / brand_mention
  domain_rating INTEGER,
  owner_name TEXT,
  website_name TEXT,
  status TEXT DEFAULT 'pending',            -- live / pending / completed / etc
  month_label TEXT,
  contact_name TEXT,
  contact_email TEXT,
  notes TEXT,
  sr_raw JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exchanges_status ON exchanges(status);
CREATE INDEX IF NOT EXISTS idx_exchanges_owner ON exchanges(owner_name);

CREATE TABLE IF NOT EXISTS exchange_comments (
  id SERIAL PRIMARY KEY,
  exchange_id INTEGER REFERENCES exchanges(id) ON DELETE CASCADE,
  author TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
