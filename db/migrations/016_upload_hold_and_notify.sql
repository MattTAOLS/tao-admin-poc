-- Save (On hold) on the review page and per-person publish notifications (2026-11-11). Idempotent.
-- A hold is a marker on an upload in needs_review, not a new status: the state machine is unchanged. It is cleared by
-- approve, reject, re-extract, or Release hold. The draft keeps what the TAO Admin had typed in the publish pop-up.
alter table setrep_upload add column if not exists held_at timestamptz;
alter table setrep_upload add column if not exists held_by uuid references app_user(id);
alter table setrep_upload add column if not exists held_by_label text;                 -- role-only mode has no user id
alter table setrep_upload add column if not exists hold_note text;
alter table setrep_upload add column if not exists draft_note_to_partners text;
alter table setrep_upload add column if not exists draft_notify jsonb;                 -- {"add": [user ids], "remove": [user ids]}
