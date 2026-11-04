-- Corrected re-issue of a published month (wave 3, Matt's decision). An upload may name the published upload whose
-- publication it replaces on approve; replaced_by_upload_id is derived by the API from this column.
alter table setrep_upload add column replaces_upload_id uuid references setrep_upload(id);
-- The published upload stays `published` after a re-issue is uploaded, so it can no longer count as the period's
-- active upload (002). One in-flight upload per deal + period still holds.
drop index if exists setrep_upload_active_period;
create unique index setrep_upload_active_period on setrep_upload (deal_slug, collection_period)
  where status not in ('rejected', 'extraction_failed', 'published');
