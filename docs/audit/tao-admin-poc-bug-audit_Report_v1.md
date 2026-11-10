# TAO Admin POC: application-wide bug audit

Date: 2026-11-10. Code audited: branch `lead/company-run` (main at 460e0f6 plus Run now for one company, 33fcf2c).

## How it was done

Seven read-only reviewers ran in parallel on Claude Fable 5.2, one per area. Each finding needed a file and line and a concrete failing case. Most were reproduced with a throwaway script, a test, or a request against the Lead's test stack (ports 18300 / 15300). The live stack was never touched and no repo file was changed. The Lead then read the code behind the high-severity findings and confirmed each one.

Not reported, by decision: the app has no real sign-in (the role switcher is the accepted POC design).

## Totals

| Area | High | Medium | Low | Total |
| --- | --- | --- | --- | --- |
| Review and publish logic (API) | 3 | 3 | 2 | 8 |
| Extraction, rules, worker | 3 | 5 | 2 | 10 |
| News worker | 2 | 4 | 5 | 11 |
| Hosting, scripts, migrations | 2 | 3 | 5 | 10 |
| Portal and company screens | 1 | 4 | 5 | 10 |
| Admin and review screens | 1 | 3 | 4 | 8 |
| API security and permissions | 0 | 1 | 4 | 5 |
| **All** | **12** | **23** | **27** | **62** |

Two findings were reported by two reviewers each (non-finite numbers; uploads stuck in `extracting`), so the table holds 60 distinct bugs. One more display defect was noted in passing (L27), which makes 61. The security review found no way for a role to do or see what it should not: role gates, partner isolation and secret handling held under live probing.

## High severity (12)

### Could publish wrong or unreviewed numbers

| # | Bug | Where | How it shows |
| --- | --- | --- | --- |
| H1 | A reviewer's resolution moves to a different finding when the rules re-run. Findings are matched by rule and field list only, and every R11 restatement finding has the same field list. | `api/app/review.py:71-86` (same key at `:186-190`, `:293-312`) | Two R11 blocks; accept the first as a restatement; a value edit removes the first. The stored acceptance attaches to the second. Block count 0; the report publishes with the second finding never reviewed. |
| H2 | Approve re-runs the rules only when value edits exist, and later months in review are not re-run after an approve or a re-issue. | `api/app/main.py:254-258` | July published; August in review with 0 blocks; July re-issued with a different closing balance; August approves, although a re-run raises R11 "opening does not equal prior closing". |
| H3 | Review actions have no atomic state check (no row lock, no conditional update). | `api/app/main.py:249, 226, 612` | Two approvals at once: version 2 "corrected re-issue" of itself, duplicate notifications. Approve + reject at once: upload ends `rejected` while its publication stays live to partners. Approve + re-extract: a published upload ends `extracting`. |
| H4 | A page with no text layer yields empty sections and no findings. R01 treats an empty list as present. | `rules/checks.py:102`; `worker/extract/__init__.py:96-98` | Moneda Aug-2026 with page 14 blanked: `covenants: []`, confidence 0.975, zero findings. With page 11 blanked, the aging check validates last month's row. |
| H5 | Manual re-extract of some pages corrupts the merged extraction. | `worker/extract/__init__.py:151-154, 165-177`; `settrep_standard.py:837-846`; `guarantor_settrep.py:731` | Essex Apr-2026 page 13: ratio history re-indexed, values under the wrong months (39 changed leaves). Moneda Aug-2026 pages 12 and 14: ICR, leverage and equity set to null. The automatic retry page sets were clean on the files tested. |
| H6 | Re-extraction during review discards the reviewer's resolutions. | `worker/validate/adapter.py:297-317` | Acknowledge an R12 block with a reason, re-extract: the new extraction has R12 open again with no resolution. |

### Wrong or broken on screen

| # | Bug | Where | How it shows |
| --- | --- | --- | --- |
| H7 | Extracted values labels collapse to one letter per line on rows with a corrected value. **Regression from the 10 Nov overlap fix, live now.** | `web/src/review/review.css:63-66` | Finloc Jul-2026 at 1440 px: "Closing" renders as C / l / o / s / i / n / g in a 144 px tall row. Also at 1920 px. |
| H8 | Wide tables are cut off with no horizontal scroll. | `web/src/design/components/components.css:81` | At 1280 px the Companies list loses Adverse media and Notes (245 px clipped); the program Dashboard loses Facility limit, Utilization and Trend. Still 85 px clipped at 1440 px. |

### News screening

| # | Bug | Where | How it shows |
| --- | --- | --- | --- |
| H9 | A story whose link redirects is re-read, re-checked and fails to save on every later run. | `news/runner.py:144-146, 288-297, 330` | Run 2 calls Claude again for a story already on file, hits the unique constraint, and the run ends `partial` with a raw SQL error. |
| H10 | The publisher page text always replaces the provider's article body, even when the page is a cookie or paywall notice. | `news/runner.py:142-143` | Event Registry body "TLFC was sued for fraud…" is replaced by "Please enable JavaScript and cookies". Claude excludes the story, and excluded stories are never re-checked. |

### Hosting

| # | Bug | Where | How it shows |
| --- | --- | --- | --- |
| H11 | The laptop export script fails in Git Bash, which is where the hosting guide says to run it. | `scripts/export-dev-data.sh:17` | Git Bash rewrites `/data` to `C:/Program Files/Git/data`; tar fails and a useless filestore archive is left behind. The database dump itself succeeds. |
| H12 | The restore script destroys before it validates. | `scripts/prod-restore.sh:27-42` | A truncated dump, swapped arguments or any restore warning leaves the database dropped or half-loaded and the app stopped. The final wait loop can hang for ever. |

## Medium severity (23)

**Review and publish logic**
- M1. The seed overwrites master data edited in the app (program sharing, limit, servicer). A partner un-shared from a program sees it again after a re-seed. `api/app/seed.py:555-567`
- M2. Re-extract on a failed upload returns 500 and leaves an orphan job when a newer upload exists for the same deal and period. `api/app/main.py:231-234`
- M3. A one-company news run marks every company as screened. **From the Run now change; not live yet.** `api/app/companies.py:143-148`

**Extraction, rules, worker**
- M4. An unreadable covenant value becomes status "OK" with no finding. `derive.py:475`, `settrep_standard.py:132`, `rules/checks.py:744`
- M5. R06 cannot fail on the contract totals: it checks a figure the extractor derives from the same two numbers. `rules/checks.py:246`
- M6. On MOVE Trust reports, a finding's page and the automatic second-pass pages are F-PIL page numbers. `contracts/rules.yaml` (`source_page_hint`); `adapter.py:210-213`
- M7. The floor-covenant WATCH band differs between the extractor and rule R18, so values just above a floor raise a false "report says OK". `derive.py:479` vs `rules/checks.py:723-733`
- M8. An interrupted extraction job is lost and the upload stays in `extracting` (no recovery; also reported by the hosting review). `worker/main.py:119-126`

**News worker**
- M9. A date Claude reads is stored as confirmed with no future bound; a 2031 date counts as "recent" until 2031. `news/runner.py:181-182, 320-323`
- M10. Article redirects are followed to internal addresses (SSRF), and the internal page's text is stored and sent to Claude. `news/sources/net.py:79-111`; `news/pages.py:161-173`
- M11. The 10-second page timeout is per read, not total; a slow page can hold a run for minutes and block Run now. `news/sources/net.py:89-91`
- M12. A page wrapped in a `<form>` (common on ASP.NET sites) loses all its article text. `news/pages.py:18`

**Hosting**
- M13. The cron example fails every night until `backups/` exists. `docs/hosting.md`
- M14. Backups are never pruned and sit on the same disk as the database; a failed dump leaves a partial file under a valid name. `scripts/prod-backup.sh`
- M15. Stored news-source keys do not survive the laptop-to-server move: the guide says to generate a new `NEWS_SECRET_KEY`, and never says to copy or back up `.env`. `docs/hosting.md`, `.env.production.example:27`

**Portal and company screens**
- M16. TLFC's profile opens on an unpublished deal ("Not published") although the list shows it as OK with $140.8M. `CompanyProfilePage.tsx:102`
- M17. Switching user inside the same portal leaves the previous user's data on screen (for example "Following"). `web/src/portfolio/data.ts:12-31`; `web/src/shell/App.tsx:185`
- M18. The company profile scrolls sideways: the hidden chart data table is 590 px wide. `charts.tsx:183`; `components.css:5`
- M19. Some notification "Open" buttons go to the wrong place (partner `user_change` links have no portal prefix; an analyst is sent to an admin-only page). `api/app/notify.py:133-135`

**Admin and review screens**
- M20. MOVE Trust reports show mostly dashes in "Cumulative net losses by vintage" and "Ratio history": the tables use F-PIL column names. `ExtractedValues.tsx:179-190, 207-215`
- M21. The user drawer compares against stale subscriptions after a save, so a change back cannot be saved without reopening it. `UserManagementPage.tsx:152, 187`
- M22. A `?thread=` link from a notification keeps pulling the comment panel back to that thread. `ReviewPage.tsx:67-71`

**Security**
- M23. CSV formula injection in the audit export: a user's name or a reason starting with `=` runs as a formula when a TAO Admin opens the file in Excel. A partner user can set such a name. `api/app/auditlog.py:121, 135`

## Low severity (27)

**API input handling (500 where a clean refusal is due)**
- L1. A NUL byte in any path, query or JSON string. `main.py:1546, 891, 1084` and others
- L2. Unbounded integers (`version`, `offset`). `main.py:887, 943`
- L3. Audit `month` with year 0000 or 9999. `main.py:36`; `auditlog.py:26-31`
- L4. `NaN` / `Infinity` in number fields (program limit, value edits, corrections, covenant thresholds); also reported by the logic review. `main.py:316-319, 403-405, 652, 684-686`; `review.py:209-220`

**Review and publish logic**
- L5. Correction dates use the server's date, not Toronto's; after 19:00 Toronto a correction shows tomorrow's date. `api/app/review.py:143, 252`

**Extraction, worker**
- L6. Values from the model fallback are trusted unchecked (unasked fields overwrite parsed ones; a bad date fails the upload). `worker/extract/__init__.py:41-56`
- L7. Re-extract from `extraction_failed` stores a fragment as the extraction. `worker/main.py:41-48`

**News worker**
- L8. A first search cut short (daily cap, a source skip, or a paid archive added later) never completes. `news/runner.py:383`
- L9. A check that is refused or cut off is retried every run for ever. `news/check.py:189-190`
- L10. Two news worker instances would fail each other's runs and could start two scheduled runs. `news/main.py:63-68, 124-131`
- L11. Exclusion and context words match as raw substrings with no accent folding ("art" matches "party"; "equipement" misses "équipement"). `news/runner.py:38-40`
- L12. Verdict coercion accepts bad values as kept (`"false"`, `NaN`, 85). `news/check.py:110, 116`
- Not verified offline: whether article text can steer the live model. Story text is not escaped inside the prompt's tags. `news/check.py:148-152`

**Hosting**
- L13. The guide's outbound list omits publisher sites and the paid providers.
- L14. The guide describes Azure (read by no code) and the Anthropic key (needed for the news check, optional for extraction) wrongly.
- L15. A restore leaves Redis untouched, so old jobs run against restored data. `scripts/prod-restore.sh`
- L16. `env_file: .env` gives Postgres, Redis and nginx every secret. `docker-compose.prod.yml:11`
- L17. nginx drops security headers on `/` and `/assets/`. `deploy/nginx.conf:34-47`

**Portal and company screens**
- L18. "What to watch" links to anchors that do not exist (`#losses`, `#next-report`, the loss chart). `sections.tsx:73`; `api/app/companies.py:524, 611, 630`
- L19. Notifications tab race: a slow tab's answer overwrites the tab now selected. `NotificationsPage.tsx:76-81`
- L20. The chart hover box is cut off at the right edge of the window. `charts.tsx:93`
- L21. A covenant value of −0.06 shows as "-$0". `web/src/portfolio/Num.tsx:8`
- L22. The inbox stops at 100 notifications; older ones are unreachable. `NotificationsPage.tsx:78`

**Admin and review screens**
- L23. Reporting calendar rows re-sort on every keystroke and a non-digit wipes the field. `SystemSettingsPage.tsx:207, 215`
- L24. Links into System settings sections do not scroll to the section. `AuditLogPage.tsx:276, 278`
- L25. Covenant "In force / Scheduled" uses the UTC date; "Export this month" uses the browser's month. `ProgramRecordPage.tsx:20`; `SystemSettingsPage.tsx:93`
- L26. A role switch in another browser tab leaves a stale identity in the sidebar. `web/src/shell`
- L27. `worst_vintage` arrives with broken characters from extraction ("Dec-22 â€’ Nov-23").

## One thing outside the code

While checking the production compose file, a reviewer ran `docker compose config`, which printed the development `.env` values (the Anthropic key and `NEWS_SECRET_KEY`) into this session's local log. They were not written to any file or sent anywhere else. Rotating the Anthropic key is the cautious choice.

## Checked and found sound (selected)

- Role gates and partner isolation on every route probed; TAO-only data never reached a partner role; news-source keys never appeared in a response, log or audit entry.
- Extraction values for F-PIL deals match the reference objects with zero differences; number parsing (separators, parentheses, signs, percent) holds; Dynamic Capital's four months extract cleanly.
- Roll-ups are computed on read, so they are never stale; insights follow the decided rules (median, one point per company, TLFC as one company).
- Migrations 007–014 are safe to re-run; the production images copy every file the code needs; binary backups survive Git Bash.
- Chart hover picks the right month at the edges; full screen measures correctly; units and colour polarity are right across the six published deals.

## Proposed order of fixes

1. **Now:** H7 (live regression) and M3 (before Run now goes live).
2. **Review-to-publish integrity:** H1, H2, H3, H6, then H4, M4, M5, M7. H5 and H6 touch `worker/extract/` and `worker/validate/`, which are frozen; they need Matt's go-ahead to open.
3. **News:** H9, H10, M9–M12.
4. **Screens:** H8, M16–M22.
5. **Hosting, before IT installs:** H11, H12, M13–M15, L13–L17.
6. **Security and input handling:** M23, L1–L4.
7. The remaining low items.
