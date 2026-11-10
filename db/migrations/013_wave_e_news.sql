-- Phase 2 wave E: news screening version 2 (contract lead/wave-e, docs/phase2/tao-admin-poc-news_Architecture_v1.md).
-- Paid news sources with client keys, a mandatory Claude check on every story, dates confirmed from the article itself,
-- per-company search settings. Idempotent like every migration from 007 on. Nothing here touches extraction.

-- Every source a story can come from. The free two and the fixture stay; the paid ones are new.
alter table news_item drop constraint if exists news_item_source_check;
alter table news_item add constraint news_item_source_check check (source in
  ('google_news', 'gdelt', 'event_registry', 'newscatcher', 'brave_news', 'brave_web', 'dow_jones', 'lexisnexis', 'fixture'));

-- Dates (decision E3). published_at is now set only from the article itself or a provider's publication field;
-- source_date keeps what the search source said (Google pubDate, GDELT seendate, Brave page_age).
alter table news_item add column if not exists source_date timestamptz;
alter table news_item add column if not exists date_status text not null default 'source_only';
alter table news_item drop constraint if exists news_item_date_status_check;
alter table news_item add constraint news_item_date_status_check check (date_status in ('confirmed', 'source_only', 'unknown'));

-- Where the story really lives (Google links resolved to the publisher), every source that found it, its language.
alter table news_item add column if not exists resolved_url text;
alter table news_item add column if not exists sources jsonb not null default '[]';
alter table news_item add column if not exists language text;

-- The Claude check (decision E2). Rows from before wave E are 'unchecked': shown as before, never counted as recent
-- and never alerted, until the re-check (E9) turns them into kept or excluded.
alter table news_item add column if not exists check_status text not null default 'unchecked';
alter table news_item drop constraint if exists news_item_check_status_check;
alter table news_item add constraint news_item_check_status_check check (check_status in ('kept', 'excluded', 'pending', 'unchecked'));
alter table news_item add column if not exists check_confidence numeric;
alter table news_item add column if not exists check_reason text;
alter table news_item add column if not exists check_model text;
alter table news_item add column if not exists checked_at timestamptz;
alter table news_item add column if not exists description text;     -- the snippet or page text the check read (trimmed)
create index if not exists news_item_company_check on news_item (company_slug, check_status);

-- Rows from before wave E took published_at from the search source (the Dynamic Capital 2009-page fault): move it to
-- source_date until the re-check confirms a date. Only unchecked rows with no source_date yet, so a re-run changes nothing.
update news_item set source_date = published_at, published_at = null
  where check_status = 'unchecked' and source_date is null and published_at is not null;

-- Runs: a re-check is a run of its own; stats hold calls per source, candidates, kept/excluded/pending and Claude tokens.
alter table news_run drop constraint if exists news_run_trigger_check;
alter table news_run add constraint news_run_trigger_check check (trigger in ('schedule', 'manual', 'recheck'));
alter table news_run add column if not exists stats jsonb not null default '{}';

-- Per-company search settings (decision E7). TAO only.
alter table company add column if not exists news_context_terms jsonb not null default '[]';
alter table company add column if not exists news_exclusions jsonb not null default '[]';
alter table company add column if not exists news_languages jsonb not null default '["en", "fr"]';

-- Paid sources and the client's credentials (decisions E1, E8). secrets_enc is a Fernet token over a JSON object of the
-- provider's secret fields, encrypted with NEWS_SECRET_KEY from .env (never stored here). secrets_last4 holds only the
-- last four characters of each field, for the screen. config holds the non-secret fields.
create table if not exists news_source (
  provider text primary key check (provider in ('event_registry', 'newscatcher', 'brave', 'dow_jones', 'lexisnexis')),
  enabled boolean not null default false,
  secrets_enc text,
  secrets_last4 jsonb not null default '{}',
  config jsonb not null default '{}',
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  updated_at timestamptz,
  updated_by uuid references app_user(id)
);
insert into news_source (provider) values ('event_registry'), ('newscatcher'), ('brave'), ('dow_jones'), ('lexisnexis')
  on conflict (provider) do nothing;
