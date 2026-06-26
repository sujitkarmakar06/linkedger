-- Outreach pipeline
CREATE TABLE IF NOT EXISTS outreach (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  pitch_type TEXT,                          -- guest_post / link_insert / resource / niche_edit / pr
  outreach_status TEXT DEFAULT 'prospect',  -- prospect/pitched/follow_up_1/follow_up_2/replied/negotiating/won/published/rejected/no_response/disqualified
  contact_name TEXT,
  contact_email TEXT,
  owner_name TEXT,
  qualified BOOLEAN,
  domain_rating INTEGER,
  traffic INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach(outreach_status);

CREATE TABLE IF NOT EXISTS outreach_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  pitch_type TEXT,
  subject TEXT,
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outreach_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  min_dr INTEGER DEFAULT 30,
  min_traffic INTEGER DEFAULT 3000,
  sender_name TEXT,
  sender_signature TEXT
);
INSERT INTO outreach_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
