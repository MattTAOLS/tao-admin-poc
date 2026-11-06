-- Phase 2 wave C: in-app notifications and TAO comment threads (contract abdda6d). Idempotent (see 010).

-- One row per person per event. Only ever read by its owner; a partner's list is filtered through partner_filter again on
-- read. Kept 12 months (the API purges older rows).
create table if not exists notification (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id),
  kind text not null,
  title text not null,
  body text,
  link text not null,
  upload_id uuid references setrep_upload(id),
  deal_slug text,
  collection_period text,
  version integer,
  thread_id uuid,
  note_from_tao text,
  changes jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notification_user_created on notification (user_id, created_at);

-- Events the API notices after the fact (the worker moves an upload to needs_review or extraction_failed): one row per
-- event once its notifications are made, so each is sent once, to the subscribers of that moment.
create table if not exists notification_event (
  key text primary key,
  created_at timestamptz not null default now()
);

-- A TAO-internal thread on one finding (finding_id, rule_id copied) or one extracted value (pointer) of an upload.
create table if not exists thread (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references setrep_upload(id),
  finding_id uuid,
  pointer text,
  rule_id text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  version integer,
  created_by uuid not null references app_user(id),
  created_at timestamptz not null default now(),
  resolved_by uuid references app_user(id),
  resolved_at timestamptz
);
create index if not exists thread_upload on thread (upload_id);

-- Comments are never deleted; an edit keeps the old text in the comment_edit audit entry.
create table if not exists comment (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references thread(id),
  author_id uuid not null references app_user(id),
  body text not null,
  mentions jsonb not null default '[]',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists comment_thread on comment (thread_id);
