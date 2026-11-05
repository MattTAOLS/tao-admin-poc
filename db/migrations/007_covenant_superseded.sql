-- Re-running the seed after its covenant definitions changed (e.g. the Stride / Xpedite fix) left the old rows next
-- to the new ones, so R14 saw both. The seed now marks a deal's current rows that the file no longer contains as
-- superseded and inserts the new ones. Superseded rows stay for history; every read takes superseded_at is null.
-- Idempotent: operators applied this file by hand before the migration runner existed (api/app/migrate.py).
alter table covenant_definition add column if not exists superseded_at timestamptz;
create index if not exists covenant_definition_current on covenant_definition (deal_slug, legal_ref, effective_from) where superseded_at is null;
