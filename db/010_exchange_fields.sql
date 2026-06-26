-- Extra fields for full link-exchange detail + link-health statuses + reciprocal (outbound) link
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS blog_url TEXT;            -- partner page hosting the inbound link
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS reciprocal_source TEXT;  -- SolGuruz blog hosting the outbound link
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS reciprocal_anchor TEXT;
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS reciprocal_target TEXT;  -- external/partner URL we linked to
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS link_status TEXT;        -- live / lost / removed / pending
ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS exchange_date DATE;
