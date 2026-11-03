# TAO Admin POC — handover docs

Produced 2026-10-28 for the agent team. Everything here is an input to the build plan
(claude.ai/artifact/RDq1Lm6nHp3y4z9a9SxJrm). Commit this folder as `docs/` in the POC repo.

| File | What it is | Source |
| --- | --- | --- |
| `portal-map.md` | Portals, roles, every page with its place, routes, journeys, notifications, entities, plus the Mermaid tree | Exported from the TAO Admin Portal Map (claude.ai/artifact/9QVmZnsR9cMqkPqGP8g1kb). Re-export after changes; the map is the source of truth. |
| `validation-strategy.md` | The 22 validation rules, six layers, workflow, and what the sample SetReps add | Exported from the strategy doc (claude.ai/artifact/4cncE54X4z3PBBsnHH1jic) |
| `dashboard-json/<deal>.dashboard.json` | One real per-deal object for each of the 12 deals (9 MOVE Trust, period 2026-07; 3 F-PIL 2.0, period 2026-08) | Recovered from the `const DATA` embedded in the shared dashboard artifacts |
| `dashboard-json/program-*.dashboard.json` | The two program-level aggregates the dashboards render | Same |
| `dashboard-json/SCHEMA.md` | Field inventory of the deal object: every path, observed types, how many deals carry it | Derived from the 12 files |
| `dashboard-renderer.reference.js` | The aggregation + rendering JavaScript embedded in the dashboards (weighted utilization, covenant totals, CNL tables, watch threshold). Reference for the roll-up maths; not the generator source. | Extracted from the MOVE Trust dashboard page |
| `design/redesign_mockup.html` | The TAO Admin · Operations redesign; tokens are in the build plan's Design brief | Supplied by Matt |

Not in this folder (still wanted): the generator source that produces `dashboard.json` from a SetRep,
one MOVE Trust SetRep PDF, and the SLFA threshold conditions as master data.
Sample SetRep PDFs live in `Example Documents/Example SETTREP PDF/` beside this folder's parent.
