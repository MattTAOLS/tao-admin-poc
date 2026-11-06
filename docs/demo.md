# TAO Admin POC — demo walkthrough

The build plan's demo script (section "Demo script and acceptance", steps 1–7), then MOVE Trust month by month (step
9) and the wave B editing steps (step 10), run in order from a fresh database, with the screenshots the Playwright
tests capture on every run (`docs/demo/*.png`). Each step below is one test (or a few) in `tests/e2e/specs/`; the
negative tests sit between the steps where their state exists. Every number here comes from
the real SetRep PDFs in `data/samples/` and the shared dashboard objects in `docs/dashboard-json/`.

## Run it

On a clean Windows machine with Docker Desktop, Node 20+, Python 3.11+ (`pip install httpx pypdf`) and Git Bash:

```sh
cp .env.example .env                        # fill in ANTHROPIC_API_KEY
# put the 12 F-PIL SetRep PDFs in data/samples/ (Moneda, Stride, Xpedite, 202605-202608)
# and the MOVE Trust PDFs in data/samples/move-trust/ (step 9 uses Essex, TLFC_LP and Finloc, 202604-202607)
docker compose up -d --build
docker compose exec api python -m app.seed  # Git Bash: prefix MSYS_NO_PATHCONV=1 if a path argument is mangled
cd tests/e2e
npm ci
npx playwright install chromium
npm run test:e2e                            # setup + steps 1-7 + negatives + steps 9-10, about 10-20 minutes
npm run lighthouse                          # optional: accessibility on the four main pages, after test:e2e
```

The tests read `E2E_WEB_URL` (default `http://localhost:5173`) and `E2E_API_URL` (default `http://localhost:8000`).
For a private stack beside the default one (the agent setup), from the repo root:

```sh
export API_PORT=18500 WEB_PORT=15500
docker compose -p tao-qa -f docker-compose.yml -f scripts/compose.agent.yml up -d --build
docker compose -p tao-qa -f docker-compose.yml -f scripts/compose.agent.yml exec -T api python -m app.seed
cd tests/e2e && E2E_WEB_URL=http://localhost:15500 E2E_API_URL=http://localhost:18500 npm run test:e2e
```

**Reset.** The demo needs a fresh database: the setup test stops with a clear message if Xpedite, Moneda or Stride
2026-08 has already been uploaded, and step 9 stops the same way if any of its MOVE Trust months has. Reset with `docker compose down -v`, then `up -d` and the seed again (add
`-p tao-qa -f docker-compose.yml -f scripts/compose.agent.yml` for the private stack).

**What the setup does.** `tests/e2e/setup/demo.setup.ts` checks the stack is up, seeded and fresh, builds the
seeded-error PDF with the Lead's tool (`scripts/demo_data.py: seeded_moneda_aug`, one digit changed on page 2 of
Moneda 202608), and publishes seven months through the HTTP API, the way a previous month-end would have left the
system: May–July for Moneda and Xpedite, July for Stride (the prior month step 6 checks). Xpedite's June and July
reports revise earlier months (R11 restatements that the reference object also records); the setup accepts them as a
reviewer would. `npm run report` opens the last HTML report.

## Journey 1 — a clean report, from upload to both partner portals

### Step 1. TAO Analyst uploads a SetRep

Signed in as TAO Analyst through the sidebar user card: Uploads › Upload report, deal Xpedite Leasing (F-PIL 2.0),
collection period 2026-08, drop `Xpedite Leasing - 202608 - SETTREP.pdf`.

![Upload form](demo/01-upload-form.png)

The status moves Received › Extracting › Needs review while the page polls every 2 seconds. The reporting period read
from the page header is Jul 2026, one month before the collection period (rule R04). No findings.

![Needs review](demo/01-upload-needs-review.png)

The Approval queue (now in the sidebar) lists it with its finding count ("No findings").

![Approval queue](demo/01-approval-queue.png)

### Step 2. TAO Admin reviews and publishes

Switched to TAO Admin: Approval queue › Xpedite Leasing. No finding cards ("No findings. Every rule passed for this
extraction."). Every extracted value carries its page link (`p. N`), or names the earlier publication it was carried
from: 94 page links, 0 values without a source.

![Review report, clean](demo/02-review-clean.png)

A page link opens the page image at that value.

![Page viewer](demo/02-page-viewer.png)

Publish to partner › Approve and publish. The dialog says the report goes to the Investor and Manager portals, the
two partners F-PIL 2.0 is shared with. The status becomes Published; the Activity card and the Audit log show
Approve and Publish by `tao_admin`.

![Publish dialog](demo/02-publish-dialog.png)
![Published](demo/02-published.png)
![Audit log](demo/02-audit-log.png)

### Step 3. Investor and Manager viewers see the deal; the numbers match the shared dashboard

Switched to Investor · Viewer: Portfolio Executive Summary › F-PIL 2.0 › Open deal Xpedite Leasing. The program
month is now August, and every deal stays in it: Moneda and Stride have nothing published for August yet, so their
cards show July with a blue "As of Jul 2026" pill and the totals carry one line, "Moneda Capital Corp. (Jul 2026) and
Stride Capital (Jul 2026) are behind; their Aug 2026 reports are not published yet." Each Open deal link carries the
deal's own month (`?period=`).

![Portfolio summary](demo/03-portfolio-summary.png)
![Program summary](demo/03-program-summary.png)
![Deal page](demo/03-deal-page.png)

The test reads every number on the deal page (154 values carrying `data-field`) and compares each with the
published object and with `docs/dashboard-json/f-pil-2-0-xpedite-leasing.dashboard.json`: 0 mismatches, largest
money difference $0.00; the tranche roll-forward matches to the cent. The deal offers four periods (2026-05 to
2026-08).

Both partners share both programs, so the Manager · Viewer takes the same path in the Manager portal and sees the
same 154 numbers, again with 0 mismatches.

![Manager deal page](demo/03-manager-deal-page.png)

Behind it (`specs/03b-master-data.spec.ts`): both programs list investor and manager as partners, Partners is
readable by TAO roles only (`/master/partners`, 403 for partner roles), and every covenant definition states its
unit (fraction, ratio or currency).

![Partners](demo/03b-partners.png)

## Journey 2 — a report with an error

### Step 4. TAO Analyst uploads the seeded-error report

The copy of Moneda 2026-08 with one digit changed on page 2 (scheduled principal 646,926.71 → 646,826.71). Status
needs review with one Block finding, R05 Tranche balance roll-forward: ours $15,020,071.52, report
$15,019,971.52, difference −$100.00, tolerance ±$1.00, with the roll-forward terms and the page 2 crop. The second
pass has already run (Extraction: Pass 2, re-read page 2). The analyst's view is read only.

![Seeded report needs review](demo/04-seeded-needs-review.png)
![R05 finding card](demo/04-r05-finding-card.png)

**Negative tests on this state.** The analyst cannot resolve, reject or publish: no buttons in the UI, and the API
answers 403 `admin_only` to approve, override and reject. As TAO Admin, Publish to partner is disabled with "1 block
finding is open. Resolve it before publishing.", and the API answers 409 `open_block_findings` naming R05.

![Analyst read only](demo/04b-analyst-read-only.png)
![Publish blocked](demo/04b-publish-blocked.png)

### Step 5. TAO Admin overrides with a reason and publishes our value

Use ours for R05, reason "servicer typo, confirmed by email", Save and re-run rules. The rules re-run, R05 shows
"Used our value" with the reason, no block finding is open, Publish to partner › Approve and publish. The Audit log
shows the Override with its reason, then Approve (listing the override used) and Publish.

![Override dialog](demo/05-override-dialog.png)
![R05 resolved](demo/05-r05-resolved.png)
![Audit log, override](demo/05-audit-override.png)

"Use ours" changes what partners see. R05 carries `targets` (`/tranche_balance/closing` among them), the published
Moneda 2026-08 closing is ours, $15,020,071.52, and the deal's `data_corrections` records the closing for 2026-08 as
15,019,971.52 → 15,020,071.52 with the reason. The investor deal page prints $15,020,072.

![Deal page with our value](demo/05-deal-page-ours.png)

## Journey 3 — the next month and a corrected re-issue

### Step 6. TAO Analyst uploads the following month

Stride Capital 2026-08, after Stride 2026-07 is published. Until it is published, the program API lists Stride in
`deals_behind` as of 2026-07; afterwards it does not. No R11 finding: the extracted opening balance and
opening contracts equal July's published closing. Two R14 review findings, no block; TAO Admin publishes it. The
F-PIL 2.0 program dashboard now shows 3 deals for August 2026.

![Next month needs review](demo/06-next-month-needs-review.png)
![Program dashboard](demo/06-program-dashboard.png)

(The build plan's "covenant status change raises an in-app toast" was dropped from the demo on 2026-11-03.)

### Step 7. TAO Admin re-issues month one, publishes it and regenerates the dashboard

Upload report, Moneda Capital Corp. 2026-05, the May PDF again. The period is published, so the page asks "Upload
this file as a corrected re-issue?"; Upload as corrected re-issue.

![Already published](demo/07-already-published-confirm.png)

The re-issue reaches needs review, marked "Corrected re-issue". R12 blocks with "Corrected re-issue: replaces the
2026-05 report published …" and names the later published months (2026-06, 2026-07, 2026-08) that still carry the
earlier May figures; the review page shows the same in a banner.

![Re-issue needs review](demo/07-reissue-needs-review.png)
![Re-issue banner](demo/07-reissue-banner.png)

Accept as replacement for R12, with a reason, re-runs the rules with no block open; Publish to partner › Approve and
publish. The banner now reads "It replaced the report published …". The publication points at the re-issue, the
old upload shows `replaced_by_upload_id` and a "Replaced by a corrected re-issue" banner linking to the new one, and
the audit log carries the upload (`replaces_upload_id`), the override with its reason, and the publish
(`replaced_upload_id`).

![Re-issue published](demo/07-reissue-published.png)
![Old upload replaced](demo/07-old-upload-replaced.png)

Reports library › Regenerate dashboard…, program F-PIL 2.0 › Regenerate: "F-PIL 2.0: rebuilt from N published
reports." The roll-up totals are unchanged (the re-issue is the same real PDF) and the Audit log records a manual
Regenerate by `tao_admin`. The investor deal page for May 2026 now serves the re-issue.

![Reports library](demo/07-reports-library.png)
![Audit log, re-issue](demo/07-audit-reissue.png)
![Partner deal page, May](demo/07-partner-deal-may.png)

## Negative tests (tenancy and failure)

- Both partners share both programs, so no program is hidden from either partner today; the test still tries every
  program a partner does not own (none) and checks the portfolio lists only owned programs. A partner role that types
  the other partner's portal URL is sent back to its own portal. Claiming the other partner in `X-Partner` is refused
  (403 `bad_partner`), and so are an unknown partner (`X-Partner: nobody`) and no `X-Partner` at all, on the
  portfolio, program and deal routes, with no deal data in the body.
- Partner roles get 403 on `/uploads`, `/audit`, `/master/*` and regenerate, and `/admin` URLs send them back to
  their portal. An analyst gets "You don’t have access" on the Audit log page and 403 on `/audit` (Partners is
  read-only for analysts).
- A blank PDF ends in `extraction_failed`. The upload card states the worker's reason (`Upload.failure_reason`):
  "Extraction failed: page 1 has no text layer; cover block not found (no page has text: scanned or blank PDF, OCR
  fallback not built yet)", followed by what to do next. The test rejects it afterwards.

![Blank PDF](demo/08-blank-pdf-failed.png)

## Journey 4 — MOVE Trust, month by month

### Step 9. Restatements a reviewer meets, and a deal behind the program month

MOVE Trust has nine deals and real reports from April to July 2026. The test takes three of them through nine
uploads, the fewest that show what a reviewer meets on this program. A MOVE report names its own month: the file
`Essex - 202605 - SETTREP.pdf` is collection period 2026-05 and reporting period 2026-05 (R04's lag is 0 for this
template). Each month is uploaded by the TAO Analyst and published by the TAO Admin before the deal's next month.

**April.** Essex Lease Financial Corp., TLFC LP (Leases) and Finloc 2000 Inc. 2026-04 go up through the API and
reach needs review with no Block (Finloc carries one R19 Note, MSA 8.1 (d) moving to BREACH). The admin publishes
each one.

**Essex May restates April.** The analyst uploads `Essex - 202605 - SETTREP.pdf` through the form. It stops at needs
review with two R11 Blocks and one R19 Note. Each R11 is a restatement: the May report prints April's ratios again,
with different values from the April report already published.

![Essex May needs review](demo/09-essex-may-needs-review.png)

- Debt-to-equity for 2026-04 was 6.35 in the published April report; the May report says 6.22.
- Interest coverage for 2026-04 was 1.15 in the published April report; the May report says 1.12.

![Essex R11 restatements](demo/09-essex-r11-restatements.png)

Switched to TAO Admin, on each card: Accept as restatement for R11, reason "servicer restated the April ratios in the
May report", Save and re-run rules. The card reads "Accepted as restatement"; after the second, "Rules re-ran. No
block findings open." Publish to partner shows "2 findings resolved with a reason" and the Investor and Manager
portals; Approve and publish. The audit log has one Restatement accepted row per finding, with the reason.

![Restatement dialog](demo/09-restatement-dialog.png)
![Essex publish dialog](demo/09-essex-publish-dialog.png)

The published Essex May deal carries 1.12 and 6.22 in its April ratio row, and its `restatements` list records both
changes (2026-04 as reported in April, then in May), the same as the start of the list in
`docs/dashboard-json/move-trust-essex-lease-financial-corp.dashboard.json`.

**A deal behind.** Essex May is now published and TLFC LP's and Finloc's May are not. The MOVE Trust program month is
May 2026, and the two deals still contribute April. As Investor · Viewer, Portfolio Executive Summary › MOVE Trust:
TLFC LP and Finloc carry a blue "As of Apr 2026" pill, Essex does not, and the totals say "… are behind; their May
2026 reports are not published yet." The program API lists both in `deals_behind` as of 2026-04.

![MOVE Trust with two deals behind](demo/09-program-deals-behind.png)

**TLFC LP June restates the RVL ratio.** TLFC LP May (no findings) and Finloc May are published. TLFC LP June then
reaches needs review with two R11 Blocks: the RVL ratio for 2026-04 and for 2026-05 was 0.00% in the published May
report, and the June report says 0.112487% for both. The admin accepts both as restatements with the reason
"servicer restated the April and May RVL ratio in the June report" and publishes. The published June deal's ratio
history and `restatements` match the reference object.

![TLFC LP R11 restatements](demo/09-tlfc-r11-restatements.png)

**Finloc's currency revaluation is not a break.** Finloc carries CAD and USD tranches. Its opening balance in CAD
equivalent differs from the prior month's published closing by the USD revaluation: +$64,124.04 in May,
+$106,968.53 in June, −$47,609.31 in July. R11 compares each currency in its own units, where the opening equals the
prior closing, so none of the three months raises R11 (or any Block). The test checks the gap, the CAD opening
against the prior CAD closing, and the empty R11 list for each month.

**The reference period.** Finloc July is the period the MOVE reference objects were taken at. The MOVE Trust program
page now shows July 2026, with Essex "As of May 2026" and TLFC LP "As of Jun 2026". Open deal Finloc 2000 Inc.: the
test reads the 209 numbers on the deal page and compares each with the published object and with
`docs/dashboard-json/move-trust-finloc-2000-inc.dashboard.json`: 0 mismatches, largest money difference $0.01. The
deal offers four periods (2026-04 to 2026-07).

![MOVE Trust in July](demo/09-program-july.png)
![Finloc deal page](demo/09-finloc-deal-page.png)

## Journey 5 — editing values and covenants (phase 2, wave B)

### Step 10. Edit in review, correct after publish, change a covenant

Every edited number below is a real extracted value moved by $100.00, the size of the seeded R05 error, so the change
is easy to spot. The covenant change is a test change, not a real amendment. `specs/10-editing.spec.ts`.

**10a. Edit a value in review.** The analyst uploads Essex Lease Financial Corp. 2026-06, the month after step 9's
May; it reaches needs review with no Block. The analyst sees Extracted values with no Edit control, and
`POST /uploads/{id}/edits` answers 403. Switched to TAO Admin: Extracted values › Tranche balance, Closing › Edit, new
value $100.00 higher, reason of at least 10 characters, Save and re-run rules. The value shows Edited with the original
underneath, and the rules re-run: R05 blocks, because the page 2 closing no longer equals the roll-forward row.

![Edit dialog](demo/10-edit-dialog.png)
![The edit raises R05](demo/10-edit-raises-r05.png)

Revert, with its own reason: the original is back, R05 closes, and the footer reads Ready to publish. Then Tranche
balance, Interest › Edit, $100.00 higher; no block rule reads interest, so nothing opens. Publish to partner lists "1
value edit by hand, listed below" with the old and new value and the reason; Approve and publish.

![Publish dialog lists the edit](demo/10-publish-lists-edit.png)

The Audit log, filtered to the upload, has two Value edited rows and one Value edit reverted row on the Reports tab.
On the investor deal page for June 2026, Data corrections shows Balance · Interest, Was and Now, the reason and
Corrected by TAO; the page prints the same numbers as the published object.

![Audit, value edits](demo/10-audit-value-edits.png)
![Corrected by TAO](demo/10-deal-corrected-by-tao.png)

**10b. Correct a published report.** The analyst sees no Correct a value… in the Reports library and no Correct… on a
published report, and the API answers 403. As TAO Admin, Reports library › Correct a value of TLFC LP (Leases) Jun
2026: pick Tranche balance · interest, type the new value, a reason and a note to partners, Correct and re-publish. No
block opens, so it is published at once: "Published as version 2." The investor deal page shows Corrected and Version
2 of 2; the menu lists both versions with the reason, and Version 1 (original) opens the earlier numbers under the
banner "You are looking at version 1. The current version is 2."

![Correct a published value](demo/10-correct-dialog.png)
![Versions menu](demo/10-version-menu.png)
![Version 1 with the banner](demo/10-version-1-banner.png)

Then Finloc 2000 Inc. Jul 2026, Tranche balance · closing $100.00 higher. R05 blocks, so nothing is published: "Waiting
in the approval queue: 1 block finding … Version 1 stays live", and the investor still gets version 1. The Approval
queue lists it tagged Correction, version 2. On the correction, Approve and publish v2 is disabled until R05 is
acknowledged with a reason; then it publishes version 2 and the audit log has correction, correction_approve and
publish. The analyst gets 403 on the correction's approve.

![Correction in the queue](demo/10-queue-correction.png)
![Correction review](demo/10-correction-review.png)

**10c. Change a covenant.** Partners › Investor › F-PIL 2.0, Covenant definitions. The analyst reads the page ("Read
only. Only TAO Admin can change master data."), opens History, has no Edit, and `PUT /master/covenants` answers 403. As
TAO Admin: Edit SLFA 9.1 (e) for Moneda Capital Corp. › New version from a date, watch buffer 0.15 from 2026-09-01,
threshold unchanged, with a reason; What this change does states the date. Save new version. The covenant now has two
rows (2022-12-09 and 2026-09-01), History lists the new version with the reason, and the Audit log's Platform tab has a
Master data change with before and after. A second new version from 2026-09-01 or 2026-08-01 is refused with 409
`effective_not_later`.

![New covenant version](demo/10-covenant-new-version.png)
![Covenant history](demo/10-covenant-history.png)
![Audit, Platform tab](demo/10-audit-platform.png)

**Known bug.** At 1440 x 900 the Covenant definitions table is wider than its card and the Edit and History column is
cut off with no scroll (`docs/requests.md`, QA 2026-11-05). Step 10c runs at 1920 x 1080; a separate test marked
`test.fail` checks 1440 and will turn red when the table is fixed.

## Acceptance (build plan), measured 2026-11-04

Two runs on the QA stack (Windows 11, Docker Desktop), each from `docker compose down -v`, then `up -d` (images
built), seed, `npm run test:e2e`; both 21 of 21 green (18 for steps 1–8 as before, 3 for step 9).

| Criterion | Pass | Measured |
| --- | --- | --- |
| Both sample SetReps extract with no null required field | Yes / No | Yes for both templates the demo uses: every F-PIL PDF and the nine MOVE Trust PDFs of step 9 (Essex, TLFC LP, Finloc) reach needs review; the schema validation is the Extraction agent's suite. |
| Rules 1–18 each have a passing and a failing fixture and run in under 2 s | Yes / No | Pass and fail fixtures for R01–R15, R17–R19 under `rules/tests/fixtures/`; R16 (program-level SetRep) has none because no such SetRep exists. Timing is the Rules suite's `test_reference_findings_validate_and_run_fast`. |
| Published deal page equals the shared dashboard for the same deal and period | Every metric within $1 / 0.01 pp | Yes. Xpedite Leasing 2026-08: 154 numbers on the page, 0 mismatches against the published object and the reference, largest money difference $0.00, for the investor and the manager. MOVE Trust Finloc 2000 Inc. 2026-07: 209 numbers, 0 mismatches, largest money difference $0.01. |
| A partner role cannot reach another partner's data by URL or API | Verified by test | Yes: `specs/08-negatives.spec.ts` (4 tests). With both programs shared, this rests on the X-Partner checks (other, unknown, missing partner) and the portal redirect. |
| Time from upload to needs review on a 20-page SetRep | Under 3 minutes | Yes. 3–26 s per report across both runs. F-PIL (13–17 pages): Stride 3–9 s, Moneda 5–17 s (the seeded copy with its second pass included), Xpedite 7–26 s. MOVE Trust (18–29 pages): Essex 11–19 s, Finloc 12–18 s, TLFC LP 17–23 s. |
| Every number on the Review report has a page reference | 100% | Yes. Xpedite 2026-08: 94 page links, 8 values carried from the July publication (labelled so), 0 "no source"; 27 of 27 key-value rows referenced. |
| Lighthouse accessibility on the four main pages | 90 or higher | Yes. TAO Admin dashboard 100, Review report 96, Portfolio executive summary 100, Deal page 100. The one failure is colour contrast on the Review report's resolved finding card (layer and value labels, the Block pill, our value). |
| Full demo from `docker compose up` on a clean Windows machine | Under 10 minutes including seed | Yes. Run 1: 8 min 38 s (start and seed 47 s, tests 7 min 51 s, of which step 9 about 3 min 10 s). Run 2: 7 min 25 s (36 s, 6 min 49 s; step 9 about 3 min). Images were already built and web dependencies already in `web/node_modules`; a first `up --build` added about 2 minutes in earlier runs. |

Per-report extraction times are written to `tests/e2e/.cache/measurements.jsonl` on every run.

**Wave B runs, 2026-11-05.** After merging `integration/wave-b` and adding step 10: two runs from `down -v`, up, seed,
`npm run test:e2e`; both 25 of 25 (24 steps and negatives, plus the known-bug test, which passes as an expected
failure). Run 1: 20 min 43 s (start and seed 1 min 39 s, tests 19 min 4 s; step 10 about 2 min 50 s). Run 2: 24 min
17 s (3 min 42 s, 20 min 35 s; step 10 about 2 min 25 s). The host was slow throughout (antivirus load: F-PIL extraction
took 30–60 s per report against 3–26 s on 2026-11-04), so these runs do not show the 10-minute target either way.
