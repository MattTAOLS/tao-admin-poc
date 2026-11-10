-- Run now for one company (company profile, Latest news). A manual run with company_slug set searches only that company
-- and is allowed while the daily search (company_feeds.enabled) is off. null = every company, as before. Idempotent.
alter table news_run add column if not exists company_slug text references company(slug);
