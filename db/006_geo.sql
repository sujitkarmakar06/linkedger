-- GEO / AI visibility
CREATE TABLE IF NOT EXISTS geo_snapshots (
  snapshot_date DATE PRIMARY KEY,
  avg_position NUMERIC,
  impressions INTEGER,
  clicks INTEGER,
  ctr NUMERIC,
  keywords_top10 INTEGER,
  geo_score INTEGER,
  ai_citations INTEGER,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS geo_files (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,                        -- llms_txt / robots_txt / schema
  content TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS geo_keywords (
  id SERIAL PRIMARY KEY,
  keyword TEXT NOT NULL,
  kind TEXT,                                 -- striking / ai_gap
  position NUMERIC,
  impressions INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS geo_ai_citations (
  id SERIAL PRIMARY KEY,
  engine TEXT NOT NULL,                      -- chatgpt / perplexity / gemini / ai_overviews / copilot
  state TEXT DEFAULT 'unknown',              -- cited / partial / not_yet / unknown
  query TEXT,
  checked_on DATE,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS geo_audit (
  id INTEGER PRIMARY KEY DEFAULT 1,
  tech_health INTEGER,
  pages_indexed INTEGER,
  lcp_seconds NUMERIC,
  source TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO geo_audit (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS geo_audit_issues (
  id SERIAL PRIMARY KEY,
  severity TEXT,                             -- high / medium / low
  title TEXT NOT NULL,
  detail TEXT,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
