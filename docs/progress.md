# Progress log

Append an entry when a work package lands. Newest first.

- 2026-11-05 — QA & Demo, phase 2 wave B (merged integration/wave-b): `specs/10-editing.spec.ts`, after step 9.
  10a: Essex 2026-06 uploaded by the analyst; analyst sees no Edit and gets 403; TAO Admin edits Tranche balance closing
  (+$100.00, R05 Block raised), reverts (R05 closed), edits interest (+$100.00), publishes; the Publish dialog lists the
  edit, the Reports audit has value_edit x2 and value_edit_revert, the investor deal page shows Corrected by TAO with
  Was / Now. 10b: Reports library › Correct a value… on TLFC LP June interest publishes version 2 at once (Corrected,
  Version 2 of 2, version 1 with the Earlier version banner); Finloc July closing opens R05, waits in the queue tagged
  Correction while version 1 stays live, Acknowledge R05, Approve and publish v2; analyst sees no correct control, 403 on
  create and approve. 10c: Moneda SLFA 9.1 (e) new version from 2026-09-01 (watch buffer 0.15, test change) with a
  reason; History and the Platform audit master_change (before / after); 409 effective_not_later for 2026-09-01 and
  2026-08-01; analyst reads History, no Edit, 403. Facts in `lib/facts.ts` (STEP10). Two runs from `down -v`: 25/25 and
  25/25 (one is a `test.fail` known-bug check), 20 min 43 s and 24 min 17 s on a slow host. Bugs filed in requests.md ›
  QA & Demo: the covenant table clips Edit / History at 1440 px (step 10c runs at 1920 until fixed); a MOVE page-2
  principal edit is not checked by R05 (minor). docs/demo.md step 10 with 13 screenshots.
- 2026-11-05 — UI-Partner, phase 2 wave B (publication versions, decisions B2 and B3): merged lead/wave-b (35e3abc).
  Deal page, admin and partner shells: when the published deal's current version is above 1, the header shows a
  "Corrected" pill (blue, dot plus word) and a "Version N of M" button that opens the versions menu (newest first:
  version, published date, publisher, correction reason; Escape and outside click close it). An older version opens
  `?period=…&version=n` (the API call carries `version`) under a banner "You are looking at version n. The current
  version is m." with "Go to the current version". Data corrections: `choice: "manual"` rows read "Corrected by TAO"
  (plus "version n" when the entry carries it) with old → new, the date (`applied`, else the edit's `at`) and the
  reason; use_ours / use_report rows unchanged; partners see the same values (B3). Program pages, the period picker,
  prev / next deal and the breadcrumb never carry `version`. Nothing changes when version is 1 or absent. New:
  `web/src/portfolio/Versions.tsx`; `links.deal` and `paths.deal` take an optional version. Tests: `npx vitest run
  src/portfolio` 110 passed, 17 live skipped (new `versions.test.tsx`, 10 tests, fixture = real Dynamic Capital July 2026
  with one change: version 2 with a manual recoveries correction). Full web suite 450 passed, 1 failed under load
  (review ReviewPage R05 override, 21 s; passes alone 17/17). Not checked against the real API (wave B API not merged);
  I assume manual entries in `data_corrections` carry `choice`, `applied` or `at`, and optionally `version`, `edit_id`.
- 2026-11-05 — UI-Review (phase 2 wave B, item 1): value edits, corrections, correction queue, audit labels.
  Edit (D1 a): in Extracted values every number (key/value rows and numeric table cells, covenants and ratios included)
  gets Edit for TAO Admin while the upload is needs_review or approved. The dialog shows the current value, its page
  crop, the raw text and a source-page link (opens the viewer), the new value (typed as printed; percentages as 1.79),
  the change, a reason of 10+ characters, and the rules whose findings name the value (fields or targets). "Save and
  re-run rules" stays disabled until the value parses, differs and the reason is long enough. After saving the value
  shows an Edited pill with "original …" underneath, a tooltip with who, when and the reason, and Revert (reason 3+).
  The upload's finding_counts come from the response; findings, edits, upload and audit reload. Analysts see the
  marker, original and reason with no controls. The Publish dialog lists every active edit (value, old, new, who,
  reason); the footer shows "N values edited"; the Re-extract dialog warns when a picked page holds an edited value.
  Corrections (D1 c): "Correct a value…" in the Reports library (current published rows) and on a published review
  record (footer, and "Correct…" on each value). One or more values, reason 10+, optional note to partners (marked
  "sent to partners in a later release"). The result reads "Published as version N" or "Waiting in the approval queue:
  K block findings" with a link. The Approval queue adds `GET /corrections?status=needs_review` rows with a Correction
  tag; a row opens `/admin/uploads/queue/<upload>?correction=<id>` (no new shell route), which shows the correction's
  edits, its re-run findings with crops, and Approve / Reject (reason). Approve is disabled with the reason while block
  findings are open and shows the 409 open_block_findings refusal. Published uploads show "Version N", a Corrections
  card linking to each, and a banner while one is pending; the library shows vN, a Corrected tag and "Correction waiting".
  Activity labels value_edit, value_edit_revert, correction, correction_approve, correction_reject (and export), with
  "label (p. N): old → new" when the entry's detail carries pointer / old_value / new_value (or an edits list).
  Correction review (contract 867d8f1): each open block finding on a queued correction gets Accept as restatement /
  Acknowledge for TAO Admin (reason 3+, `POST /corrections/{id}/findings/{fid}/override`; use ours / use report are
  not offered); the view reloads the correction and Approve unlocks once no block is open.
  Run: `npx vitest run src/review` (105 tests). Stubbed / assumed: the edits and corrections routes fall back to empty
  lists when the API does not have them yet. The page lays edits over the extraction for display (the extraction row
  is not rewritten); a correction's "Published" column is computed the same way plus any use ours / use report write,
  so it can differ from the published deal if the API applies something else. Needs from Data & API: audit `detail`
  for value_edit / correction entries with `pointer`, `old_value`, `new_value` (and `edits` for a correction) so the
  Activity line shows old → new; `source_page` on ValueEdit for the re-extract warning.
- 2026-11-05 — UI-Admin (phase 2 wave B item 2, D2): covenant edits with version history on the Program / facility
  record, and the wave B audit actions.
  Covenant definitions table: current rows only (rows with `superseded_at` drop out), new Unit and Last change columns
  ("Seed load", or date · who), Kind renamed Direction, the long Source moved to the history panel and the dialog. One
  **Edit** per row and **Add covenant** (TAO Admin only); **History** per covenant for both TAO roles. The Edit dialog
  asks "New version from a date" (`mode: new_version`, no id, Effective from must be later than the covenant's latest
  version) or "Correct the current version" (`mode: correct`, the row's id, date fixed); the save button reads Save new
  version / Save correction. Fields: direction, unit (now required), single or banded threshold, watch buffer, effective
  from, source, reason (at least 10 characters). Add covenant (`mode: add`) adds deal, legal reference and description.
  A "What this change does" box works the impact out from the dates and lists this deal's reports in review
  (`GET /uploads?status=needs_review&deal_slug=`), marking for a new version which keep the current version; it says
  published periods are not touched. After saving, a toast and a note on the card give the count from
  `rerun_upload_ids`. 409 `not_current`, `exists`, `effective_not_later` show as plain messages in the dialog. History
  reads `GET /master/covenants?include_history=true`: when, who, old → new per field, effective date, kind (Created,
  Added, New version, Correction) and reason, newest first; a seed row replaced by a seed run says "replaced <date>".
  Audit log: labels for `value_edit` (Value edited), `value_edit_revert`, `correction`, `correction_approve`,
  `correction_reject`, all on Reports (also without an upload_id); `master_change` stays on Platform and its summary
  adds the covenant `mode` and `effective_from`. Detail cell and expanded row show before → after for these actions
  from `before`/`after`, `pointer` + `old_value`/`new_value`, or a correction's `edits[]`.
  Run: `npx vitest run src/admin` (web/). Stubbed / needs: `changed_at` on CovenantDefinition (requests.md; without it
  new versions and added covenants show who but not when), help text for the new buttons (Design System, requests.md).
  Built against the contract only; not checked against the real API (Data & API builds it in parallel).
- 2026-11-05 — Rules, wave B (R14 note, covenant corrections): merged lead/wave-b (35e3abc).
  R14 (`rules/checks.py: thresholds_match_master`): a ceiling / floor covenant on the report with no master definition
  in force for the period (none recorded for its legal_ref, or the first version starts after the period end) is now a
  `note` naming the covenant (legal_ref + description, report threshold, period), instead of being skipped. Mismatches
  stay `review`. Binary tests are not noted (no threshold). A context with no master at all (no `covenants` key) stays
  silent; an empty list means the deal has no definitions and every ceiling / floor covenant is noted.
  Reference deals: the three F-PIL deals (August 2026) are unchanged; every MOVE Trust deal (July 2026) now gets notes
  because the seed has no MOVE covenant_definitions: Dynamic 7, Essex 7, Finloc 8, Meridian 7, TLFC Leases 10,
  TLFC Loans 8, TLFC LP 10, TPine 4, VCC IV 6 (67 in all; `KNOWN_R14_NOTES` in test_rules.py). Stride reports before
  2026-01 note SLFA 9.1(d), (e), (f), (g); January 2026 onward is clean. New extra fixture `r14-not-in-force`
  (Stride as December 2025, four frozen notes). No existing fixture changed.
  worker/validate: the SELECT names its columns, so origin / supersedes_id / changed_by / change_reason do not change
  the master shape; only current rows (superseded_at null) reach covenants_as_of. Tests: a mode=correct row (same
  effective_from, supersedes_id set) is the one R14 compares; a Stride December 2025 upload stores four R14 notes.
  Run: `cd rules && python -m pytest -q` (128), `cd worker/validate && python -m pytest -q` (22), `make check`.
  For the Lead: 67 notes on MOVE Trust reviews is a lot of noise until MOVE definitions are seeded; one note per deal
  ("no covenant definitions recorded") is a one-line change if preferred. UI-Review: R14 notes carry no our_value, so
  "Use ours" should stay disabled for them.
- 2026-11-05 — Rules, wave B follow-up (Lead decision, R14 collapse): a deal with no covenant definitions recorded
  at all now gets ONE R14 note per report, "No covenant definitions recorded for <deal>: <n> covenants on the report
  were not checked", with `legal_refs` (unique, report order), `count`, `deal`, `deal_slug` and `period` in context.
  A deal with definitions but none in force for a legal_ref keeps one note per covenant (Stride before 2026-01-22,
  Moneda with 9.1 (e) removed). worker/validate adds `master.covenants_recorded` (all current rows for the deal) so
  R14 can tell the two cases apart; parity request to Data & API in requests.md. Reference deals: each MOVE Trust
  deal has 1 R14 note (9 in all, was 67); F-PIL none. Tests: rules 129, worker/validate 23, check_contracts green.
- 2026-11-05 — Data & API (phase 2 wave B): covenant changes, value edits, corrections with publication versions.
  Migration `009_wave_b_editing.sql` (idempotent): covenant_definition gains origin (seed|ui; rows with an old
  master_change entry are backfilled to ui), supersedes_id, changed_by, change_reason, changed_at; publication gains
  version, correction_id, version_reason; new tables publication_version, correction (one pending per upload, partial
  unique index) and value_edit.
  Covenants: `PUT /master/covenants` takes mode new_version | correct | add and a reason (10+ characters, spaces trimmed)
  and never updates a row in place. correct supersedes the current row and inserts its replacement (same effective_from,
  supersedes_id); new_version needs a later effective_from; add needs a legal_ref the deal does not have. 409 not_current,
  exists, effective_not_later; 422 for a correct without id, a changed effective_from / deal / legal_ref, or new_version on
  an unknown legal_ref. Returns {definition, superseded_id, rerun_upload_ids}; re-runs the rules on the deal's needs_review
  uploads; master_change entry with before, after, mode, effective_from and the reason. `GET ?include_history=true` returns
  superseded rows too. The seed supersedes only origin=seed rows and never inserts into a (legal_ref, effective_from) slot
  held by a ui row (R11). The review context carries `master.covenants_recorded` (parity with worker/validate for R14).
  Value edits: `/uploads/{id}/edits` (GET, POST) and `/edits/{edit_id}/revert`. tao_admin only, needs_review or approved,
  numbers at an existing pointer only (a whole-number field stays whole). On a pointer the latest not-reverted edit is in
  force; revert falls back to the previous edit, else the extracted value. Re-runs and approve read the extraction with the
  edits applied; approve also re-runs first when edits exist, writes each edited pointer into the published deal and one
  data_corrections row (choice manual, edit_id, old = extracted value). A manual edit wins over use_ours / use_report on the
  same pointer: the approve detail lists the override target as replaced, and the override and value_edit entries both stay.
  Upload dict: active_edit_count (pointers with an edit in force), published_version, pending_correction_id.
  Corrections: `/uploads/{id}/corrections`, `/corrections`, `/corrections/{id}`, approve, reject. Edits apply to the live
  published deal; data_corrections rows carry edit_id, correction_id and version. The rules re-run with prior = published
  previous month and the corrected period left out of published_periods (no R12). A block that was resolved in the
  original review carries its resolution; any other open block queues the correction (B1), else it publishes at once as
  version n+1 (old version copied to publication_version, publish + regenerate entries, and later-period needs_review
  uploads of the deal re-run, their ids in the publish detail). Approve re-runs the rules first (409 open_block_findings
  while a block stays open) and refuses a correction whose base version is no longer live (409 bad_state). A corrected
  re-issue now also archives the old version (version_reason "corrected re-issue"). `GET /published/.../deals/{slug}`
  gains version, versions and `?version=n`.
  Fixed on the way: review.rerun inserted a new finding before its values were set (NOT NULL on layer); never hit before
  because no earlier re-run produced a finding the worker had not.
  Tests: api suite on SQLite (count in the commit), wave B files and test_master/test_reissue also on PostgreSQL 16 via
  pg8000, and 009 checked there for idempotency and the ui backfill. check_contracts green.
  Needs from others: UI-Admin sends mode + reason on PUT /master/covenants (the old body is now 422). worker/validate
  does not apply value edits after a pass-2 extraction; the API re-runs with edits on approve and on every edit, so
  findings written by the worker in between ignore edits until then. Correction findings cannot be overridden (no route
  in the contract), so a queued correction is approved only once a re-run no longer blocks, or rejected.
- 2026-11-05 — Rules, worker/validate (value edits on pass 2): merged agent/api (a5e054a, migration 009).
  `validate_extraction` now applies the upload's active review edits before running the rules, like
  api/app/review.rerun: latest not-reverted edit per pointer, correction edits excluded, pointers that no longer resolve
  skipped, integer fields kept integer (`SqlStore.active_edits`, `apply_edits`). Guarded: without the value_edit table
  there are no edits. The stored extraction stays the raw read; only the findings reflect the edits, so a pass 2 during
  review no longer drops them. Tests: worker/validate 25, rules 129, check_contracts green.
- 2026-11-05 — UI-Admin, wave A (D3 audit log, D4 clickable upload rows). Built against the wave A contract (9764f69).
  **Audit log** (`web/src/admin/AuditLogPage.tsx`): Reports and Platform tabs with this month's counts; each tab opens
  on the current month in Toronto time (`GET /audit?scope&month&limit=100`, Show all pages through 500 at a time), then
  History, the earlier months from `GET /audit/months` with counts, each opening in place (first 50, then Show all).
  One search box (debounced, 2+ characters, `q` in the URL) searches every month and both tabs; results are grouped by
  month with a Reports/Platform chip and highlighted matches. Action (grouped by tab), User and Deal filters live in
  the URL (`action`, `actor`, `deal`) and go to the API (`action`, `actor_role`, `deal_slug`). A row click or Enter
  expands it: before → after per field (from `detail.before/after`), the reason, the report with collection and
  reporting period from the upload record, file, upload / finding / entry ids and a link to the upload's whole trail.
  The Report column shows deal and period, linking where the Uploads table goes. `?upload_id=` still opens one
  upload's trail across all months (table name "Audit log"). Export CSV per month (current and each History month)
  via `GET /audit/export.csv`, file `audit-<tab>-<month>.csv`. `export` added to AUDIT_ACTIONS and ACTION_LABEL;
  `restate` now reads "Restatement accepted". TAO Analyst: page open (pages.ts roles), Reports tab only, never calls
  scope=platform, no sidebar entry. **Latest uploads** (`UploadsTable.tsx`, also Uploads and Upload history): the row
  opens Review (needs_review, approved), the deal page at `?period=<collection_period>` (published) or the upload
  details (failed, rejected, received, extracting); the deal name is the real link, the Open column names the
  destination, Audit and re-issue tags keep their own targets. Stubbed: tab counts and History counts ignore the
  action/user/deal filters, and export writes the whole month, because the contract's /audit/months and export.csv
  take no filters. Needs: QA change to e2e 08 (analyst audit no longer "no access"), help text update, see requests.md.
- 2026-11-05 — UI-Partner (with Design System, Lead-authorized): trend colours, phase 2 wave A item 5. Colour shows
  whether a move is good or bad for the metric; the arrow shows direction. `KpiTile` delta takes an optional
  `tone` (good / bad / neutral) separate from `direction`; without it the old up-green / down-red colours stay. A
  good or bad tone adds "better" / "worse" to the tooltip and screen-reader text only (A2). One polarity file,
  `web/src/portfolio/polarity.ts`: KPI metric map (delinquency, loss, CNL, leverage lower is better; coverage higher;
  tranche balance, contracts, warehouse advances neutral) and covenant polarity from `kind` (ceiling lower, floor
  higher, binary none). Covenant `Trend` cells on the deal page and Program Dashboard colour the published trend word
  (never recomputed): green better, red worse, flat and n/a grey, binary uncoloured; the word stays Rising / Falling /
  Flat. Every portfolio KPI delta today is a balance or count, so those deltas are now grey. No Test or Last period
  columns (A3). Run: `cd web && npx vitest run src/portfolio src/design`. Nothing stubbed; nothing needed from others.
- 2026-11-05 — UI-Review: sharper page viewer (phase 2 wave A item 4, risk R6). `web/src/review/components/PageImage.tsx`.
  The finding-card crop keeps 110 dpi (no query). The viewer stacks the page images: 110 dpi underneath (usually
  cached from the crop), then `?dpi=200` for Fit and 100%, `?dpi=300` from 200% upward, each shown only once it has
  loaded (`visibility`, never opacity), so changing zoom never blanks the page. Zoom steps Fit / 100 / 200 / 400%
  (100% = actual size, 96/72 CSS px per point). Opened from a value or a finding with an outline it starts at 200%
  centred on the cell; "Zoom to value" (or Z) goes to 400% and centres it; + and - step the zoom; previous / next page
  and Escape as before. Outlines are a 2 px line outside the cell (red finding, purple source), no fill, no blend.
  Boxes are placed in page points: the page size comes from the loaded image's natural size and the dpi it was asked
  for, and each image is scaled by its own naturalWidth / page width, so outlines fit every layer; `PX_PER_PT` is gone.
  Cache keyed by page and dpi (`lib/api.ts: pageImageUrl`). Not built: the magnifier (design note 9) and area clips
  at 600 dpi (design note 11a; the contract has whole pages at 110/200/300). Needs from Data & API: the `dpi` query
  as in contract 9764f69; until it is merged the old API ignores the query and serves 110 dpi, and the viewer still
  places outlines correctly (it scales by the real image width). Tests: `src/review/__tests__/PageImage.test.tsx`,
  14 tests on the real Moneda page 2 size (1,466.67 × 1,133.33 pt; 2241 / 4075 / 6112 px at 110 / 200 / 300 dpi).
- 2026-11-04 — QA & Demo, MOVE Trust in the demo (merged main b40a3f3): `specs/09-move-trust.spec.ts`, three tests in
  order. 9a: Essex, TLFC LP and Finloc April uploaded by the analyst and published by the admin (API); Essex May through
  the upload form gets two R11 restatement Blocks (April ICR 1.15 → 1.12, D/E 6.35 → 6.22), the admin accepts each as a
  restatement with a reason and publishes; the MOVE program (May) then shows TLFC LP and Finloc "As of Apr 2026"
  (`deals_behind` too). 9b: TLFC LP May, Finloc May, then TLFC LP June with two R11 restatements (Apr and May RVL ratio
  0 → 0.112487%) accepted in the UI and published. 9c: Finloc June and July; Finloc May–July raise no R11 (CAD-equivalent
  gap = revaluation +64,124.04 / +106,968.53 / −47,609.31, CAD opening = prior CAD closing); Finloc July investor deal
  page vs `move-trust-finloc-2000-inc.dashboard.json`: 209 numbers, 0 mismatches. Published ratio_history and
  `restatements` checked against the references. Facts in `lib/facts.ts` (DEALS essex / tlfcLp / finloc, MOVE,
  STEP9). `lib/deal.ts`: rows sharing an id (Finloc's two "MSA (Definitions)" covenants) now match by occurrence.
  docs/demo.md: step 9 walkthrough with 8 new screenshots; steps 2, 3, 6 and the blank-PDF negative follow main
  (both portals in the publish dialog, "As of Jul 2026" on F-PIL, deals_behind, failure_reason on the card); every
  screenshot retaken. Two clean runs from `down -v`: 21/21 and 21/21, 8 min 38 s and 7 min 25 s including start and
  seed; step 9 about 3 min. Nine uploads instead of seven because Finloc must reach July for May–July and for the
  reference comparison (MOVE extraction 11–23 s each). Run: as docs/demo.md, with data/samples/move-trust/ in place.
  The five orphaned screenshots listed in requests.md (2026-11-03) are still in docs/demo/ for the Lead to remove.
- 2026-11-04 — UI-Partner, Top 10 obligor concentration (merged main b40a3f3): new `web/src/portfolio/Top10.tsx` on
  the deal page (admin and partner routes), after Borrower and portfolio ratios, per the reference top10Panel. A card
  "Top 10 obligor concentration", collapsed by default ("Show obligors" / "Hide obligors", aria-expanded). Its
  subtitle reads "N of 10 obligors over the concentration limit" or "10 largest obligors, all within the concentration
  limit", plus "source page N" from `source_pages.top10_obligor`. Columns: rank, obligor, contract amount,
  concentration, limit (`concentration_limit_desc` when present, e.g. TPine "max(3%, $800,000)", else the pct), limit
  per obligor, excess. A row with excess > 0 gets a bad-tone "Over limit" pill. Finloc gets CAD amount and USD amount
  columns next to "Total contract amount" (the published `aggregate_contract_amount`; concentration is on the total).
  No card at all when `top10_obligors` is empty (F-PIL deals, Meridian). Tests: new `top10.test.tsx` (6: collapsed
  and expands, TPine over-limit row, Finloc amounts read back to the reference, none for Moneda, present on admin and
  investor routes); portfolio 77; full web suite 389 pass, 1 flaky under full-suite load
  (`src/shell/help/__tests__/help.test.tsx`, passes alone, 22/22). tsc and check_contracts green.
- 2026-11-04 — UI-Review, polish (merged main b40a3f3). (1) Resolved finding card contrast: the library's
  `.ds-finding--resolved { opacity: .78 }` blended token text under WCAG AA on the Review report (Lighthouse 96).
  `review.css` now sets a resolved card in `.rv-group` to opacity 1 on `--canvas-deep` with a neutral `--border` left
  rule and no shadow (resolution line on `--card`); the Resolved pill and resolution line still say it in words.
  Ratios before → after: layer and value labels (`--muted`) 3.40 → 5.08:1, small Block pill (`--bad` on `--bad-bg`)
  3.34 → 4.66:1, our value (`--dpv`) 4.23 → 6.33:1. Tokens only. Design System may want to drop the opacity in
  components.css itself so other users of FindingCard get the same fix. (2) R12 timestamp: `formatMessage` in
  `lib/format.ts` shows ISO date-times inside a rule message with `formatDateTime` ("2026-11-04 01:33", as the
  banner, queue and footer do); used on finding cards, the resolve dialog and the correction_inconsistent list. No
  change to rules/. Tests: vitest review 69, 5 new (formatMessage, resolved-card contrast from tokens.css, R12 card and
  dialog text); full web suite green except the help-page and Upload history timing tests that also fail on main
  under full-suite load; tsc clean; check_contracts green. Not re-run: Lighthouse (needs the demo stack).
- 2026-11-04 — UI-Partner, latest month (merged main 9ce35c8 and lead/latest-month cb12a95): built against
  `PublishedProgram.deals_behind`. A deal behind the program month shows a blue "As of Jul 2026" pill (dot plus word)
  on its Program Executive Summary card, its Program Dashboard deal row and covenant rows, its Portfolio flagged-deal
  row, its Go to deal option, and in the deal page header. Program totals (both program pages and each portfolio card)
  carry one line: "Moneda Capital Corp. is as of Jul 2026; its Aug 2026 report is not published yet." Several deals
  are listed as "A (Jul 2026), B (Jun 2026) and N more are behind; …". Every deal link (cards, deal rows, flagged rows,
  Go to deal, prev / next) now carries `?period=` = the deal's own month (`as_of` when behind, else the program
  month). The deal page reads the program at its latest month when the deal is at its newest publication (so prev /
  next open each neighbour at its own newest month), and at the deal's month otherwise. The deal month picker already
  used the deal's own `available_periods`. Empty or absent `deals_behind`: no pill, no note, links at the program
  month. Tests: portfolio 70 (new `behind.test.tsx`, 7: F-PIL references with one change, Moneda published for
  2026-07 only, fake API 404s it for 2026-08). Full web suite 348 pass, 1 fail in `src/admin/__tests__/DashboardPage.test.tsx`
  (MOVE covenant totals row, fails on main without this change too; UI-Admin's). tsc and check_contracts green.
- 2026-11-04 — Design System: merged lead/latest-month and agent/api (302cd45, Upload.failure_reason). The upload card
  and the failed upload's review footer show `failure_reason` to tao_admin and tao_analyst, with the usual-cause text
  when it is null; neither reads the audit log any more. Help "When extraction fails" updated. Web 376 passed, 17
  skipped; tsc clean; check_contracts green.
- 2026-11-04 — Design System, help-page gaps fixed (Lead-authorized, in web/src/admin and web/src/review for this task):
  (1) the upload card's R04 hint reads the reporting lag per template from `reporting_lag_months` in rules.yaml
  (F-PIL 1, MOVE Trust 0), so MOVE uploads no longer warn; (2) Extraction failed states the worker's reason to TAO
  Admin (extract audit row) and the usual cause plus next step to analysts, on the upload card and the review footer;
  (3) the publish dialog names every partner in `partner_slugs` ("the Investor and Manager portals"); (4) the reject
  dialog says the status turns to Rejected and the reason goes in the audit log; (5) failed uploads get a Details link
  in Uploads / Upload history / Dashboard and "Upload details →" on the card; (6) Audit log in the Account nav
  (tao_admin); (8) Dashboard test expects MOVE OK 84. Help text updated to match, workarounds removed. Spot-checked on
  the tao-help stack: a MOVE Dynamic Capital 2026-04 upload through the form shows no R04 warning; a blank PDF shows
  the reason to TAO Admin and the generic cause to an analyst, both reached from Upload history › Details; publish and
  reject dialog wording; Audit log in the sidebar. Tests: web 375 passed, 17 skipped, 0 failed; tsc clean;
  check_contracts green. Gap 7 (latest month per program) waits on the operator.
- 2026-11-04 — Design System: Help & support built for both shells (`/admin/help`, `/investor/help`, `/manager/help`),
  registered in pages.ts with `built: true`. Content is data in `web/src/shell/help/content.ts`; `HelpPage.tsx` renders
  task sections with numbered steps, a glossary ("What the words mean"), a search box (every word must match; kept in
  `?q=`), an "On this page" list and an anchor link per section (`#publish` scrolls under the top bar and takes focus).
  Each block can carry `roles`: tao_analyst sees no resolve / re-extract / publish / reject / audit sections and gets
  "what you cannot do" lines; partner Company Admins get the Team members placeholder note. Page links resolve per
  shell (partner paths gain /investor or /manager). Every step was walked on a private stack (tao-help, review
  profile): role switcher, dashboard, upload form and the re-issue note, Moneda Aug R05 Use ours → publish (dialog
  text, data corrections on the investor deal page), re-extract dialog, Reports library regenerate ("rebuilt from 8
  published reports"), audit log filters, a blank PDF → Extraction failed with the reason in the Extract row, a MOVE
  Trust upload (Dynamic Capital 2026-04, reporting period 2026-04, no findings), program record, analyst read-only
  footer. Known findings listed for testers come from that run and the Rules entries (Xpedite Jun/Jul R11, Moneda May
  R18 ×2 + R19, Essex May and TLFC LP Jun R11, R19 notes). Tests: `cd web && npx vitest run src/shell` (41; help 22:
  rendering through the shell, role filtering, search, every link resolves to a built page open to the role, banned
  words, no invented contact details). Full web suite 369 passed, 1 failed (DashboardPage MOVE OK 83 vs 84, from main
  01cf274, not this change). Gaps and confusing flows: docs/requests.md › Design System, 2026-11-04.
- 2026-11-04 — Extraction: MOVE reference corrections (Lead-authorized, nine move-trust-*.dashboard.json files only;
  every value checked against the printed PDF value, formatting byte-stable: json indent=1, only changed lines move).
  TLFC LP rvl_ratio_pct is a real restatement, not a misread: May report p.14 prints RVL Ratio Apr-26 0.000000% and
  May-26 0.000000%; June report p.14 prints 0.112487% for both (Residual Losses '-' in both). No extraction change.
  Changed values (deal, path: old -> new, PDF page, report):
  * Dynamic (p.2 Pool Balances row): ph[1] (May) losses -1,363,634.47 -> 0.0; interest 126,978.64 -> 1,438,341.43
    (interest collections 1,363,634.47 + prepayment excess 74,706.96); recoveries -216,554.61 -> 52,271.68.
    ph[2] (June) principal_prepayments 7,286,831.27 -> 3,260,076.37; losses -1,465,986.69 -> 0.0; interest
    281,325.43 -> 1,747,312.12 (1,465,986.69 + 281,325.43); recoveries -33,189.86 -> 0.0; new ineligible_buyback
    4,026,754.90 (Buyback column d).
  * Finloc (p.18, July): top10_obligors[0..9] obligor_concentration_pct / concentration_limit_pct /
    concentration_limit_per_obligor / excess_concentration_amount moved back into their own columns, e.g. [0]
    6,769,167.28 -> 13.99%, 13.99% -> 5.00%, 5.00% -> 2,419,344.46, 2,419,344.46 -> 4,349,822.82; excess for
    [1..9]: 1,680,800.32 / 1,048,295.86 / 698,057.36 / 557,899.91 / 327,073.93 / 0 / 0 / 0 / 0 (printed '-').
  * TLFC LP (p.2 yield formula (e+f)): ph[0..2] interest 970,074.70 -> 968,695.49; 926,282.50 -> 925,480.05;
    946,299.86 -> 942,243.56. TLFC Loans (p.2, (e+f)): 105,960.85 -> 98,599.13; 93,794.33 -> 90,738.77;
    144,871.57 -> 141,119.85.
  * TLFC Leases: inserted the printed lock-up test "Is the amount on deposit in the Deferred Account less that 75%
    of the Required Deferred Amount ...? No" (p.8/p.17) at covenants[3] and prior_covenants[3];
    covenant_summary.OK 13 -> 14.
  * charge_off null -> printed amount (p.2 adjustment column, downward part): Dynamic, Essex, VCC IV ph[0..3] 0.0;
    Finloc ph 0.0 / 6,011.10 / 0.0 / 4,163.85 and tranche_balance 4,163.85; TLFC LP ph and tranche_balance 0.0;
    TLFC Leases ph 0 / 0 / 0 / 0.01, tranche_balance 0.01; TLFC Loans ph 0.01 / 0.03 / 0 / 0, tranche_balance 0.0;
    TPine ph 0 / 0 / 0 / 0.04, tranche_balance 0.04. Meridian already carried it.
  * adjustment_increase added where printed (upward part): Essex ph[1] 0.01; Finloc ph[0..2] 35,289.34 /
    50,888.50 / 8,425.37 (CAD equivalent); TLFC LP ph[0..3] 3,035.22 / 2,551.21 / 2,972.92 / 2,782.68 and
    tranche_balance 2,782.68; TLFC Leases ph[0] 0.01, ph[2] 0.01.
  * Covenant text quoting June next to July values, replaced with the July report's: Essex MSA 8.1 (j)
    description "exceeded 25%" -> "15%", threshold 0.25 -> 0.15 (p.14); MSA 8.1 (l) description (adds "following
    the OC Rebalancing Date (where applicable)" / "of such Securitization", p.8); clean-up note tranches "10, 11,
    12, ..., 17, 19, ..." -> "10 - 11, 13 - 23, and 25" (p.14 footnote). TPine MLA 7.1 (v) note differential
    -9,965,355.40 -> -9,875,676.11 (p.10). VCC LSA SRE (t) description adds "(where applicable)", note
    -135,257.83 -> -0.01 (p.8). TLFC LP 7.1 (t) description (July wording, p.11), 7.5 description "24 of 97" ->
    "24 of 98" (p.17). TLFC Leases 7.1 (u) description (July wording) and note -0.06 -> -0.01 (p.11); 7.5
    description "19 of 74" -> "17 of 74" and footnote tranche list (p.17). TLFC Loans 7.1 (s) note -0.06 -> -0.05
    (p.11).
  * source_pages plainly wrong: Meridian quantitative_tests null -> 11, financial_ratios 1 -> 11; VCC IV
    enhancement 5 -> 7; TLFC Loans cumulative_losses 13 -> 15.
  Left as they were: data_corrections, oldest ratio_history months, other source_pages (convention differences),
  and the remaining listed quirks in tests/test_move_*.py (not on the Lead's list). Quirk lists shrank to match;
  all 80 MOVE sample tests pass, and with Rules' R03/R04/R05 on main no MOVE report raises a phase-1 block.
- 2026-11-04 — Rules, wave 2 (MOVE Trust): merged lead/move-trust. `engine.run` hands top-level rules.yaml settings
  (`reporting_lag_months`) to every rule as `rule["settings"]`. R04 expects collection_period = reporting_period + the
  template's lag (F-PIL 1, MOVE Trust 0, unknown 1) and names it in the message. R05 adds + adjustment_increase +
  balance_adjustment. R03 gives loss and CNL ratios −5..1 (TPine −113.21% / −130.68% pass, 113.21 still blocks). New
  fixtures cover r05-adjustment-increase, r05-charge-off-move and r05-balance-adjustment. Reference gaps for Finloc and
  TLFC LP stay documented as reference-data gaps. Over the 36 MOVE extractions from agent/extraction, phases 1+2,
  with the previous month as prior: R03/R04/R05 0 (was 2/36/7). What remains is R11 ×7 (Finloc FX re-translation,
  Essex and TLFC LP restatements; see requests.md › Rules) and R19 notes ×8. Tests: rules 104, worker/validate 19,
  check_contracts green.
- 2026-11-04 — Extraction: wave 2, MOVE Trust. `move-trust-settrep-v1` is a dispatch template choosing one of four
  layouts from page-1 keywords: servicer-report (Meridian), multicurrency (Finloc), guarantor (TLFC LP, Leases,
  Loans) and standard (Dynamic, Essex, TPine, VCC IV), each a template plus an engine under
  `worker/extract/engines/` (hook in `extract()`; `meta.layout` names the layout). For all nine deals, chain()
  and month-by-month extend() over April–July reproduce the reference objects except listed quirks (per-deal
  dicts with reasons in `tests/test_move_*.py`). Interest is the effective-yield income each report's formula
  prints, so fresh extractions equal the post-correction references. Roll-forward: `charge_off` /
  `adjustment_increase` close R05 in all 36 reports (Finloc, TLFC LP and Meridian gaps explained); R05 needs the
  `adjustment_increase` term, R04 a per-program offset (MOVE reporting month = collection month). history.extend
  now reads the reporting-month lag from the extraction. Slow tests: `@pytest.mark.slow`, skipped unless
  `EXTRACT_ALL=1` (`EXTRACT_SAMPLES_DIR` points at a checkout with data/samples). Run everything:
  `EXTRACT_ALL=1 python -m pytest -q worker/extract/tests` (about 20 min).
- 2026-11-03 — Lead: wave-3 decisions (branch lead/wave3). Matt chose: (1) a program can be visible to several
  partners; migration 004 adds `program_partner`, Program/Upload gain `partner_slugs`, and both partners see MOVE
  Trust and F-PIL. (2) use_ours / use_report change the published value: findings gain optional `targets` (JSON
  pointers to every copy of the value); approve writes the chosen value there and appends `data_corrections`; no
  targets means 409 `no_target`. (3) the API's extra fields and error codes are now in openapi.yaml, plus
  `GET /master/partners`, `CovenantDefinition.unit`, and `collection_period` / `action` query filters.
- 2026-11-03 — Lead: UI-wave prep (branch lead/ui-prep). `web/vite.config.ts` reads VITE_PORT and VITE_API_PROXY, so a
  dev server can sit beside compose's :5173 and proxy /api to any API (set VITE_API_URL=/api/v1; no CORS change).
  `scripts/compose.agent.yml` gives each agent a private stack (API on ${API_PORT}, no host ports for Postgres/Redis).
  `scripts/demo_data.py --profile admin|review` loads demo state through the HTTP API from the real samples; review
  leaves a seeded Moneda Aug (R05 −100.00) in needs_review. Approving accepts R11 restatements first: Xpedite's Jun
  and Jul reports revise Jan-26 equity/D-E and May-26 rolling loss ratios, exactly as the reference `restatements` list.
- 2026-11-03 — Extraction: wave 1c history. `worker/extract/history.py: extend(prior_deal, extraction)` chains one
  upload onto the deal's last published object (an earlier extend/chain result or a seeded reference object):
  period_history oldest first, aging_history newest first, ratio_history gaps, restatements, balance
  discontinuities, prior_covenants (with the prior CNL value) and prior closings. Pure; extend(None, ex) is ex;
  a prior that is not before the extraction's period raises ValueError. May→Jun→Jul→Aug month by month equals
  chain() and the reference object for all 3 F-PIL deals. Carried months get no `sources` entries (the schema
  requires a page); meta.history says "published <period>" and lists the carried pointers. worker/main.py passes
  `extend=history.extend` to handle_extraction when its signature accepts it (inspect), else the plain call. A PDF
  with no text on page 1 now fails with "page 1 has no text layer; cover block not found" (ExtractionError)
  instead of an IndexError. Tests: 62 in worker/extract/tests.
- 2026-11-03 — Data & API: seed paths require content. `app/seed.py` picks the first seed folder that holds
  partners.json and the first reference folder with a *.dashboard.json, so an empty compose mount point (api/seed) no
  longer shadows the real one. Decoy tests in tests/test_seed.py; 113 API tests pass.
- 2026-11-03 — Data & API: wave 1b schema parity. Merged lead/wave1-seams. `api/app/models.py` now matches migration 001
  for raw-SQL writers (worker/validate): the five timestamp columns have `server_default=now()` as well as the Python
  default, and ids are stored on SQLite as the dashed 36-character text PostgreSQL prints (was 32-char hex, so raw
  updates by the API's id matched 0 rows). New `tests/test_schema_parity.py` inserts an extraction with raw SQL (dashed
  upload id, no created_at) and reads it back through the API; it fails on the old models. 111 passed on SQLite and on
  PostgreSQL 16 built from db/migrations. Existing SQLite files built by the old models must be deleted and re-seeded.
- 2026-11-03 — Data & API: wave 1 deliverables 1–7. All 23 operations in `contracts/openapi.yaml` are real and backed by
  the database (SQLAlchemy models over 001 + new migrations 002/003). Seed: `python -m app.seed` loads seed/*.json
  idempotently; `--reference-publications` also publishes the 12 real deal objects for the partner portals. Uploads store
  the PDF under `FILE_STORE/uploads/<id>/source.pdf`, count pages with pypdfium2, push `{"upload_id","pass":1}` to
  `extract:jobs`, refuse a published period (R12, 409). Override resolves the finding, writes `override`/`restate` to the
  audit, re-runs `rules.run()` and merges findings (ids and resolutions survive). Approve refuses while a block finding is
  open, writes the publication and approve/publish/regenerate audit entries. Page images render at 110 dpi and are cached.
  Program roll-up (`api/app/rollup.py`) reproduces both real program files total for total and is computed on read.
  Partner scoping is `partner_filter` + `visible_programs` in `api/app/main.py`; another partner's program or deal is a 404.
  Run: from `api/`, `python -m pytest -q` (110 tests, SQLite); `TEST_DATABASE_URL=postgresql+pg8000://...` runs the same
  suite on PostgreSQL built from `db/migrations` (110 passed against postgres:16-alpine). Stubbed: regenerate only bumps
  `rollup_version` and audits (roll-ups are never stale); `actor_label` is the role until real sign-in. Needs: compose mount
  for the demo seed, contract fold-in of extra fields/errors, worker status/row conventions (all in `docs/requests.md`).
- 2026-11-03 — Lead: wave-1 seam decisions (branch lead/wave1-seams). Roll-forward terms: `charge_off` is the one
  name for the page-2 NPV adjustment (column i), already in the reference data; `new_funded` (+) and
  `ineligible_buyback` (−) are new optional period_history fields, all positive amounts. R05 is now opening +
  new_funded − principal − prepayments − losses − charge_off − ineligible_buyback. `covenants[].reported_triggered`
  (YES/NO) is in the schema and R18 uses it. rules.yaml also takes Rules' R03 range, R09 fn and R18 floor band.
  Compose: worker runs `python main.py` from /app (imports `extract`, `validate`, `rules`); api mounts
  docs/dashboard-json for the demo seed. Worker hand-off: worker/validate owns every database write
  (`mark_extracting`, `handle_extraction`, `mark_failed`); worker/main.py calls them.
- 2026-11-03 — Design System: wave 1 delivered on `agent/design`.
  Built: `web/src/design/components` (import everything from `@/design/components`): Button (primary / ghost /
  danger, sm, icon, loading), StatusPill plus UploadStatusPill / SeverityPill / FindingStatusPill / CovenantPill with
  the contract vocabularies mapped once (UPLOAD_STATUS, UPLOAD_TERMINAL for the 2 s polling stop, SEVERITY,
  FINDING_STATUS, COVENANT_STATUS incl. AVAILABLE), Card, KpiTile + KpiRow, DataTable (sticky header under the top bar,
  numeric columns right-aligned tabular, sort, row expand with controlled Expand all, clickable rows, footer totals,
  empty state, skeleton rows, compact density, fixed-height scroll), FindingCard (renders a finding.schema.json object
  as is: rule id, severity, status, message, ours / report / difference / tolerance by unit, context arithmetic,
  source page, resolution; crop slot and action slot), Field + Input / Select (grouped options) / Textarea, FileDrop
  (accept + size validation, keyboard), ToastProvider + useToast (bottom-right, 6 s, pause on hover, max 3), Dialog
  (focus trap, Escape, focus return, alertdialog, non-dismissable while busy), Breadcrumb, SkeletonBlock, PageHeader,
  StatePanel (empty / error / no-access / not-found), format helpers (formatCurrency, formatPercent, formatNumber,
  formatSigned, formatPeriod, formatByUnit, formatDiffByUnit), inline SVG `icons`.
  Shell (`web/src/shell`): user-card role switcher in the sidebar footer (menu, arrows / Enter / Escape), Workspace /
  Account nav with icons, top bar = PageHeader fed by `usePageHeader()` from `@/shell/header`, breadcrumb derived from
  the registry, lazy page registration via `load` in `pages.ts` with a route progress bar + skeleton, page transition
  on the content column only, StatePanel no-access and not-found (with Go to home), ToastProvider around the app,
  `--ds-sticky-top` published for table headers, print stylesheet hides sidebar and actions.
  Run: `cd web && npm install && npm test` (115 tests incl. a tokens-only lint over design/ and shell/),
  `npx tsc --noEmit`, `npm run build`, `npm run storybook` (:6006) or `npm run build-storybook`. Stories use the real
  program JSON in docs/dashboard-json and the R05 finding fixture; nothing invented.
  Stubbed: no page components (UI agents); FindingCard page crop is a slot the page fills from
  `/uploads/{id}/pages/{n}.png`. Not checked in a browser by me (no dev server reachable from my session); the
  Storybook build and jsdom tests pass. Needs: see Design System in docs/requests.md (package.json, .storybook owner,
  make check running the web suite).
- 2026-11-03 — Extraction: wave 1b seams (merged lead/wave1-seams). The page-2 NPV adjustment is emitted as
  `period_history[].charge_off`; `new_funded` and `ineligible_buyback` stay, positive amounts, only where the
  layout prints them (Moneda: charge_off; Stride: new_funded, ineligible_buyback; Xpedite: none). All 12
  extractions validate and close the new R05 identity within $1 (tested directly until Rules' checks.py lands).
  `worker/main.py handle()` calls validate's mark_extracting / handle_extraction / mark_failed, keeps writing
  `extraction-pass<n>.json`, and falls back to disk-only without the adapter; tests cover success, pass 2,
  extraction failure and hand-off failure with fakes, plus a `python main.py`-style import from worker/.
  Requirements: `worker/requirements.txt` (runtime) and `worker/requirements-dev.txt` (pytest, pypdf).
  Run: `pip install -r worker/requirements-dev.txt && python -m pytest -q worker/extract/tests`.
- 2026-11-03 — Extraction: wave 1 deliverables 1–6 on `agent/extraction`. `extract(pdf, template_id, pages=None)`
  in `worker/extract/` reads the text layer with pdfplumber (repairs Excel's phantom spaces inside numbers,
  detects negative signs by geometry, aligns blank cells by column edges), parses sections by heading through
  `templates/fpil-2.0-settrep-v1.yaml`, derives the dashboard fields (current period rows, ratio_history,
  cnl_by_period with limits, covenants with status/trend/utilization, summary, financial_ratios) and records a
  source (page, bbox, raw text) for every leaf. Result: the 3 F-PIL reference objects reproduced field for field
  from their PDFs (`history.chain` over the 4 reports per deal; tolerance $0.01 / 0.0001), every one of the 12
  PDFs matches its period's rows, all pass phase-1 rules with no block finding, and a copy of Moneda 202608 with
  one digit changed on page 2 fails R05 by exactly −100.00. Claude fallback (`ANTHROPIC_MODEL`) is asked only
  for unplaced cells, JSON-validated, every call logged; the 12 samples need none. Pass 2 re-reads named pages
  and returns a patch (`merge_patch` applies it). `worker/main.py` runs jobs and hands off to `worker/validate`.
  Run: `python -m pytest -q worker/extract/tests` (≈2 min; sample tests skip without `data/samples/`);
  `python -m worker.extract.compare <pdf> <reference.dashboard.json>`. Stubbed: OCR fallback (pages without
  text are listed in `meta.pages_without_text`), MOVE Trust template, the validate hand-off. Needs: see
  docs/requests.md › Extraction (pypdf, compose worker path, R05 extra terms, reference quirks).
- 2026-11-03 — Rules, wave 1b (seams): merged lead/wave1-seams. R09 resolves from rules.yaml (FN_FALLBACK gone).
  R05 adds `new_funded` (+) and `ineligible_buyback` (−) beside `charge_off`, named in context and message when
  non-zero; R18 checks `covenants[].reported_triggered` (YES ⇔ BREACH). New fixtures r05-new-funded,
  r05-ineligible-buyback, r18-reported-triggered (Moneda, SLFA 9.1 (h) answered YES at ICR 1.27 vs 1.10).
  `worker/validate` now owns the worker's database writes: `mark_extracting`, `handle_extraction` (extraction row,
  reporting_period, findings, pass-2 enqueue on retryable block findings or needs_review, pass-1 findings marked
  resolved_by_pass_2), `mark_failed` (status + audit row); opens its own transaction on DATABASE_URL when no
  connection is passed. `build_context` returns the API's override Context shape. Run: `cd rules && python -m pytest -q`
  (75), `cd worker/validate && python -m pytest -q` (12, SQLite). Not tested on PostgreSQL here (no libpq locally).
  Needs: worker/main.py to call the three functions (Extraction); AuditEntry.action decision; earlier open items
  (Stride/Xpedite covenant seed, deal facility limit, `make check` line).
- 2026-11-03 — Rules: every phase-1 and phase-2 rule implemented in `rules/checks.py` (R01–R15, R17–R19); R16 and
  R20–R22 (phase 3) not implemented. Each has `rules/tests/fixtures/<rule>-pass.json` / `-fail.json` (a real deal
  object plus one recorded change, generated by `make_fixtures.py`) and frozen expected findings under
  `fixtures/findings/`. On the 12 reference deals with seeded master data: no block findings except R05 on Finloc
  and TLFC LP (Meridian now closes: R05 subtracts its NPV adjustment `charge_off`); R18 reproduces every
  ceiling/floor status, worst_status and covenant_summary; one review finding pair (R14 on Stride, seed issue);
  one R19 note (Essex ICR OK → WATCH). `run()` over one deal ≈ 25–70 ms. `worker/validate/`: `SqlStore` +
  `validate_extraction(store, extraction_id)` builds prior / master / published periods / upload from the
  database, plus `retry_pages`, `resolved_by_pass_2`, `counts`, `insert_findings`. Run:
  `cd rules && python -m pytest -q` (72) and `cd worker/validate && python -m pytest -q` (6). Stubbed / limited:
  R02 has no report currency field to read except Finloc's by_currency; R10 and R17 compare multiples to the
  printed ratio history (no EBITDA / interest captured); R17 skips "(Definitions)" trigger tests; R15 lacks a
  deal-level facility limit; R18 cannot check page-14 YES / NO. Needs: see `docs/requests.md` › Rules (R09 `fn`,
  R05 / R18 / R03 wording, Stride/Xpedite covenant seed, deal facility limit, worker mount path, `make check` line).
- 2026-11-03 — Rules, wave 1c (history chaining): `handle_extraction(job, extraction, conn=None, enqueue=None,
  extend=None)`. With `extend`, the extraction is chained onto the prior publication (the same one build_context
  hands the rules as ctx.prior, via `prior_publication`) before it is validated and stored, so the stored row,
  the findings and a later approve all carry the full history. No prior: stored unchanged, extend not called.
  extend raises: logged, unchained document stored with a note in `meta.notes`, upload not failed. On all 12
  reference deals, the chained object against the previous month as prior raises no block or review finding the
  single-month extraction does not; R11's restatement check finds the chained earlier months equal to the prior.
  Chaining removes three R11 blocks (Dynamic, Essex, TLFC LP: opening gap = tranche funded since the prior) when
  the prior has no tranche list, because the chained `balance_discontinuities` explain the gap; with a prior that
  carries `all_tranches`, R11 explains them either way. Run: `cd rules && python -m pytest -q` (76),
  `cd worker/validate && python -m pytest -q` (16). Needs: Extraction's `worker/extract/history.py: extend`
  (main has only `chain`) and worker/main.py passing `extend=` to `handle_extraction`.
- 2026-11-03 — UI-Partner, wave 1: `web/src/portfolio/`. Portfolio Executive Summary (a card per program the caller
  may see: balance with change, utilization, covenant counts, deals flagged; flagged-deals table; Go to deal picker
  grouped by program), Program Executive Summary (tiles, escalations, a card per deal with OK / WATCH / BREACH and a
  link, prev / next program, period picker), Program Dashboard (Portfolio Metrics tiles and a deal table; Covenant
  Status & Review, one row per deal × covenant with status, value, threshold, utilization, trend; expand row →
  covenant detail with last period; Expand all / Collapse all; Flagged only; watch threshold pop-up, display only;
  Print / Save as PDF expands every row, prints, restores; print stylesheet), Deal page (Deal Metrics tiles,
  roll-forward, facility and contracts, balance history, aging by period, losses and CNL by vintage, borrower and
  portfolio ratios, covenant table with legal ref and description, ratio history as an inline SVG, one series,
  latest 13 months; prev / next deal; period picker) and, in the TAO Admin shell only, an upload strip (status of the
  period's upload, link to its review page, any newer upload). Data only from `/published/*` (plus `GET /uploads?deal_slug=`
  for the admin strip, admin shell only); 404 shows "You don't have access". Every number on screen carries its path
  in the published object (`data-field`). Tests: `cd web && npx vitest run src/portfolio` (55: the 12 deals and 2
  programs rendered and every displayed number read back against the reference files within $1 / 0.01 pp; states,
  access, navigation, dashboard controls, print, admin strip; tokens only). Over HTTP:
  `PF_LIVE_API=http://localhost:18300 npx vitest run src/portfolio/__tests__/live.test.tsx` (16, against a stack
  seeded with `--reference-publications`: all 12 deals and both programs equal the reference). Checked in a browser
  on :5176 against that stack. Print: width checked by applying the print rules at A4's 186 mm content width
  (no element overflows with all 98 MOVE Trust covenant rows expanded, about 14 pages); a real print to A4 / Letter
  was not run. Stubbed: admin program / dashboard / deal pages ride on query parameters until the nested admin routes
  exist; Reports, Report viewer and Data room are not built. Needs: see `docs/requests.md` › UI-Partner.
- 2026-11-03 — UI-Review, wave 1 (deliverables 1–3) on `agent/ui-review`. Registered in `web/src/shell/pages.ts` (load
  fields only). Approval queue (`/admin/uploads/queue`): needs_review (+ approved) uploads oldest first, deal and program
  names from master data, finding counts as severity pills, row or link opens the review. Review report
  (`/admin/uploads/queue/:uploadId`): header facts (deal, collection period with settlement date, reporting period,
  uploader, extraction pass and re-read pages, confidence, open/resolved counts); findings grouped block → review → note as
  FindingCards with the rule title from `contracts/rules.yaml`, the page image fetched with the role headers, centred on the
  report-value cell and outlining every cell the rule read (bboxes from `sources`), click for a page viewer with
  Fit/100/150/200 % and previous/next page; per-card Use ours / Use report / Accept as restatement / Acknowledge for
  `tao_admin`, each requiring a reason, then the findings refresh from the override response. Extracted values panel:
  balances, month-by-month roll-forward, contracts, aging, CNL by vintage, covenants, financial ratios and ratio history,
  each value or row with a page link (opens the viewer on that cell with its raw text) or "from published Jul 2026" for
  carried months. Activity table from `/audit` (admin only). Sticky footer: Re-extract pages… (pages with open findings
  preselected, then 2 s polling until the pass settles), Reject… (reason), Publish to partner… (disabled with the reason
  while a block is open; shows the API's 409 if it refuses). Analysts see everything read-only; partner roles get "no
  access" and no intake request. Reports library (`/admin/reports`): published uploads by program, deal and period with
  filters, Partner view and Review record links, Regenerate dashboard pop-up (all programs or one).
  Verified against the private stack (tao-ui-review, :18200 via Vite on :5175): the walkthrough ran in a browser and again
  over HTTP — R05 block on page 2 (−$100.00) with its crop, override use_ours with a reason, finding overridden and
  publish enabled, approve → published, `/audit` has the override with ours 15,020,071.52 and report 15,019,971.52; analyst
  403 on override/approve, approve 409 while blocked. Run: `cd web && npx vitest run src/review` (45 tests; fixtures are
  recorded real API responses). Needs: see docs/requests.md › UI-Review (percent_points formatting, narrow FindingCard,
  admin deal route for Partner view, override-vs-published question, MSYS path note).
- 2026-11-03 — UI-Admin, wave 1 (all five work packages): eight pages in `web/src/admin/`, registered in
  `web/src/shell/pages.ts` (`load` only). Upload report: deal (grouped by program) and collection period first, then
  the PDF; after upload it shows the collection period as entered and the reporting period read from the report,
  the status pill and steps moving received → extracting → needs review with 2 s polling (stops at needs review or
  any other settled state), finding counts, an R04 note when the two dates are not one month apart, a review link,
  and plain-language 409 / 422 / 403 errors. Uploads: four queue tiles (received, extracting, needs review, published
  this month) and the ten latest uploads. Upload history: deal / period / status filters kept in the URL, status
  pill, block / review / note counts, who / when, Review and Audit links. Dashboard: Programs, Deals, Flagged deals
  (worst status BREACH or WATCH) from `/published/portfolio`, covenant totals by program, the queue tiles, latest
  uploads; empty state when nothing is published. Partners → Partner details → Program / facility record: limits,
  deals with template id, covenant definitions with single or banded thresholds, watch buffer, effective date,
  version state (in force / superseded / scheduled) and source; `tao_admin` edits programs, deals and covenants
  (edit in place or add a new version) through the PUT routes; other roles get a read-only view. Audit log: upload
  filter (API) and action filter, expandable detail, deep link `?upload_id=` from Upload history. Every page has
  loading, empty, error (with retry) and no-access (any 403) states. Run: `cd web && npx vitest run src/admin`
  (53 tests, `api()` mocked); dev against a private stack: `MSYS_NO_PATHCONV=1 VITE_PORT=5174
  VITE_API_PROXY=http://localhost:18100 VITE_API_URL=/api/v1 npx vite`. Verified: the upload journey against Prism
  (static examples, so status stays `received`) and against the real stack as `tao_analyst` in the browser
  (received → extracting → needs review in about 14 s, reporting period 2026-06 for a 2026-07 PDF filed as 2026-10,
  R04 note shown, 4 block findings, polling stopped); PUT program / deal / covenant on the real API with the
  dialogs' bodies, then the master_change entries in the Audit log. Lighthouse accessibility 96 on Upload report and
  Upload history (only failure: Design System colour contrast). Needs: see `docs/requests.md` › UI-Admin.
- 2026-11-03 — QA & Demo: Playwright suite in `tests/e2e/` (own package.json + lockfile, @playwright/test 1.56.1,
  lighthouse 13.5.0). Projects: `setup` (stack up, seeded, fresh; seeded-error PDF via `scripts/demo_data.py`; May–Jul
  published for Moneda, Xpedite, Stride through the API), `demo` (steps 1–7 of the build plan's demo script, each
  switching role through the sidebar user card and asserting on visible text and on API state with the role-header
  client, plus negatives: analyst 403, publish 409 while R05 is open, partner tenancy by URL and API, partner and analyst
  on TAO routes, blank PDF → extraction_failed), `wave3` (manager sees both programs, /master/partners, covenant unit,
  Use ours writes 15,020,071.52 with data_corrections; expected red until merged). Result from `docker compose down -v`
  on the QA stack: 16/16 green in 8 min (a second clean run lost step 4 to the API page-image crash filed to Data & API, the rest green after an API restart); wave3 4/4 red for the expected reasons. `docs/demo.md` is the walkthrough with
  27 screenshots in `docs/demo/` and the acceptance table measured (Xpedite deal page: 154 numbers, 0 mismatches against
  the shared dashboard; upload to needs review 6–32 s; Lighthouse 93–96; full demo 11 min 17 s, over the 10-minute
  target). Run: see `docs/demo.md` › Run it. Stubbed: step 6's covenant toast (not built, no data) and step 7's
  re-upload (API refuses, R12). Needs: see `docs/requests.md` › QA & Demo.
- 2026-11-03 — UI-Partner, wave 3: merged integration/wave3. Admin-shell portfolio links now use the nested routes
  (`/admin/portfolio/:programId`, `/dashboard`, `/deals/:dealId`); tests updated. Router links use `<Button as="link">`;
  my KPI minimum width is gone (tiles no longer ellipsize). Deal page: "Data corrections" section from `deal.data_corrections`
  only (six MOVE Trust reference deals carry one each). Ownership per program_partner: both partners see both programs; an
  unknown program (404) shows "You don't have access". Tests: `cd web && npx vitest run src/portfolio` 60 passed (17 live
  tests skipped without PF_LIVE_API); live against tao-ui-partner seeded with `--reference-publications`: 17 passed. Browser
  check on :5176: manager sees MOVE Trust Dynamic Capital with its correction; admin nested dashboard links to nested deal routes.
  Known red test outside my folder: UI-Review ReportsLibraryPage "deepest registered portfolio route" (see requests).
- 2026-11-03 — Data & API: wave 3b. Merged agent/rules (7d05e5b, findings carry `targets`). Override re-runs refresh
  `targets`. Approve plans every resolved use_ours / use_report write first: different values for one pointer → 409
  `conflicting_corrections`; equal values are written once. After writing, if anything changed, the rules re-run on the
  corrected deal and any block finding no resolved finding covers → 409 `correction_inconsistent`; derived fields are not
  hand-computed. Seeded demo: use_ours writes 15,020,071.52 to all five R05 targets, the R05 identity holds on the
  published deal (opening − components = 15,020,071.52) and approve succeeds; use_report changes nothing. Also normalised
  my files back to LF (earlier edits had written CRLF). 125 API tests pass on SQLite and PostgreSQL.
- 2026-11-03 — Data & API: wave 3. Merged main (e20ce7d) and lead/wave3. Multi-partner programs: `ProgramPartner` model over
  004; Program and Upload return `partner_slugs` (partner_slug = the first); `visible_programs` reads program_partner, so the
  manager now sees MOVE Trust and F-PIL and a partner not listed gets 404. `PUT /master/programs` takes `partner_slugs` (or
  `partner_slug` alone) and audits. New `GET /master/partners`; `CovenantDefinition.unit` on GET/PUT; `GET /uploads?collection_period=`
  and `GET /audit?action=`. Overrides: use_ours / use_report need `targets` (else 409 `no_target`); approve writes the chosen
  value to every target in the published deal (the extraction is untouched) and appends one `data_corrections` entry per
  changed pointer, listed in the approve audit detail. Migration 005 adds `finding.targets`. Seed loads `partner_slugs` and
  `unit` idempotently. 122 tests pass on SQLite and on PostgreSQL 16 built from db/migrations 001-005. Waiting on Rules:
  adapter must write `targets`, and the r02 fixture needs regenerating after the seed patch (see requests.md).
- 2026-11-03 — Rules, wave 3 (override targets): findings carry `targets` (finding.schema.json) where use ours /
  use report should change the published value. Each target is the field plus every other copy of the same number
  in the deal (to the cent for money, exact for counts and ratios); the current period row is found by
  collection_period, so pointers are right in single-month and chained objects. Tests: every target in every
  fixture, and in all 12 reference deals as single-month and chained objects with seeded errors, resolves to
  report_value; writing our_value to the targets makes the finding go away. `insert_findings` writes `targets` when
  the finding table has the column (it does not yet: see requests.md). Run: `cd rules && python -m pytest -q` (80),
  `cd worker/validate && python -m pytest -q` (17).

  | Rule | Finding | targets | Why |
  | --- | --- | --- | --- |
  | R01 | field missing | none | nothing to choose between |
  | R02 | currency vs facility | none | text, master data |
  | R03 | value out of range | none | no our_value to write |
  | R04 | periods | none | months, other period |
  | R05 | roll-forward | current `period_history[i].closing_balance` + copies: `tranche_balance.closing`, `period_history[i].closing_amount`, `tranche_amount.closing`, `program.program_amount` | our_value = computed closing (Lead decision) |
  | R05 | page-2 vs roll-forward row | `tranche_balance.opening` or `.closing` | our_value = the row's figure for the same field |
  | R06 | contracts roll-forward | `contracts.closing` + `period_history[i].closing_contracts` when equal | our_value = opening + change |
  | R06 | top-mover row | `contracts.top_movers[j].closing_contracts` | same, per tranche |
  | R06 | movers exceed net decrease | none | aggregate, no single field |
  | R07 | aging buckets | `aging_history[0].closing_balance` | our_value = bucket sum |
  | R08 | vintage gross − recoveries | `cnl_by_period[i].cumulative_net_losses` | our_value = computed CNL |
  | R08 | vintage ratio | `cnl_by_period[i].cnl_ratio_reported_pct` if stored, else `.cnl_ratio_pct` | the field report_value came from |
  | R08 | vintage total vs page 11 | `aging_history[0].cumulative_net_losses` | our_value = vintage sum |
  | R09 | unused / utilization | `program.unused_facility` / `program.program_utilization_pct` | recomputed from limit and drawn |
  | R10 | enhancement % | `total_enhancement.total_enhancement_pct` | recomputed |
  | R10 | coverage / leverage / equity | `financial_ratios[k].value` + same-number covenant `current_value`s | our_value = the ratio-history row |
  | R11 | opening vs prior, restatements | none | other period; restatement is accept / reject |
  | R12, R13 | published period, wrong deal | none | not a value |
  | R14, R15 | thresholds, limits | none | master data |
  | R17 | covenant recompute | `covenants[i].current_value` + same-number copies (other covenants on the metric, `financial_ratios`) | our_value = recomputed |
  | R18, R19 | status, YES/NO, summary, status change | none | statuses / text |
- 2026-11-03 — Design System: wave 3 fixes on `agent/design` (merged main e20ce7d and lead/wave3 72c66e8).
  (1) `percent_points` findings are fractions: formatByUnit / formatDiffByUnit multiply by 100, so Stride R14 reads
  ours 4.00%, report 3.50%, difference −0.50 pp, tolerance ±0.00%; context fractions follow, context amounts in a
  percent_points finding (R10 enhancement_amount, base) stay plain numbers. (2) FindingCard is a size container: under
  680 px the values go to two columns and the page crop moves below them; the values never overlap. (3) Contrast, WCAG
  AA (4.5:1), hues kept and darkened (ratios are the worst case over the listed surfaces):

  | Token | Surfaces | Old | Old ratio | New | New ratio |
  | --- | --- | --- | --- | --- | --- |
  | `--muted` | cream, card, canvas-deep, lav | #8b8597 | 3.09:1 lav, 3.43:1 cream, 3.56:1 card | #6e687a | 4.64:1 lav, 5.15:1 cream, 5.35:1 card |
  | `--ok` (pill word) | ok-bg, cream, card | #1f9d6b | 3.07:1 (ok-bg) | #187b54 | 4.67:1 (ok-bg) |
  | `--warn` (pill word) | warn-bg, cream, card | #bd7a18 | 3.12:1 (warn-bg) | #976113 | 4.60:1 (warn-bg) |
  | `--bad` (pill word) | bad-bg, cream, card | #d24b46 | 3.57:1 (bad-bg) | #be332e | 4.66:1 (bad-bg) |
  | `.navlabel` → new `--text-on-indigo-muted` | indigo, indigo-2 | color-mix = #8c86b3 | 4.04:1 (indigo) | #a49fc3 | 5.45:1 indigo, 4.67:1 indigo-2 |
  | `--blue`, `--dpv` (unchanged) | own -bg, cream, card | #2f5fd0, #6a37d8 | 5.00:1, 5.57:1 | same | same |

  New token `--line-on-indigo` (sidebar hairline, decorative). A test recomputes every pair from tokens.css.
  (4) KpiTile values never ellipsize: font size follows the tile width (clamp 16 px to --fs-kpi, container units),
  then wraps. (5) pages.ts: admin routes `/admin/portfolio/:programId`, `/dashboard`, `/deals/:dealId` (owner
  portfolio, no nav); `tao_analyst` on Partners, Partner details, Program record. (6) `apiBlob(path)`, `roleHeaders()`
  and `API_BASE` in shell/api.ts; `Button as="link" to` (router) and `as="a" href`, disabled renders an aria-disabled span.
  Tests: web 303 passed, 16 skipped, 2 failed — both are UI tests that pin the pre-registration fallback (see
  docs/requests.md, To UI-Partner / To UI-Review). api 112 passed, 1 failed (`/master/partners` parity, pre-existing).
  Not checked in a browser by me; layout fixes rely on container queries (supported in current Chrome, Edge, Firefox, Safari).
- 2026-11-03 — UI-Review, wave 3 (corrections) on `agent/ui-review`, merged with integration/wave3. Override dialog: Use
  ours / Use report only when the finding has `targets` (otherwise disabled on the card and in the dialog, with the reason);
  for a value choice it says what publishing does ("Writes $15,020,071.52 to 5 fields: Roll-forward Aug 2026 · closing
  balance, Tranche balance · closing, …", pointers as readable labels; "Nothing changes" when the extraction already holds
  the value); R05 / R07 add the hint that Use report is right when a component was misread. Resolved value choices show
  "Pending on publish" (then "Published") on the card. Publish dialog lists the corrections approve will write (field,
  extracted, published, rule and choice) and shows 409 `conflicting_corrections` (field, both values, rules) and
  `correction_inconsistent` (the new block findings) with "Go to R0x" buttons that close the dialog and focus the card.
  Page images use `apiBlob`; link-buttons use `<Button as="link">`. Verified live (tao-ui-review, migrations 004/005 on a
  fresh volume): use ours on the seeded R05 → published closing 15,020,071.52 with five `data_corrections` entries (period
  history closing balance and amount, tranche balance closing, tranche amount closing, program amount); after a reset, use
  report → published closing 15,019,971.52, no `data_corrections`, approve audit `corrections: []`; analysts see no buttons;
  Stride R14 (no targets) shows use ours / use report disabled. Run: `cd web && npx vitest run src/review` (52 tests).
- 2026-11-03 — UI-Admin, wave 3 follow-ups: Partners and Partner details read `/master/partners` (real names, kind,
  status; a partner without programs shows, with "None yet"); a program counts for every partner in `partner_slugs`
  (older API: `[partner_slug]`). Program record shows "Visible to", and `tao_admin` edits it in the program dialog
  (a checkbox per partner, at least one required, `partner_slug` = first checked). Covenant thresholds format by
  `unit` (fraction / ratio / currency), old guess only when `unit` is null; the covenant dialog has a Unit select
  and sends `unit`. Upload history sends `collection_period` and the Audit log sends `action` to the API (client-side
  filtering removed). Live on the tao-ui-admin stack (fresh volumes, seed, `--profile admin`): tao_analyst sees all
  three Partners pages read-only (note, no edit controls); tao_admin unchecked Manager on F-PIL 2.0 in the dialog,
  the API returned `partner_slugs: ["investor"]`, Manager's details page then listed only MOVE Trust and the
  Manager program URL for F-PIL showed "No such program"; restored through the dialog. Lighthouse accessibility 100
  on Upload report and Upload history. Run: `cd web && npx vitest run src/admin` (58 tests).
- 2026-11-03 — Rules, corrected re-issues: R12 on an upload with `replaces_upload_id` still blocks, with "Corrected
  re-issue: replaces the {period} report published {published_at}." and, when later months are published, "Later
  published months (...) still carry the earlier figures for {period}." Context has replaces_upload_id, published_at,
  later_periods; no targets (acknowledge with a reason, or reject). A plain duplicate keeps its message. The
  worker's `build_context` reads `replaces_upload_id` once migration 006 adds the column (absent: None), and passes
  `published_periods` as {period: published_at} so the message carries the date. History chaining on a re-issue
  uses the last publication before the period (`prior_publication`, strict <), never the one being replaced; tested
  end to end. Fixtures r12-reissue and r12-reissue-later. Run: rules 84, worker/validate 19.
- 2026-11-03 — Data & API: page-image crash fixed. PDFium is not thread-safe and concurrent first renders killed the
  uvicorn process silently. `api/app/pdf.py` puts every PDFium open, render and save (page counting on upload included)
  under one process-wide lock, and writes each PNG to a temp file in the page folder before `os.replace`. Burst of 12
  parallel requests for pages 3-8 on a private stack: before, 1 of 4 bursts killed the server (health timed out) and
  others served 11 valid PNGs of 12; after, 6 of 6 bursts gave 12/12 valid PNGs with health 200. New
  tests/test_page_concurrency.py; 128 API tests pass on SQLite and PostgreSQL.
- 2026-11-03 — Data & API: corrected re-issues. `POST /uploads` takes `replace`; a published period without it is still
  409 `already_published`, `replace` with no publication is 422 `nothing_to_replace`, and with one the upload records
  `replaces_upload_id`. Approve swaps the publication row to the new upload (rollup_version + 1, publish audit names
  `replaced_upload_id`); the old upload stays `published` and reports `replaced_by_upload_id` (derived). Migration 006 adds
  the column and stops a `published` upload counting as the period's active upload, so the re-issue can be uploaded while
  one-in-flight still holds. The Upload dict in the override Context carries `replaces_upload_id`. 133 API tests pass on
  SQLite and PostgreSQL (migrations 001-006).
- 2026-11-03 — UI-Review, corrected re-issues (merged integration/wave3 fbb7d41). Review page: a banner on a re-issue
  ("Corrected re-issue of Moneda Capital Corp. Jul 2026. Publishing replaces the report published …", link to the replaced
  upload's review record) with the later-months warning from R12's `later_periods`; past tense once published; on a
  replaced upload a note and footer link to the re-issue. R12 card on a re-issue: one primary "Accept as replacement"
  (acknowledge + reason; the dialog relabels Acknowledge and hides the empty ours/report values). Publish dialog: "Replaces
  the report published …" plus the later-months note. Queue tags re-issues; Reports library shows "Re-issue" / "Replaced"
  status, "Replaces earlier report" / "Replaced by re-issue" links, and no Partner view link on a replaced row. Verified
  live (tao-ui-review, fresh volume): published Moneda Aug, re-uploaded Moneda 2026-07 with replace=true → R12 "replaces
  the 2026-07 report published … Later published months (2026-08) still carry the earlier figures for 2026-07"; Accept
  as replacement + publish in the browser → old upload `replaced_by_upload_id` = the re-issue, publish audit
  `replaced_upload_id` = the old one. Tests: `cd web && npx vitest run src/review` (62; Reissue.test.tsx on recorded responses).
- 2026-11-03 — UI-Admin, corrected re-issues: Upload report turns 409 `already_published` into a confirm dialog
  ("{deal} {period} is already published (on {date}). Upload this file as a corrected re-issue? ...") whose primary
  button resends with `replace=true`; when the chosen deal + period already has a published upload (looked up with
  `GET /uploads?deal_slug&collection_period&status=published`) the form also offers a "This is a corrected re-issue"
  checkbox; 422 `nothing_to_replace` reads as a plain sentence; the progress card says what the re-issue replaces.
  Uploads, Upload history and the Dashboard list tag "Re-issue" (`replaces_upload_id`) and "Replaced by re-issue"
  (`replaced_by_upload_id`), both linking to Upload history for that deal and period. Live (tao-ui-admin, fresh
  volumes, seed, `--profile admin`): re-issued Moneda 2026-08 through the UI via the 409 → confirm path; it reached
  needs_review in about 25 s with `replaces_upload_id` = the published upload and one R12 block ("Corrected re-issue:
  replaces the 2026-08 report published ..."); after acknowledge + approve over the API the history showed
  "Re-issue" on the new upload and "Replaced by re-issue" on the old one. Run: `cd web && npx vitest run src/admin` (63).
- 2026-11-03 — Data & API: the override re-run Context passes `published_periods` as {collection_period: published_at}
  like worker/validate, so a re-run R12 names the publication date. Test in tests/test_reissue.py; 134 API tests pass on
  SQLite and PostgreSQL.
- 2026-11-03 — QA & Demo, final round on integration/wave3: wave-3 assertions folded into the demo (step 3 manager sees
  the same Xpedite numbers; `specs/03b-master-data.spec.ts` partners and covenant unit; step 5 Use ours publishes
  15,020,071.52 with data_corrections), step 7 rewritten as a corrected re-issue of Moneda 2026-05 (confirm → R12 →
  Accept as replacement → publish → replaced_by → regenerate → partner page), toast clause removed, tenancy negatives
  add unknown / missing X-Partner, setup publishes 7 history months instead of 9. Two clean runs from `down -v`:
  18/18 and 18/18, 5 min 16 s and 4 min 43 s including start and seed. Lighthouse 100 / 96 / 100 / 100. docs/demo.md
  and its screenshots are current. Needs: see `docs/requests.md` › QA & Demo (resolved-card contrast, R12 message
  timestamp, five stale screenshots).
- 2026-11-04 — Rules: merged lead/covenants. With Stride's and Xpedite's own definitions, R14 raises nothing on
  the 12 reference deals (the Stride pair was the seed copy); Xpedite's ARFA refs are now compared, banded 9.1 (b)/(c)
  included. R14 skips a definition with no threshold and no threshold_rule (Stride 9.1 (g), per vintage). Fixtures
  unchanged (r14/r15 are Moneda). Rules 86, worker/validate 19. The Stride/Xpedite seed request in requests.md is resolved.
- 2026-11-04 — Lead: Stride and Xpedite covenant definitions replaced (branch lead/covenants). They were copies of
  Moneda's. Now from each 2026-08 report's covenant page, marked UNVERIFIED: Xpedite ARFA dated 2022-10-14, 9.1 (b)/(c)
  banded 6%/3% and 4%/2% on NPV ≤ / > $10M, (d) 3.0%, (f) CNL 2.75%, (e) ICR ≥ 1.10, (g) leverage ≤ 10, (h) equity
  ≥ $3,000,000. Stride SLFA dated 2021-02-05, amended 2026-01-22 (footnote, page 11): (d) 3.50%, (e) 2.50%, (f)
  3.5%, effective 2026-01-22 (pre-amendment values are not printed); (g) CNL is per vintage (3.50% for Sept 2021 -
  Aug 2022, 2.75% otherwise), so no scalar threshold; R08 checks it per vintage. R14 now raises nothing on the
  three F-PIL reference deals (Stride had two false reviews; Xpedite was never compared). 21 -> 18 definitions.
- 2026-11-04 — Data & API: merged lead/covenants (18 definitions; Stride and Xpedite have their own). `PUT /master/covenants`
  now accepts a definition with both threshold and threshold_rule null (Stride SLFA 9.1 (g), limit per vintage); the seed
  test counts the seed files instead of literals. Re-seeding an existing database leaves the 3 retired Stride/Xpedite rows
  in place (no superseded flag in the model; see requests.md). 135 API tests pass on SQLite and PostgreSQL.
- 2026-11-04 — Rules, wave 2b (R11 FX, robustness): merged main (5b0edb1). R11 compares multi-currency deals per
  currency: when both objects carry by_currency, each currency's native opening is checked against its native prior
  closing (USD from usd_closing_raw, or from the CAD equivalent ÷ spot_rate) within tol.currency. The CAD-equivalent
  gap is revaluation, kept in context. Single-currency deals are unchanged. Finloc May–July raise no R11 (revaluation
  +64,124.04, +106,968.53, −47,609.31; native gaps 0.00, and the reference May USD cent is absorbed). A native break
  still blocks (fixture r11-fx-revaluation). Essex May's restatement still blocks. R05 and R07 now return a block
  finding naming null terms ("Cannot check: … missing … pass 2 or review") instead of raising a TypeError.
  engine.run turns any check that raises into a finding (block, or review for note rules), so a rule can no longer
  mark an upload extraction_failed. Over the 36 MOVE extractions: R11 ×4 (Essex May ×2, TLFC LP June ×2), R19 notes ×8,
  nothing else. Tests: rules 122, worker/validate 19, check_contracts green.
- 2026-11-04 — Rules, wave 2c (corrected MOVE references): merged lead/move-fixes. KNOWN_ROLLFORWARD_GAPS is now empty
  in test_engine.py and test_rules.py. All 12 reference deals pass every phase-1/2 rule with no block, and R05 closes on
  every period_history month of TLFC LP, Finloc and Meridian as the references stand. Fixtures were regenerated from the
  corrected references. r05-adjustment-increase / r05-charge-off-move now pass unchanged, and each fail case drops the
  one amount (the old gap: +2,782.68 / −4,163.85). A sign-lost read is tested separately (twice the amount). The R11
  Finloc tests hold: by_currency is unchanged and July's −47,609.31 is still revaluation. Tests: rules 123,
  worker/validate 19, api 135, check_contracts green.
- 2026-11-04 — Data & API: latest-month program view (merged main 9ce35c8 and lead/latest-month cb12a95). For month P
  (requested, or the newest collection_period across the program's publications) each deal contributes its latest
  publication with collection_period <= P; deals with nothing at or before P are left out. `deals_behind`
  ({deal_slug, deal_name, as_of}) lists the deals contributing an earlier month, on /published/programs/{slug} and on
  each /published/portfolio program entry; [] when all are current. available_periods, the deal endpoint and
  rollup.build_program are unchanged. A requested month not in available_periods (e.g. ?period=2026-09) is 404,
  so no month is built only from older reports (Lead's decision). Also `failure_reason` on the Upload dict: read from the audit row that
  failed the upload (worker/validate mark_failed reason, or 'queue unavailable'); null unless extraction_failed. No
  migration, no worker change. Needs from Lead: `failure_reason` on the Upload schema in contracts/openapi.yaml.
  Tests: api 141, check_contracts green.
- 2026-11-04 — Rules, worker/validate (migration 007): merged main (b40a3f3) and agent/api (dbf0e42).
  `SqlStore.covenant_definitions` now reads only current rows (`superseded_at is null`). Like `upload()`, it checks for
  the column first, so a database without migration 007 still works. Test: a later-dated superseded SLFA 9.1 (e) at
  4.00% next to the current 3.50% reaches neither the context nor R14; the same row left in force does raise R14.
  Tests: worker/validate 20, rules 123, check_contracts green.
- 2026-11-03 — Lead: day-0 scaffold. Contracts (OpenAPI 19 routes, extraction + finding schemas, 22 rules as
  data, tokens, motion), compose with five services, API role gates with tests, rules engine with R01/R05/R07 and
  reference-data tests, web shell with role switcher and every portal-map page routed, seed data, agent briefs.
  Findings from real data: F-PIL and six MOVE Trust deals close their roll-forward to the cent; three MOVE Trust
  deals do not (see rules tests); two aging conventions exist.
- 2026-11-04 — Data & API: superseded covenant definitions (migration 007). `covenant_definition.superseded_at`
  (timestamptz, null = current) plus a partial index on current rows. `python -m app.seed` compares each deal's
  definitions in the seed file with its current rows by content: identical rows are untouched, current rows the file no
  longer has get superseded_at = now, new rows are inserted (the uuid5 id unless an earlier version holds it, then a
  new uuid). Same file twice is a no-op; deals not in the file keep their rows. So a database seeded before the
  Stride/Xpedite fix is corrected by re-running the seed after applying 007; no `down -v`. Every API read takes current
  rows only (`views.covenants_as_of`: /master/covenants with and without as_of, and the override re-run context).
  An existing database needs `007_covenant_superseded.sql` applied by hand (initdb runs migrations only on a fresh
  volume). Needs from Rules: the one-line adapter filter in requests.md, or worker R14 still sees superseded rows.
  No contract change. Tests: api 144 on SQLite and on PostgreSQL (pg8000), check_contracts green.
- 2026-11-05 — Data & API (phase 2 wave 0 + wave A): migration runner, page images by dpi, audit split.
  Runner (`api/app/migrate.py`): at API start-up (and `python -m app.seed`) on PostgreSQL, applies every pending
  `db/migrations/NNN_*.sql` in order, each in its own transaction with its `schema_migrations` row, under a session
  advisory lock so two API processes never migrate at once. SQLite keeps create_all. Compose no longer mounts the
  migrations into initdb; the API mounts them at /migrations (`MIGRATIONS_DIR`), so a fresh volume is built by the
  runner alone. Baseline for a pre-runner database (app tables, no schema_migrations): each of 001-006 whose change is
  visible in the catalog is recorded as applied (`baseline = true`); 007 (now idempotent) and later always run.
  Every migration from 007 on must be idempotent. 008 adds `review_action_at` for the audit month and paging queries.
  Page images: `GET /uploads/{id}/pages/{n}.png?dpi=110|200|300` (default 110, anything else 422), cached per dpi
  under `pages/<dpi>/<n>.png`, still behind the PDFium lock with atomic writes. Old `pages/<n>.png` files are left
  where they are and never served.
  Audit (`api/app/auditlog.py`): `/audit` gains scope, month (America/Toronto), q, actor_role, deal_slug, limit
  (default 100), offset; scope=reports for both TAO roles, platform or no scope tao_admin only. `/audit/months` and
  `/audit/export.csv` (writes an `export` entry, platform). Scope is derived (reports = upload_id set, or publish /
  regenerate); `extract` rows untouched. Note for UI-Admin: `/audit` without limit now returns at most 100 rows.
  Tests: api 174 passed + 6 skipped on SQLite (the skips are the runner scenarios); 180 on PostgreSQL 16 via pg8000
  with TEST_DATABASE_URL and TEST_MIGRATE_URL on a throwaway container. Checked live on a `-p tao-api` stack: a
  database built by hand to 007 baselines 001-006 and runs 007 + 008 (data kept); a restart is a no-op; reset_demo
  --profile review from an empty volume builds the schema through the runner and runs the whole review profile.
- 2026-11-05 — Data & API (phase 2 wave B): covenant changes, value edits, corrections with publication versions.
  Migration `009_wave_b_editing.sql` (idempotent): covenant_definition gains origin (seed|ui; rows with an old
  master_change entry are backfilled to ui), supersedes_id, changed_by, change_reason, changed_at; publication gains
  version, correction_id, version_reason; new tables publication_version, correction (one pending per upload, partial
  unique index) and value_edit.
  Covenants: `PUT /master/covenants` takes mode new_version | correct | add and a reason (10+ characters, spaces trimmed)
  and never updates a row in place. correct supersedes the current row and inserts its replacement (same effective_from,
  supersedes_id); new_version needs a later effective_from; add needs a legal_ref the deal does not have. 409 not_current,
  exists, effective_not_later; 422 for a correct without id, a changed effective_from / deal / legal_ref, or new_version on
  an unknown legal_ref. Returns {definition, superseded_id, rerun_upload_ids}; re-runs the rules on the deal's needs_review
  uploads; master_change entry with before, after, mode, effective_from and the reason. `GET ?include_history=true` returns
  superseded rows too. The seed supersedes only origin=seed rows and never inserts into a (legal_ref, effective_from) slot
  held by a ui row (R11). The review context carries `master.covenants_recorded` (parity with worker/validate for R14).
  Value edits: `/uploads/{id}/edits` (GET, POST) and `/edits/{edit_id}/revert`. tao_admin only, needs_review or approved,
  numbers at an existing pointer only (a whole-number field stays whole). On a pointer the latest not-reverted edit is in
  force; revert falls back to the previous edit, else the extracted value. Re-runs and approve read the extraction with the
  edits applied; approve also re-runs first when edits exist, writes each edited pointer into the published deal and one
  data_corrections row (choice manual, edit_id, old = extracted value). A manual edit wins over use_ours / use_report on the
  same pointer: the approve detail lists the override target as replaced, and the override and value_edit entries both stay.
  Upload dict: active_edit_count (pointers with an edit in force), published_version, pending_correction_id.
  Corrections: `/uploads/{id}/corrections`, `/corrections`, `/corrections/{id}`, approve, reject. Edits apply to the live
  published deal; data_corrections rows carry edit_id, correction_id and version. The rules re-run with prior = published
  previous month and the corrected period left out of published_periods (no R12). A block that was resolved in the
  original review carries its resolution; any other open block queues the correction (B1), else it publishes at once as
  version n+1 (old version copied to publication_version, publish + regenerate entries, and later-period needs_review
  uploads of the deal re-run, their ids in the publish detail). Approve re-runs the rules first (409 open_block_findings
  while a block stays open) and refuses a correction whose base version is no longer live (409 bad_state). A corrected
  re-issue now also archives the old version (version_reason "corrected re-issue"). `GET /published/.../deals/{slug}`
  gains version, versions and `?version=n`.
  Fixed on the way: review.rerun inserted a new finding before its values were set (NOT NULL on layer); never hit before
  because no earlier re-run produced a finding the worker had not.
  Tests: api suite on SQLite (count in the commit), wave B files and test_master/test_reissue also on PostgreSQL 16 via
  pg8000, and 009 checked there for idempotency and the ui backfill. check_contracts green.
  Needs from others: UI-Admin sends mode + reason on PUT /master/covenants (the old body is now 422). worker/validate
  does not apply value edits after a pass-2 extraction; the API re-runs with edits on approve and on every edit, so
  findings written by the worker in between ignore edits until then. Correction findings cannot be overridden (no route
  in the contract), so a queued correction is approved only once a re-run no longer blocks, or rejected.
  Update after Lead 867d8f1: `POST /corrections/{id}/findings/{finding_id}/override` (tao_admin; restatement or
  acknowledge, use_ours / use_report 409 bad_choice; 409 bad_state when the correction is decided or the finding is not
  open) resolves a queued correction's finding; the resolution and finding id survive approve's re-run, and approve then
  publishes. Audit: override / restate with correction_id in detail. PublicationVersion carries note_to_partners, read
  from the correction (no schema change). active_edit_count is per value, as built.
- 2026-11-05 — UI-Partner, wave C: partner Team members page (D8 c) at `/<investor|manager>/settings/team`, Company
  Admins only (`web/src/portfolio/TeamPage.tsx`, logic in `team.ts`; pages.ts entry set to built + load, owner portfolio).
  Table: name (initials, "you" when /me names a user), email, role (Company Admin / Viewer), status (dot plus word),
  last active, reports received (`receives_summary`). Header actions Add user and Invite (same form; the invite email
  shows "coming later"). Edit dialog: name, email, role limited to the partner's admin / viewer (own role locked),
  deactivate / reactivate with a reason (no delete; own deactivation locked), and "Reports this person receives": a tree
  of the programs in `/published/portfolio` for this caller, each with "All deals in this program, including new ones"
  (deal_slug null) and per-deal boxes; in-app only, email "coming later". Saves PATCH only changed fields and PUT the
  whole subscription list only when it changed; unshared programs drop out. Notes on the page: Receives is notifications
  only, one active Company Admin always, nobody changes their own role. 409 last_admin / self_change / email_taken /
  other_partner and the 422 subscription codes show as plain sentences in the dialog. Viewers get the shell no-access
  state. Role-only mode works: every call carries X-Role + X-Partner through the shell api(), `/users?partner_slug=` is
  the caller's partner, and rows from any other partner are filtered out client-side too.
  Run: `npx vitest run src/portfolio` (team.test.tsx, 13 tests). Stubbed / needs: the drawer history (note 13) needs a
  Company Admin readable audit route (/audit is TAO only); the edit view is the Design System Dialog (size lg), there is
  no drawer component; "you" and the self locks appear only once the shell sends X-User (in role-only mode the API's
  409 self_change message shows instead).
