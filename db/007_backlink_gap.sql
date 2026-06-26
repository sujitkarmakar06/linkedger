-- Backlink gap analysis
CREATE TABLE IF NOT EXISTS bl_own_domains (
  id SERIAL PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,
  dr INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bl_gap (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  dr INTEGER,
  dofollow BOOLEAN,
  competitor TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bl_meta (
  id INTEGER PRIMARY KEY DEFAULT 1,
  last_gap_upload TIMESTAMPTZ,
  competitor_label TEXT
);
INSERT INTO bl_meta (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
