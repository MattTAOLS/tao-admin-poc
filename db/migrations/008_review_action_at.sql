-- Phase 2 wave A: the audit log pages newest first and filters by calendar month (GET /audit, /audit/months),
-- so review_action needs an index on its time. Idempotent, like every migration from 007 on.
create index if not exists review_action_at on review_action (at desc);
