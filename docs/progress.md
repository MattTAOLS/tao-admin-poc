# Progress log

Append an entry when a work package lands. Newest first.

- 2026-11-06 — QA & Demo, phase 2 wave D (merged integration/wave-d): must-pass first: the 31 existing tests, unchanged,
  31/31 from `down -v` with the news fixture override (58 min 30 s on a busy host; no failure, so nothing to attribute
  to wave D). New `specs/12-companies.spec.ts` (7 tests), STEP12 in `lib/facts.ts`: 12a Companies list (10 rows, TLFC one
  row with 3 deals, "Breach or watch" = 4 and `?status=flagged` survives a reload, "Loans" finds TLFC by deal, star
  follow, Essex and Xpedite balance and status equal the published objects); 12b Essex profile (KPIs = July 2026
  publication = reference object, "MSA 8.1 (h) near its limit", delinquency median by default then mean, median
  recomputed from Finloc and TLFC LP, published covenant cells Apr-Jul outlined, both April restatements, TLFC picker
  over 3 deals); 12c feed off -> 409 feeds_off, feed on with a reason, Run now -> Done with 10 items and 7 adverse,
  fixture-only titles, false friends unmatched, Essex Negative news, review (Essex) and dismiss (Moneda), adverse_media
  notification to the follower, adverse_change and news_run audit, analyst 403; 12d analyst note with an @A. Patel
  pick, mention Open -> `?note=`, partners 404/403 on notes; 12e partner off (no nav, Page not found, 404), on with a
  reason, investor sees the 10 shared companies (both programs are shared with both partners, so no outside company
  exists; hidden open and dismissed items checked instead), no Notes column or TAO-only parts, reviewed item only, note
  text in no investor or manager response; 12f record edit and contact, company_change before/after, analyst 403;
  12g News runs list. Two full runs from `down -v`: 38/38 (46 min 37 s) and 38/38 (30 min 18 s). docs/demo.md step 12
  with 19 screenshots `docs/demo/12-*.png`. Run: add `-f scripts/compose.news-fixture.yml` to the compose command.
  Filed in requests.md (QA & Demo, wave D): published `source_file` is "source.pdf" (worker reads the stored name),
  "Open thread" on note mentions, "1 other deals" and "one point per deal" wording.
- 2026-11-06 — UI-Partner, phase 2 wave D (agent/ui-partner): Companies list, Company profile and the Companies section on
  the Portfolio Executive Summary, all in `web/src/portfolio/companies/`, one set of files for the TAO Admin shell and both
  partner portals. `CompaniesPage.tsx` (default export, D5 screens B and C): one row per company (TLFC is one row with three
  deals), status dot + word with "n breach · n watch", balance, delinquency range with direction arrow and good/bad colour
  from `polarity.ts` (rising is bad), news in 7 days, adverse media state, Notes for TAO only. Search covers company and deal
  names; program, industry, status (incl. "Breach or watch"), adverse media and "only companies I follow" all live in the URL;
  every column sorts; Export CSV writes the filtered rows (raw numbers). The star does PUT / DELETE follow and is disabled with
  a hint in role-only mode. `CompanyProfilePage.tsx` (default export, D6): record with "Not set" for empty fields and a TAO
  Admin "Edit record" dialog (industry, NAICS, HQ, website, relationship since, owner from the active TAO users, aliases, deal
  links, required reason; PATCH sends only what changed), KPIs from the published deal object, What to watch with anchor
  links, performance charts with a Median / Mean / Both control and the covenant limit line (no industry averages), rolling
  loss ratios with named peers (peers with drawn false listed, not drawn), the covenant at watch (else interest coverage),
  pool balance with grey slots for months not loaded and the program median change, covenant status history (published cells
  outlined, recomputed cells say so on hover and focus), Top 10 obligors (existing panel), restatements and TAO corrections,
  news (All / Negative, sentiment word, source, link out; "Not screened yet" or "No news in 30 days"), adverse media (state,
  category counts, "sanctions is a keyword hit, not a list check"; TAO Admin Mark reviewed with a note and Dismiss with a
  reason), watchlist and alerts (follow, link to Profile, email "coming later"), analyst notes (TAO only: add with @mentions
  and an optional report month, edit own, remove own or as TAO Admin; writing needs a signed-in user), key contacts (TAO
  Admin add / edit / remove with a reason), documents (this deal's SetReps, linking to the Reports library or the Data room;
  no other uploads this wave). `?deal=` picks the deal for multi-deal companies (first by default); "View as partner" hides
  every TAO-only part; a partner gets Not found on a 404 or while the feature is off. `CompaniesSection.tsx` sits between the
  program cards and Flagged deals for TAO, and for partners while `Me.features.companies` is true (read from the session, else
  `GET /me`); off or unreadable, it renders nothing and `/companies` is not called.
  Tests: `companies.test.tsx` (list, filters in the URL, sort, follow, CSV, partner columns, feature off, summary section) and
  `profile.test.tsx` (sections in order, compare control, loss peers, covenant history, news, both adverse dialogs, analyst
  rights, notes rights and @mention, Edit record, contacts, TLFC deal picker, partner view and Not found), with a fake API
  (`companyApi.tsx`) and fixtures (`companyFixtures.ts`) computed from docs/dashboard-json; news, adverse items, notes and
  contacts are test records. Run: `cd web && npx vitest run src/portfolio`.
  Stubbed / needs: routes and partner nav gating come from Design (`pages.ts`); `Me.features` is read through a cast until
  `shell/types.ts` has it; the profile reads `/companies` for the screened state (see requests.md, UI-Partner).
- 2026-11-05 — Data & API (phase 2 wave C): people, notifications, comments, settings (contract abdda6d + 5575406).
  Auth seam (R1): `caller()` resolves `X-User` (an active app_user) to the same Caller (role, partner) plus user_id and
  label (the name); X-Role / X-Partner are then ignored. Unknown id 401 `unknown_user`, deactivated 401 `inactive_user`.
  Without X-User the demo headers behave exactly as before (no X-Role: 422 `invalid`); every gate, partner_filter and
  the original test_roles.py lines are unchanged. Audit rows carry `actor_user_id` and the name as actor_label;
  uploaded_by / published_by keep the role string, setrep_upload gains `uploaded_by_user_id`. last_active_at is written
  at most every 5 minutes. `/audit?actor_user_id=` (own entries readable by every role; others need the scope rule).
  Migration 010: app_user, subscription, user_pref, notification_pref, system_setting, review_action.actor_user_id,
  setrep_upload.uploaded_by_user_id, publication(_version).note_to_partners. Migration 011: notification,
  notification_event, thread, comment. Both idempotent; checked on PostgreSQL 16 (pg8000) from an existing 009 database
  with data, then each file run again. The seed loads seed/users.json (adds a user only if id and email are new; never
  changes one).
  Users: `/users` (tao_admin all; Company Admins only their partner's, another partner's user is 404; others 403
  `company_admin_only`), create / patch / deactivate / reactivate / subscriptions with self_change, last_admin,
  other_partner, email_taken (case-insensitive), role_partner_mismatch, unknown_partner, already_active /
  already_deactivated, not_visible, email_later. PATCH with a new role and no partner_slug takes the role's partner
  (TAO: none). `/me` (demo: user null, defaults), PATCH /me, `/me/notification-prefs` (required: covenant_changed,
  correction_published; partner roles receive report_published, correction_published, user_change), `/settings`
  (five keys, defaults until set; publish_note_templates merges a partial value). Audit: user_change, prefs_change,
  settings_change with before / after.
  Notifications: approve takes `{note_to_partners}` (stored on the publication and its archived versions, shown in
  `versions[]`), publish and correction publish notify per `/uploads/{id}/recipients` (subscribed users at a partner the
  program is shared with, partner users only while partner_notifications_enabled, plus subscribed TAO users; reasons
  deactivated, not_visible, not_subscribed, partner_notifications_off, switched_off). correction_published carries
  `changes`. Reject and correction reject -> report_rejected; a queued correction -> report_needs_review; both to
  subscribed TAO users. The worker moves uploads to needs_review / extraction_failed outside the API, so a sweep on
  every notification read sends those once (report_needs_review plus covenant_changed per R19 note; system for a failed
  extraction) to the TAO subscribers of that moment, keyed in notification_event; it also purges rows older than 12
  months. Partner reads go through partner_filter again: partner kinds only, deals of programs visible now (R7).
  Comments: TAO only (partners 403), writes need X-User (401 user_required), reads do not. Mentions only active TAO
  users (422 bad_mention), each notified once; replies notify the thread's other people; edits author-only (403
  not_author), new mentions only, old text in comment_edit; resolve / reopen by any TAO Admin or the starter (403
  forbidden otherwise, 409 bad_state). Threads carry `version`; a correction keeps them, a re-issue lists the replaced
  uploads' threads. Links (Lead's table): review queue `/admin/uploads/queue/<id>` (`?thread=<id>` for mention and
  reply), published and correction `/admin|/<partner>/portfolio/<program>/deals/<deal>?period=`, covenant_changed
  `/admin/partners/<first partner>/programs/<program>`, user_change and system `/admin/settings/users` (partner:
  `/settings/profile`). Follow-ups: a tao_analyst may GET exactly `/users?partner_slug=tao&status=active` (id, name,
  email, role: the @mention list), anything else 403; receives_summary reads "All MOVE Trust deals; Moneda Capital
  Corp. (F-PIL 2.0)" or "Nothing yet"; every user_change detail carries the user's email and name.
  Tests: test_auth_seam, test_users, test_notifications, test_threads, test_migrate (010/011 on PostgreSQL), test_roles
  wave C lines; parity 49 / 61. Full api suite on SQLite (count in the final commit); wave C files plus audit, seed,
  corrections, re-issue also on PostgreSQL 16 via pg8000. check_contracts green.
  Needs from the Lead: contract text still says receives_summary "None" when empty (now "Nothing yet") and the
  Notification.link examples are the old paths; the kinds a partner role can receive are not listed; the sweep timing
  (needs_review and extraction-failed notifications appear when someone next opens notifications or the badge polls)
  is worth a line under Notification. A system notification about an upload (extraction failed) links to its review page; /admin/settings/users is for user_change (and system without an upload).

## 2026-11-06 — Data & API, wave D (companies, news, adverse media) — branch agent/api
- Built (api/ only, contract lead/wave-d 30d8fd4): models for migration 012 (company, company_contact, company_note,
  company_follow, news_run, news_item, adverse_item, deal.company_slug); `seed.load_companies` (adds a company whose slug
  is missing, links a deal only while it has none; never changes an existing company or link). The 13 paths
  (`api/app/main.py`, logic in `api/app/companies.py`), parity now 62 paths / 81 operations.
- Rights: tao_admin writes the record, deal links, contacts, adverse decisions, Run now; both TAO roles read and write
  notes (author edits, author or tao_admin removes). Partner roles reach `/companies*` only while
  `company_profiles_partner_enabled` (else 404 `not_found`), scoped by `visible_deals` = deals of the programs
  `visible_programs` gives `partner_filter`; a company with no visible deal is 404. Notes: partners 403 `tao_only`
  (404 while profiles are off); CompanyRow.notes absent and Company.owner null for partners.
- Figures from each deal's latest publication only. Insights: 13 ratio months, program median and mean one point per
  other company in the program (a company with several deals at the median of its deals; its own deals left out; null
  under 2 companies; contract 1f5f594), balance_median_change the same way, loss peers on the same rolling field (drawn false past 10x), covenant history
  (published where a publication's ratio month exists, else recomputed with `covenants_as_of` and the deal's watch
  buffer), signals, restatements (company restatements + data_corrections). Checked against docs/dashboard-json (Essex
  July 2026 delinquency 0.0131; MOVE Trust median 0.0042 over the 5 other companies reporting it, TLFC once).
- next_report from `reporting_calendar` and the settlement offset; late after 5 business days with no upload of the
  period. news_7d and adverse.state read `not_screened` until an ok / partial run finished after the company was made.
- Settings: `company_feeds` validated and merged over its defaults (fields left out keep their value);
  `company_profiles_partner_enabled` (default false); `Me.features.companies`.
- Audit, all five in Platform, details in the Lead's shapes: company_change {company_slug, company_name, change
  (created | record | deals | contact_added | contact_edited | contact_removed), contact_id, before, after} with changed
  fields only (a PATCH that edits fields and links writes a `record` and a `deals` entry; moving a deal also writes a
  `deals` entry on the company it left); company_note {company_slug, note_id, body, mentions, collection_period};
  company_note_edit {company_slug, note_id, change edited | removed, before, after}; adverse_change {company_slug,
  adverse_id, category, title, state, note}; news_run {run_id, trigger}.
- Notifications (sweep, notification_event keys, each once): adverse_media (open item to TAO followers; reviewed item
  to partner followers, the review route runs the sweep at once), negative_news (followers), report_late (TAO
  subscribers, once per deal and period). Partners only while partner_notifications_enabled and
  company_profiles_partner_enabled and only if they can see the company; partner reads also hide these two kinds while
  profiles are off. All three in the reports tab; partners can switch off the first two. Note mentions are kind
  mention linking to `/admin/companies/<slug>?note=<id>`.
- Run: `cd api && python -m pytest -q` (SQLite), or with `TEST_DATABASE_URL=postgresql+pg8000://...` on a throwaway
  PostgreSQL. Smoke-tested on compose project tao-api (migration 012 applied at start, seed and Run now LPUSH to `news`).
- Stubbed / not here: the news worker itself (News agent). Contract gaps and choices: docs/requests.md, Data & API
  2026-11-06 (unlinked-deal row slug, partner owner null, MOVE Trust has no covenant definitions so its history is
  published months only, signal severities and anchors, interpretations).
- 2026-11-05 — Data & API (phase 2 wave C): people, notifications, comments, settings (contract abdda6d + 5575406).
  Auth seam (R1): `caller()` resolves `X-User` (an active app_user) to the same Caller (role, partner) plus user_id and
  label (the name); X-Role / X-Partner are then ignored. Unknown id 401 `unknown_user`, deactivated 401 `inactive_user`.
  Without X-User the demo headers behave exactly as before (no X-Role: 422 `invalid`); every gate, partner_filter and
  the original test_roles.py lines are unchanged. Audit rows carry `actor_user_id` and the name as actor_label;
  uploaded_by / published_by keep the role string, setrep_upload gains `uploaded_by_user_id`. last_active_at is written
  at most every 5 minutes. `/audit?actor_user_id=` (own entries readable by every role; others need the scope rule).
  Migration 010: app_user, subscription, user_pref, notification_pref, system_setting, review_action.actor_user_id,
  setrep_upload.uploaded_by_user_id, publication(_version).note_to_partners. Migration 011: notification,
  notification_event, thread, comment. Both idempotent; checked on PostgreSQL 16 (pg8000) from an existing 009 database
  with data, then each file run again. The seed loads seed/users.json (adds a user only if id and email are new; never
  changes one).
  Users: `/users` (tao_admin all; Company Admins only their partner's, another partner's user is 404; others 403
  `company_admin_only`), create / patch / deactivate / reactivate / subscriptions with self_change, last_admin,
  other_partner, email_taken (case-insensitive), role_partner_mismatch, unknown_partner, already_active /
  already_deactivated, not_visible, email_later. PATCH with a new role and no partner_slug takes the role's partner
  (TAO: none). `/me` (demo: user null, defaults), PATCH /me, `/me/notification-prefs` (required: covenant_changed,
  correction_published; partner roles receive report_published, correction_published, user_change), `/settings`
  (five keys, defaults until set; publish_note_templates merges a partial value). Audit: user_change, prefs_change,
  settings_change with before / after.
  Notifications: approve takes `{note_to_partners}` (stored on the publication and its archived versions, shown in
  `versions[]`), publish and correction publish notify per `/uploads/{id}/recipients` (subscribed users at a partner the
  program is shared with, partner users only while partner_notifications_enabled, plus subscribed TAO users; reasons
  deactivated, not_visible, not_subscribed, partner_notifications_off, switched_off). correction_published carries
  `changes`. Reject and correction reject -> report_rejected; a queued correction -> report_needs_review; both to
  subscribed TAO users. The worker moves uploads to needs_review / extraction_failed outside the API, so a sweep on
  every notification read sends those once (report_needs_review plus covenant_changed per R19 note; system for a failed
  extraction) to the TAO subscribers of that moment, keyed in notification_event; it also purges rows older than 12
  months. Partner reads go through partner_filter again: partner kinds only, deals of programs visible now (R7).
  Comments: TAO only (partners 403), writes need X-User (401 user_required), reads do not. Mentions only active TAO
  users (422 bad_mention), each notified once; replies notify the thread's other people; edits author-only (403
  not_author), new mentions only, old text in comment_edit; resolve / reopen by any TAO Admin or the starter (403
  forbidden otherwise, 409 bad_state). Threads carry `version`; a correction keeps them, a re-issue lists the replaced
  uploads' threads. Links (Lead's table): review queue `/admin/uploads/queue/<id>` (`?thread=<id>` for mention and
  reply), published and correction `/admin|/<partner>/portfolio/<program>/deals/<deal>?period=`, covenant_changed
  `/admin/partners/<first partner>/programs/<program>`, user_change and system `/admin/settings/users` (partner:
  `/settings/profile`). Follow-ups: a tao_analyst may GET exactly `/users?partner_slug=tao&status=active` (id, name,
  email, role: the @mention list), anything else 403; receives_summary reads "All MOVE Trust deals; Moneda Capital
  Corp. (F-PIL 2.0)" or "Nothing yet"; every user_change detail carries the user's email and name.
  Tests: test_auth_seam, test_users, test_notifications, test_threads, test_migrate (010/011 on PostgreSQL), test_roles
  wave C lines; parity 49 / 61. Full api suite on SQLite (count in the final commit); wave C files plus audit, seed,
  corrections, re-issue also on PostgreSQL 16 via pg8000. check_contracts green.
  Needs from the Lead: contract text still says receives_summary "None" when empty (now "Nothing yet") and the
  Notification.link examples are the old paths; the kinds a partner role can receive are not listed; the sweep timing
  (needs_review and extraction-failed notifications appear when someone next opens notifications or the badge polls)
  is worth a line under Notification. A system notification about an upload (extraction failed) links to its review page; /admin/settings/users is for user_change (and system without an upload).

## News, wave D (2026-11-06)

Built: `news/`, the news worker. `main.py` reads `company_feeds` every minute (defaults when absent: off, 06:00,
America/Toronto, google_news + gdelt), runs queued Run-now rows oldest first (BRPOP on `NEWS_QUEUE` is a wake-up; the
queued rows are the source of truth), and starts one `schedule` run per local day at or after run_at (zoneinfo; tested
around local and UTC midnight, the March skipped hour and the November repeated hour). One run at a time; a run left
`running` by a restart is failed; a queued run that meets `enabled: false` is failed without fetching. Sources: Google
News RSS (one quoted query per name and alias, 2 s apart, last 7 days), GDELT DOC 2.0 (one OR query per company, 5.5 s
apart), fixture (`NEWS_SOURCE=fixture`, `NEWS_FIXTURE=<json>`). urllib, 20 s timeout, User-Agent "tao-admin-poc news
worker", nothing personal sent. Matching: whole phrase, case-insensitive, name and aliases, title or description.
Screening: `screen.py` + `screen_terms.json`, five adverse categories (one open adverse_item per category hit) and
positive / neutral / negative sentiment; keywords only. Errors per company and source as `{company_slug, source,
message}`; status ok / partial / failed. Logs: run start and end with counts.

Run: `python -m pytest news/tests` (72 tests, SQLite, network refused). Fixture format and expected rows:
`news/README.md`; example `news/fixtures/example.json` (10 items and 7 adverse items against the seed companies, two
false friends that must not match).

Checked on PostgreSQL 16 in a private stack (tao-news): container idles while off; a queued run while off is failed with
the "company_feeds is off" error; with the fixture a manual run wrote 10 items and 7 adverse items (status ok); the
scheduled run started once, deduped to 0 new items, and did not repeat. Companies were inserted by hand because the
API on lead/wave-d does not seed them or serve `/news/runs` yet; the `/companies/{slug}/news` read was not checked.

Live smoke test (once, Google News only, 17 requests): status ok, 10 companies, no errors, every response parsed as
RSS, 0 items kept (nothing within 7 days that names a company in the title or description). Setting switched back off,
stack removed with `down -v`; nothing fetched was committed.

Needs: API seeds `company` and implements POST `/news/runs` as described under "News" in docs/requests.md; Lead or QA
sets NEWS_SOURCE / NEWS_FIXTURE on the news service for the e2e.
- 2026-11-05 — Data & API (phase 2 wave C): people, notifications, comments, settings (contract abdda6d + 5575406).
  Auth seam (R1): `caller()` resolves `X-User` (an active app_user) to the same Caller (role, partner) plus user_id and
  label (the name); X-Role / X-Partner are then ignored. Unknown id 401 `unknown_user`, deactivated 401 `inactive_user`.
  Without X-User the demo headers behave exactly as before (no X-Role: 422 `invalid`); every gate, partner_filter and
  the original test_roles.py lines are unchanged. Audit rows carry `actor_user_id` and the name as actor_label;
  uploaded_by / published_by keep the role string, setrep_upload gains `uploaded_by_user_id`. last_active_at is written
  at most every 5 minutes. `/audit?actor_user_id=` (own entries readable by every role; others need the scope rule).
  Migration 010: app_user, subscription, user_pref, notification_pref, system_setting, review_action.actor_user_id,
  setrep_upload.uploaded_by_user_id, publication(_version).note_to_partners. Migration 011: notification,
  notification_event, thread, comment. Both idempotent; checked on PostgreSQL 16 (pg8000) from an existing 009 database
  with data, then each file run again. The seed loads seed/users.json (adds a user only if id and email are new; never
  changes one).
  Users: `/users` (tao_admin all; Company Admins only their partner's, another partner's user is 404; others 403
  `company_admin_only`), create / patch / deactivate / reactivate / subscriptions with self_change, last_admin,
  other_partner, email_taken (case-insensitive), role_partner_mismatch, unknown_partner, already_active /
  already_deactivated, not_visible, email_later. PATCH with a new role and no partner_slug takes the role's partner
  (TAO: none). `/me` (demo: user null, defaults), PATCH /me, `/me/notification-prefs` (required: covenant_changed,
  correction_published; partner roles receive report_published, correction_published, user_change), `/settings`
  (five keys, defaults until set; publish_note_templates merges a partial value). Audit: user_change, prefs_change,
  settings_change with before / after.
  Notifications: approve takes `{note_to_partners}` (stored on the publication and its archived versions, shown in
  `versions[]`), publish and correction publish notify per `/uploads/{id}/recipients` (subscribed users at a partner the
  program is shared with, partner users only while partner_notifications_enabled, plus subscribed TAO users; reasons
  deactivated, not_visible, not_subscribed, partner_notifications_off, switched_off). correction_published carries
  `changes`. Reject and correction reject -> report_rejected; a queued correction -> report_needs_review; both to
  subscribed TAO users. The worker moves uploads to needs_review / extraction_failed outside the API, so a sweep on
  every notification read sends those once (report_needs_review plus covenant_changed per R19 note; system for a failed
  extraction) to the TAO subscribers of that moment, keyed in notification_event; it also purges rows older than 12
  months. Partner reads go through partner_filter again: partner kinds only, deals of programs visible now (R7).
  Comments: TAO only (partners 403), writes need X-User (401 user_required), reads do not. Mentions only active TAO
  users (422 bad_mention), each notified once; replies notify the thread's other people; edits author-only (403
  not_author), new mentions only, old text in comment_edit; resolve / reopen by any TAO Admin or the starter (403
  forbidden otherwise, 409 bad_state). Threads carry `version`; a correction keeps them, a re-issue lists the replaced
  uploads' threads. Links (Lead's table): review queue `/admin/uploads/queue/<id>` (`?thread=<id>` for mention and
  reply), published and correction `/admin|/<partner>/portfolio/<program>/deals/<deal>?period=`, covenant_changed
  `/admin/partners/<first partner>/programs/<program>`, user_change and system `/admin/settings/users` (partner:
  `/settings/profile`). Follow-ups: a tao_analyst may GET exactly `/users?partner_slug=tao&status=active` (id, name,
  email, role: the @mention list), anything else 403; receives_summary reads "All MOVE Trust deals; Moneda Capital
  Corp. (F-PIL 2.0)" or "Nothing yet"; every user_change detail carries the user's email and name.
  Tests: test_auth_seam, test_users, test_notifications, test_threads, test_migrate (010/011 on PostgreSQL), test_roles
  wave C lines; parity 49 / 61. Full api suite on SQLite (count in the final commit); wave C files plus audit, seed,
  corrections, re-issue also on PostgreSQL 16 via pg8000. check_contracts green.
  Needs from the Lead: contract text still says receives_summary "None" when empty (now "Nothing yet") and the
  Notification.link examples are the old paths; the kinds a partner role can receive are not listed; the sweep timing
  (needs_review and extraction-failed notifications appear when someone next opens notifications or the badge polls)
  is worth a line under Notification. A system notification about an upload (extraction failed) links to its review page; /admin/settings/users is for user_change (and system without an upload).

## 2026-11-06 — Design System, wave D (companies in the shell, company alerts, help)

- Routes (`web/src/shell/pages.ts`): `/admin/companies` (nav "Companies" after Portfolio Executive Summary, both TAO
  roles) and `/admin/companies/:companySlug` ("Company profile", breadcrumb under Companies); partner `/companies` and
  `/companies/:companySlug` in both portals, same files. Loaders come from
  `import.meta.glob('../portfolio/companies/{CompaniesPage,CompanyProfilePage}.tsx')`, so the shell builds and tests
  before UI-Partner's files are merged; a missing file renders the routed placeholder. Once merged, the glob picks them up
  with no shell change. Nav icon: new `IconBriefcase` in `web/src/design/components/icons.tsx`.
- Feature gate: `Me.features: { companies: boolean }` is now required in `web/src/shell/types.ts` (UI-Partner's request).
  `Page.feature: 'companies'` on the partner entries. The shell now reads GET /me in role-only mode too
  (demo headers only, no X-User) and on a role change without a user; `session.features` holds Me.features (null while
  reading; all false if /me fails, so the gate fails closed). Off: no nav entry, and a direct visit shows Not found in the
  body and the top bar. While /me is in flight: the route loading state. TAO routes are not gated.
- Notifications (`web/src/shell/account/`): kinds adverse_media "Adverse media", negative_news "Negative news",
  report_late "Report late", each with an icon (new IconShield, IconNews, IconClock) and its own open button; every kind
  now shows an icon beside its status pill. `KIND_TAB` maps all three to Reports. Profile preferences list them with a help
  line; report_late is never offered to a partner (`TAO_ONLY_KINDS`). "How you are notified" names the company alerts.
- Help (`web/src/shell/help/content.ts`): TAO sections Find a company, Read a company profile (median vs mean, grey
  months, recomputed covenant cells), News and adverse media, Add an analyst note (TAO), Keep the company record and
  contacts (TAO Admin), Turn on the news feed and partner access (TAO Admin, Run now); partner section Look up a company;
  notification sections and glossaries updated. Wording follows designs D5/D6 and the contract; check button names against
  UI-Partner's pages at merge.
- Tests: shell, sign-in, account and help tests cover the routes, gating, role-only /me, new kinds and help role
  visibility. Three existing assertions changed on purpose: "no /me call without a user" now expects one role-only /me.
- 2026-11-05 — Data & API (phase 2 wave C): people, notifications, comments, settings (contract abdda6d + 5575406).
  Auth seam (R1): `caller()` resolves `X-User` (an active app_user) to the same Caller (role, partner) plus user_id and
  label (the name); X-Role / X-Partner are then ignored. Unknown id 401 `unknown_user`, deactivated 401 `inactive_user`.
  Without X-User the demo headers behave exactly as before (no X-Role: 422 `invalid`); every gate, partner_filter and
  the original test_roles.py lines are unchanged. Audit rows carry `actor_user_id` and the name as actor_label;
  uploaded_by / published_by keep the role string, setrep_upload gains `uploaded_by_user_id`. last_active_at is written
  at most every 5 minutes. `/audit?actor_user_id=` (own entries readable by every role; others need the scope rule).
  Migration 010: app_user, subscription, user_pref, notification_pref, system_setting, review_action.actor_user_id,
  setrep_upload.uploaded_by_user_id, publication(_version).note_to_partners. Migration 011: notification,
  notification_event, thread, comment. Both idempotent; checked on PostgreSQL 16 (pg8000) from an existing 009 database
  with data, then each file run again. The seed loads seed/users.json (adds a user only if id and email are new; never
  changes one).
  Users: `/users` (tao_admin all; Company Admins only their partner's, another partner's user is 404; others 403
  `company_admin_only`), create / patch / deactivate / reactivate / subscriptions with self_change, last_admin,
  other_partner, email_taken (case-insensitive), role_partner_mismatch, unknown_partner, already_active /
  already_deactivated, not_visible, email_later. PATCH with a new role and no partner_slug takes the role's partner
  (TAO: none). `/me` (demo: user null, defaults), PATCH /me, `/me/notification-prefs` (required: covenant_changed,
  correction_published; partner roles receive report_published, correction_published, user_change), `/settings`
  (five keys, defaults until set; publish_note_templates merges a partial value). Audit: user_change, prefs_change,
  settings_change with before / after.
  Notifications: approve takes `{note_to_partners}` (stored on the publication and its archived versions, shown in
  `versions[]`), publish and correction publish notify per `/uploads/{id}/recipients` (subscribed users at a partner the
  program is shared with, partner users only while partner_notifications_enabled, plus subscribed TAO users; reasons
  deactivated, not_visible, not_subscribed, partner_notifications_off, switched_off). correction_published carries
  `changes`. Reject and correction reject -> report_rejected; a queued correction -> report_needs_review; both to
  subscribed TAO users. The worker moves uploads to needs_review / extraction_failed outside the API, so a sweep on
  every notification read sends those once (report_needs_review plus covenant_changed per R19 note; system for a failed
  extraction) to the TAO subscribers of that moment, keyed in notification_event; it also purges rows older than 12
  months. Partner reads go through partner_filter again: partner kinds only, deals of programs visible now (R7).
  Comments: TAO only (partners 403), writes need X-User (401 user_required), reads do not. Mentions only active TAO
  users (422 bad_mention), each notified once; replies notify the thread's other people; edits author-only (403
  not_author), new mentions only, old text in comment_edit; resolve / reopen by any TAO Admin or the starter (403
  forbidden otherwise, 409 bad_state). Threads carry `version`; a correction keeps them, a re-issue lists the replaced
  uploads' threads. Links (Lead's table): review queue `/admin/uploads/queue/<id>` (`?thread=<id>` for mention and
  reply), published and correction `/admin|/<partner>/portfolio/<program>/deals/<deal>?period=`, covenant_changed
  `/admin/partners/<first partner>/programs/<program>`, user_change and system `/admin/settings/users` (partner:
  `/settings/profile`). Follow-ups: a tao_analyst may GET exactly `/users?partner_slug=tao&status=active` (id, name,
  email, role: the @mention list), anything else 403; receives_summary reads "All MOVE Trust deals; Moneda Capital
  Corp. (F-PIL 2.0)" or "Nothing yet"; every user_change detail carries the user's email and name.
  Tests: test_auth_seam, test_users, test_notifications, test_threads, test_migrate (010/011 on PostgreSQL), test_roles
  wave C lines; parity 49 / 61. Full api suite on SQLite (count in the final commit); wave C files plus audit, seed,
  corrections, re-issue also on PostgreSQL 16 via pg8000. check_contracts green.
  Needs from the Lead: contract text still says receives_summary "None" when empty (now "Nothing yet") and the
  Notification.link examples are the old paths; the kinds a partner role can receive are not listed; the sweep timing
  (needs_review and extraction-failed notifications appear when someone next opens notifications or the badge polls)
  is worth a line under Notification. A system notification about an upload (extraction failed) links to its review page; /admin/settings/users is for user_change (and system without an upload).

## UI-Admin, wave D (2026-11-06)

Built: System settings has a new section 5, "Companies and news" (later sections move down one). The daily news search
switch (company_feeds: enabled, run time HH:MM, IANA time zone defaulting to America/Toronto, Google News RSS and GDELT
checkboxes, at least one) and "Partners can see company pages" (company_profiles_partner_enabled) both save through the
existing Save changes dialog: one reason, one PUT and one settings_change entry per setting, with field-level before and
after. An empty company_feeds value reads as the contract defaults. News runs lists GET /news/runs?limit=10 (trigger,
status as dot and word, started, finished, companies, items added, adverse added, errors in an expandable list). Run now
posts /news/runs; 409 feeds_off and run_active show plain messages; a 202 adds the queued run and refreshes the list every
5 s until it finishes, for at most 2 minutes. The reporting calendar says it drives "Next report due" and the late-report
alert on company pages. Audit log: labels and rendering for company_change (field-level before and after, deals by name,
linked and unlinked, contact changes), company_note (month and text), company_note_edit (old and new text, or "removed"),
adverse_change (Reviewed or Dismissed as dot and word, with the note) and news_run ("Manual run by <who>"); all five sit
on the Platform tab and in its action filter. Company subjects link to /admin/companies/<slug> (?note=<id> for notes).
Run: `cd web && npx vitest run src/admin`. Stubbed: nothing on the page; the audit detail shapes for the five actions are
my reading, since the contract does not give them (request in docs/requests.md, UI-Admin wave D). Needs: Data & API to
confirm those detail shapes; the /admin/companies route belongs to another agent.
- 2026-11-06 — QA & Demo, phase 2 wave C (merged integration/wave-c): R1 must-pass first. The existing 25 tests,
  unchanged, from `down -v`: 20 passed. Step 2 timed out waiting for the review page (its first API call came about
  10 s after navigation; the host was at 98% CPU) and step 3 followed from it. Step 9b hit its 6-minute limit on
  extraction, and step 10b followed from 9b. None traced to wave C logic: the role switcher's first user per role keeps
  every role-id pick working. Harness: expect/action timeouts 30 s, step 9 limits 15/12/12 min, `Api` takes an `X-User`,
  `signInAsUser` in lib/ui.ts, USERS and STEP11 in lib/facts.ts. New `specs/11-people.spec.ts`: 11a users (A. Patel on
  the card, 8 seeded users, add Q. Tester with all MOVE Trust deals, deactivate -> 401 inactive_user, reactivate,
  self_change and last_admin refused in UI and API, user_change in the Platform audit, analyst no access); 11b Team
  members for M. Chen (investor users only, tree = programs shared with Investor, other partner 404, viewer no
  access); 11c Essex 2026-07 thread on R14 with an @mention of A. Patel, bell, Mentions tab, Open thread -> ?thread=,
  reply, resolve (finding stays open), comment / thread_resolve audit, partners 403; 11d D. Alvarez subscribed, "off"
  reason with notifications off, System settings switch on with a reason, publish with a note, D. Alvarez's "Note from
  TAO" and Open report -> ?period=2026-07, managers get nothing; 11e profile name and time zone, locked required kinds,
  422 required. Two full runs from `down -v`: 31/31 and 31/31 (one is a `test.fail` known-bug check), 40 min 37 s
  and 40 min 41 s. Bug filed in
  requests.md › QA & Demo: an analyst's @ list is empty (GET /users omits status for analysts; the composer filters on
  it); 11c starts that thread through the API until fixed. Lead's covenant-table fix verified by the 1440 regression test.
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
- 2026-11-05 — UI-Review (phase 2 wave C, item 8, D7 b and c): comment threads, publish note and recipients, comment
  audit labels. Built against lead/wave-c (abdda6d, 5575406). Review page: every finding card has a "Comment" control
  with its comment count ("2", or "1 · resolved"); every key/value row in Extracted values, and every table row
  (roll-forward, aging, losses, ratios, covenants), has one too, anchored to the value or row pointer (a row counts the
  threads on its cells). The top bar has "Comments (N)", a panel listing every thread on the upload with All / Open /
  Resolved filters and Open per thread. The thread panel (one dialog) shows the threads on that finding or value, open
  first, oldest comment first, resolved ones folded with who and when; "from version n" on threads carried from an
  earlier publication version (C9), "from the replaced report" on a re-issue's inherited threads. Composer: @ lists
  active TAO users from `GET /users?partner_slug=tao&status=active` (name, email, role; not yourself), filtered as you
  type, arrows / Enter / Tab / Escape; picking inserts "@Name" and the id goes in `mentions` only while the name stays in
  the text. Enter sends, Shift+Enter is a new line. Authors edit their own comments (shown "edited"). Resolve / Reopen
  for any TAO Admin or the thread's starter (C10); others see who can; the panel says resolving does not resolve the
  finding. Both TAO roles comment. `?thread=<id>` opens that thread (notification links). Without a user (`GET /me`
  user null, or 401 user_required) the panel shows "Sign in as a user to comment." instead of the box and buttons.
  Publish dialog keeps its content and adds "Note to partners (optional)" (2,000 max, counter; trimmed, empty sent as
  null in the approve body) and "Who gets notified" from `GET /uploads/{id}/recipients`: a Partner / User / Channel table
  (email shown "coming later"), "Not notified (n)" with each reason, "Partner notifications are off, so no partner is
  notified." when any reason is partner_notifications_off, and a line that the internal threads are not sent. A failed
  recipients call says so and does not block publishing. The correction dialog's note now reads "Sent to partners with
  the correction". Activity: Comment added, Comment edited (before → after), Thread resolved, Thread reopened, with the
  anchor, text and mention count; publish entries show the note and recipient count.
  Files: `web/src/review/components/Comments.tsx`, `lib/comments.ts`, `__tests__/Comments.test.tsx` (new); ReviewPage,
  ExtractedValues, Dialogs, Corrections, Activity, lib/api, lib/types, review.css. Tests: `npx vitest run src/review`
  (count in the commit); `npx tsc --noEmit` and `python scripts/check_contracts.py` green. Not checked against the real
  API (wave C API not merged). Assumes the shell sends X-User (Design System). Needs: see UI-Review in requests.md
  (TAO Analyst cannot read `/users`, so analysts' @mention list falls back to people already on the upload's threads).
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

## UI-Admin, wave C (2026-11-05)
- Built: User management (/admin/settings/users, TAO Admin only). Users table (name and email, role, partner, status,
  last active, reports received from receives_summary) with partner (TAO / Investor / Manager), status and search
  filters; Add user and Invite by email (email + role; name = the address's local part, since AppUserCreate needs one).
  Right-hand drawer (?user=<id> or ?user=new): details and role (PATCH with changed fields only), Deactivate / Reactivate
  with a reason of 3+ characters (no delete), "Reports this user receives" Program -> deal tree of the 12 deals from
  /master/deals ("All deals ... including new ones" = deal_slug null; per-deal ticks; in-app only, email "coming later";
  partner users see only programs shared with their partner), and History from /audit?scope=platform&q=<email>.
  Self and last-admin are guarded in the UI (needs /me to name the caller; demo mode has no user, so only the API guards
  self_change there). Every wave C error code has a plain message in admin/ui.tsx errorText.
- Built: Roles & permissions (/admin/settings/users/roles): read-only six-role matrix, dot plus Yes / No / Limited, New tags.
- Built: System settings (/admin/settings/system, TAO Admin only). Editable: partner_notifications_enabled (off by default,
  warning), reporting_calendar (pre-filled with the August 2026 settlement days per deal; a test checks them against
  docs/dashboard-json; suggestions are saved only when edited or confirmed), notification_defaults (in-app per role and
  kind; required kinds show Always), publish_note_templates (D10 wording suggested when empty). One reason per save,
  one PUT /settings/{key} per changed key; a partial failure names what saved. Read-only: programs and deals with locked
  template_id, rules.yaml catalogue (line-scanned; request a change from the Lead), retention "Kept indefinitely" with
  this month's CSV export, branding and integrations placeholders, maintenance (Regenerate link; reset demo a script).
- Audit log: labels for user_change, prefs_change, settings_change (Platform) and comment, comment_edit, thread_resolve,
  thread_reopen (Reports); before -> after for user and settings changes with role, program, deal and setting names.
  .adm-scroll now resets --ds-sticky-top so sticky table headers no longer sit 64 px down inside a scroll box.
- pages.ts: built + load for the three routes (Lead-authorised lines only).
- Tests: `npx vitest run src/admin` (new: UserManagementPage, SystemSettingsPage incl. Roles, AuditWaveC). Built
  against the contract with fakes; not yet run against the real wave C API.
- Needs: Data & API to return receives_summary and to include the user's email or name in user_change detail (the
  drawer's History searches by email). Design System: the shell sending X-User so /me names the caller.
- 2026-11-05 — Design System (phase 2 wave C): sign in as a user, notification bell, Notifications, Profile, help.
  Built: the sidebar card is "Sign in as (POC)", listing the seeded users (web/src/shell/users.ts, a copy of
  seed/users.json kept equal by a test; the web container does not mount seed/) grouped by role, with a line saying it
  stands in for real sign-in. `data-testid="role-switcher"` kept; the first user of each role has the role id in its
  menu item's accessible name, so tests/e2e/lib/ui.ts still matches one item per role (a second user of the role does
  not match). Choosing a user stores its id (`tao-admin-poc.user`) and role; api(), apiBlob() and roleHeaders() send
  X-User with X-Role / X-Partner. GET /me resolves the user; any failure (older API, unknown_user, inactive_user, a reply
  without a user) falls back to role-only mode and X-User stops being sent. No stored user = role-only, exactly as phase 1.
  loadRole / saveRole unchanged; saveRole of another role clears the user. Pages read the person with
  `useSession()` from '@/shell/session' (mode, userId, me). Notifications nav item: unread badge from
  /notifications/unread-count on navigation and every 60 s, only for a signed-in user. Pages /admin/notifications,
  /notifications, /admin/settings/profile, /settings/profile registered (web/src/shell/account/). Help: sections for
  sign-in, notifications, comments, profile, user management, team members, system settings, and the publish note and
  recipients.
  Run: `npx vitest run src/shell src/design` (226 tests); full web suite 527 passed, 17 skipped; tsc clean;
  check_contracts green.
  Stubbed / notes: partner Notifications tabs are All / Reports / System (no Mentions: comments never reach partners).
  Display preferences apply to the Notifications and Profile pages only; other pages keep their own formats. The help
  text for User management, Team members, System settings and the review page comments follows the designs (D7, D8, D10);
  UI-Admin, UI-Review and UI-Partner should check the button labels once built.
  Needs from others: the Notification `link` example in the contract (`/admin/review/<id>`, `/investor/programs/<p>/deals/<d>`)
  does not match the app routes (`/admin/uploads/queue/<id>`, `/investor/portfolio/<p>/deals/<d>`); the page navigates
  to `link` as given, so the API should emit app routes (Data & API, Lead). UI-Admin / UI-Partner register User management
  (/admin/settings/users), Team members (/settings/team) and System settings (/admin/settings/system) in pages.ts with
  `load` and `built: true` (tell me, I own the file). review/lib/api.ts approve spreads roleHeaders(), which now carries
  X-User, so it needs no change.
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
- 2026-11-05 — Data & API (phase 2 wave C): people, notifications, comments, settings (contract abdda6d + 5575406).
  Auth seam (R1): `caller()` resolves `X-User` (an active app_user) to the same Caller (role, partner) plus user_id and
  label (the name); X-Role / X-Partner are then ignored. Unknown id 401 `unknown_user`, deactivated 401 `inactive_user`.
  Without X-User the demo headers behave exactly as before (no X-Role: 422 `invalid`); every gate, partner_filter and
  the original test_roles.py lines are unchanged. Audit rows carry `actor_user_id` and the name as actor_label;
  uploaded_by / published_by keep the role string, setrep_upload gains `uploaded_by_user_id`. last_active_at is written
  at most every 5 minutes. `/audit?actor_user_id=` (own entries readable by every role; others need the scope rule).
  Migration 010: app_user, subscription, user_pref, notification_pref, system_setting, review_action.actor_user_id,
  setrep_upload.uploaded_by_user_id, publication(_version).note_to_partners. Migration 011: notification,
  notification_event, thread, comment. Both idempotent; checked on PostgreSQL 16 (pg8000) from an existing 009 database
  with data, then each file run again. The seed loads seed/users.json (adds a user only if id and email are new; never
  changes one).
  Users: `/users` (tao_admin all; Company Admins only their partner's, another partner's user is 404; others 403
  `company_admin_only`), create / patch / deactivate / reactivate / subscriptions with self_change, last_admin,
  other_partner, email_taken (case-insensitive), role_partner_mismatch, unknown_partner, already_active /
  already_deactivated, not_visible, email_later. PATCH with a new role and no partner_slug takes the role's partner
  (TAO: none). `/me` (demo: user null, defaults), PATCH /me, `/me/notification-prefs` (required: covenant_changed,
  correction_published; partner roles receive report_published, correction_published, user_change), `/settings`
  (five keys, defaults until set; publish_note_templates merges a partial value). Audit: user_change, prefs_change,
  settings_change with before / after.
  Notifications: approve takes `{note_to_partners}` (stored on the publication and its archived versions, shown in
  `versions[]`), publish and correction publish notify per `/uploads/{id}/recipients` (subscribed users at a partner the
  program is shared with, partner users only while partner_notifications_enabled, plus subscribed TAO users; reasons
  deactivated, not_visible, not_subscribed, partner_notifications_off, switched_off). correction_published carries
  `changes`. Reject and correction reject -> report_rejected; a queued correction -> report_needs_review; both to
  subscribed TAO users. The worker moves uploads to needs_review / extraction_failed outside the API, so a sweep on
  every notification read sends those once (report_needs_review plus covenant_changed per R19 note; system for a failed
  extraction) to the TAO subscribers of that moment, keyed in notification_event; it also purges rows older than 12
  months. Partner reads go through partner_filter again: partner kinds only, deals of programs visible now (R7).
  Comments: TAO only (partners 403), writes need X-User (401 user_required), reads do not. Mentions only active TAO
  users (422 bad_mention), each notified once; replies notify the thread's other people; edits author-only (403
  not_author), new mentions only, old text in comment_edit; resolve / reopen by any TAO Admin or the starter (403
  forbidden otherwise, 409 bad_state). Threads carry `version`; a correction keeps them, a re-issue lists the replaced
  uploads' threads. Links (Lead's table): review queue `/admin/uploads/queue/<id>` (`?thread=<id>` for mention and
  reply), published and correction `/admin|/<partner>/portfolio/<program>/deals/<deal>?period=`, covenant_changed
  `/admin/partners/<first partner>/programs/<program>`, user_change and system `/admin/settings/users` (partner:
  `/settings/profile`). Follow-ups: a tao_analyst may GET exactly `/users?partner_slug=tao&status=active` (id, name,
  email, role: the @mention list), anything else 403; receives_summary reads "All MOVE Trust deals; Moneda Capital
  Corp. (F-PIL 2.0)" or "Nothing yet"; every user_change detail carries the user's email and name.
  Tests: test_auth_seam, test_users, test_notifications, test_threads, test_migrate (010/011 on PostgreSQL), test_roles
  wave C lines; parity 49 / 61. Full api suite on SQLite (count in the final commit); wave C files plus audit, seed,
  corrections, re-issue also on PostgreSQL 16 via pg8000. check_contracts green.
  Needs from the Lead: contract text still says receives_summary "None" when empty (now "Nothing yet") and the
  Notification.link examples are the old paths; the kinds a partner role can receive are not listed; the sweep timing
  (needs_review and extraction-failed notifications appear when someone next opens notifications or the badge polls)
  is worth a line under Notification. A system notification about an upload (extraction failed) links to its review page; /admin/settings/users is for user_change (and system without an upload).

## Lead — company profile chart size and full screen (2026-11-09)

Charts that have a section to themselves (rolling loss ratios, the featured covenant, pool balance) are now drawn at
1000 × 260 at most instead of stretching to the page width. Legends are 13.5 px with longer, thicker keys. Every company
chart has a Full screen button that opens the same chart, redrawn at 1100 × 440, in a dialog (Escape closes it, focus
returns to the button). Files: `web/src/portfolio/companies/charts.tsx`, `companies.css`, one new test in
`web/src/portfolio/__tests__/profile.test.tsx`.

## Lead — company profile charts in one three-column grid (2026-11-09)

Every company chart is drawn at the same size in three columns: the performance charts on the first row, then rolling
loss ratios, the featured covenant and the pool balance chart, each its own card, on the second. The pool balance table
moved to its own card below ("Pool balance by period"). The top row's gap is widened by the cards' padding so the two
rows share columns. Full screen now fills the window and redraws the chart at the measured size, with every month
labelled. Two columns below 1200 px, one below 760 px.

## Lead — production hosting (2026-11-09)

`docker-compose.prod.yml` runs the same six services from images built at the repo root (`deploy/*.Dockerfile`):
the web app built once and served by nginx, which also passes `/api/` to the API (one origin, no CORS change); the
API without reload; no source mounts; database password from `.env`; only the web port published; health checks,
restart policy, log rotation, Redis saved to disk. No application code changed. Scripts: `scripts/prod-backup.sh`,
`scripts/prod-restore.sh`, `scripts/export-dev-data.sh` (laptop to server). Guide for IT: `docs/hosting.md`.
Tested: full e2e demo 38/38 against the production stack (`scripts/compose.prod-test.yml` for the news fixture);
backup then restore brings back deleted rows and all files; a dev-stack export restored into it matches row for row
and serves its PDFs and page images through nginx; the images hold no `.env`.

## Data & API — wave E news screening version 2 (2026-11-10)

Built to contract 72ff34e and migration 013. Models for the new news_item columns (source_date, date_status,
resolved_url, sources, language, check_*), news_run.stats, company.news_* and the `news_source` table. Provider
definitions, the credential store and the update/test checks live in `api/app/news_sources.py`.
- `GET /news/sources`, `PUT /news/sources/{provider}`, `POST /news/sources/{provider}/test` (tao_admin; 404 unknown
  provider). Credentials: `secrets_enc = Fernet(NEWS_SECRET_KEY).encrypt(json.dumps({secret field: value}).encode()).decode()`;
  `secrets_last4[field]` = last 4 when the value is 12+ characters, else null; a field is set when it is a key of
  secrets_last4. PUT merges secrets (string replaces, null removes, unsent kept) and config (only the keys sent change; null returns a field to its default).
  409 `not_available`, `no_secret_key` (key unset or not a valid Fernet key), `missing_credentials` (also when a PUT
  would leave an enabled source without a required secret); 422 `invalid`. The PUT body is parsed by hand so a 422 can
  never echo a credential. `news_source_change` audit (Platform): provider, label, enabled before/after,
  config_changed, secrets_set, secrets_removed (names only); no entry when nothing changed.
- Test: LPUSH of the string `{"type":"test","provider":"<p>"}` on NEWS_QUEUE (default `news`); 202 with the NewsSource.
  Queue down: last_test is set to ok false, "News worker queue unavailable; try again shortly".
- `POST /news/recheck` (tao_admin): news_run trigger `recheck`, its id LPUSHed like Run now, `news_run` audit,
  409 `run_active`; allowed with feeds off. NewsRun now returns `stats`.
- NewsItem: source_date, date_status, sources (falls back to [source] for old rows), language, url = resolved_url
  when set, `check` for TAO only. Partners see kept only; TAO kept + unchecked, `include=excluded|pending|all`.
  Sort and `days` use coalesce(published_at, source_date, found_at). news_7d: kept, confirmed, published in 7 days.
  Adverse lists and the to_review count hide items whose story is excluded or pending.
- Alerts: negative_news and the TAO adverse_media alert (item opened) only when the story is kept with a confirmed
  published_at in the last 7 days; the partner alert when TAO marks an item reviewed needs only a kept story (Lead's
  decision: no date rule). An adverse item with no story never alerts. A story that becomes eligible later
  (re-check) alerts then, once.
- Company: `news_search` in GET for TAO, PATCH validates (terms trimmed, 2+ characters, deduplicated ignoring case,
  at most 30; languages non-empty subset of en/fr) and records it in the company_change `record` entry.
- `company_feeds.daily_cap` (1–5000, default 200).
Run: `cd api && python -m pytest -q` (new: `tests/test_news_wave_e.py`, 23 tests). `cryptography==44.0.3` added.
For News: the env var is `NEWS_SECRET_KEY` (the API already gets `.env`); the worker writes last_test_at/ok/message
on the row; adverse items and alerts depend on check_status and date_status being written as above.
For UI: GET /news/sources returns `secret_key_set`; poll it after a test until last_test.at changes.
## News — wave E, news screening version 2 (2026-11-10)

Built in `news/` on `agent/news` against the wave E contract (72ff34e): per company, queries in English and French
(name, aliases, name plus adverse terms), pooling by canonical URL, pre-filters (on file, exclusions, name match),
Google link decoding, the article page read once for its date and text, `date_status`, context terms, the mandatory
Claude check (`claude-haiku-5-5` by default, structured output, pending on failure and retried at the start of the next
run), adverse items for kept stories only, search windows (3 months, 12 with a paid archive, then 7 days), a daily cap
per source, `news_run.stats`, recheck runs, and Test connection messages. Paid sources: Event Registry, NewsCatcher,
Brave news and web; Dow Jones and LexisNexis are slots that say "Needs the client's API documentation". Credentials are
decrypted per run with `NEWS_SECRET_KEY` and scrubbed from every message. New dependencies: `anthropic==1.17.0`,
`cryptography==44.0.3` (rebuild the news image).

Run: `cd news && pip install -r requirements-dev.txt && python -m pytest -q` (156 tests, no network). The four Dynamic
Capital stories are regression tests: the 2009 page is dropped by its page date before any check; the three
ordinary-phrase stories are excluded by the (mocked) check. `python check_eval.py` runs a labelled set against the live
model on demand (needs a key; not run yet).

Verified only against recorded data: the paid adapters (responses shaped from the providers' published docs in
`news/fixtures/providers/`; no client key yet), Google's new-style link decoding (unofficial call, mocked), and the
Claude check (recorded answers). Stubbed: Dow Jones and LexisNexis. Needs: QA to move step 12 to 11 news items (the
fixture now has an excluded story and a kept story with an unconfirmed date); the API to send test messages and
recheck runs as in `docs/requests.md` (News, 2026-11-10).
## UI-Admin, wave E (2026-11-10)

System settings (TAO Admin only), against the wave E contract (72ff34e):

- **6 · News sources** (new section; Data retention to Maintenance move to 7–10). One row per provider from
  `GET /news/sources`: label and note, status as dot plus word (Not available yet, then Key not set, then On or Off),
  each key as "Set, ends in ••••last4" or "Not set", and the last test (OK or Failed, time, provider message). A banner
  says when `secret_key_set` is false. **Edit** dialog: the provider's fields in order; secret fields are password boxes
  that always start empty, with Remove (and Keep to undo); other fields by kind (text, url, integer, boolean switch); the
  on/off switch, disabled with the reason when `available` is false; a summary of the change that never shows a key;
  a reason of at least 3 characters. Save sends `PUT /news/sources/{provider}` with only what changed (`enabled`,
  changed `config` keys, `secrets` as string or null). **Test connection** posts `.../test`, then polls
  `GET /news/sources` every 2 s until that provider's `last_test.at` changes, for at most 40 s. The 409s
  `no_secret_key`, `not_available`, `missing_credentials` read in plain words.
- **Re-check stories** next to Run now in section 5, with the E9 explanation; a confirm dialog, then
  `POST /news/recheck`; `run_active` reads "A news run is already in progress."; a queued re-check is watched like Run now.
- **Daily request cap per source** in the company_feeds editor (1–5000, default 200), saved with the feed settings.
- **News runs**: Re-check runs are named; a new "Checks and calls" column opens each run's `stats` (calls per source,
  sources that hit the cap, candidates, kept, excluded, pending, dates confirmed, Claude tokens); runs from before
  wave E show a dash. Section 5's text now says paid sources and the Claude check are involved.

Files: `web/src/admin/newsSources.ts`, `web/src/admin/NewsSourcesSection.tsx`, `SystemSettingsPage.tsx`,
`settings.ts`, `admin.css`; tests in `web/src/admin/__tests__/NewsSourcesSettings.test.tsx` (16 new).
Run: `npx vitest run src/admin` in `web/`. Assumption to confirm with Data & API: a PUT with a partial `config`
merges into the stored config (the contract says "only what is sent changes").
## UI-Partner — wave E news screening on the company pages (2026-11-10)

Built against the wave E contract (72ff34e). Latest news: each story shows its confirmed date, or "Date not confirmed"
with the source's date in muted text ("source says 6 Nov 2026"); "Found by" lists every source by name (Google News,
GDELT, Event Registry, NewsCatcher, Brave, Brave web, Dow Jones, LexisNexis); French stories carry an FR marker. The
API order is kept. The subtitle says counts and alerts use only checked stories with a confirmed date, and "new this
week" counts only those. TAO only (gone under "View as partner" and for partner roles): a "Show excluded" toggle that
refetches with `include=all`, excluded stories muted with "Excluded by the news check" and the reason, "Awaiting check"
for pending, "Not checked yet" for stories from before wave E, and "Kept by the news check" with the reason on hover and
in an expandable "Why". Partner view filters to kept stories and never sends `include`. Edit record (TAO Admin) has a
News search group: context words (commas), exclusion phrases (one per line), English / French (at least one); each term
at least 2 characters, duplicates dropped; `news_search` goes in the PATCH, whole, only when it changed. The record
panel shows the settings read-only for TAO. The `news_7d` column headers (Companies list, Portfolio summary section)
and cells carry "Checked stories with a confirmed date in the last 7 days". Fixtures: Essex news on file is six test
stories covering every check status and date status; news search settings are test records. Run: `npx vitest run
src/portfolio` in `web/`. Nothing stubbed; no requests.
## QA & Demo — wave E, news screening version 2 (2026-11-10)

On `agent/qa`, reset onto `integration/wave-e` (b166e53). Step 12 follows the new fixture: `STEP12.fixture.items` 11,
the run message built from the facts ("11 news items and 7 adverse items added"), `docs/demo.md` 12c and 12g updated.
New `tests/e2e/specs/13-news-screening.spec.ts` (6 tests, facts in `STEP13`) and demo.md Journey 8, step 13: News
sources (five rows, Dow Jones and LexisNexis not available, a fake Brave key shown only as "ends in" plus the last four
and absent from the page, every API response the page got and `GET /news/sources`; Test connection result; key
removed; switch-on without a key refused with the plain-words `missing_credentials`; news_source_change audit without
the key); Latest news ("Date not confirmed", "Found by", Show excluded with the reason, View as partner); partners
(investor and manager, every company, `include=excluded|all|pending`: no excluded story, no check block, no reason);
the Dynamic Capital news search words on the record; Re-check stories; the run's "Checks and calls".
Run: as in `docs/demo.md` (needs `scripts/compose.news-fixture.yml` and `NEWS_SECRET_KEY` in `.env`). Two full runs
from a fresh database: 44 of 44 both times (tests 18 min 36 s and 14 min 24 s). Screenshots for steps 12 and 13
re-taken; the rest kept. Filed in `docs/requests.md` (QA & Demo, 2026-11-10): the Audit log shows news_source_change
raw (no label, no subject, the detail hides what changed); a note that `stats.date_confirmed` counts excluded stories.

## Lead — review page fixes from the Dynamic Capital Jul-2026 upload (2026-11-10)

1. Extracted values: labels ran under the numbers ("Principal" behind $4,702,550.23). Each cell was 282 px and the
   hidden Comment button keeps its 66 px, leaving the label about 40 px. Cells are now at least 340 px and a label wraps
   at word breaks instead of running under the value (`web/src/review/review.css`).
2. Page links on a table row (ratio history, roll-forward, vintages) opened the right page with no outline at all; the
   yellow block seen on Dynamic Capital page 16 is shading printed in the company's own PDF. A row link now outlines the
   whole row: the union of its fields' boxes on that page, padded 2 pt (`rowBox` in `web/src/review/lib/provenance.ts`).
   A single value still gets its own box. Test in `lib.test.ts`.
## Lead — company chart hover readout (2026-11-10)

Every company chart (performance, loss ratios, featured covenant, pool balance; on the page and full screen) shows a
readout on hover: a guide line at the nearest month, a highlighted point on each line, and a box with the month and
every line's value plus the limit. Pool balance shows the closing balance or "Not loaded". With the chart focused
(Tab), Left/Right/Home/End move along the months and Escape clears. The readout is aria-hidden; screen readers keep
the hidden data table. Native SVG tooltips removed. Two new tests in `profile.test.tsx`.

## Lead — Run now for one company (2026-11-10)

Company profile, Latest news: a "Run now" button for TAO Admin (not the analyst, not "View as partner", not partners).
It queues a manual news run for that company alone (`POST /news/runs?company_slug=<slug>`, `news_run.company_slug`,
migration 014) and works while the daily search is off; an every-company Run now still needs it on. The page shows
"Searching…", then what the run found ("2 stories added, 3 excluded by the news check" or "no new stories"), and
reloads the news, adverse items and counts without clearing the screen. `run_active` reads "A news run is already in
progress." System settings lists such a run as "Manual · <company> only"; the audit entry links to the company.
Tests: API (403/404/409, feeds off, audit), news worker (only that company is searched), three UI tests.

## Lead — audit fixes: hosting, scripts, guide (2026-11-10)

Audit report: `docs/audit/tao-admin-poc-bug-audit_Report_v1.md`. Fixed here: H11, H12, M13, M14, M15, L13, L14, L15
(queues), L16, L17.
- `scripts/prod-restore.sh`: both files are checked first (dump listed, archive `gzip -t` and listed, right
  extensions); the dump loads into a scratch database and the files into a scratch folder; the swap happens only when
  both have loaded; a failure before the swap removes the scratch copies and starts the app again on the old data; the
  job queues are cleared after the swap; waits are bounded; commands that take no file read `/dev/null`, so the
  RESTORE prompt gets its answer.
- `scripts/prod-backup.sh`: temporary names renamed on success, seconds in the name, pruning after `KEEP_DAYS` (14).
- `scripts/export-dev-data.sh`: `MSYS_NO_PATHCONV=1` (Git Bash rewrote `/data`), temporary names, a note on
  `NEWS_SECRET_KEY`.
- `docker-compose.prod.yml`: `env_file` only on api, worker and news. `deploy/nginx.conf`: all three security headers
  in every location.
- `docs/hosting.md`, `.env.production.example`: outbound list (publisher sites, paid sources), `NEWS_SECRET_KEY` and
  `NEWS_MODEL`, copy the laptop's key when moving data, keep a copy of `.env`, cron line creates `backups/`, Azure
  marked as reserved, how a restore protects existing data.
Tested on a throwaway production stack: swapped arguments, a truncated dump, a truncated archive and an unconfirmed
prompt are refused with nothing changed; a dump that fails while loading leaves the data intact and the app running;
a real restore works; a laptop export made in Git Bash restores to the same 23 uploads and 70 files.
## Data & API — bug audit fixes (2026-11-10)

Fixes for the API items of `docs/audit/tao-admin-poc-bug-audit_Report_v1.md`, on `agent/api`. Tests: `api/tests/test_audit_fixes.py`
(one section per audit id). Run: `cd api && python -m pytest -q -p no:cacheprovider` (508 passed, 9 skipped on SQLite).

- H1: findings are matched across re-runs by `review.finding_key` (rule, fields and the context that names the row: month,
  field, vintage, legal_ref, side, tranche, metric, currency, limit name). Used by the re-run, approve and corrections.
- H2: approve always re-runs the rules; every publish (approve, re-issue, correction) re-runs later months in review and
  lists them in the publish entry (`rerun_upload_ids`). A re-issue therefore always shows its R12 block at approve; the
  reviewer acknowledges it first, as the rule intends.
- H3: every review action locks the upload row (`lock_upload`), confirms the status it read (`_still`) and changes status
  with a conditional update (`_transition`, `_correction_transition`). The loser gets 409 `bad_state`.
- M2: re-extract commits before it queues; 409 `upload_in_progress` when a newer upload holds the period; 503
  `queue_unavailable` (upload put back) when the queue is down.
- M1 seed insert-only for partners, programs, deals. M19 account links. M23 CSV cells. L18 anchors `loss-ratios`, `record`.
- L1 NUL bytes (path 404, query and JSON 422). L2 `version` <= 2147483647, `offset` <= 1,000,000. L3 months 2000-2100.
  L4 no NaN / Infinity. L5 `applied` is the Toronto date.

Not verified: the row locks on PostgreSQL (the suite ran on SQLite, where the conditional updates carry the tests).
Needs from others: Lead, contract text for 503 on reextract, `upload_in_progress` on reextract, the integer and month
bounds, and `rerun_upload_ids` on the publish entry (all optional documentation; no route shape changed).
## News — bug audit fixes (2026-11-10)

On `agent/news`, from `docs/audit/tao-admin-poc-bug-audit_Report_v1.md`. Run: `cd news && python -m pytest -q` (259
tests; 102 new). Detail in `news/README.md`.

- H9. A story is on file under every URL it is known by. `news_item.url` now holds the link the source gave and
  `resolved_url` the publisher URL (the API already serves `resolved_url or url`); both are compared without scheme
  and "www.". On file is asked before fetching, after a Google link resolves, and after the page read; a unique
  violation is on file, not an error. A story on file is not resolved, read or checked again.
- H10. The page text replaces the provider's text only when it is longer and the page names the company.
- M9. One guard for every confirmed date: 1990 or later, not past tomorrow.
- M10. Article pages and Google link resolution fetch public http(s) hosts only, on every redirect hop; the address
  really connected to is checked. A refused URL is an unreadable page.
- M11. A fetch has a 10-second total deadline.
- M12. A `<form>` wrapper no longer drops the article; `<header>` and `<footer>` are skipped only outside `<article>`.
- L8. The first-search window is per company and source, recorded in `news_run.stats.first_search`.
- L9. A check refused or cut off three times excludes the story; an outage or a missing key never counts.
- L10. Atomic schedule insert; a `running` run is failed only when its heartbeat (`news_run.heartbeat_at`, migration
  015, stamped on claim, after every company and before each page read and Claude check) is over 10 minutes old.
- L11. Names, aliases, context words and exclusions: whole phrases, accents folded.
- L12 and the prompt: verdict fields are not coerced; story and company text cannot write prompt tags.

Stubbed or not proven here: the PostgreSQL path of the schedule insert (`pg_advisory_xact_lock`, then check, then
insert) is exercised only on SQLite's single-statement path in the tests; it needs one run under `docker compose`.
Nothing called a paid API or the Anthropic API.

For the Lead: (1) `stats.first_search` is a new key inside `news_run.stats`; the contract lists the stats properties
without closing the object, so nothing breaks, but it is not documented in `contracts/openapi.yaml`. (2) Done by
the Lead's migration 015 (`news_run.heartbeat_at`): after a worker crash, Run now is free again within 10 minutes.
(3) A story has one `url`; remembering every source link would need a column
(`news_item.source_urls jsonb`). (4) Existing rows keep the old shape (`url` = final URL); no migration is needed.
## UI-Admin / UI-Review — bug audit fixes on the TAO screens (2026-11-10)

On `agent/ui-admin`, from the fixes base 1e3b4a5. Findings from `docs/audit/tao-admin-poc-bug-audit_Report_v1.md`.

- M20 Extracted values (`web/src/review/components/ExtractedValues.tsx`): the loss and ratio tables use one column
  catalogue for every layout and show a column when a row of the extraction holds a value for it. MOVE Trust reports
  now show their own columns (semi-annual or annual period, tranches, period original balance, period CNL, reported
  ratio, default trigger, spread, loss ratio, RVL ratio); F-PIL keeps its vintage table and gains the monthly
  delinquency ratio it also prints. Leverage and interest coverage read "8.91x". The roll-forward and aging tables list
  the MOVE-only terms (new funded, ineligible buyback, upward adjustment, balance adjustment, payment deferral) when
  present. Edit, page links and comments work on the new columns. Edit and correction lists name a MOVE loss row by its
  period (`lib/corrections.ts: pointerLabel`). Test: `review/__tests__/ExtractedValues.test.tsx` (Finloc and Moneda in
  detail, then all 12 objects in `docs/dashboard-json`: one column per key that holds a value, no column all dashes).
- M21 User drawer: compares against the list the last PUT returned. Test in `UserManagementPage.test.tsx`.
- M22 Review page: a `?thread=` link opens its thread once and is then removed from the address. Test in `Comments.test.tsx`.
- L23 Reporting calendar: rows stay in the order the page opened with while a day is typed; the typed text stays with
  its "1 to 31" error. L24: System settings scrolls to `#set-...` once loaded and when the hash changes. L25: covenant
  In force / Scheduled, "Export this month" and the "Published this month" tile read the date in America/Toronto
  (`web/src/admin/toronto.ts`: `torontoMonth`, `torontoDate`). Audit log: a one-company news run reads
  "Manual run by A. Patel · Stride Capital only". Tests: `admin/__tests__/AuditFixes.test.tsx`.

Run: `cd web && npx vitest run src/admin src/review`. Nothing stubbed. Nothing needed from the API or the contracts.
Left as is: timestamps on the review pages and in admin tables show in the viewer's own zone (display only, no month or
day decision hangs on them); the roll-forward table still does not list `interest` and `recoveries` per month (the
current month's are under Balances).
## UI-Partner / Design System — bug audit fixes on the portal, shell and design system (2026-11-10)

Findings from `docs/audit/tao-admin-poc-bug-audit_Report_v1.md`, branch `agent/ui-partner`.

- **H8** wide tables: `DataTable` measures its wrapper; a table wider than it gets `.ds-table-wrap--x` (sideways scroll
  inside the card, header sticks to the wrapper) and becomes a focusable region named by the caption. A table that
  fits is untouched, so its header still sticks under the top bar. Trade-off: a table that scrolls sideways no longer
  has the page-level sticky header (CSS cannot do both without a second scroll container). Checked in a real browser
  on a static page with the real CSS. Every `.ds-table-wrap` in `web/src` is rendered by `DataTable`, so admin and
  review tables get the same behaviour; none needs a change.
- **M16** company profile opens on the first deal with a published report (`?deal=` still wins).
- **M17** the page content remounts when the identity changes (`identityKey`: role, user id, whether calls carry
  X-User), so every page reads its data again for the new person. Also: the previous person's role is no longer written
  back over the new one right after a switch, and a late unread count for the previous person is dropped.
- **M18** the charts' screen-reader tables sit in a visually hidden `div`; `.ds-visually-hidden` also clips with
  `clip-path` and has a safety net for a bare table.
- **L18** What to watch: old anchors map to the ids on the page (`signalAnchor`); a signal is a link only when its
  target is on the page, else plain text.
- **L19 / L22** Notifications: only the newest request may write its answer; "Show older" pages with `offset`.
- **L20** the chart hover box is placed against the chart's card and the window (`tipPlacement`).
- **L21** no negative zero: `formatCurrency`, `formatPercent`, `formatNumber` (so `fmtNum`) and the inbox `formatAmount`.
- **L26** a role or user switch in another browser tab is taken over (`storage` event), then the content remounts.
- **M19 (UI half)** `notificationTarget`: a link without a portal prefix gets the current portal's; a page the role
  cannot open, or one this portal does not have, goes to Profile.

Run: `cd web && npx tsc --noEmit -p . && npx vitest run src/portfolio src/shell src/design`. New tests:
`design/components/__tests__/tableScroll.test.tsx`, `portfolio/__tests__/audit.test.tsx`,
`shell/__tests__/identity.test.tsx`, `shell/account/__tests__/inbox.test.tsx`.
Stubbed: nothing. Needed from others: the API halves of L18 (anchors) and M19 (portal-prefixed links); the UI works
with the old and the new values.
## Rules + Extraction — bug-audit fixes H4, H5, H6, M4–M8, L6, L7, L27 (2026-11-10)

Branch `agent/rules` on 1e3b4a5. `worker/extract/` opened for these fixes with Matt's go-ahead. Audit ids are from
`docs/audit/tao-admin-poc-bug-audit_Report_v1.md`.

What changed, by finding:

- **H4** A page with no text layer no longer passes clean. R01 treats an empty required table (`/covenants`,
  `/cnl_by_period`, `/aging_history`) as missing, requires an aging row for this collection period, and raises two
  more block findings from the extraction's own record: `meta.pages_without_text` (names the pages) and
  `meta.unplaced` (names the fields). R07 and R08 read the aging row of this period by its period, never index 0, so a
  chained history cannot put last month's row under the check. R05 blocks when `period_history` holds only earlier
  months. Moneda Aug-2026 with page 14 blank: three block findings instead of none.
- **H5** Pass 2 parses the whole document and builds the deal object in full, then keeps only the leaves whose inputs
  are all on the pages asked for (`Recorder.inputs`). `merge_patch` matches list rows by natural key
  (`meta.row_keys`: month, period, vintage label, legal ref + description, ratio key, tranche, rank), appends a row the
  base lacks, and never lets a null replace a pass-1 value. The audit's six cases merge to the full extraction with
  zero differing leaves. Cost: a pass 2 now takes as long as a pass 1.
- **H6** `handle_extraction` copies the reviewer's status and resolution from the upload's previous extraction to the
  matching new finding (same identity, severity, targets, values and context). A finding whose values changed starts
  open. Identity (`adapter._key`) is rule id, fields and the context values that name the row (month, field, vintage,
  legal_ref, side, tranche, metric, history_month, currency, limit_name): the same list as the API's `finding_key`.
- **M4** A ceiling or floor covenant with no value (or no threshold) has `status: null`, provenance confidence 0.5 on
  that status, and is in none of the `covenant_summary` counts. R18 raises a review finding naming the covenant.
  `prior_covenants` rows keep "OK" where the prior month's CNL is not printed on the report (unchanged; chaining
  replaces the row).
- **M5** Every engine writes the report's printed contract change to `/contracts/change_reported` (as printed: F-PIL
  positive for a decrease, MOVE Trust negative; the multi-currency layout sums its pages). R06 closes the count with
  it. `change_abs` is unchanged and is the fallback for objects without the printed figure.
- **M6** `rules.run()` resolves each finding's `source_page` from this extraction: `sources` of its targets, then its
  fields, then `deal.source_pages`, then the `rules.yaml` hint. The API's re-run gets the same pages because it calls
  `run()`. Dynamic Capital Jul-2026 R07: page 15, and the pass-2 page set follows. The R07 and R08 sentences name the
  report's own page.
- **M7** One status function, `rules/covenant_status.py`, called by every engine (`worker/extract/status.py`) and by
  R18. Floor band: WATCH when value <= threshold / (1 - buffer). Chosen because the published Essex object has
  interest coverage 1.11 against a floor of 1.00 as WATCH, and the portal's own `displayStatus` uses the same
  utilization test. The symmetric band (threshold x 1.1) is gone from `derive.py`.
- **M8** `worker/main.py`: `serve()` wraps every loop pass; a Redis or database error is logged and retried after 5 s.
  A job whose upload cannot be marked extracting goes back on the queue (5 attempts). `recover()` runs at start and
  every 120 s: `validate.recover_stale` marks uploads left in `received` / `extracting` with no queued job and no
  activity for `WORKER_STALE_MINUTES` (default 15) as `extraction_failed` with a plain reason and an audit row.
- **L6** Model-fallback cells are checked before merging: asked-for fields only, no nulls, page inside the document
  and among the pages shown, finite numbers, cover dates that parse. A rejected answer leaves the field unplaced with a
  note in `meta.notes`.
- **L7** A pass-2 job with no `extraction-pass1.json` (or no pages) runs a full pass 1 and is handed off as pass 1.
- **L27** Not an extraction defect. The reports print vintages with a figure dash (U+2012); the extraction carries
  that character and the worker writes JSON with `\u` escapes. "â€’" is those UTF-8 bytes read as cp1252 by a reader
  on a Windows host. Regression test added; `scripts/check_contracts.py` and one rules test still open JSON without an
  encoding (the rules test is fixed).

How to run: `cd rules && python -m pytest -q`; `cd worker/validate && python -m pytest -q`;
`EXTRACT_SAMPLES_DIR=<checkout with data/samples> python -m pytest -q worker/extract/tests` (add `EXTRACT_ALL=1` for
the MOVE Trust cases).

Needs from the Lead:

1. `contracts/extraction.schema.json`: `covenants[].status` is `{"type": "string"}`. An extraction with an unreadable
   covenant value now carries `status: null` and does not validate. Proposed: `"status": {"type": ["string", "null"],
   "description": "OK | WATCH | BREACH | AVAILABLE; null when the value or threshold was not read"}` for `covenants`
   and `prior_covenants`. Also add `contracts.change_reported` (`{"type": ["number", "null"], "description": "the
   report's printed change on the Contract Totals row, as printed"}`); the object already allows extra keys.
2. `contracts/rules.yaml`: the unread-page and unplaced-field findings are folded into R01. Proposed entry (needs the
   `rule_id` pattern in `finding.schema.json` widened to R23):
   `- id: R23 / layer: structural / phase: 1 / severity: block / title: Every page and field was read / fields:
   [meta:/pages_without_text, meta:/unplaced] / fn: extraction_complete / on_failure: review / message: "{detail}"`.
   R06's description still says "opening_contracts − change = closing_contracts"; the check now reads
   `/contracts/change_reported`, worth adding to its `fields`.
3. UI: a covenant with `status: null` renders the pill text "null" (`CovenantPill`, `String(status)`); it should read
   "No value". New finding messages the review page will show: R01 "N page(s) of the report have no text layer and
   were not read: ...", R01 "N field(s) the extraction could not place on the report: ...", R18 "<ref>: no current
   value was read for this ceiling covenant ...", R06 "Opening contracts X and the printed change Y give Z ...".
4. API: nothing required. `handle_extraction` now returns a `carried` count beside `counts`.

## Data & API — Save (On hold) and per-person notify choices (2026-11-11)

Built to contract 1aaf359 and migration 016, on `agent/api`.

- **Hold.** `POST /uploads/{id}/hold` (tao_admin, `needs_review` only, row-locked like the other review actions) sets
  `held_at`, `held_by`, `held_by_label`, `hold_note` and the draft (`draft_note_to_partners`, `draft_notify`).
  `DELETE /uploads/{id}/hold` clears the four hold fields and keeps the draft. A hold is a marker, never a status.
  `Upload.hold` and `Upload.draft` are in every Upload the API returns (list, detail, every action that returns one).
- **Body rules on Save.** `note` is replaced on every save (not sent or blank = null). `note_to_partners` and `notify`
  keep their stored value when not sent and are cleared when sent as null. `notify` is validated as approve validates it.
- **Clearing.** `_transition` clears the hold on every move to a status other than `needs_review`, and the draft on
  `approved` and `rejected`, so no action can leave a hold behind. A re-extract whose queue push fails puts the hold back
  with the status. `Upload.hold` also reads null whenever the status is not `needs_review`.
- **Recipients.** `can_change` on both lists. One reason changed order: a person who switched report_published off now
  reads `switched_off` whether subscribed or not (before, an unsubscribed one read `not_subscribed`), so
  `not_subscribed` always means "would receive it if added".
- **Approve with `notify`.** Validated before anything is published (422 `invalid`, a message naming the person). The
  notifications go to (notified − remove) + add. The publish audit detail always carries `notified_added` and
  `notified_removed` ({id, name} lists, empty when there are none); `recipients` is who was notified.
  The stored draft is never applied by the API: the UI sends `notify` with approve.
- **Audit.** `hold` (reason = the note; detail {note, has_draft_note, notify_add, notify_remove}) and `hold_release`
  (detail {note}); both carry the upload id, so they are in the Reports scope and the upload's activity trail.

How to run: `cd api && python -m pytest -q -p no:cacheprovider tests/test_hold_notify.py` (25 tests); the whole suite
the same way without the file name.

Stubbed: nothing. Corrections take no notify choices (out of scope).

Needs from others: UI-Review reads `Upload.hold`, `Upload.draft` and `Recipients.can_change`; role-only mode shows
`by_label` "TAO Admin" with `by` null. A draft may name someone who can no longer be changed (deactivated since the
save): the API returns it as stored and approve refuses it with the person's name, so the UI should reconcile the draft
against `/recipients` when it opens the pop-up.
## UI-Review / UI-Admin: Save for later (On hold) and per-person notify choices (2026-11-11)

Built against contract commit 1aaf359 (`Upload.hold`, `Upload.draft`, `NotifyChoices`, `HoldRequest`,
`ApproveRequest.notify`, `Recipients.can_change`, POST and DELETE `/uploads/{id}/hold`, audit `hold`, `hold_release`).

- **Review page, action bar** (TAO Admin, needs_review): Re-extract pages…, **Save…**, Reject…, Publish to partner….
  Save… opens "Save for later": one optional "Why is it waiting?" note (max 1,000, pre-filled with the stored hold
  note), Cancel and "Save and close". The POST body is `{note}` only, so the stored draft is not touched. On success:
  toast "Saved. On hold in the Approval queue." and the Approval queue opens.
- **On hold marker**: an "On hold" pill beside the status pill and a line at the top of the page, "On hold since
  <date time> by <by_label>" plus the note in quotes, with **Release hold** (TAO Admin; DELETE, then the marker goes).
- **Publish pop-up**: one row per person, grouped TAO then each partner: switch, name, side tag, "Will be notified" /
  "Not notified", then the channel, the reason, or "Locked: <reason>" when `can_change` is false. A switched row reads
  "Added for this report" / "Left out for this report". Header "Who gets notified · N people" (live), and
  "N changes for this report only. Subscriptions are not changed." with Reset. The stored draft is applied on open;
  choices the recipients no longer allow are dropped. Approve sends `{note_to_partners, notify: {add, remove}}`
  (`notify` left out when nothing was switched). **Save for later** in the footer (needs_review only) posts
  `{note_to_partners, notify}` plus the existing hold note, then toast and queue. A 422 shows the API message.
- **Approval queue**: "On hold" pill beside the status, the note (clipped at 60, full text in the title) and
  "<by_label>, <date time>"; chips "All N" / "On hold N" above the table. Held reports stay in the default list.
- **Audit log**: `hold` "Saved for later (On hold)" and `hold_release` "Hold released" on the Reports tab and in the
  action filter. Hold summary: the note, "draft note kept", "N notification changes". Publish summary and expanded
  row: "Added by hand: …", "Left out: …". The review page's Activity card shows the same.

How to run: `cd web && npx tsc --noEmit -p . && npx vitest run src/review src/admin` (23 files, 351 tests).
New tests: `web/src/review/__tests__/Hold.test.tsx`, two in `QueuePage.test.tsx`, four in
`src/admin/__tests__/AuditWaveC.test.tsx`; the two publish-dialog tests in `Comments.test.tsx` follow the new markup.

Stubbed: nothing. The not-notified reasons keep the existing wording ("the program is not shared with their
partner", "turned off report notifications").

Needs from others: none beyond the contract. The UI relies on POST hold keeping `note_to_partners` and `notify`
when they are not sent (Save… sends only `note`).
