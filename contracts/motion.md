# Motion and interaction rules

Three named transitions, used everywhere, nothing else. Durations and easing come from `tokens.css`
(`--t-control`, `--t-panel`, `--t-page`, `--ease`); `prefers-reduced-motion: reduce` sets all three to 0 ms.

| Name | Duration | What it animates | Where |
| --- | --- | --- | --- |
| control | 120 ms | background, border-color, color, box-shadow, transform (≤ 2 px) | buttons, nav items, chips, checkboxes, row hover |
| panel | 160 ms | opacity + transform translateY(6px → 0) on enter; opacity only on exit | finding cards, dropdowns, popovers, side panels, expanded table rows, toasts |
| page | 180 ms | opacity + transform translateX(8px → 0) on the main content area only | route changes inside a shell; the sidebar and top bar never move |

Rules:

- Nothing bounces, springs or overshoots. One easing curve (`--ease`).
- Page transitions animate the content column only. The sidebar, top bar and role switcher are static so the eye has a fixed frame.
- Tables never animate their rows on data load; they appear complete. Row expand/collapse uses `panel`.
- Status changes (an upload moving received → extracting → needs review) update in place with a `control` fade on the status chip; polling interval 2 s while a status is non-terminal.
- Loading: skeleton blocks in `--lav` for cards and KPI tiles; a single thin progress bar under the top bar for route loads. No spinners inside tables.
- Hover on a primary button: translateY(-1px) + `--sh-primary`; active: translateY(0). Ghost buttons change background to `--lav` only.
- Focus is always visible (`--focus` ring); keyboard order follows reading order; every popover is dismissable with Escape.
- Toasts (the only notification channel in the POC) enter with `panel`, sit bottom-right, auto-dismiss after 6 s unless hovered, and never stack more than three.
