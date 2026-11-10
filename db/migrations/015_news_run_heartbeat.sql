-- Audit L10: the news worker stamps a run while it works, so a run whose worker died is told apart from a live one in
-- minutes instead of hours (and a second worker never fails a live run). null on runs from before this migration.
-- Idempotent.
alter table news_run add column if not exists heartbeat_at timestamptz;
