-- Phase 2 wave C: people (contract abdda6d). Users behind the X-User seam (risk R1), their report subscriptions, display
-- and notification preferences, and system settings. Idempotent like every migration from 007 on: the runner applies it to
-- the operator's existing database at API start-up, and running it twice changes nothing.

-- A person. Email is stored lower-case and is unique. There is no hard delete: status deactivated keeps the name on
-- uploads, comments and audit rows.
create table if not exists app_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role text not null check (role in ('tao_admin', 'tao_analyst', 'investor_admin', 'investor_viewer', 'manager_admin', 'manager_viewer')),
  partner_slug text references partner(slug),
  status text not null default 'active' check (status in ('active', 'deactivated')),
  created_at timestamptz not null default now(),
  last_active_at timestamptz,
  deactivated_at timestamptz,
  deactivation_reason text
);
create index if not exists app_user_partner on app_user (partner_slug);

-- Which reports a user is notified about. deal_slug null = every deal in the program, including later ones.
create table if not exists subscription (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user(id),
  program_slug text not null references program(slug),
  deal_slug text references deal(slug),
  channels jsonb not null default '["in_app"]'
);
create index if not exists subscription_user on subscription (user_id);

-- Display settings (PATCH /me). Absent row = the defaults.
create table if not exists user_pref (
  user_id uuid primary key references app_user(id),
  time_zone text,
  date_format text,
  number_format text,
  updated_at timestamptz not null default now()
);

-- One row per notification kind the person changed; kinds without a row take the notification_defaults setting.
create table if not exists notification_pref (
  user_id uuid not null references app_user(id),
  kind text not null,
  in_app boolean not null default true,
  digest text not null default 'instant' check (digest in ('instant', 'daily')),
  primary key (user_id, kind)
);

-- Key/value settings (GET/PUT /settings). Absent key = its default.
create table if not exists system_setting (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Who did it: the audit row and the upload keep the role string (actor_role, uploaded_by) and gain the user id when the
-- caller sent X-User. Null in demo mode and for every row written before wave C.
alter table review_action add column if not exists actor_user_id uuid references app_user(id);
create index if not exists review_action_actor_user on review_action (actor_user_id);
alter table setrep_upload add column if not exists uploaded_by_user_id uuid references app_user(id);

-- The approve note (ApproveRequest.note_to_partners) lives with the version it was sent with.
alter table publication add column if not exists note_to_partners text;
alter table publication_version add column if not exists note_to_partners text;
