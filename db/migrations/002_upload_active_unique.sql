-- 001 put unique (deal_slug, collection_period, status) on setrep_upload, which forbids a second rejected or
-- failed upload for the same deal and period (a normal fix-and-re-upload loop). Replace it with: at most one
-- ACTIVE upload (anything not rejected / extraction_failed) per deal and period. Publication keeps its own
-- unique (deal_slug, collection_period), and the API's R12 pre-check refuses uploads for a published period.
alter table setrep_upload drop constraint if exists setrep_upload_deal_slug_collection_period_status_key;
create unique index if not exists setrep_upload_active_period on setrep_upload (deal_slug, collection_period)
  where status not in ('rejected', 'extraction_failed');
