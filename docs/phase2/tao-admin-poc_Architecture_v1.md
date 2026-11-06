# TAO Admin POC, phase 2: build plan

Status: draft for Matt's review. Nothing in this plan is built. Designs: `docs/phase2/designs/index.html` (D1–D10).
Baseline: `main` at cf1c8e4, 21 of 21 demo steps green, extraction verified on all 12 deals.

## 1. What phase 2 is

Ten additions to a portal that works. The aim is to add them without moving anything that already works, above all the
extraction. Every item below was checked against the code (file and line references in section 6). None of them needs a change
to `worker/extract/`; that folder is frozen for phase 2 and any commit touching it is refused at merge.

| # | Addition | Design | Size | Risk |
| --- | --- | --- | --- | --- |
| 1 | TAO Admin edits extracted values; post-publish correction | D1 | L | Medium |
| 2 | TAO Admin edits covenants, with versions and effective dates | D2 | M | Medium |
| 3 | Audit log split into Reports and Platform, by month, search | D3 | M | Low |
| 4 | Sharper page images in the viewer | D1 | S | Low |
| 5 | Trend arrows coloured good or bad per metric | D4 | S | Low |
| 6 | Dashboard Latest uploads rows open the report | D4 | S | Low |
| 7 | Companies list and company profile, daily news and adverse media | D5, D6 | L | Medium (external data) |
| 8 | Notifications, comments with @mentions, publish notes to partners | D7 | L | Medium |
| 9 | User management: real users, roles, report subscriptions, partner self-admin | D8 | L | **High** |
| 10 | Profile and System settings | D9, D10 | M | Low |

Size: S under a day of agent work, M one to two days, L three or more.

## 2. Decisions locked (2026-11-05)

- TAO Admin is the manager: it edits values and covenants and manages users. TAO Analyst stays read-only and comments.
  Partner Company Admins manage their own team.
- Trend colour shows good or bad for the metric. Direction stays on the arrow.
- Value edits are free before publish (audited, rules re-run). After publish an edit is a correction: a new version,
  re-published, partners notified.
- Extraction does not change.

Added 2026-11-05 after the design review:
- **News and adverse media (plan D1): free sources first.** Google News RSS and GDELT searched by company name, with our own
  keyword screening for the five adverse-media categories. It is an example feed; a paid supplier can replace it later behind
  the same news worker. Items stay TAO-reviewed before partners see them.
- **Partner names (C2): none yet.** The portals keep the generic "Investor" and "Manager"; naming them later is a seed change.
- **Email (C5): later.** Phase 2 is in-app only. Profile and settings show email as "coming later", not as live switches.
- **Data retention (S2): kept indefinitely.** TAO hosts the data; uploads, extractions, publications and the audit log are never
  deleted. D10's retention section becomes a read-only "Kept indefinitely" statement, with export.
- **Corrections that fail the rules (B1): approval queue.** Version 2 waits in the queue with its block findings, like any upload.

## 3. Guardrails for every wave

1. **The demo stays green.** Every merge to `main` runs the full suite: contract check, API, rules, worker/validate,
   extraction, web, and the 21-step demo from a fresh database. A red run does not merge.
2. **Contracts first.** Each wave starts with the Lead's contract change (`contracts/openapi.yaml`, new tables), reviewed
   before any builder starts, as in phase 1. New audit actions go into all three places at once: the contract enum,
   `web/src/admin/data.ts` and `AuditLogPage.tsx`.
3. **The role switcher stays until the end.** Real users arrive behind it (section 5, item 9). The demo, the tests and the
   meeting walkthrough keep working throughout.
4. **Your data is safe.** A migration runner lands first (wave 0) so schema changes apply to your existing database.
   No more `down -v` and no more hand-applied SQL.
5. **One owner per folder**, as in phase 1. Agents work in their own worktrees and branches; the Lead integrates and asks
   before `main` moves.
6. **Feature flags for anything a partner sees first.** Notifications to partners and the company profile ship behind a
   system setting that is off until you switch it on.

## 4. Order of work

The order follows the dependencies: low-risk visible fixes first, then the data-editing core, then users (which
notifications and profiles need), and the external news feed last because it depends on a supplier choice.

### Wave 0: foundations (Lead, half a day)
- Migration runner: a `schema_migrations` table, and the API applies pending files in `db/migrations` at start-up.
  Today migrations only run on an empty database (`docker-compose.yml:6`), which is why 007 had to be applied to your stack
  by hand.
- Extend `scripts/reset_demo.py` so it keeps working with the runner.

### Wave A: quick wins (items 4, 5, 6, 3) — parallel, about two days
| Item | Owner | Notes |
| --- | --- | --- |
| 4 Sharper pages | Data & API + UI-Review | Render at 300 dpi (`PAGE_DPI`, `api/app/main.py:27`); cache path keyed by dpi so old 110 dpi images are not served; the viewer scales boxes from the image's real width instead of a hard-coded 110. Add a "zoom to value" control. |
| 5 Trend colours | Design System + UI-Partner | KpiTile gets a tone (good, bad, neutral) separate from direction. Covenant trends take polarity from the covenant's kind (a ceiling rising is bad). A metric polarity table lives in one file. |
| 6 Clickable rows | UI-Admin | DataTable already supports row click and keyboard (`DataTable.tsx:44`). The row opens Review, the deal or the upload details by status; the Audit link stays. |
| 3 Audit split | Data & API + UI-Admin | `/audit` gains scope, month, search and paging. Scope is derived from the action, so no data moves. An index on time. The `extract` audit rows that feed `failure_reason` are not renamed. |

### Wave B: editing (items 2 then 1) — about four days
| Item | Owner | Notes |
| --- | --- | --- |
| 2 Covenant edits | Data & API, UI-Admin, Rules | The API already versions covenants (`put_covenant`, `main.py:414`). Edits supersede the old row (`superseded_at`, migration 007) instead of overwriting it, so past months keep the version they were checked against. The seed only supersedes rows it created. Open reviews are re-run when a covenant changes, so their R14 findings are current. Platform audit with before/after. |
| 1 Value edits and corrections | Data & API, UI-Review, UI-Partner, Rules | Before publish: a new edit endpoint reusing the existing override machinery (`apply_overrides`, `rerun` in `api/app/review.py`), recorded in `data_corrections` and the Reports audit. After publish: a correction creates a publication version (new `publication_version` table; today a publication is overwritten in place), re-publishes, and records `correct` in the audit. The next month's R11/R12 checks use the corrected values, which is right but is shown to the reviewer. Partner notification is wired in wave C. |

Item 2 goes first because a correction re-runs R14 against the versioned covenants.

### Wave C: people (items 9, then 8 and 10) — about six days
| Item | Owner | Notes |
| --- | --- | --- |
| 9 Users | Lead (auth seam), Data & API, Design System (shell), UI-Admin, QA | Tables `app_user` and `subscription`. Auth keeps accepting the demo headers (`X-Role`, `X-Partner`) while a demo flag is on, and also resolves a signed-in user to the same caller (role, partner) plus a user id and name. Every permission check, the partner filter and the role tests stay as they are. The role switcher becomes "sign in as" a seeded user per role, keeping its test ids, so the demo and the e2e suite do not change. Partner Company Admins can manage only users of their own partner, enforced in the API. Subscriptions only decide who is notified; they never widen what a partner can see. Delete means deactivate, so audit history stays. |
| 8 Notifications and comments | Data & API, Design System (shell bell), UI-Review, UI-Partner | Tables `notification`, `comment`, `notification_pref`; the approve call accepts an optional note to partners. Comments on a finding or value with @mentions; mentions notify. Publish and correction notify subscribed partner users, filtered by the same programme visibility as the portal. Email is a second channel behind a setting, off by default. |
| 10 Profile and settings | Design System, Data & API | `user_pref` and a key/value `system_setting` table, `PATCH /me`, `GET/PUT /settings` (TAO Admin). Rule tolerances and extraction templates stay read-only on screen; they keep coming from `contracts/rules.yaml` and the templates. |

### Wave D: companies (item 7) — about four days, after the data-source decision
| Item | Owner | Notes |
| --- | --- | --- |
| 7 Companies and profile | Data & API, new News agent, UI-Partner | A `company` table (a lending company can sit behind several deals), `news_item`, `adverse_item`, `news_run`. A separate news worker in its own container runs at 06:00, with its own queue; it never touches the extraction queue. Performance charts use the monthly report data already published; program averages are computed from the same data. Industry averages and news need an outside source (section 7). |

### Close-out (QA and Lead, about a day)
The e2e demo gains steps for value edit, correction, covenant edit and a notification. Help & support is updated for
every new page. A final full run from a fresh database, then your sign-off.

Total: roughly 18–20 agent-days, run as four waves with your approval between each.

## 5. Risks and how each is handled

| # | Risk | Where | Handling |
| --- | --- | --- | --- |
| R1 | Real users break every test and the demo sign-in | `api/app/auth.py`, `tests/e2e/lib/ui.ts`, `api/tests/test_roles.py` | Keep the demo headers working behind a flag; users map to the same caller object; switcher keeps its test ids. Role tests stay unchanged and must pass. |
| R2 | Schema changes need a database wipe | `db/migrations`, `docker-compose.yml:6` | Wave 0 migration runner before any new table. |
| R3 | A value edit conflicts with an existing override | `api/app/review.py: apply_overrides` | One rule: a manual edit replaces an earlier override on the same field, and the audit shows both. Tested. |
| R4 | Corrections silently change the next month's checks | `worker/validate/adapter.py: prior_publication` | Intended. The next month's review shows "prior month corrected on <date>". |
| R5 | Covenant edits change months already reviewed | `rules/checks.py:564` R14 | Effective dates and superseding, never in-place updates. Past months keep their version. |
| R6 | Sharper images break the highlight boxes or serve stale images | `PageImage.tsx:5`, page cache | Cache keyed by dpi; boxes scaled from the real image width; check on every deal type. |
| R7 | Partners see data they should not | `partner_filter`, notifications, companies | Every new partner-facing query goes through the same partner filter; negative e2e tests extended to the new pages. |
| R8 | External news is wrong, slow or costs money | item 7 | Separate worker, its own failures shown on the page, behind a setting, supplier chosen by you. |
| R9 | Text edits break the extraction schema | `contracts/extraction.schema.json` (`data_corrections` values are numbers) | Edits are numeric in phase 2; text fields stay read-only unless you ask. |
| R10 | Contract counts drift | `api/tests/test_openapi_parity.py:17` | Updated in the same commit as each new route. |
| R11 | Seed re-runs undo covenant edits made in the UI | `api/app/seed.py` | The seed supersedes only rows it created. |
| R12 | Extraction changes by accident | `worker/extract/` | Folder frozen; merge check refuses any diff there; extraction suite run on every merge. |

## 6. Code touch-points (from the impact review)

- Auth and tenancy: `api/app/auth.py:13`, `api/app/main.py:437-447`.
- Audit: `api/app/views.py` (audit, failure_reason), `contracts/openapi.yaml` AuditEntry, `web/src/admin/data.ts:61`,
  `web/src/admin/AuditLogPage.tsx:10`.
- Review edits: `api/app/main.py:179-261`, `api/app/review.py:54-168`, `web/src/review/components/ExtractedValues.tsx`, `Dialogs.tsx`.
- Covenants: `api/app/main.py:414-433`, `api/app/views.py` covenants_as_of, `api/app/seed.py`, `rules/checks.py:564-596`,
  `worker/validate/adapter.py:99-114`.
- Page images: `api/app/main.py:27,285-286`, `api/app/pdf.py`, `web/src/review/components/PageImage.tsx`.
- Trends: `web/src/design/components/KpiTile.tsx`, `web/src/portfolio/fmt.ts:124`, `Covenants.tsx`, `DealPage.tsx:65-83`.
- Shell: `web/src/shell/pages.ts`, `roles.ts`, `api.ts`, `RoleSwitcher.tsx`.
- Tests most affected: `api/tests/test_roles.py`, `test_review.py`, `test_reissue.py`, `test_published.py`, `test_master.py`,
  `test_openapi_parity.py`; e2e specs 02, 03b, 05, 07, 08 and `lib/ui.ts`, `lib/api.ts`.

## 7. Decisions still needed from you

Grouped by the wave that needs the answer. Each has a recommendation; where you agree, no reply is needed beyond "accept the
recommendations for wave X". Design references are design ID and note number (e.g. D1·11).

### Before wave A
| # | Decision | Recommendation |
| --- | --- | --- |
| A1 | Sharper viewer: render on the server for the visible area at the zoom needed (PDF stays on the server), or render vectors in the browser with pdf.js (sharp at any zoom, but the PDF goes to the browser) (D1·7, D1·11) | Server, at 150/300/600 dpi by zoom level |
| A2 | Trend cells: show "better / worse" as a word on screen, or only in the tooltip and for screen readers (D4·6) | Tooltip only; the colour plus arrow carries it |
| A3 | Ship the extra "Test" and "Last period" columns in covenant tables, or only the colour change (D4·6) | Colour change only in wave A |
| A4 | Audit log: can TAO Analyst read the Reports tab (D3) | Yes, read-only; Platform stays TAO Admin |
| A5 | Audit months: Toronto time or each user's time zone (D3·5) | Toronto time, so everyone sees the same month |
| A6 | Does exporting an audit CSV write its own audit entry (D3·6) | Yes, on the Platform tab |

### Before wave B
| # | Decision | Recommendation |
| --- | --- | --- |
| B1 | A correction whose rule re-run raises a block: send version 2 to the Approval queue, or refuse it (D1) | **Decided: approval queue** |
| B2 | Store a correction as a cloned upload on the re-issue path, or as a version number on the publication (D1·13) | Publication version table; no fake upload |
| B3 | Partner notice of a correction: show old → new values, or "corrected" plus the note (D1, D7·15) | Old → new for the changed fields, plus the note |
| B4 | Covenants: allow "correct the current version" (same date), or every change must be a new dated version (D2·4) | Allow it, but audited with before/after and R14 re-run on open reviews |
| B5 | R14 when no covenant version is in force for the period (Stride before 2026-01-22): stay silent, or raise a note (D2·7) | Raise a note |
| B6 | Minimum reason length for value edits and covenant changes (D1, D2) | 10 characters (overrides stay at 3) |

### Before wave C
| # | Decision | Recommendation |
| --- | --- | --- |
| C1 | Sign-in for real users: keep the demo switcher with real users behind it, or add password sign-in now | Keep the switcher for the POC; real sign-in is a production item |
| C2 | Partner names: seed says Investor and Manager, portal map mentions BDC and 990 Capital (D8) | **Decided: no names yet; keep Investor and Manager** |
| C3 | Can TAO Analyst view User management (read-only) (D8) | No, TAO Admin only, as pages.ts has it |
| C4 | Can a partner Company Admin hide a program from a Viewer, or only control what they receive (D8·11) | Only what they receive; visibility stays with TAO |
| C5 | Email: in-app only, or connect an email service (D7·19, D9·4) | **Decided: later; in-app only in phase 2** |
| C6 | Email content when on: title, note and link only, or figures too (D7·19) | Title, note and link only |
| C7 | "Note from TAO" signed by the company or by the person who published (D7·17) | The company |
| C8 | Who is told about a correction by default: all subscribed users of the deal, or only Company Admins | All subscribed users |
| C9 | Comment threads on a corrected report: carry over to version 2 or stay on version 1 (D7) | Carry over, marked "from version 1" |
| C10 | Analyst can resolve only threads they started, or any thread (D7·10) | Only their own; TAO Admin resolves any |
| C11 | How long notifications are kept (D7) | 12 months |
| C12 | Two-step verification for TAO roles once real sign-in exists (D9·5) | Required for TAO, optional for partners (production item) |
| C13 | Record partner page views and prints in the audit log (D9·11) | Downloads only in phase 2 |

### Before wave D
| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | News and adverse media source | **Decided: free sources first (Google News RSS, GDELT) with our own screening; paid supplier later** |
| D2 | Industry averages on the profile charts: drop, or name a source (D6·5) | Drop for now; program median is real and enough |
| D3 | Program comparison line: median or mean, weighted by balance or not (D6·4) | Median, unweighted, one point per company |
| D4 | Loss comparison: pick one measure across deals, or compare named peers only (D6·6) | Named peers on the same measure only |
| D5 | Is TLFC (Leases, Loans, LP Leases) one company (D5·1) | Yes; the company record groups deals |
| D6 | Partners see adverse media items still Open, or only Reviewed (D6·11) | Reviewed only |
| D7 | Upload older SetReps so profiles show 13 months of balance and covenant history (D6·7) | Yes, if the PDFs exist; extraction handles them unchanged |
| D8 | "Next report due" from a per-deal expected day entered by TAO (D6, D10·6) | Yes, from the reporting calendar in System settings |

### Settings and maintenance (any time)
| # | Decision | Recommendation |
| --- | --- | --- |
| S1 | Should rule tolerances, severities and the WATCH margin ever be editable on screen (D10·4) | No; a request to the Lead and a contract change, as today |
| S2 | Who sets data retention periods (D10·9) | **Decided: kept indefinitely** |
| S3 | Overdue-report alerts to TAO only, or also partner Company Admins (D10·6) | TAO only |
| S4 | A Reset demo button, or keep it as a script (D10·12) | Script only; a button that wipes data is a risk on a shared stack |

## 8. How we run it

Each wave: you approve the designs for that wave, the Lead lands the contract change and you see it, builders work in
parallel in their own branches, QA extends the demo, the Lead integrates on an `integration/` branch, the full suite runs from a
fresh database, and `main` moves only when you say so. Your stack is updated after each wave with data kept.

## 9. Found during the build

- **Wave B, minor (QA):** on MOVE Trust reports, an edit to page-2 `/tranche_balance/principal` (or recoveries, interest) raises
  no finding, because R05 reads the period roll-forward row, not those fields. The edit publishes beside an unedited copy in
  `period_history`. The edit dialog already says no rule reads the value. Options: have R05 also compare the page-2 totals with
  the roll-forward row, or edit both together. Not blocking; queued for the Rules agent.
- **Wave B, MOVE Trust covenants:** no MOVE deal has covenant definitions in the master data, so R14 raises one note per MOVE
  report ("No covenant definitions recorded") and no MOVE threshold is checked. A TAO Admin can now add them with "Add covenant",
  or they can be seeded from the reports as was done for Stride and Xpedite.
- **Waves A and B, test speed:** demo runs took 20+ minutes against about 5 earlier, with the host CPU at 100% (antivirus and
  the Docker VM) and every step slowed alike, extraction included. Re-time on a quiet machine before judging the 10-minute target.
