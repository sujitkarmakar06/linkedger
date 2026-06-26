-- Editable prospect database + comments
CREATE TABLE IF NOT EXISTS prospects (
  id SERIAL PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  domain_rating INTEGER,
  status TEXT DEFAULT 'active',     -- active / negotiating / won / inactive
  niche TEXT,
  sites_offered TEXT,               -- pages/sites the prospect offers for placement
  owner_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS prospect_comments (
  id SERIAL PRIMARY KEY,
  prospect_id INTEGER REFERENCES prospects(id) ON DELETE CASCADE,
  author TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Seed prospects from the exchange ledger (guarded; runs once)
DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM prospects LIMIT 1) THEN
  INSERT INTO prospects (domain,contact_name,contact_email,domain_rating,owner_name,status,sites_offered)
  SELECT prospect_domain AS domain,
         max(contact_name), max(contact_email), max(domain_rating), max(owner_name),
         CASE WHEN bool_or(link_status='live') THEN 'won' ELSE 'active' END,
         string_agg(DISTINCT blog_url, ' | ')
  FROM exchanges
  WHERE prospect_domain IS NOT NULL AND prospect_domain <> '' AND prospect_domain <> 'unknown'
  GROUP BY prospect_domain
  ON CONFLICT (domain) DO NOTHING;
END IF;
END $$;
