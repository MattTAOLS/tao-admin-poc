-- Phase 2 wave D: companies, news and adverse media (contract lead/wave-d). Idempotent like every migration from 007 on.
-- Nothing here touches extraction or the extraction queue. Every figure on the company pages is read from published deal
-- objects; these tables hold only the company record, people's notes and follows, and what the news worker finds.

-- A lending company. One company groups one or more deals (TLFC's three MOVE Trust deals are one company, decision D5).
-- Industry, HQ, website and owner are typed by a TAO Admin; the seed fills only name, aliases and deal links.
create table if not exists company (
  slug text primary key,
  name text not null,
  aliases jsonb not null default '[]',
  industry text,
  naics text,
  headquarters text,
  website text,
  relationship_since text,                       -- 'YYYY-MM' override; null = first vintage in the reports
  owner_user_id uuid references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table deal add column if not exists company_slug text references company(slug);
create index if not exists deal_company on deal (company_slug);

-- Key contacts. Removing one sets removed_at; the row stays (nothing is hard-deleted).
create table if not exists company_contact (
  id uuid primary key default gen_random_uuid(),
  company_slug text not null references company(slug),
  name text not null,
  role text,
  email text,
  receives text,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index if not exists company_contact_company on company_contact (company_slug);

-- TAO-only analyst notes. Never joined by a partner route. Removing one sets removed_at.
create table if not exists company_note (
  id uuid primary key default gen_random_uuid(),
  company_slug text not null references company(slug),
  author_id uuid not null references app_user(id),
  body text not null,
  mentions jsonb not null default '[]',
  collection_period text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  removed_at timestamptz
);
create index if not exists company_note_company on company_note (company_slug);

-- Watchlist: one row per user per followed company.
create table if not exists company_follow (
  user_id uuid not null references app_user(id),
  company_slug text not null references company(slug),
  created_at timestamptz not null default now(),
  primary key (user_id, company_slug)
);

-- One row per news worker run (daily schedule or Run now).
create table if not exists news_run (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('schedule', 'manual')),
  status text not null default 'queued' check (status in ('queued', 'running', 'ok', 'partial', 'failed')),
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  companies integer not null default 0,
  items_added integer not null default 0,
  adverse_added integer not null default 0,
  errors jsonb not null default '[]'
);
create index if not exists news_run_queued on news_run (queued_at);

-- A news item about one company. The same article for two companies is two rows; the same URL twice for one company is one.
create table if not exists news_item (
  id uuid primary key default gen_random_uuid(),
  company_slug text not null references company(slug),
  run_id uuid references news_run(id),
  source text not null check (source in ('google_news', 'gdelt', 'fixture')),
  title text not null,
  url text not null,
  publisher text,
  published_at timestamptz,
  sentiment text not null check (sentiment in ('positive', 'neutral', 'negative')),
  found_at timestamptz not null default now(),
  unique (company_slug, url)
);
create index if not exists news_item_company_found on news_item (company_slug, found_at);

-- An adverse-media hit from keyword screening. Open until a TAO Admin reviews or dismisses it; partners see reviewed only.
create table if not exists adverse_item (
  id uuid primary key default gen_random_uuid(),
  company_slug text not null references company(slug),
  news_item_id uuid references news_item(id),
  category text not null check (category in ('litigation', 'regulatory', 'fraud', 'insolvency', 'sanctions')),
  title text not null,
  url text not null,
  publisher text,
  found_at timestamptz not null default now(),
  state text not null default 'open' check (state in ('open', 'reviewed', 'dismissed')),
  note text,
  state_by uuid references app_user(id),
  state_at timestamptz,
  unique (company_slug, url, category)
);
create index if not exists adverse_item_company on adverse_item (company_slug, state);
