-- Wave 3: a finding may name the JSON pointers in extraction.deal that hold the value it disputes (every copy).
-- On approve, a use_ours / use_report resolution writes the chosen value to each pointer (contracts/finding.schema.json
-- `targets`). 004 added the contract field but no column to keep it in.
alter table finding add column targets jsonb;
