# TAO Admin POC — demo walkthrough

The build plan's demo script (section "Demo script and acceptance", steps 1–7), run in order from a fresh database,
with the screenshots the Playwright tests capture on every run (`docs/demo/*.png`). Each step below is one test in
`tests/e2e/specs/`; the negative tests sit between the steps where their state exists. Every number here comes from
the real SetRep PDFs in `data/samples/` and the shared dashboard objects in `docs/dashboard-json/`.

## Run it

On a clean Windows machine with Docker Desktop, Node 20+, Python 3.11+ (`pip install httpx pypdf`) and Git Bash:

```sh
cp .env.example .env                        # fill in ANTHROPIC_API_KEY
# put the 12 SetRep PDFs in data/samples/ (Moneda, Stride, Xpedite, 202605-202608)
docker compose up -d --build
docker compose exec api python -m app.seed  # Git Bash: prefix MSYS_NO_PATHCONV=1 if a path argument is mangled
cd tests/e2e
npm ci
npx playwright install chromium
npm run test:e2e                            # setup + the seven steps + negatives, about 4 minutes
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
2026-08 has already been uploaded. Reset with `docker compose down -v`, then `up -d` and the seed again (add
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

Publish to partner › Approve and publish. The status becomes Published; the Activity card and the Audit log show
Approve and Publish by `tao_admin`.

![Publish dialog](demo/02-publish-dialog.png)
![Published](demo/02-published.png)
![Audit log](demo/02-audit-log.png)

### Step 3. Investor and Manager viewers see the deal; the numbers match the shared dashboard

Switched to Investor · Viewer: Portfolio Executive Summary › F-PIL 2.0 › Open deal Xpedite Leasing.

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

Stride Capital 2026-08, after Stride 2026-07 is published. No R11 finding: the extracted opening balance and
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
- A blank PDF ends in `extraction_failed`; the page says "Extraction failed. Check the audit log for the reason,
  then upload the file again." and the audit reason reads "page 1 has no text layer; cover block not found (no page
  has text: scanned or blank PDF, OCR fallback not built yet)". The test rejects it afterwards.

![Blank PDF](demo/08-blank-pdf-failed.png)

## Acceptance (build plan), measured 2026-11-03

Two runs on the QA stack (Windows 11, Docker Desktop), each from `docker compose down -v`, then `up -d` (images
built), seed, `npm run test:e2e`; both 18 of 18 green.

| Criterion | Pass | Measured |
| --- | --- | --- |
| Both sample SetReps extract with no null required field | Yes / No | Yes for the F-PIL template: every F-PIL PDF the demo uploads reaches needs review; the schema validation is the Extraction agent's suite. No MOVE Trust SetRep exists to test. |
| Rules 1–18 each have a passing and a failing fixture and run in under 2 s | Yes / No | Pass and fail fixtures for R01–R15, R17–R19 under `rules/tests/fixtures/`; R16 (program-level SetRep) has none because no such SetRep exists. Timing is the Rules suite's `test_reference_findings_validate_and_run_fast`. |
| Published deal page equals the shared dashboard for the same deal and period | Every metric within $1 / 0.01 pp | Yes. Xpedite Leasing 2026-08: 154 numbers on the page, 0 mismatches against the published object and the reference, largest money difference $0.00, for the investor and the manager. |
| A partner role cannot reach another partner's data by URL or API | Verified by test | Yes: `specs/08-negatives.spec.ts` (4 tests). With both programs shared, this rests on the X-Partner checks (other, unknown, missing partner) and the portal redirect. |
| Time from upload to needs review on a 20-page SetRep | Under 3 minutes | Yes. 4–15 s per report (13–17 pages) across both runs: Stride 4–7 s, Moneda 5–11 s, Xpedite 9–15 s; the seeded Moneda with its second pass 7–11 s. |
| Every number on the Review report has a page reference | 100% | Yes. Xpedite 2026-08: 94 page links, 8 values carried from the July publication (labelled so), 0 "no source"; 27 of 27 key-value rows referenced. |
| Lighthouse accessibility on the four main pages | 90 or higher | Yes. TAO Admin dashboard 100, Review report 96, Portfolio executive summary 100, Deal page 100. The one failure is colour contrast on the Review report's resolved finding card (layer and value labels, the Block pill, our value). |
| Full demo from `docker compose up` on a clean Windows machine | Under 10 minutes including seed | Yes. Run 1: 5 min 16 s (start and seed 55 s, tests 4 min 21 s). Run 2: 4 min 43 s (50 s, 3 min 53 s). Images were already built and web dependencies already in `web/node_modules`; a first `up --build` added about 2 minutes in earlier runs. |

Per-report extraction times are written to `tests/e2e/.cache/measurements.jsonl` on every run.
