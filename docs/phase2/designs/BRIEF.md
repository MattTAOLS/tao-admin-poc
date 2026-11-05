# Phase 2 design brief (for the design agents)

The operator (Matt) wants HTML designs of every new or changed page before any code changes. These are static mockups he will
review and mark up. No application code changes in this phase.

## Locked decisions (2026-11-05)

1. **TAO Admin is the "manager".** No new TAO role. TAO Admin can edit extracted numbers and covenants; TAO Analyst stays read-only
   (uploads, comments). On the partner side the "manager" is the existing Company Admin role (investor_admin, manager_admin).
2. **Trend colour = good or bad for that metric**, not direction. The arrow shows direction; the colour shows whether the move is
   favourable (delinquency rising = red, coverage rising = green, flat = grey). Status is always dot/arrow plus a word.
3. **Editing extracted numbers:** free edits while a report is in review (audited, rules re-run on the edited value). After publish, an
   edit is a **correction**: it creates a new version, re-publishes the deal, and notifies the partners, like today's corrected re-issue.
4. **Extraction is not touched.** No change to how PDFs are read or how fast. Page images get sharper (see D1) by rendering, not by
   changing extraction.

## The operator's asks, by design file

| ID | File | What it shows |
| --- | --- | --- |
| D1 | review-edit.html | Review report page: TAO Admin edits an extracted value (before publish), the sharper page viewer, and the post-publish correction dialog |
| D2 | covenants.html | Program / facility record: TAO Admin edits covenant definitions, with version history |
| D3 | audit-log.html | Audit log split into Reports and Platform; current month shown, older months under History; search across every month |
| D4 | quick-fixes.html | Dashboard "Latest uploads" rows open the report; trend arrows coloured good/bad (before and after) |
| D5 | companies.html | Portfolio Executive Summary lists the lending companies; a Companies page |
| D6 | company-profile.html | Company profile: performance from monthly reports vs program averages, daily news, adverse media, industry |
| D7 | notifications.html | Notifications inbox, comments with @mentions on a report, publish note to partners, the partner's notification |
| D8 | user-management.html | TAO user management and partner Team members: add/edit/deactivate, role, which reports each user receives |
| D9 | profile.html | Profile page (all portals): recommendations |
| D10 | system-settings.html | TAO System settings: recommendations |

## How to build a design

- Copy `_template.html`. Keep the top strip (with your D-number) and the shell. Link `assets/mockup.css` only; no other CSS files,
  no JavaScript frameworks. Small inline `<script>` for tab switching or opening a dialog is fine; the page must read correctly with
  JavaScript off (show the dialog/state statically below, inside `.mk-stage`, labelled "State after clicking ...").
- Use the portal's classes from `assets/mockup.css` (ds-card, ds-table, ds-kpi, ds-pill, ds-finding, ds-field, ds-input, ds-btn,
  ds-dialog, ds-crumb, ds-pagehead) and tokens only (`var(--...)`), never raw colours. Charts are inline SVG using tokens.
- Mirror the current page where one exists: read the live page component first (paths in your brief) so labels, columns and layout
  match what users know today. Mark what is new with `<span class="mk-tag">New</span>` and what changes with
  `<span class="mk-tag mk-tag--changed">Changed</span>`.
- Numbered design notes (`.mk-note`) explain each new behaviour: who can do it, what is audited, what happens next. The operator will
  reply "change note 4", so number them.
- **Real numbers only** for deal data: take them from `docs/dashboard-json/*.dashboard.json` (deal names, balances, ratios, covenants,
  obligors). Anything that has no real source yet (news headlines, user names, comments, industry averages) is clearly sample content:
  label it "Sample" and keep it plausible and neutral. Never present invented figures as real. Use generic people names
  (e.g. "A. Patel", "J. Moreau"); no real emails beyond the `@example.com` domain.
- Plain, direct language in every label and note (no "leverage", "robust", "seamless", "unlock", "ecosystem").
- Desktop first (1280 px), but nothing may break at 900 px.
- Open your file in a browser (file path) and check it renders, with no console errors.

When done, list in your report: the file(s), the design notes in one line each, and any open questions for the operator.
