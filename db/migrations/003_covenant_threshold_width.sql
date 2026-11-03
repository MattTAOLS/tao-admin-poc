-- 001 typed covenant_definition.threshold as numeric(12,6), which tops out below 1,000,000. Amount covenants exceed
-- that: SLFA 9.1 (j) Minimum Total Equity is 2,500,000 for all three F-PIL 2.0 deals (seed/covenant_definitions.json),
-- so `make seed` failed on PostgreSQL with "numeric field overflow". Widen it; ratios keep their six decimals.
alter table covenant_definition alter column threshold type numeric(20,6);
