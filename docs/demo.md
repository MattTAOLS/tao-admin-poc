# TAO Admin POC — demo walkthrough

The build plan's demo script (section "Demo script and acceptance", steps 1–7), then MOVE Trust month by month (step
9), the wave B editing steps (step 10) and the wave C people steps (step 11), the wave D company pages (step 12), the wave E news screening (step 13) and Save for later with per-person notify choices (step 14), run in order from a fresh database,
with the screenshots the Playwright tests capture on every run (`docs/demo/*.png`). Each step below is one test (or a
few) in `tests/e2e/specs/`; the negative tests sit between the steps where their state exists. Every number here comes from
the real SetRep PDFs in `data/samples/` and the shared dashboard objects in `docs/dashboard-json/`.

## Run it

On a clean Windows machine with Docker Desktop, Node 20+, Python 3.11+ (`pip install httpx pypdf`) and Git Bash:

```sh
cp .env.example .env                        # fill in ANTHROPIC_API_KEY
# put the 12 F-PIL SetRep PDFs in data/samples/ (Moneda, Stride, Xpedite, 202605-202608)
# and the MOVE Trust PDFs in data/samples/move-trust/ (step 9 uses Essex, TLFC_LP and Finloc, 202604-202607)
docker compose -f docker-compose.yml -f scripts/compose.news-fixture.yml up -d --build   # step 12: news worker on its test fixture
docker compose exec api python -m app.seed  # Git Bash: prefix MSYS_NO_PATHCONV=1 if a path argument is mangled
cd tests/e2e
npm ci
npx playwright install chromium
npm run test:e2e                            # setup + steps 1-7 + negatives + steps 9-14, 40-70 minutes on a busy host
npm run lighthouse                          # optional: accessibility on the four main pages, after test:e2e
```

The tests read `E2E_WEB_URL` (default `http://localhost:5173`) and `E2E_API_URL` (default `http://localhost:8000`).
For a private stack beside the default one (the agent setup), from the repo root:

```sh
export API_PORT=18500 WEB_PORT=15500
docker compose -p tao-qa -f docker-compose.yml -f scripts/compose.agent.yml -f scripts/compose.news-fixture.yml up -d --build
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

**Fixed bug.** At 1440 x 900 the Covenant definitions table used to be wider than its card with the Edit and History
column cut off (`docs/requests.md`, QA 2026-11-05). The Lead made it scroll sideways inside the card; the regression
test "covenant Edit and History are reachable at 1440 x 900" checks it, and step 10c runs at the suite's 1440 x 900.

## Journey 6 — people (phase 2, wave C)

### Step 11. Users, team members, comments, the publish note and profile

Wave C puts real users behind the role switcher. The sidebar card is now "Sign in as (POC)": eight sample users from
`seed/users.json`, grouped by role. The first user of each role carries the role id in its menu name, so steps 1–10
still pick a role the way they did and now act as that role's first user (A. Patel for TAO Admin, J. Moreau for TAO
Analyst, and so on). With no user chosen the app runs by role alone, as before. `specs/11-people.spec.ts`; the added
user, the comments, the note and the profile changes are test data.

**11a. Users.** Signed in as A. Patel, the card shows the name and TAO Admin. User management lists the eight seeded
users. Add user: Q. Tester, TAO Analyst, receiving "All deals in MOVE Trust, including new ones". Deactivate with a
reason: the API then answers that user with 401 `inactive_user`. Reactivate with a reason. A. Patel cannot deactivate
herself ("You can’t change your own role or deactivate yourself."), and M. Chen, the only Investor Company Admin,
cannot be deactivated or demoted ("This is the last active admin for its company"); the API answers 409 `self_change`
and `last_admin`. The Platform tab of the Audit log has user_change entries (created, subscriptions, deactivated,
reactivated) by A. Patel. J. Moreau, an analyst, gets "You don’t have access" on User management and 403 on `/users`.

![User management](demo/11-user-management.png)
![Add user](demo/11-add-user.png)
![Last admin refused](demo/11-last-admin-refused.png)
![Audit, user changes](demo/11-audit-user-change.png)

**11b. Team members.** M. Chen (Investor Company Admin) opens Team members: M. Chen and D. Alvarez only, no TAO or
Manager user, and the API keeps her to her own partner (another partner's user is 404). Editing D. Alvarez shows a
subscription tree with only the programs shared with Investor. D. Alvarez (Viewer) gets no access.

![Team members](demo/11-team-members.png)

**11c. Comments and mentions.** The analyst uploads Essex Lease Financial Corp. 2026-07 (the month after step 10's
June). J. Moreau starts a thread on its R14 note and mentions A. Patel. Known bug: an analyst's @ list is empty
(`docs/requests.md`, QA 2026-11-06), so the test sends this first comment through the API, as the comment box would;
a separate test marked `test.fail` checks the @ list. The finding card shows one comment with @A. Patel highlighted.
Signed in as A. Patel, the Notifications badge shows unread; the Mentions tab has the mention, and Open thread lands
on the review page with `?thread=` and the thread open. She replies and resolves the thread; the R14 finding stays
open. The Reports tab of the audit log has two comment entries and a thread_resolve, and J. Moreau gets a Reply
notification. Partners get 403 on the threads route.

![Comment with a mention](demo/11-comment-mention.png)
![Mention in Notifications](demo/11-notifications-mention.png)
![Thread resolved](demo/11-thread-resolved.png)

**11d. Publish note and partner notifications.** A. Patel subscribes D. Alvarez to Essex in User management. Partner
notifications are off by default, so Publish to partner › Who gets notified says "Partner notifications are off" and
shows D. Alvarez's row as Not notified, "Locked: partner notifications are off", with its switch disabled (M. Chen,
not subscribed, reads the same). Cancel. System settings › Partner notifications on, with a reason (a settings_change
on the Platform tab). Publish again: D. Alvarez's row reads "Will be notified · In-app"; M. Chen and the Manager users
read Not notified, "does not receive this deal"; type a note to partners; Approve and publish. The Publish audit
entry carries the note and exactly the recipients the pop-up listed. Step 14 covers switching people by hand. Signed in as D. Alvarez, Notifications shows "Report published: Essex Lease
Financial Corp. · July 2026" with "Note from TAO" and the note as typed; Open report goes to the deal at
`?period=2026-07`. No comment text reaches her, in the page or the API. The Manager users, not subscribed, get
nothing about it.

![Notifications off](demo/11-publish-notifications-off.png)
![Publish with a note](demo/11-publish-with-note.png)
![Partner notification](demo/11-partner-notification.png)

**11e. Profile.** S. Lindqvist changes her name to S. Lindqvist-Berg (the sidebar card follows) and her time zone to
America/Vancouver. "Covenant status changed (WATCH or BREACH)" and "Correction published" are checked and locked
(always on); switching one off through the API is 422 `required`. The changes are prefs_change entries on the
Platform tab.

![Profile](demo/11-profile.png)

## Journey 7 — companies (phase 2, wave D)

### Step 12. Companies, the company profile, news and adverse media

Wave D groups the deals by lending company: ten companies over the twelve deals (`seed/companies.json`), TLFC being
one company with three MOVE Trust deals. Every figure on the company pages comes from the published deal objects. The
news worker runs on its labelled test fixture (`scripts/compose.news-fixture.yml`): every headline starts with "Test
item:", is invented and says nothing true about any company. `specs/12-companies.spec.ts`; the record values, contact,
note and reasons are test data.

**12a. Companies list.** A. Patel opens Companies: 10 companies, TLFC one row with "3 deals". Status "Breach or watch"
leaves the companies whose worst status is BREACH or WATCH (4 after steps 1–11: Finloc in breach, Essex, Moneda and
Xpedite at watch), and the URL holds `?status=flagged` through a reload. Searching "Loans" finds TLFC through its deal
TLFC (Loans). The star follows Essex (the API lists it under `following=true`). Balance and status on the Essex and
Xpedite rows equal the published objects: $179,272,568 at Watch (July 2026) and $39,651,581 at Watch (August 2026).

![Companies](demo/12-companies-list.png)
![Breach or watch](demo/12-companies-filtered.png)

**12b. Essex profile.** The KPIs are the July 2026 publication, equal to the shared dashboard object: closing tranche
balance $179,272,568, 826 contracts, 88.54% of the $200,000,000 program limit, 0 breach and 1 watch. What to watch
starts with "MSA 8.1 (h) near its limit" (interest coverage 1.11 against a floor of 1.0). The delinquency chart shows
Essex (1.31% in July) and the program median; Mean swaps the median for the mean. The median is checked against the
other MOVE Trust companies' publications (Finloc and TLFC LP: the median of the two where both report; no line in
July, when only Finloc does). Covenant status history outlines the published months, Apr–Jul 2026. Restatements list
April's interest coverage 1.15 → 1.12 and debt to equity 6.35 → 6.22, restated by the company in the May report. For
TLFC the Deal picker holds its three deals: TLFC LP (Leases) shows its own KPIs (`?deal=`), and TLFC (Leases) and
TLFC (Loans) say "Not published yet".

![Essex profile](demo/12-essex-profile.png)
![Delinquency with the program median](demo/12-delinquency-median.png)
![Covenant history](demo/12-covenant-history.png)
![TLFC deal picker](demo/12-tlfc-deal-picker.png)

**12c. News and adverse media.** With the feed off, Run now is 409 `feeds_off`. System settings › Daily news search
on, with a reason; Run now; the list refreshes to "Run finished: Done. 11 news items and 7 adverse items added." The
worker then starts the day's scheduled run as well (06:00 Toronto has passed), which finds nothing new. Every item
is a fixture item and the two false friends (TLFCX Holdings, Essex Lease Financing Ltd) match nobody. The run stores
12 stories: the fixture's Dynamic Capital story about a city market is excluded by the news check (fixture mode: the
labelled answer stands in for Claude, no API call) and hidden from the default lists, so 11 show (step 13b). The Essex
profile shows its one item marked Negative, and one Open adverse item (Litigation, "1 to review"). Mark reviewed with
a note: the row shows Reviewed, A. Patel and the note. On Moneda, Dismiss with a reason. A. Patel follows Essex, so
she has an "Adverse media to review" and a "Negative news" notification. The Platform audit has the two adverse_change
entries and the news_run. J. Moreau (analyst) gets 403 on review and dismiss and sees no buttons.

![Run now](demo/12-news-run-ok.png)
![News and adverse media](demo/12-news-and-adverse.png)
![Adverse item reviewed](demo/12-adverse-reviewed.png)
![Audit, adverse changes](demo/12-audit-adverse.png)

**12d. Analyst notes.** J. Moreau adds a note on Essex and picks A. Patel from the @ list. The company_note entry is in
the Platform audit. A. Patel's Mentions tab has "J. Moreau mentioned you: Essex Lease Financial Corp., analyst note";
Open lands on `/admin/companies/essex-lease-financial-corp?note=<id>` with that note marked current. Partners get
404 on the notes route while company pages are off for them, 403 once on.

![Analyst note](demo/12-analyst-note.png)
![Note mention](demo/12-note-mention.png)

**12e. Partner view.** Off by default: D. Alvarez (Investor Viewer) has no Companies entry, `/investor/companies` is
"Page not found" and `/companies` is 404. A. Patel switches "Partners can see company pages" on with a reason. Both
programs are shared with both partners in the seed, so no company is outside the investor's programs; the test
records that and checks the hidden states instead. D. Alvarez sees all 10 companies, no Notes column, and on Essex no
analyst notes, no Edit record, no relationship owner and no "View as partner". Only the reviewed adverse item shows:
Moneda's dismissed item and VCC IV LP's two open items are absent in the page and the API. The note text appears in no
investor or manager response (companies, profile, news, adverse, insights, notifications, published objects).

![Partner, feature off](demo/12-partner-off.png)
![Partner companies](demo/12-partner-companies.png)
![Partner profile](demo/12-partner-profile.png)

**12f. Company record.** A. Patel edits the Essex record (industry and headquarters, test values) with a reason and
adds a key contact. The Platform audit has a company_change `record` entry whose before and after hold only the two
changed fields, and a `contact_added` entry. J. Moreau sees no Edit record or Add contact and gets 403 from the API.

![Edit record](demo/12-edit-record.png)
![Record and contact](demo/12-record-and-contact.png)
![Audit, company change](demo/12-audit-company-change.png)

**12g. News runs.** System settings lists the runs, newest first: the scheduled run and the manual run from 12c (Done,
10 companies, 11 items, 7 adverse, no errors). Analysts may read the runs; partners get 403.

![News runs](demo/12-news-runs.png)

## Journey 8 — news screening, version 2 (phase 2, wave E)

### Step 13. News sources, checked stories, and the re-check

Wave E puts every story through a date check and a mandatory Claude check, and adds paid sources with the client's
own keys (`docs/phase2/tao-admin-poc-news_Architecture_v1.md`). On the fixture stack the check is the labelled answer
in `news/fixtures/example.json` and no paid source or Claude call is made. `specs/13-news-screening.spec.ts`; the Brave
key, the search words and the reasons are test data.

**13a. News sources.** A. Patel opens System settings › 6 News sources: five rows, Event Registry, NewsCatcher, Brave
Search, Dow Jones (Factiva) and LexisNexis (Nexis Data+); the last two read "Not available yet" and their Test
connection is off. Analysts and partners get 403 on `/news/sources`. Edit Brave Search, type a fake API key and a
reason: the summary says "API key: set", never the key. After Save the row reads "Set, ends in ••••7Q4Z" (also after a
reload); the key is in no API response the page received, not in the page, and not in `GET /news/sources`. Test
connection queues one small query; the worker writes the result and the row shows it. On the QA stack the news
container reached Brave, which answered "HTTP 422: The provided subscription token is invalid.", so the row reads
Failed with that message; the test accepts any clear result within 40 seconds. Remove the key: "Not set", "Key not
set". Switching Brave on with no key is refused in plain words ("A required key is not set. …"; the API's 409
`missing_credentials`) and nothing changes. The Platform audit has two news_source_change entries (key set, key
removed) naming the field, never the value; the refused switch-on wrote none.

![News sources](demo/13-news-sources.png)
![Brave key dialog](demo/13-brave-key-dialog.png)
![Key set, last four only](demo/13-brave-key-set.png)
![Test connection result](demo/13-brave-test-result.png)
![Switch on without a key](demo/13-brave-missing-key.png)
![Audit, news source change](demo/13-audit-news-source.png)

**13b. Latest news.** On Xpedite Leasing the fixture's trade-show story reads "Date not confirmed" with the source's
date in small text, "Found by Test fixture" and "Kept by the news check"; it is not counted in Xpedite's `news_7d`
(1, the other Xpedite story), and neither it nor the excluded story raised a notification. On Dynamic Capital the
default list leaves out the city-market story; "Show excluded" (TAO only) brings it back muted, with "Excluded by the
news check" and its reason. "View as partner" hides the toggle, the check lines and the excluded story.

![Date not confirmed](demo/13-date-not-confirmed.png)
![Show excluded](demo/13-show-excluded.png)
![View as partner](demo/13-view-as-partner.png)

**13c. Partners.** With company pages on for partners (step 12e), D. Alvarez (investor) and L. Haddad (manager) ask for
every company's news with no filter and with `include=excluded`, `include=all` and `include=pending`: kept stories
only, no check block, and neither the excluded headline nor its reason anywhere. Their company record has no news
search settings. On the Dynamic Capital page the investor sees no Show excluded toggle and no check lines.

![Partner news](demo/13-partner-news.png)

**13d. News search settings.** A. Patel edits the Dynamic Capital record: context words "leasing, equipment, finance"
and the exclusion phrase "dynamic capital of street food", with a reason. The record panel shows both (TAO only); the
company_change entry carries them; partners do not receive them and an analyst gets 403.

![Edit news search](demo/13-edit-news-search.png)
![Record panel](demo/13-record-news-search.png)

**13e. Re-check stories.** System settings › Re-check stories, confirm: the run is queued, the list refreshes, and the
note reads "Re-check finished: Done. …". The runs list has a Re-check row (Done) with its stats; the Platform audit has
its news_run entry with trigger `recheck`. After a fixture run every story is already checked, so the re-check finds
nothing to change.

![Re-check confirm](demo/13-recheck-confirm.png)
![Re-check done](demo/13-recheck-done.png)

**13f. Checks and calls.** The manual fixture run from 12c shows its stats in the new column: "140 candidates · 11 kept
· 1 excluded" (the Dynamic Capital story), and, opened, calls per source (Test fixture 10), the daily cap (None),
pending 0, dates confirmed 11 (the 12 stored stories, excluded one included, less the Xpedite story) and Claude tokens "0 in, 0 out" (fixture mode makes no call).

![Run stats](demo/13-run-stats.png)

## Journey 9 — save for later and who gets notified

### Step 14. Save (On hold), and per-person choices in the Publish pop-up

A TAO Admin can park a report that is not ready to publish, and can decide person by person who is told about one
publish. `specs/14-hold-and-notify.spec.ts`, on its own report: TLFC LP (Leases) 2026-07, the month after step 9's
June, uploaded by J. Moreau. The spec first switches partner notifications off through the API (step 11 left them on)
and subscribes J. Moreau and R. Okafor to the deal, so the publish has TAO subscribers. The notes and reasons are test
data.

**14a. Save…, the queue, the marker.** Signed in as A. Patel, the review page's action bar reads Re-extract pages…,
Save…, Reject…, Publish to partner…. Save… opens "Save for later" with one optional field, "Why is it waiting?". Type
a note; Save and close. A toast says "Saved. On hold in the Approval queue." and the Approval queue opens. The row
keeps its Needs review status and gains an On hold pill, the note in quotes and "A. Patel, <date time>". The chips
above the table read "All N" and "On hold 1"; On hold filters to this row. Nothing was published: the Investor still
has June for the deal (`published_period` 2026-06, the program page says "As of Jun 2026") and no user has a
report_published notification for the upload.

![Save for later](demo/14-save-for-later.png)
![Approval queue, On hold](demo/14-queue-on-hold.png)

The review page shows the On hold pill beside the status and the line "On hold since <date time> by A. Patel:
“<note>”" with Release hold. J. Moreau (analyst) sees the pill and the line, but no Save… and no Release hold ("Read
only."); the API answers her 403 `admin_only` on both. D. Alvarez (Investor) is sent back to her own portfolio from
the queue and the review URL, and every partner user and partner role gets 403 on `GET /uploads`, the upload, its
recipients and the hold routes. A. Patel saves again: the dialog starts from the stored note, and the new note
replaces it in the queue. Release hold clears the pill and the line; the report stays in Needs review, the On hold
chip reads 0 ("Nothing on hold"), and a second release is 409 `bad_state`. The audit trail has two "Saved for later
(On hold)" entries with their notes and one "Hold released".

![Review page, On hold](demo/14-review-on-hold.png)
![The analyst sees the marker](demo/14-analyst-sees-hold.png)

**14b. Who gets notified, partner notifications off.** Publish to partner… lists one row per person under TAO,
Investor and Manager: a switch, the name, "Will be notified" or "Not notified", then the channel or the reason. The
header counts the people who will be told. With partner notifications off, the four partner users read "Locked:
partner notifications are off" and their switches do not move. S. Lindqvist-Berg, a TAO user who "does not receive
this deal", is switched on: "Added for this report", and the count goes up by one. R. Okafor, a subscriber, is
switched off: "Left out for this report", and the count goes back down. The line "2 changes for this report only.
Subscriptions are not changed." has Reset, which puts both rows back. With the two choices made again and a note to
partners typed, Save for later (in the pop-up's footer, between Cancel and Approve and publish) shows the same toast
and opens the queue: the row is On hold with no note. `Upload.draft` holds the note and the choices. Reopening the
report ("On hold since … by A. Patel.") and the pop-up shows the same note and the same two switched rows. Asking the
API to add a locked person, on Save or on Approve, is 422 `invalid`: "K. Novak cannot be added: partner notifications
are switched off in System settings".

![Choices with partner notifications off](demo/14-publish-choices-notifications-off.png)
![The draft, reopened](demo/14-publish-draft-reopened.png)

**14c. Partner notifications on, and the publish.** D. Alvarez switches "Report published" off in her Profile. A.
Patel turns Partner notifications on in System settings, with a reason. In the pop-up the banner is gone; M. Chen and
the Manager users, who can see the deal and do not receive it, can now be switched on; D. Alvarez stays "Locked:
switched this off in their Profile", and the API refuses her by name (422: "D. Alvarez cannot be added: they switched
this notification off in their profile") with nothing published. M. Chen is switched on: 3 changes. Approve and
publish. The report is published, and its hold and draft are gone. S. Lindqvist-Berg and M. Chen (added) each have
exactly one "Report published" notification carrying the note; J. Moreau (untouched subscriber) has one; R. Okafor
(left out), D. Alvarez (locked) and the Manager users have none. Every user's subscriptions are what they were before
the publish: the added people still do not receive the deal and R. Okafor still does. The Publish audit entry reads
"Added by hand: S. Lindqvist-Berg, M. Chen" and "Left out: R. Okafor", and its recipients are exactly the people
told. A published report cannot be held (409 `bad_state`). The spec then switches D. Alvarez's notification back on;
partner notifications stay on, as step 11 left them.

![Partner notifications on](demo/14-publish-partners-on.png)
![Audit: added by hand, left out](demo/14-audit-added-left-out.png)
![The added partner user is told](demo/14-added-partner-notification.png)

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

**Wave C runs, 2026-11-06.** After merging `integration/wave-c`: the existing steps 1–10 were first run unchanged from
`down -v`. That run had 20 of 25 pass. Step 2 failed because the review page was still loading after the 15 s expect
timeout (its first API call came about 10 s after navigation: the Vite dev server on a host at 98% CPU, from WSL and
the antivirus); step 3 then followed from it. Step 9b hit its 6-minute limit on extraction time, and step 10b followed
from 9b. None of these traced to wave C logic. The suite now uses 30 s expect and action timeouts and longer limits
for step 9, and with step 11 added a full run from `down -v`, up, seed and `npm run test:e2e` was 31 of 31 green (29
steps and negatives, the covenant regression check, and the analyst @mention known-bug test, which passes as an
expected failure): 40 min 37 s (start and seed 4 min 8 s, tests 36 min 29 s; step 11 about 3 min 50 s). The same host
ran the wave B suite in about 21 minutes the day before and the phase 1 suite in 7–9 minutes. A second run from `down -v` was
also 31 of 31: 40 min 41 s (start and seed 3 min 22 s, tests 37 min 19 s).

**Wave D runs, 2026-11-06.** After merging `integration/wave-d`, the 31 existing tests were first run unchanged from
`down -v` (stack with `scripts/compose.news-fixture.yml`, up, seed): 31 of 31, tests 58 min 30 s, start and seed about
4 min (the host was again at high CPU; step 9 alone took 22.5 min). With step 12 added, two full runs from `down -v`,
up, seed and `npx playwright test --project=demo`: run 1, 38 of 38 in 46 min 37 s (start and seed 4 min 41 s, tests
41 min 56 s; step 12 about 5 min 50 s); run 2, 38 of 38 in 30 min 18 s (2 min 11 s, 28 min 7 s; step 12 about 3 min).
Screens in the TAO shell were re-taken because the sidebar now has Companies; partner-shell screenshots of earlier
steps did not change and were kept.

**Wave E runs, 2026-11-10.** On `integration/wave-e` (b166e53) with step 12 moved to the new fixture (11 news items) and
step 13 added: two full runs from `down -v`, up, seed and `npx playwright test --project=demo` (stack with
`scripts/compose.news-fixture.yml`). Run 1, 44 of 44: tests 18 min 36 s (images rebuilt first); step 12 about 2 min 10 s,
step 13 about 1 min 10 s. Run 2, 44 of 44: 16 min 6 s (start and seed 1 min 33 s, tests 14 min 24 s); step 12 about 2 min
6 s, step 13 about 1 min 9 s. Test connection with the fake Brave key ended Failed both times ("HTTP 422: The provided
subscription token is invalid.") within a few seconds.
