# TAO Admin POC: bug audit, fix status

Date: 2026-11-11. Companion to `tao-admin-poc-bug-audit_Report_v1.md` (the findings). Branch: `integration/fixes`.

## Summary

Every high and medium finding is fixed, and every low finding is fixed or closed with a reason. Five builders fixed their own areas in parallel; the Lead fixed the hosting items, the live label regression and the Run now screening bug, and made the contract changes the fixes needed.

| Severity | Found | Fixed | Fixed with a stated limit | Closed, not a defect |
| --- | --- | --- | --- | --- |
| High | 12 | 11 | 1 (H9) | 0 |
| Medium | 23 | 23 | 0 | 0 |
| Low | 27 | 26 | 0 | 1 (L27) |

## Verification

| Check | Result |
| --- | --- |
| Contract check | passes |
| Rules | 167 passed (129 before) |
| Validate worker | 40 passed (25 before) |
| Extraction | 130 passed, 84 skipped (the slow MOVE Trust suites, which need `EXTRACT_ALL=1`) |
| News worker | 259 passed (157 before) |
| API | 508 passed, 9 skipped (470 before) |
| Web app | type check clean; 775 passed, 17 skipped (701 before) |
| Full demo from a fresh database | 44 of 44 in 11.4 minutes |
| Extraction regression | all 48 sample PDFs extracted before and after: no existing value changed; one new field (`contracts.change_reported`) in 44 files; the three F-PIL deals still match `docs/dashboard-json/` with zero differences |
| Hosting scripts | tested on a throwaway production stack: swapped arguments, a truncated dump, a truncated archive and an unconfirmed prompt are refused with nothing changed; a failing load leaves the data intact; a real restore and a Git Bash laptop export work |
| Browser, 1280 and 1440 px | Companies table scrolls inside its card; TLFC opens on its published deal; no sideways page scroll; MOVE Trust tables have no all-dash column; labels keep 130 px on corrected rows |

Not verified:

- The row locks behind H3 ran on SQLite in the API suite, where the conditional updates carry the tests. PostgreSQL takes the same code path with a real `SELECT ... FOR UPDATE`; the full demo ran on PostgreSQL without a locking error, but no test fires two requests at the same instant against PostgreSQL.
- The paid news sources have still never run with a real key.
- Whether article text can steer the live model. The prompt now escapes tag-like text and tells the model the story block is untrusted.

## What changed for users

- **Approving a corrected re-issue** now always needs the "this replaces a published report" finding (R12) acknowledged first. Before, it could be approved without it.
- **Approve always re-runs the checks,** and publishing a month re-runs the later months still in review. A month can gain a new blocking finding when an earlier month is re-issued.
- **A page with no readable text, or a field the extraction could not place,** is now a blocking finding (under R01), naming the pages or fields.
- **A covenant whose value could not be read** shows "No value" and a review finding, not "OK".
- **Re-extracting pages** keeps reviewer decisions on findings that did not change, and no longer moves ratio values to other months.
- **Two people acting on one report at once:** exactly one action succeeds; the other gets a clear refusal.
- **Wide tables** scroll sideways inside their card. A table that scrolls this way keeps its header at the top of the card, not under the page's top bar.
- **Switching user** (or switching in another browser tab) reloads the page's data.
- **MOVE Trust reports** show their own columns in the loss, ratio and roll-forward tables.
- **News:** a story's page text is used only when it is better evidence than the provider's text; redirects to internal addresses are refused; a check that fails three times on the story itself is excluded with that reason; a crashed run is detected in 10 minutes.
- **The seed** only adds missing partners, programs and deals; it no longer overwrites what was edited in the app.
- **CSV exports** prefix a cell that would run as a formula with `'`.

## Items with a note

- **H9 (redirecting links), fixed with a limit.** A story is recognised by its source link and its final publisher URL (ignoring `http`/`https` and `www.`). A second, different link to the same article (a shortener, another aggregator) is recognised only once its page has been read, so its page is read once per run while the link stays in the search window. Claude is not called again and nothing is saved twice. A `news_item.source_urls` column would remove the limit.
- **L27 (broken characters in a vintage label), closed.** The extraction carries the report's own figure dash correctly. The broken text came from a reader outside the worker; it no longer appears in anything the API serves (all 23 extractions and the portfolio checked), `scripts/check_contracts.py` now reads JSON as UTF-8, and a regression test covers the label.
- **M4 needed a contract change:** `covenants[].status` may now be null. Made by the Lead.
- **Unread pages and unplaced fields** are reported under R01 instead of a new rule. A separate rule (R23) is drafted in the Extraction agent's report if wanted.
- **A second pass now re-reads the whole document** (H5), so it takes as long as a first pass.
- **The roll-forward table still does not list interest and recoveries per month.** They are extracted for all 12 deals; adding them widens the F-PIL table. Left for a decision.

## Migrations in this batch

- `014_news_run_company.sql`: `news_run.company_slug` (Run now for one company).
- `015_news_run_heartbeat.sql`: `news_run.heartbeat_at` (a dead run is detected in minutes).

Both are idempotent and apply at API start-up.
