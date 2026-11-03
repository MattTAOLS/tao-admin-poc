-- Data model from docs/ build plan. Partner-scoped tables carry partner_slug; the API filters on it in one place.
create table partner (slug text primary key, name text not null, kind text not null check (kind in ('investor','manager')), status text not null default 'active');
create table program (slug text primary key, name text not null, partner_slug text not null references partner(slug), currency text not null default 'CAD', "limit" numeric(18,2) not null, warehouse_limit numeric(18,2));
create table deal (slug text primary key, name text not null, program_slug text not null references program(slug), servicer text not null, template_id text not null);
create table covenant_definition (id uuid primary key default gen_random_uuid(), deal_slug text not null references deal(slug), legal_ref text not null, description text not null,
  kind text not null check (kind in ('ceiling','floor')), threshold numeric(12,6), threshold_rule jsonb, watch_buffer_pct numeric(6,4) not null default 0.1, effective_from date not null, source text);
create table collection_period (period text primary key check (period ~ '^[0-9]{4}-[0-9]{2}$'));
create table setrep_upload (id uuid primary key default gen_random_uuid(), deal_slug text not null references deal(slug), collection_period text not null, reporting_period text,
  file_name text not null, file_path text not null, page_count int, uploaded_by text not null, uploaded_at timestamptz not null default now(),
  status text not null check (status in ('received','extracting','needs_review','approved','rejected','published','extraction_failed')) default 'received',
  reject_reason text, unique (deal_slug, collection_period, status) deferrable initially deferred);
create table extraction (id uuid primary key default gen_random_uuid(), upload_id uuid not null references setrep_upload(id), pass int not null check (pass in (1,2)),
  meta jsonb not null, deal jsonb not null, sources jsonb not null, confidence numeric(5,4), created_at timestamptz not null default now());
create table finding (id uuid primary key default gen_random_uuid(), extraction_id uuid not null references extraction(id), rule_id text not null, layer text not null, severity text not null,
  message text not null, fields jsonb, our_value jsonb, report_value jsonb, difference numeric, tolerance numeric, unit text, source_page int, context jsonb,
  status text not null default 'open', resolution jsonb, created_at timestamptz not null default now());
create table review_action (id uuid primary key default gen_random_uuid(), upload_id uuid references setrep_upload(id), finding_id uuid references finding(id), actor_role text not null, actor_label text,
  action text not null, reason text, detail jsonb, at timestamptz not null default now());
create table publication (id uuid primary key default gen_random_uuid(), upload_id uuid not null references setrep_upload(id), deal_slug text not null references deal(slug), collection_period text not null,
  published_by text not null, published_at timestamptz not null default now(), deal jsonb not null, rollup_version int not null default 1, unique (deal_slug, collection_period));
create index on finding (extraction_id); create index on setrep_upload (status); create index on publication (deal_slug, collection_period);
