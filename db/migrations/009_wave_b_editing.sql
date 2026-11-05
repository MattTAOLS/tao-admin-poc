-- Phase 2 wave B: covenant changes, value edits, corrections with publication versions (contract 35e3abc).
-- Idempotent, like every migration from 007 on: the runner (api/app/migrate.py) applies it to the operator's existing
-- database at API start-up, and running it twice changes nothing.

-- Covenant changes never update a row in place. origin tells the seed which rows it may supersede (risk R11);
-- supersedes_id links a correction to the row it replaced; changed_by / change_reason come from the PUT.
alter table covenant_definition add column if not exists origin text not null default 'seed';
alter table covenant_definition add column if not exists supersedes_id uuid references covenant_definition(id);
alter table covenant_definition add column if not exists changed_by text;
alter table covenant_definition add column if not exists change_reason text;
alter table covenant_definition add column if not exists changed_at timestamptz;
-- Rows an operator already created or edited through the old PUT carry a master_change audit entry keyed by their id:
-- they are UI rows, so a later seed run must leave them alone.
update covenant_definition set origin = 'ui'
  where origin = 'seed' and id::text in (select detail->>'key' from review_action
                                         where action = 'master_change' and detail->>'entity' = 'covenant_definition');

-- The live publication carries its version; earlier versions are copied to publication_version before an overwrite.
alter table publication add column if not exists version integer not null default 1;
alter table publication add column if not exists correction_id uuid;
alter table publication add column if not exists version_reason text;

create table if not exists publication_version (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references publication(id),
  version integer not null,
  upload_id uuid not null references setrep_upload(id),
  deal jsonb not null,
  published_at timestamptz not null,
  published_by text not null,
  correction_id uuid,
  version_reason text,
  archived_at timestamptz not null default now(),
  unique (publication_id, version)
);

-- A change to a published report without a new PDF. deal holds the corrected deal object; findings the rule re-run.
create table if not exists correction (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references setrep_upload(id),
  publication_id uuid not null references publication(id),
  status text not null check (status in ('needs_review', 'published', 'rejected')),
  version integer not null,
  reason text not null,
  note_to_partners text,
  deal jsonb not null,
  findings jsonb,
  finding_counts jsonb,
  created_at timestamptz not null default now(),
  created_by text not null,
  decided_at timestamptz,
  decided_by text,
  reject_reason text
);
create index if not exists correction_status on correction (status);
create unique index if not exists correction_one_pending on correction (upload_id) where status = 'needs_review';

-- A TAO Admin's change to one extracted number. Review edits have no correction_id; a correction's edits do.
create table if not exists value_edit (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references setrep_upload(id),
  correction_id uuid references correction(id),
  pointer text not null,
  old_value double precision not null,
  new_value double precision not null,
  reason text not null,
  source_page integer,
  actor_role text not null,
  actor_label text,
  at timestamptz not null default now(),
  reverted_at timestamptz,
  reverted_by text,
  revert_reason text
);
create index if not exists value_edit_upload on value_edit (upload_id);
