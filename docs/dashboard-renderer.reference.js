;

// Shared show/hide for collapsible history tables (prior rows carry data-ph=<id>).
window.togglePriorRows = function (id, btn, n, unit) {
  const rows = document.querySelectorAll('tr[data-ph="' + id + '"]');
  const show = rows.length && rows[0].classList.contains('ph-hide');
  rows.forEach(r => r.classList.toggle('ph-hide', !show));
  if (!show) document.querySelectorAll('tr[data-ph-detail="' + id + '"]').forEach(r => { r.style.display = 'none'; });
  btn.innerHTML = show ? (btn.dataset.icon + ' Hide prior ' + unit + 's &#9652;')
                       : (btn.dataset.icon + ' Show ' + n + ' prior ' + unit + (n === 1 ? '' : 's') + ' &#9662;');
};
const phButton = (id, n, unit, icon) => n > 0
  ? `<button type="button" class="ph-toggle" data-icon="${icon}" onclick="togglePriorRows('${id}', this, ${n}, '${unit}')">${icon} Show ${n} prior ${unit}${n === 1 ? '' : 's'} &#9662;</button>` : '';


// If every deal's name shares a common leading phrase (e.g. all deals sit
// under the same trust: "MOVE Trust - TLFC LP", "MOVE Trust - Essex Lease
// Financial Corp."), that phrase belongs in the page title, not repeated on
// every row of the deals table. Falls back to full names + generic title if
// the deals don't actually share one (e.g. a portfolio spanning trusts).
function commonDealNamePrefix(names) {
  if (!names.length) return '';
  let prefix = names[0];
  // With only one deal on file (a new program's first onboarded deal),
  // there's no second name to compare against, so the loop below never
  // runs and `prefix` would stay as the deal's own full name -- which
  // fails the trailing-separator check and silently falls back to a
  // generic "Portfolio Dashboard" title instead of "F-PIL 2.0 - Portfolio
  // Dashboard". Verified directly as a real case, not hypothetical: this
  // is exactly what happened when F-PIL 2.0 was stood up with just one
  // deal. A single name's own "X - Y" split is still a valid prefix
  // candidate even with nothing to compare it to.
  for (const name of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++;
    prefix = prefix.slice(0, i);
  }
  // only count it if it ends on a clean word/separator boundary, so we don't
  // cut a shared prefix off mid-word (e.g. "MOVE Trust - T" from "TLFC" vs "Tri-something")
  const m = prefix.match(/^(.*?)(\s*-\s*|\s+)$/);
  if (m) return m[1].trim();
  if (names.length === 1) {
    const m2 = names[0].match(/^(.*?)\s+-\s+.+$/);
    if (m2) return m2[1].trim();
  }
  return '';
}
const DEAL_NAME_PREFIX = commonDealNamePrefix(DATA.deals.map(d => d.deal_name));
// F-PIL 2.0 deals are structured as secured loan/credit facilities, not
// securitization tranches -- showing "Tranche Balance" for a deal that has
// no tranches at all would be genuinely inaccurate, not just off-brand.
// DATA.terminology is absent for every MOVE Trust deal, so these fall back
// to the exact labels already in use there.
const TERM = DATA.terminology || {};
const BALANCE_LABEL = TERM.balance_label || 'Tranche Balance';
const AMOUNT_LABEL = TERM.amount_label || 'Tranche Amount';
const UNIT_LABEL = TERM.unit_label || 'Tranche';
function shortDealName(name) {
  return DEAL_NAME_PREFIX && name.startsWith(DEAL_NAME_PREFIX)
    ? name.slice(DEAL_NAME_PREFIX.length).replace(/^\s*-\s*/, '').trim()
    : name;
}
document.getElementById('pageTitle').textContent =
  DEAL_NAME_PREFIX ? `${DEAL_NAME_PREFIX} - Portfolio Dashboard` : 'Portfolio Dashboard';

// Zero vs. absent, deliberately distinct and now matching the source
// reports' own convention: an exact zero renders as "-" (exactly how the
// PDFs print a zero), while a missing / not-reported / not-applicable
// value renders as "n/a". Previously zero was "$0" and absent was an
// em dash -- two near-identical dashes meaning different things, with
// no legend, and neither matching what a reader sees in the report.
function fmtMoney(v) { if (v===null||v===undefined) return 'n/a'; if (v===0) return '-'; const s=v<0?'-':''; return s+'$'+Math.abs(v).toLocaleString('en-US',{maximumFractionDigits:0}); }
function sparklineSVG(values, opts = {}) {
  const w = opts.width || 90, h = opts.height || 24, pad = 2;
  const vals = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (vals.length < 2) return '<span style="color:var(--muted);font-size:10px">n/a</span>';
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (opts.threshold !== undefined && opts.threshold !== null) { lo = Math.min(lo, opts.threshold); hi = Math.max(hi, opts.threshold); }
  if (hi === lo) { hi = lo + (Math.abs(lo) || 1) * 0.1; lo = lo - (Math.abs(lo) || 1) * 0.1; }
  const x = i => pad + (i / (vals.length - 1)) * (w - 2 * pad);
  const y = v => pad + (1 - (v - lo) / (hi - lo)) * (h - 2 * pad);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = vals[vals.length - 1], first = vals[0];
  const rising = last > first;
  // For a ceiling-type covenant, rising is the concerning direction; for a
  // floor-type (ICR, equity), falling is. Color the line by whether it's
  // moving toward or away from trouble, not by raw direction.
  const worse = opts.kind === 'floor' ? !rising : rising;
  const color = (opts.threshold !== undefined && opts.threshold !== null && worse && Math.abs(last - first) > 1e-9) ? 'var(--breach)' : 'var(--accent)';
  const thr = (opts.threshold !== undefined && opts.threshold !== null)
    ? `<line x1="${pad}" y1="${y(opts.threshold).toFixed(1)}" x2="${w - pad}" y2="${y(opts.threshold).toFixed(1)}" stroke="var(--breach)" stroke-width="1" stroke-dasharray="2,2" opacity=".6"/>` : '';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle;overflow:visible">${thr}<polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/><circle cx="${x(vals.length-1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2" fill="${color}"/></svg>`;
}

function trendChartSVG(labels, series, opts = {}) {
  // series: [{name, values, color, threshold, kind, fmt}]
  // Trim trailing months where EVERY series on THIS chart has no value --
  // not just the current period, any number of trailing empty months.
  // The caller passes one shared 12-month label array to both charts on a
  // deal page, but a deal can have one chart's data stop earlier than the
  // other's (Finloc: Borrower Data's ICR/Leverage/Total Equity table lags
  // by a month and has no Jun-26 row at all, while Portfolio Performance's
  // Delinquency/Loss Ratio genuinely does). Showing an x-axis tick with
  // nothing plotted under it on EITHER series reads as a missing data
  // point rather than "this chart doesn't extend that far" -- so it's
  // dropped instead. A month stays if AT LEAST ONE series has a real
  // value there (Xpedite's chart: Leverage has no Jun-26, but ICR does,
  // so Jun-26 correctly stays and only Leverage's own line stops short).
  let lastRealIdx = -1;
  for (let i = labels.length - 1; i >= 0; i--) {
    if (series.some(s => s.values[i] !== null && s.values[i] !== undefined && !isNaN(s.values[i]))) { lastRealIdx = i; break; }
  }
  if (lastRealIdx >= 0 && lastRealIdx < labels.length - 1) {
    labels = labels.slice(0, lastRealIdx + 1);
    series = series.map(s => ({...s, values: s.values.slice(0, lastRealIdx + 1)}));
  }
  // Same for LEADING months: a deal page's shared label array can start
  // well before THIS chart's data (TLFC: Servicer Data back to Mar-24,
  // Portfolio Performance only from Jul-25), which left an empty stretch
  // at the left of the chart.
  let firstRealIdx = labels.findIndex((_, i) => series.some(s => s.values[i] !== null && s.values[i] !== undefined && !isNaN(s.values[i])));
  if (firstRealIdx > 0) {
    labels = labels.slice(firstRealIdx);
    series = series.map(s => ({...s, values: s.values.slice(firstRealIdx)}));
  }
  // Many limit lines (TLFC: Lock-Up and EoT levels on three ratios = six
  // lines, three of them at 1.00%) can't each carry a full text label
  // without the labels piling on top of one another. Past two lines, the
  // lines keep their color and dash style and get just a short value tag
  // at the right edge (one per distinct value), and the full description
  // of every limit moves into a key under the chart.
  const limitCount = series.reduce((n, s) => n + ((s.threshold !== null && s.threshold !== undefined) ? 1 : 0) + ((s.threshold2 !== null && s.threshold2 !== undefined) ? 1 : 0), 0);
  const keyMode = limitCount > 2;
  const keyRows = [];
  const w = opts.width || 560, h = opts.height || 170, padL = 52, padR = keyMode ? 44 : 12, padT = 14, padB = 26;
  const all = [];
  series.forEach(s => { s.values.forEach(v => { if (v !== null && v !== undefined && !isNaN(v)) all.push(v); }); if (s.threshold !== null && s.threshold !== undefined) all.push(s.threshold); if (s.threshold2 !== null && s.threshold2 !== undefined) all.push(s.threshold2); });
  if (all.length < 2) return '';
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) { hi = lo + (Math.abs(lo) || 1) * 0.1; lo = lo - (Math.abs(lo) || 1) * 0.1; }
  const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
  const n = labels.length;
  const x = i => padL + (i / Math.max(1, n - 1)) * (w - padL - padR);
  const y = v => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  const fmt = opts.fmt === 'pct' ? (v => (v * 100).toFixed(1) + '%') : opts.fmt === 'dollar' ? (v => '$' + (v / 1e6).toFixed(1) + 'M') : (v => v.toFixed(2) + 'x');
  // A threshold/limit value needs its own, higher-precision formatter,
  // separate from the axis gridlines' fmt above: a limit of 3.25%
  // rounded through fmt's 1-decimal axis format reads as "3.3%", losing
  // the figure's own real precision -- the same 2-decimal convention the
  // KPI cards already use (fmtPct(v,2)) is used here too, for
  // consistency between a card's own "EoT Limit 3.25%" and this same
  // limit's line label on the chart below it.
  const fmtThreshold = opts.fmt === 'pct' ? (v => (v * 100).toFixed(2) + '%') : fmt;
  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const v = lo + (hi - lo) * (g / 4);
    grid += `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${w - padR}" y2="${y(v).toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
    grid += `<text x="${padL - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${fmt(v)}</text>`;
  }
  let xlabels = '';
  const step = Math.max(1, Math.ceil(n / 6));
  labels.forEach((l, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    // The most recent month sits flush at the plot area's own right edge
    // (x = w - padR). Center-anchoring it there, same as every other
    // label, put roughly half its width past the SVG's own viewBox
    // boundary -- clipping the most important label on the chart (the
    // current period) rather than an older one. Right-anchored instead,
    // so it reads leftward from its correct tick position and stays fully
    // inside the viewBox; every earlier label keeps the normal center
    // anchor, since only the last one sits at the hard edge.
    const anchor = (i === n - 1) ? 'end' : 'middle';
    const lx = (i === n - 1) ? w - padR : x(i);
    xlabels += `<text x="${lx.toFixed(1)}" y="${h - 8}" text-anchor="${anchor}" font-size="9" fill="var(--muted)" font-family="IBM Plex Sans,sans-serif">${l}</text>`;
  });
  let lines = '', legend = '';
  // Threshold labels that land at the same y (two covenants with the same
  // limit, e.g. Delinquency and Rolling 3-Mo Loss both at 3.5%) would
  // otherwise overprint into unreadable text -- stack them.
  const placedLabelYs = [];
  series.forEach((s, si) => {
    const pts = s.values.map((v, i) => (v === null || v === undefined || isNaN(v)) ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(' ');
    lines += `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${pts}"/>`;
    const drawLimitLine = (val, label, dash, opacity, anchorY) => {
      const ty = y(val);
      lines += `<line x1="${padL}" y1="${ty.toFixed(1)}" x2="${w - padR}" y2="${ty.toFixed(1)}" stroke="${s.color}" stroke-width="1" stroke-dasharray="${dash}" opacity="${opacity}"/>`;
      if (keyMode) {
        keyRows.push({color: s.color, dash, opacity, label});
        const tag = fmtThreshold(val);
        if (!placedLabelYs.some(p => p.tag === tag)) {
          // Nearest free slot to its own line, alternating below/above --
          // pushing only upward walked a crowded tag (Finloc's 1.50%) far
          // from its line, past the 8.00% one.
          let tagY = ty + 3;
          for (let k = 1; k < 12 && placedLabelYs.some(p => Math.abs(p.y - tagY) < 10); k++) tagY = ty + 3 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 10;
          placedLabelYs.push({tag, y: tagY});
          lines += `<text x="${w - padR + 4}" y="${tagY.toFixed(1)}" text-anchor="start" font-size="8.5" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${tag}</text>`;
        }
        return ty;
      }
      let labelY;
      if (anchorY !== undefined) {
        // Paired second threshold on the same metric: stay close to THIS
        // line, not the global collision pool. Two thresholds for the
        // same ratio are often <10pt apart (a Lock-Up vs Termination pair
        // can be 0.5 percentage points), and the general "push away by
        // 10px per collision" rule -- built for unrelated metrics'
        // labels -- was cascading the second label 60+ px away into a
        // completely different line's neighbourhood, reading as if it
        // belonged there instead. Placed on the opposite side of its own
        // line from the primary label (below if primary is above, or
        // vice versa) so the two never overlap each other, independent of
        // where every other metric's label landed.
        labelY = ty > anchorY ? ty + 9 : ty - 3;
      } else {
        labelY = ty - 3;
        while (placedLabelYs.some(py => Math.abs(py - labelY) < 10)) labelY -= 10;
      }
      placedLabelYs.push(labelY);
      lines += `<text x="${w - padR}" y="${labelY.toFixed(1)}" text-anchor="end" font-size="8.5" fill="${s.color}" font-family="IBM Plex Sans,sans-serif">${label}</text>`;
      return labelY;
    };
    if (s.threshold !== null && s.threshold !== undefined) {
      // Two different limits on the same metric (e.g. Finloc's Delinquency:
      // a Lock-Up Event trigger at 6% and a separate Event of Termination
      // trigger at 8%) both drawn, so the chart matches what the report
      // actually tests rather than showing only one and silently dropping
      // the other. Primary (non-lookback) line stays solid at full
      // opacity; the second is a lighter dotted line, labelled with its
      // own category so the two are never confused for one imprecise
      // threshold.
      const hasSecond = s.threshold2 !== null && s.threshold2 !== undefined;
      const primaryY = drawLimitLine(s.threshold, `${s.name} ${s.thresholdLabel ? s.thresholdLabel + ' ' : ''}${s.kind === 'floor' ? 'minimum' : 'limit'} ${fmtThreshold(s.threshold)}`, '4,3', hasSecond ? '.85' : '.7');
      if (hasSecond) {
        drawLimitLine(s.threshold2, `${s.name} ${s.threshold2Label || 'other'} ${s.kind === 'floor' ? 'minimum' : 'limit'} ${fmtThreshold(s.threshold2)}`, '2,3', '.55', primaryY);
      }
    }
    legend += `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px;font-size:10.5px;color:var(--ink)"><span style="display:inline-block;width:14px;height:2px;background:${s.color}"></span>${s.name}</span>`;
  });
  const sw = (r) => `<svg width="22" height="6" style="flex-shrink:0"><line x1="0" y1="3" x2="22" y2="3" stroke="${r.color}" stroke-width="1.5" stroke-dasharray="${r.dash}" opacity="${Math.min(1, parseFloat(r.opacity) + .15)}"/></svg>`;
  const key = keyMode ? `<div class="chart-limit-key" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:3px 14px;margin-top:6px;font-size:10px;color:var(--ink)">${keyRows.map(r => `<span style="display:flex;align-items:center;gap:6px">${sw(r)}<span>${r.label}</span></span>`).join('')}</div>` : '';
  return `<div style="margin-top:6px"><div style="margin-bottom:4px">${legend}</div><svg width="100%" viewBox="0 0 ${w} ${h}" style="max-width:${w}px;display:block">${grid}${xlabels}${lines}</svg>${key}</div>`;
}
function currencyBreakdownCell(cad, usdRaw, usdCadEquiv, total, color) {
  // Dual-currency deals (Finloc): four rows rather than one blended
  // figure -- CAD amount, raw USD amount, that USD amount's own CAD-
  // equivalent conversion, then the combined total (bold, divided).
  // Showing the raw USD figure alongside its converted value (not just
  // the converted value alone) is deliberate: a reader can see both what
  // was actually collected in USD and what that's worth in CAD, rather
  // than only the already-converted number. Label and value sit in their
  // own column (a small internal grid) rather than run together as
  // "Label: Value" text. white-space:nowrap on the label keeps "CAD
  // Equiv" and "Total (CAD Equiv)" on one line -- without it, the shared
  // table's many other columns squeeze this cell enough that those two
  // labels wrap mid-phrase, which reads as cluttered rather than clean.
  const row = (label, val, bold) => `<div style="display:contents">
      <div style="text-align:left;white-space:nowrap;${bold?'font-weight:700;':''}${bold&&color?`color:${color};`:''}">${label}</div>
      <div class="num" style="text-align:right;${bold?'font-weight:700;':''}${bold&&color?`color:${color};`:''}">${fmtMoney(val)}</div>
    </div>`;
  return `<div style="display:grid;grid-template-columns:auto auto;column-gap:10px;row-gap:1px;line-height:1.4;font-size:11px">
      ${row('CAD', cad)}
      ${row('USD', usdRaw)}
      ${row('CAD Equiv', usdCadEquiv)}
      <div style="grid-column:1/-1;border-top:1px solid var(--line);margin:3px 0 2px"></div>
      ${row('Total (CAD Equiv)', total, true)}
    </div>`;
}
function fmtNum(v) { if (v===null||v===undefined) return 'n/a'; if (v===0) return '-'; return v.toLocaleString('en-US'); }
// Unlike dollar/count figures (where the source PDFs print a literal
// "-" for zero, matched by fmtMoney/fmtNum below), a percentage ratio
// that happens to be exactly zero is printed by the source as the real
// number -- e.g. TLFC's own RVL Ratio table prints "0.000000%" for
// Apr-26/Mar-26, never a dash. A computed ratio of 0.00% is a precise,
// meaningful reading (no residual value loss that month), not an
// absent or unreported figure, so it's never collapsed to "-" here.
function fmtPct(v,d) { if (v===null||v===undefined) return 'n/a'; return (v*100).toFixed(d===undefined?2:d)+'%'; }
// Floor tests -- a value that must stay ABOVE a minimum (Interest Coverage,
// Total Equity, Tangible Net Worth) -- are described by their headroom over
// that minimum ("77% above min"), not as "% of limit": $13.3M equity against
// a $7.5M minimum read as "56% of limit", which sounds like the balance is
// below the requirement. Ceiling tests keep "% of limit".
function isFloorTest(c) { return !!c && c.kind === 'floor'; }
// Deals whose quantitative tests are Events of DEFAULT in their own
// agreements (VCC IV's LSA; F-PIL 2.0's SLFA/ARFA s.9.1), though the
// extractor files them under its default category "Event of Termination".
const EOD_DEAL_SLUGS = ['move-trust-vcc-iv-lp', 'f-pil-2-0-stride-capital', 'f-pil-2-0-xpedite-leasing', 'f-pil-2-0-moneda-capital-corp'];
function displayCategory(c, slug) { return (c.category === 'Event of Termination' && EOD_DEAL_SLUGS.includes(slug)) ? 'Event of Default' : c.category; }
// Formats a covenant's value in the unit the TEST is written in, read from
// the test's own wording -- never guessed from the number's size. The old
// size-based guess (under 1 = percentage, over 1,000 = dollars, otherwise a
// multiple) showed Finloc's 0.93x Interest Coverage Ratio as "93.00%", and
// $0 thresholds as "0.00%".
function covUnit(c) {
  const d = ((c && c.description) || '').toLowerCase();
  const t = c ? Math.abs(c.threshold || 0) : 0, v = c ? Math.abs(c.current_value || 0) : 0;
  if (/:1\b|coverage ratio|leverage ratio|debt\s*\/\s*equity|debt[- ]to[- ]equity/.test(d)) return 'ratio';
  if (d.includes('%') && t < 1) return 'pct';
  if (/total equity|net worth|required equity|deferred (account|amount)|tranche balance|\$\s?\d/.test(d) || t >= 1000 || v >= 1000) return 'dollar';
  return 'pct';
}
function fmtCov(c, v) {
  if (v === null || v === undefined) return 'n/a';
  const u = covUnit(c);
  if (u === 'dollar' && Math.abs(v) < 0.5) return '$0';  // zero (or a -$0.01 rounding residue) reads "$0", not "-" or "-$0"
  return u === 'dollar' ? fmtMoney(v) : u === 'ratio' ? `${v.toFixed(2)}x` : fmtPct(v, 2);
}
function floorHeadroom(cur, min, long) {
  if (cur === null || cur === undefined || !min) return '';
  const r = cur / min, w = long ? 'the minimum' : 'min';
  return r >= 1 ? `${fmtPct(r - 1, 0)} above ${w}` : `${fmtPct(1 - r, 0)} below ${w}`;
}
function statusClass(s) { return s.replace(/\s+/g,''); }

const t = DATA.portfolio_totals;
function dir(v){ return v>0?'up':v<0?'down':'flat'; }

function recomputeStatus(c, bufferFrac) {
  if (c.kind === 'binary' || c.threshold === null || c.threshold === undefined || c.current_value === null) {
    return {status: c.status, utilization_pct: c.utilization_pct};
  }
  let util;
  if (c.kind === 'ceiling') {
    util = c.current_value / c.threshold;
    if (c.current_value > c.threshold) return {status: 'BREACH', utilization_pct: util};
    if (util >= (1 - bufferFrac)) return {status: 'WATCH', utilization_pct: util};
    return {status: 'OK', utilization_pct: util};
  } else {
    util = c.threshold / c.current_value;
    if (c.current_value < c.threshold) return {status: 'BREACH', utilization_pct: util};
    if (util >= (1 - bufferFrac)) return {status: 'WATCH', utilization_pct: util};
    return {status: 'OK', utilization_pct: util};
  }
}

const RANK = {BREACH:3, WATCH:1, AVAILABLE:0, OK:0};
function statusLabel(status) {
  return status === 'BREACH' ? 'TRIGGERED' : status;
}
function dealWorstStatus(computedCovenants) {
  let rank = 0;
  for (const c of computedCovenants) {
    if (c.category === 'Clean-Up Provision') continue;
    rank = Math.max(rank, RANK[c.status] ?? 0);
  }
  return rank === 3 ? 'BREACH' : rank === 1 ? 'WATCH' : 'OK';
}

function stableKey(c) {
  // matches on legal ref + the part of the description before any trailing
  // parenthetical, since a couple of descriptions embed a period-specific
  // count/value there (e.g. "...(46 of 98)") that would otherwise break matching
  return c.legal_ref + '::' + c.description.split('(')[0].trim();
}

// Three views of utilization for deals with a warehouse facility, which
// draws on the same program limit as the term facility:
//   Term      = term principal / term facility limit (max - WH closing)
//   Warehouse = WH closing / warehouse facility limit, where that limit is
//               the lesser of the max WH limit and the unused term capacity
//               (the reports' own "min(max WH limit, availability)")
//   Total     = (term + WH) / max program limit
// Deals without a warehouse: all three collapse to the single term figure.
function utilParts(deals) {
  let tA = 0, tL = 0, wA = 0, wL = 0, oA = 0, oL = 0, anyWH = false, anyTerm = false;
  for (const d of deals || []) {
    const p = d.program || {}, w = d.warehouse || {};
    if (p.program_amount === null || p.program_amount === undefined || !p.program_limit) continue;
    anyTerm = true;
    tA += p.program_amount; tL += p.program_limit;
    const hasWH = !!(w.maximum_warehouse_facility_limit && p.maximum_program_limit);
    if (hasWH) {
      anyWH = true;
      const whAmt = w.closing_advances_outstanding || 0;
      const unused = (p.unused_facility !== null && p.unused_facility !== undefined) ? p.unused_facility : (p.program_limit - p.program_amount);
      wA += whAmt; wL += Math.max(0, Math.min(w.maximum_warehouse_facility_limit, unused));
      oA += p.program_amount + whAmt; oL += p.maximum_program_limit;
    } else { oA += p.program_amount; oL += p.program_limit; }
  }
  if (!anyTerm) return null;
  const part = (a, l) => ({amt: a, lim: l, pct: l ? a / l : null});
  return {term: part(tA, tL), wh: anyWH ? part(wA, wL) : null, total: part(oA, oL)};
}
function utilLines(u, compact) {
  const row = (lbl, x) => compact
    ? `<div style="white-space:nowrap"><span style="color:var(--muted);font-size:10px">${lbl}</span> ${fmtPct(x.pct, 1)}</div>`
    : `<div style="font-size:11px;margin-top:4px;line-height:1.35"><div style="white-space:nowrap"><b>${lbl}</b> ${fmtPct(x.pct, 1)}</div><div style="color:var(--muted);font-size:10px;white-space:nowrap">${fmtMoney(x.amt)} of ${fmtMoney(x.lim)}</div></div>`;
  return row('Total', u.total) + row('Term', u.term) + row('Warehouse', u.wh);
}
function progUtilCell(d) {
  const u = utilParts([d]);
  if (!u || !u.wh) return fmtProgUtil(d.program);
  return `<span title="(${fmtMoney(u.term.amt)} term + ${u.wh.amt ? fmtMoney(u.wh.amt) : '$0'} warehouse outstanding) / ${fmtMoney(u.total.lim)} max program limit">${fmtPct(u.total.pct, 1)}</span>`;
}
function fmtProgUtil(program) {
  if (!program || program.program_utilization_pct === null || program.program_utilization_pct === undefined) return 'n/a';
  return fmtPct(program.program_utilization_pct, 1);
}

function render(bufferPct) {
  const bufferFrac = bufferPct / 100;
  const dealsComputed = DATA.deals.map(d => {
    const covs = d.covenants.map(c => ({...c, ...recomputeStatus(c, bufferFrac)}));
    const currentWorst = dealWorstStatus(covs);
    let priorWorst = null, priorCovs = null;
    if (d.prior_covenants) {
      priorCovs = d.prior_covenants.map(c => ({...c, ...recomputeStatus(c, bufferFrac)}));
      priorWorst = dealWorstStatus(priorCovs);
    }
    // Each deal's own name for its leverage covenant: 'Debt/Equity Ratio'
    // for the TLFC-family deals whose agreements say so, 'Leverage Ratio'
    // for the other six. One metric under the hood (debt_equity_ratio).
    // Attached to the deal object so it's in scope everywhere d is (the
    // Watchlist cell, the tile/table labels, the chart series) -- a
    // plain const hit both a use-before-declaration error and a scope
    // mismatch between the Watchlist's own IIFE and the panel builder.
    const leverageLabel = covs.some(c => (c.description || '').toLowerCase().replace(/ \/ /g, '/').includes('debt/equity')) ? 'Debt/Equity Ratio' : 'Leverage Ratio';
    // Same per-deal naming as leverageLabel: Finloc's own covenant says
    // "Tangible Net Worth", not "Total Equity" -- the generic dashboard
    // label was wrong for this one deal specifically, confirmed directly
    // against its source (the string "Total Equity" never appears in
    // Finloc's report at all). Moneda and Xpedite both genuinely say
    // "Total Equity" in their own reports, so this can't be a global
    // rename.
    // TLFC Loans only: confirmed directly against the PDF's own column
    // header ("Performance Guarantor's Aggregate Indebtedness | ...Total
    // Equity | Debt/Equity Ratio") and its covenant text ("Is the Total
    // Equity of the Performance Guarantor less than..."). The other two
    // TLFC entities' own guarantor is a different, separately-named
    // entity ("TAG"), so this is specific to this one deal, not the
    // whole family.
    const totalEquityLabel = d.deal_slug === 'move-trust-tlfc-loans' ? "Performance Guarantor's Total Equity"
      : covs.some(c => (c.description || '').toLowerCase().includes('tangible net worth')) ? 'Tangible Net Worth' : 'Total Equity';
    // Meridian OneCap only: its own Balance History data distinguishes
    // Deemed Default Contracts from Charge-Off Contracts as two separate
    // loss-type columns, rather than one generic "Losses" figure. The
    // "losses" field is already mapped to this deal's Deemed Default
    // Contracts specifically (covenant_analysis.py), so the header needs
    // to say so rather than imply it's some other, unspecified loss
    // measure. Every other deal keeps the plain "Losses" label, since
    // they have no such distinction to draw.
    const hasChargeOff = (d.period_history || []).some(p => p.charge_off !== null && p.charge_off !== undefined);
    const lossesLabel = hasChargeOff ? 'Deemed Default Contracts' : 'Losses';
    return {...d, leverageLabel, totalEquityLabel, hasChargeOff, lossesLabel, computedCovenants: covs, computedWorst: currentWorst,
            priorComputedWorst: priorWorst, priorComputedCovenants: priorCovs,
            changed: priorWorst !== null && priorWorst !== currentWorst};
  });
  dealsComputed.sort((a,b) => a.deal_name.localeCompare(b.deal_name));

  const covTotals = {BREACH:0, WATCH:0, OK:0, AVAILABLE:0};
  dealsComputed.forEach(d => d.computedCovenants.forEach(c => { covTotals[c.status] = (covTotals[c.status]||0)+1; }));
  const changedCount = dealsComputed.filter(d => d.changed).length;
  const noPriorCount = dealsComputed.filter(d => d.priorComputedWorst === null).length;

  // Net-change sub-line for the headline cards. An exact-zero change
  // reads "No change" -- under the zero-as-"-" convention it would
  // otherwise render as "- (-)", which looks broken on a headline card.
  const fmtDelta = (abs, pct, asCount) => {
    if (abs === null || abs === undefined) return 'n/a';
    if (abs === 0) return 'No change';
    const a = asCount ? ((abs > 0 ? '+' : '') + abs.toLocaleString('en-US')) : fmtMoney(abs);
    return (pct === null || pct === undefined) ? a : `${a} (${fmtPct(pct, asCount ? 1 : 2)})`;
  };
  document.getElementById('kpiRow').innerHTML = `
    <div class="kpi highlight">
      <div class="label">Total ${BALANCE_LABEL} (all deals)</div>
      <div class="value num">${fmtMoney(t.closing_tranche_balance)}</div>
      <div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.02em;margin-top:6px">Net Change vs. Last Period</div>
      <div class="delta ${dir(t.tranche_balance_change_abs)} num">${fmtDelta(t.tranche_balance_change_abs, t.tranche_balance_change_pct)}</div>
    </div>
    <div class="kpi highlight">
      <div class="label">Total Outstanding Contracts</div>
      <div class="value num">${fmtNum(t.closing_contracts)}</div>
      <div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.02em;margin-top:6px">Net Change vs. Last Period</div>
      <div class="delta ${dir(t.contracts_change_abs)} num">${fmtDelta(t.contracts_change_abs, t.contracts_change_pct, true)}</div>
    </div>
    <div class="kpi highlight">
      <div class="label" title="Weighted by facility size: total drawn (program amount) across all deals divided by total limit across all deals \u2014 not a plain average of each deal's own %. A larger deal's utilization moves this number more than a smaller deal's.">Program Utilization <span style="cursor:help;opacity:.6">&#9432;</span></div>
      ${(() => { const u = utilParts(DATA.deals); return (u && u.wh) ? `<div class="value num">${fmtPct(u.total.pct,1)}</div><div class="delta flat num">${fmtMoney(u.total.amt)} of ${fmtMoney(u.total.lim)}<div style="font-size:10.5px;margin-top:2px">${fmtMoney(u.term.amt)} term + ${u.wh.amt ? fmtMoney(u.wh.amt) : '$0'} warehouse outstanding, of the max program limit</div></div>` : ''; })() || `<div class="value num">${t.program_utilization_pct !== null && t.program_utilization_pct !== undefined ? fmtPct(t.program_utilization_pct,1) : 'n/a'}</div>
      <div class="delta flat num">${t.program_utilization_pct !== null && t.program_utilization_pct !== undefined ? `${fmtMoney(t.total_program_amount)} of ${fmtMoney(t.total_program_limit)} (weighted average)${t.total_warehouse_closing_advances ? `<div style="font-size:10.5px;margin-top:2px">Limit is net of ${fmtMoney(t.total_warehouse_closing_advances)} warehouse advances, which draw on the same program limit</div>` : ''}` : `Not available for ${(t.program_utilization_deals_missing||[]).length} deal(s)`}</div>`}
    </div>
    ${(t.deals_with_warehouse && t.deals_with_warehouse.length) ? `
    <div class="kpi highlight">
      <div class="label" style="color:var(--accent)">Warehouse Advances Outstanding (all deals)</div>
      <div class="value num">${fmtMoney(t.total_warehouse_closing_advances)}</div>
      <div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.02em;margin-top:6px">Net Change vs. Last Period</div>
      <div class="delta ${dir(t.warehouse_advances_change_abs)} num">${fmtDelta(t.warehouse_advances_change_abs, t.total_warehouse_opening_advances ? t.warehouse_advances_change_abs/t.total_warehouse_opening_advances : null)}</div>
    </div>` : ''}
  `;

  const breachDeals = dealsComputed.filter(d => d.computedWorst === 'BREACH').map(d => shortDealName(d.deal_name));
  const watchDeals = dealsComputed.filter(d => d.computedWorst === 'WATCH').map(d => shortDealName(d.deal_name));
  const reviewDeals = dealsComputed.filter(d => d.computedWorst !== 'OK').map(d => shortDealName(d.deal_name));
  const changedDeals = dealsComputed.filter(d => d.changed).map(d => shortDealName(d.deal_name));
  const dealList = (names) => names.length
    ? `<div style="margin-top:5px;display:flex;flex-direction:column;gap:2px">${names.map(n =>
        `<div style="font-size:10.5px;color:var(--muted);line-height:1.4">&#8226;&nbsp; ${n}</div>`).join('')}</div>` : '';
  document.getElementById('statusKpiRow').innerHTML = `
    <div class="kpi highlight" style="${covTotals.BREACH ? `border-color:var(--breach);background:var(--breach-bg)` : ''}">
      <div class="label" style="${covTotals.BREACH ? 'color:var(--breach);font-weight:700' : ''}">Covenant Status (all deals, all tests)</div>
      <div class="value num" style="color:${covTotals.BREACH?'var(--breach)':'inherit'}">${covTotals.BREACH||0} <span style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.02em">Triggered</span></div>
      ${dealList(breachDeals)}
      <div class="value num" style="color:${covTotals.WATCH?'var(--watch)':'inherit'};margin-top:8px">${covTotals.WATCH||0} <span style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.02em">Watch</span></div>
      ${dealList(watchDeals)}
    </div>
    <div class="kpi highlight">
      <div class="label" title="Deals currently at TRIGGERED or WATCH, as of this period -- regardless of whether that status is new or has held for several periods.">Deals to Review <span style="cursor:help;opacity:.6">&#9432;</span></div>
      <div class="value">${reviewDeals.length} of ${DATA.deal_count}</div>
      ${dealList(reviewDeals)}
    </div>
    <div class="kpi highlight" style="${changedCount ? `border-color:var(--watch);background:var(--watch-bg)` : ''}">
      <div class="label" style="${changedCount ? 'color:var(--watch);font-weight:700' : ''}" title="Deals whose worst covenant status is different from last period, at the current watch threshold -- a status that has stayed flagged (or stayed clean) for multiple periods in a row does not count as changed.">Status Changes This Period <span style="cursor:help;opacity:.6">&#9432;</span></div>
      <div class="value">${changedCount} of ${DATA.deal_count}</div>
      ${dealList(changedDeals)}
      ${noPriorCount ? `<div class="delta flat" style="margin-top:8px">${noPriorCount} deal(s) have no prior period to compare against</div>` : ''}
    </div>
  `;

  let rows = '';
  dealsComputed.forEach((d, i) => {
    const tb = d.tranche_balance, ct = d.contracts, ta = d.tranche_amount || {};
    const fmtGeneric = (v) => {
      if (v === null || v === undefined) return 'n/a';
      const av = Math.abs(v);
      return av > 1000 ? fmtMoney(v) : av < 1 ? fmtPct(v, 2) : `${v.toFixed(2)}x`;
    };
    const covenantTooltip = (c) => {
      if (c.current_value === null || c.current_value === undefined || c.threshold === null || c.threshold === undefined) {
        return 'Reported directly by the servicer/originator; no underlying ratio value tracked for this test.';
      }
      const util = isFloorTest(c) ? ` \u2014 ${floorHeadroom(c.current_value, c.threshold, true)}` : (c.utilization_pct !== null && c.utilization_pct !== undefined) ? ` \u2014 ${fmtPct(c.utilization_pct, 0)} of the way to triggering` : '';
      // A ratio test's current value is formatted like its threshold: a
      // 0.93x Interest Coverage Ratio was shown as "93.00%" because the
      // magnitude-based guess treats anything under 1 as a percentage.
      return `Current: ${fmtCov(c, c.current_value)}  |  ${isFloorTest(c) ? 'Minimum' : 'Threshold'}: ${fmtCov(c, c.threshold)}${util}`;
    };
    const priorByKey = {};
    if (d.priorComputedCovenants) d.priorComputedCovenants.forEach(c => { priorByKey[stableKey(c)] = c.status; });
    // Which specific test(s) actually drove the deal-level status change --
    // not just "the worst status changed," but which covenant caused it,
    // and (where a ratio underlies it) the actual figure and threshold
    // being compared, not just the test's yes/no description.
    const driverCovenants = d.priorComputedCovenants
      ? d.computedCovenants.filter(c => priorByKey[stableKey(c)] !== undefined && priorByKey[stableKey(c)] !== c.status)
      : [];
    const watchLevel = (c) => {
      if (c.threshold === null || c.threshold === undefined) return null;
      // The exact value at which WATCH starts, derived the same way
      // recomputeStatus() decides it -- kept in sync with the live watch
      // threshold control, not a separately-maintained calculation.
      return c.kind === 'ceiling' ? c.threshold * (1 - bufferFrac) : c.threshold / (1 - bufferFrac);
    };
    const driverNote = driverCovenants.length
      ? `<div style="color:var(--muted);font-size:10.5px;margin-top:3px;max-width:320px;white-space:normal">${driverCovenants.map(c => {
          if (c.current_value === null || c.current_value === undefined || c.threshold === null || c.threshold === undefined) {
            return c.description;
          }
          const wl = watchLevel(c);
          return `${c.description} (current ${fmtCov(c, c.current_value)}${wl!==null?`, watch at ${fmtCov(c, wl)}`:''}, threshold ${fmtCov(c, c.threshold)})`;
        }).join('; ')}</div>`
      : '';
    let vsLastCell;
    if (d.priorComputedWorst === null) {
      vsLastCell = '<span style="color:var(--muted);font-size:11px">No prior data</span>';
    } else if (d.changed) {
      vsLastCell = `<div>
          <div style="font-size:11px;font-weight:700;color:var(--ink);margin-bottom:3px">Status Change</div>
          <div style="display:flex;align-items:center;gap:5px;white-space:nowrap;font-size:11px">
            <span style="color:var(--muted)">was</span>
            <span class="pill ${statusClass(d.priorComputedWorst)}">${statusLabel(d.priorComputedWorst)}</span>
            <span style="color:var(--muted)">&rarr; now</span>
            <span class="pill ${statusClass(d.computedWorst)}">${statusLabel(d.computedWorst)}</span>
          </div>
          ${driverNote}
        </div>`;
    } else {
      vsLastCell = '<span style="color:var(--muted);font-size:11px">No change since last period</span>';
    }
    rows += `<tr class="deal-row" onclick="toggleDeal(${i})">
      <td><span class="chev" id="chev-${i}">▶</span>${shortDealName(d.deal_name)}</td>
      <td><span class="pill ${statusClass(d.computedWorst)}">${statusLabel(d.computedWorst)}</span></td>
      <td>${(() => {
        // Every ratio still worth watching -- not just the single
        // tightest. A deal can have two or three tests all close to
        // their limits at once, and showing only #1 hid that. The
        // primary (tightest) ratio always shows in full with its
        // sparkline; any OTHER ratio within the same watch buffer used
        // for the WATCH status elsewhere on this dashboard (or already
        // over its limit) is listed underneath in compact form, so
        // "tight" means the same thing here as it does in the status
        // pills -- it moves with the watch-threshold slider.
        const hist = d.ratio_history || [];
        const MAP = [
          [['interest coverage'], 'interest_coverage_ratio', 'Interest Coverage Ratio'],
          [['leverage ratio', 'debt to equity', 'debt-to-equity', 'debt/equity', 'debt / equity'], 'debt_equity_ratio', d.leverageLabel],
          [['delinquency ratio'], 'delinquency_ratio_pct', 'Delinquency Ratio'],
          [['three month loss', 'rolling three'], 'rolling_3month_loss_ratio_pct', 'Rolling 3-Month Loss Ratio'],
          [['twelve month loss', 'rolling twelve'], 'rolling_12month_loss_ratio_pct', 'Rolling 12-Month Loss Ratio'],
          [['cnl ratio', 'cumulative net loss'], 'cnl_ratio_pct', 'CNL Ratio (Cumulative Net Loss)'],
          [['rvl ratio', 'residual value'], 'rvl_ratio_pct', 'RVL Ratio (Residual Value)'],
          [['loss ratio'], 'loss_ratio_pct', 'Loss Ratio'],
          // Dollar-denominated equity tests: named after the measure, plus
          // whose equity it is when the test names a specific entity (TLFC:
          // "Total Equity of TAG", "...of the Performance Guarantor"), not
          // the first words of the covenant question.
          [['tangible net worth'], 'total_equity', 'Tangible Net Worth'],
          [['total equity'], 'total_equity', desc => {
            const o = /total equity of (?:the )?([A-Za-z][A-Za-z .&'-]*?)\s+(?:less|in excess|of at least|equal|greater)\b/i.exec(desc || '');
            if (!o) return 'Total Equity';
            const who = o[1].trim().replace(/^performance guarantor$/i, 'Perf. Guarantor');
            return `Total Equity (${who})`;
          }],
          [['deferred account'], null, 'Deferred Account'],
        ];
        const candidates = [];
        for (const c of (d.computedCovenants || [])) {
          if (c.threshold === null || c.threshold === undefined || c.current_value === null || c.current_value === undefined) continue;
          if (c.utilization_pct === null || c.utilization_pct === undefined) continue;
          const desc = (c.description || '').toLowerCase();
          const m = MAP.find(([kws]) => kws.some(k => desc.includes(k)));
          // Name for the label: mapped short name, else a trimmed version of
          // the covenant's own wording (Meridian OneCap's "Portfolio
          // Charge-Off Ratio (3 Month Rolling Average)" etc.), so a deal
          // still shows WHICH covenant is tightest even when no 12-month
          // series exists to draw.
          const name = m ? (typeof m[2] === 'function' ? m[2](c.description) : m[2]) : (c.description || '').replace(/^has the\s+/i, '').replace(/\s+(exceeded|at any time|been).*$/i, '').replace(/^portfolio\s+/i, '').replace(/\s*\([^)]*\)/g, '').trim().slice(0, 28);
          const vals = (m && m[1]) ? hist.map(r => r[m[1]]).filter(v => v !== undefined && v !== null) : [];
          const isPctGuess = (m && m[1]) ? m[1].endsWith('_pct') : covUnit(c) === 'pct';
          candidates.push({c, name, vals, util: c.utilization_pct, isPct: isPctGuess});
        }
        if (!candidates.length) return '<span style="color:var(--muted);font-size:10px">n/a</span>';
        candidates.sort((a, b) => b.util - a.util);
        const primary = candidates[0];
        // Same "within the buffer, or over" test the WATCH status itself
        // uses -- co-located ratios beyond the primary that also qualify.
        const also = candidates.slice(1).filter(x => x.util >= (1 - bufferFrac));
        const fmtOne = (x) => {
          const over = x.util >= 1;
          const withinBuffer = x.util >= (1 - bufferFrac);
          const color = over ? 'var(--breach)' : withinBuffer ? 'var(--watch)' : 'var(--muted)';
          const fmtV = v => x.isPct ? fmtPct(v, 2) : covUnit(x.c) === 'dollar' ? fmtMoney(v) : `${v.toFixed(2)}x`;  // dollar-denominated tests (e.g. Total Equity) shown as money, not as a ratio
          return {color, fmtV, withinBuffer};
        };
        const p = fmtOne(primary);
        // When nothing is within the watch buffer, the tightest ratio is
        // still shown (never "N/A") -- checked against real portfolio
        // data before deciding this: at the default 10% buffer, 10 of 12
        // deals across both programs would show N/A, including Essex at
        // 89% (one point from watch) and Stride at 77% (the deal this
        // column specifically exists to surface). Hiding those behind
        // "N/A" would make an early-warning column empty for almost the
        // whole portfolio most months -- the opposite of its purpose.
        // Muted color and no "% of limit" callout instead of hiding it
        // outright: still visible for spotting a ratio drifting toward
        // its limit over successive months, without implying urgency
        // that isn't there yet.
        // No sparkline when there's no series -- and no note saying so; an
        // absent chart is self-explanatory and the note was clutter.
        const spark = primary.vals.length >= 3
          ? sparklineSVG(primary.vals, {width: 96, height: 22, threshold: primary.c.threshold, kind: primary.c.kind})
          : '';
        // Font sizes matched to the Current Status pill beside this column
        // (11.5px / 600): every ratio NAME, primary or secondary, is
        // 11.5px/600, and every figure line is one size (9.5px, mono).
        // Previously four sizes coexisted in this one cell (11 / 10 /
        // 9.5 / 9) with names at 700 -- measured, not eyeballed.
        const NAME_STYLE = 'font-size:11.5px;font-weight:600;';
        const FIG_STYLE = "font-size:9.5px;font-family:'IBM Plex Mono',monospace;";
        const alsoHtml = also.slice(0, 2).map(x => {
          const q = fmtOne(x);
          return `<div style="display:flex;align-items:baseline;gap:6px;margin-top:4px;padding-top:4px;border-top:1px solid var(--line)" title="${x.name}: ${q.fmtV(x.c.current_value)} now vs. ${isFloorTest(x.c) ? `required minimum ${q.fmtV(x.c.threshold)} (${floorHeadroom(x.c.current_value, x.c.threshold, true)})` : `limit ${q.fmtV(x.c.threshold)} (${fmtPct(x.util, 0)} of the way)`}.">
            <span style="${NAME_STYLE}color:${q.color}">${x.name}</span><span style="${FIG_STYLE}color:${q.color}">${isFloorTest(x.c) ? floorHeadroom(x.c.current_value, x.c.threshold) : `${fmtPct(x.util, 0)} of limit`}</span>
          </div>`;
        }).join('');
        const overflow = also.length > 2 ? `<div style="${FIG_STYLE}color:var(--muted);margin-top:3px">+${also.length - 2} more within watch range</div>` : '';
        // When more than one ratio is within the watch buffer, say so up
        // front with a count badge beside the primary name ("+1 more"),
        // in the same color as the worst of the secondaries -- a stacked
        // list under a faint divider was easy to read as one item.
        const worstAlsoColor = also.length ? fmtOne(also[0]).color : null;
        const countBadge = also.length ? `<span style="font-size:9px;font-weight:600;padding:1px 6px;border-radius:9px;border:1px solid ${worstAlsoColor};color:${worstAlsoColor};white-space:nowrap" title="${also.length + 1} ratios within the watch buffer on this deal">+${also.length} more</span>` : '';
        return `<div style="min-width:130px;white-space:nowrap" title="${primary.name}: ${p.fmtV(primary.c.current_value)} now vs. ${isFloorTest(primary.c) ? `required minimum ${p.fmtV(primary.c.threshold)} (${floorHeadroom(primary.c.current_value, primary.c.threshold, true)})` : `limit ${p.fmtV(primary.c.threshold)} (${fmtPct(primary.util, 0)} of the way)`}.${primary.vals.length >= 3 ? ' 12-month trend; dashed line = covenant limit.' : ''}${p.withinBuffer ? '' : ' Comfortably within limit -- not currently on watch.'}${also.length ? ` Plus ${also.length} more ratio(s) within watch range.` : ''}">
          <div style="display:flex;align-items:baseline;gap:6px"><span style="${NAME_STYLE}color:${p.color}">${primary.name}</span>${countBadge}</div>
          ${spark}
          <div style="${FIG_STYLE}color:var(--muted)">${p.fmtV(primary.c.current_value)} vs ${p.fmtV(primary.c.threshold)}${isFloorTest(primary.c) ? ` min (${floorHeadroom(primary.c.current_value, primary.c.threshold)})` : ` (${fmtPct(primary.util, 0)} of limit)`}</div>
          ${alsoHtml}${overflow}
        </div>`;
      })()}</td>
      <td>${vsLastCell}</td>
      <td class="num num">${tb.by_currency ? currencyBreakdownCell(tb.by_currency.cad_closing, tb.by_currency.usd_closing_raw, tb.by_currency.usd_closing_cad_equivalent, tb.closing) : fmtMoney(tb.closing)}</td>
      <td class="num num" style="color:${tb.change_abs<0?'var(--breach)':'var(--ok)'}">${fmtMoney(tb.change_abs)} (${fmtPct(tb.change_pct,1)})</td>
      <td class="num num">${ta.by_currency ? currencyBreakdownCell(ta.by_currency.cad_closing, ta.by_currency.usd_closing_raw, ta.by_currency.usd_closing_cad_equivalent, ta.by_currency.total_cad_equivalent) : ((ta.closing!==null&&ta.closing!==undefined)?fmtMoney(ta.closing):'n/a')}</td>
      <td class="num num">${(ta.opening!==null&&ta.opening!==undefined&&ta.closing!==null&&ta.closing!==undefined)?(()=>{const delta=ta.closing-ta.opening,p=ta.opening?delta/ta.opening:null;return `<span style="color:${delta<0?'var(--breach)':'var(--ok)'}">${delta===0?'-':`${fmtMoney(delta)}${p!==null?` (${fmtPct(p,1)})`:''}`}</span>`;})():'n/a'}</td>
      <td class="num num">${(!ct.opening && !ct.closing) ? 'N/A' : fmtNum(ct.closing)}</td>
      <td class="num num" ${(!ct.opening && !ct.closing) ? '' : `style="color:${ct.change_abs<0?'var(--breach)':'var(--ok)'}"`}>${(!ct.opening && !ct.closing) ? 'N/A' : `${ct.change_abs>0?'+':''}${ct.change_abs}`}</td>
      <td class="num num group-start">${(d.total_enhancement && d.total_enhancement.total_enhancement_amount!==null && d.total_enhancement.total_enhancement_amount!==undefined) ? fmtMoney(d.total_enhancement.total_enhancement_amount) : 'n/a'}</td>
      <td class="num num">${(d.total_enhancement && d.total_enhancement.total_enhancement_pct!==null && d.total_enhancement.total_enhancement_pct!==undefined) ? fmtPct(d.total_enhancement.total_enhancement_pct,2) : 'n/a'}</td>
      ${(() => {
        // Deals with a warehouse facility: the program limit shown is the
        // max facility limit (term + warehouse share one limit), with the
        // warehouse amount outstanding in brackets underneath.
        const p = d.program || {}, w = d.warehouse || {};
        const hasWH = !!(w.maximum_warehouse_facility_limit && p.maximum_program_limit);
        if (!hasWH) return `<td class="num num group-start">${p.program_limit ? fmtMoney(p.program_limit) : 'n/a'}</td>`;
        const wh = w.closing_advances_outstanding || 0;
        return `<td class="num num group-start" title="Max program (facility) limit, shared by the term and warehouse facilities. Warehouse advances outstanding: ${wh ? fmtMoney(wh) : '$0'}.">${fmtMoney(p.maximum_program_limit)}<div style="font-size:9.5px;color:var(--muted);white-space:nowrap">(WH ${wh ? fmtMoney(wh) : '$0'})</div></td>`;
      })()}
      <td class="num num">${progUtilCell(d)}</td>
      <td class="num num">${d.warehouse && d.warehouse.opening_advances_outstanding!==null && d.warehouse.opening_advances_outstanding!==undefined ? fmtMoney(d.warehouse.opening_advances_outstanding) : 'n/a'}</td>
      <td class="num num">${d.warehouse && d.warehouse.closing_advances_outstanding!==null && d.warehouse.closing_advances_outstanding!==undefined ? fmtMoney(d.warehouse.closing_advances_outstanding) : 'n/a'}</td>
      <td class="num num">${(()=>{ if(!d.warehouse||d.warehouse.opening_advances_outstanding===null||d.warehouse.opening_advances_outstanding===undefined||d.warehouse.closing_advances_outstanding===null||d.warehouse.closing_advances_outstanding===undefined) return 'n/a'; const delta=d.warehouse.closing_advances_outstanding-d.warehouse.opening_advances_outstanding, p=d.warehouse.opening_advances_outstanding?delta/d.warehouse.opening_advances_outstanding:null; return `<span style="color:${delta<0?'var(--breach)':delta>0?'var(--ok)':'var(--muted)'}">${delta===0?'-':`${fmtMoney(delta)}${p!==null?` (${fmtPct(p,1)})`:''}`}</span>`; })()}</td>
      <td class="num num print-hide">${d.warehouse && d.warehouse.maximum_warehouse_facility_limit ? fmtMoney(d.warehouse.maximum_warehouse_facility_limit) : 'n/a'}</td>
      <td class="num num print-hide">${d.program && d.program.maximum_program_limit ? fmtMoney(d.program.maximum_program_limit) : 'n/a'}</td>
    </tr>`;
    const flagged = d.computedCovenants.filter(c => c.status !== 'OK');

    const cnlByPeriod = d.cnl_by_period || [];
    // A deal with a full per-vintage CNL breakdown (see cnlByPeriodPanel
    // below) shouldn't also show a single "CNL Ratio" tile here -- one
    // number can only ever be a reduction (worst vintage, an average,
    // whatever) of what the full table already shows correctly and
    // completely, so showing both invites exactly the "why does this
    // number not match" confusion this is meant to avoid.
    // CNL Ratio now gets its own card (worst vintage vs the covenant
    // limit) -- previously suppressed whenever the per-vintage table was
    // shown, on the grounds the table carried it. The card is the quick
    // read; the table is the breakdown.
    const ratios = (d.financial_ratios || []);
    // Monthly Delinquency Ratio (Moneda, Stride) has no covenant test of
    // its own -- extract_financial_ratios() only builds tiles from
    // triggered tests, so this metric never appears there no matter what.
    // Synthesized directly from the latest ratio_history row instead,
    // rather than pretending it has a covenant behind it. Absent (no
    // tile) for every deal that doesn't report this field.
    const latestHist = (d.ratio_history && d.ratio_history.length) ? d.ratio_history[d.ratio_history.length - 1] : null;
    if (latestHist && latestHist.monthly_delinquency_ratio_pct !== undefined && latestHist.monthly_delinquency_ratio_pct !== null) {
      const monthlyTile = {key: 'monthly_delinquency_ratio', label: 'Monthly Delinquency Ratio',
                           value: latestHist.monthly_delinquency_ratio_pct, format: 'pct', group: 'Portfolio Performance'};
      // Inserted right after "Delinquency Ratio" (not appended at the end
      // of the group) so the two related figures sit next to each other,
      // with Rolling 3-Month Loss Ratio immediately following -- falls
      // back to appending at the end only if that tile is somehow absent.
      const afterIdx = ratios.findIndex(r => r.label === 'Delinquency Ratio');
      if (afterIdx === -1) ratios.push(monthlyTile);
      else ratios.splice(afterIdx + 1, 0, monthlyTile);
    }
    const fmtRatioValue = (r) => r.format === 'pct' ? fmtPct(r.value, 2)
      : r.format === 'dollar' ? fmtMoney(r.value)
      : `${r.value.toFixed(2)}x`;
    // Leverage and Total Equity specifically get their limit and a
    // pass/fail test shown right on the tile, not just the bare current
    // value -- looked up from this deal's own covenant test (by keyword,
    // matching how the Ratio Watchlist already finds these) rather than
    // hardcoded, so a deal with no such covenant (Xpedite's own Leverage
    // Ratio/Total Equity tests have no underlying value to test against
    // at all, confirmed directly against its source) simply shows the
    // bare tile as before.
    // Deliberately NOT including monthly_delinquency_ratio_pct here --
    // that metric has no covenant test of its own on any deal (confirmed
    // earlier this session), only the regular Delinquency Ratio does, so
    // adding a limit/test column for it would imply a trigger that
    // doesn't exist in any report.
    const LIMIT_TILE_KEYS = {debt_equity_ratio: ['leverage ratio', 'debt/equity', 'debt / equity'], total_equity: ['total equity', 'tangible net worth'], cnl_ratio: ['cnl ratio', 'cumulative net loss'], interest_coverage_ratio: ['interest coverage ratio'], loss_ratio_pct: ['loss ratio'], loss_ratio: ['loss ratio'], rvl_ratio_pct: ['rvl ratio', 'residual value'], rvl_ratio: ['rvl ratio', 'residual value'], delinquency_ratio: ['delinquency ratio'], deemed_default_ratio: ['deemed default ratio'], charge_off_ratio: ['charge-off ratio', 'charge off ratio'],
      delinquency_ratio_pct: ['delinquency ratio'], rolling_3month_loss_ratio_pct: ['three month loss', 'rolling three'],
      rolling_12month_loss_ratio_pct: ['twelve month loss', 'rolling twelve'],
      // Same additions as above, but under the KPI tiles' own (non-"_pct"
      // suffixed) key names from RATIO_LABELS in aggregate_deals.py --
      // the tiles and the 12-month table read this same lookup object
      // but key their own ratios differently, so both forms are needed.
      delinquency_ratio: ['delinquency ratio'], loss_ratio: ['loss ratio'],
      rolling_3month_loss_ratio: ['three month loss', 'rolling three'],
      rolling_12month_loss_ratio: ['twelve month loss', 'rolling twelve']};
    // Keys whose generic keyword could also match a more specific test on
    // some deal: a bare "loss ratio" must not pick up "rolling three month
    // loss ratio" or "cumulative net loss ratio". Exclusions apply per key.
    const LIMIT_TILE_EXCLUDE = {loss_ratio_pct: ['rolling', 'three', 'twelve', 'cumulative'], loss_ratio: ['rolling', 'three', 'twelve', 'cumulative'], rvl_ratio_pct: ['rolling', 'cumulative'], rvl_ratio: ['rolling', 'cumulative']};
    // delinquency_ratio/deemed_default_ratio/charge_off_ratio need no
    // exclusions -- these are Meridian OneCap's own metric names, specific
    // enough ("deemed default ratio", "charge-off ratio") not to collide
    // with any other deal's rolling/cumulative tests.
    // A deal can test the same underlying ratio twice -- a lookback test
    // ("...this Collection Period or any of the preceding N Collection
    // Periods...", whose current_value is a window MAX, not this period's
    // figure) and a plain current-period test. The tile shows THIS
    // period's value (see aggregate_deals.py's extract_financial_ratios,
    // which applies the same preference when choosing the tile's number)
    // -- so its limit must come from the SAME test, not whichever test a
    // bare keyword search happens to hit first. Non-lookback tests are
    // tried first; a lookback test is only used as a last resort, when no
    // plain test for that ratio exists at all.
    const isLookback = (desc) => /preceding\s+\w+\s+collection\s+periods/i.test(desc);
    // Short label for a covenant TEST, from its own text -- not from
    // category/is_lookback_test(), which both assign the SAME category to
    // two genuinely different tests on some deals (Meridian OneCap: "Has
    // the Portfolio Delinquency Ratio exceeded the LOCK-UP TRIGGER of
    // 2.00%?" and "...exceeded the EVENT OF DEFAULT TRIGGER of 3.00%?"
    // both carry category='Event of Termination', since neither matches
    // the specific "preceding N collection periods" wording
    // is_lookback_test() looks for). Checked directly against the test's
    // own wording instead, which is unambiguous on every deal seen so far.
    const CATEGORY_SHORT = {'Event of Termination': 'EoT', 'Lock-Up Event': 'Lock-Up'};
    const shortCat = (desc, category) => {
      // Try the test's own wording first (Meridian OneCap: "...the
      // Lock-Up Trigger of 2.00%?" / "...the Event of Default Trigger of
      // 3.00%?" -- explicit in the sentence). Fall back to the computed
      // category (Finloc/TLFC: "Does the Delinquency Ratio exceed...this
      // Collection Period or any of the preceding five..." carries NO
      // "lock-up"/"event of" wording at all -- is_lookback_test() is the
      // only thing that tells these two tests apart for those deals).
      const t = (desc || '').toLowerCase();
      if (t.includes('lock-up')) return 'Lock-Up';
      if (t.includes('event of default')) return 'EoD';
      if (t.includes('event of termination')) return 'EoT';
      // VCC IV LP only: its own single-threshold tests (LSA SRE (k)
      // through (p) -- Loss Ratio, CNL, Delinquency, ICR, Leverage, Total
      // Equity) were all defaulted to category 'Event of Termination' by
      // is_lookback_test()'s own fallback, but that wording never appears
      // anywhere in this deal's own source -- confirmed directly: "Event
      // of Termination" has zero occurrences in VCC IV's report, while
      // "Event of Default" appears (for a different covenant, about the
      // Performance Guarantee) -- this deal's own documents use "Event of
      // Default" as the operative term, not "Event of Termination".
      if (category === 'Event of Termination' && EOD_DEAL_SLUGS.includes(d.deal_slug)) return 'EoD';
      return CATEGORY_SHORT[category] || '';
    };
    // Every limit on a metric, loosest first for display order handled by
    // the caller -- a ratio can be tested twice at two different levels
    // (TLFC: Lock-Up 1.00% and Event of Termination 1.50% on Delinquency).
    const findCovenantsFor = (keywords, excludes) => {
      const seen = new Set();
      return (d.covenants || []).filter(c => {
        const desc = (c.description || '').toLowerCase();
        return c.threshold !== null && c.threshold !== undefined &&
          keywords.some(k => desc.includes(k)) && !(excludes || []).some(x => desc.includes(x));
      }).filter(c => { if (seen.has(c.threshold)) return false; seen.add(c.threshold); return true; })
        .sort((a, b) => a.threshold - b.threshold);
    };
    const findCovenantFor = (keywords, excludes) => {
      const matches = (d.covenants || []).filter(c => {
        const desc = (c.description || '').toLowerCase();
        return c.threshold !== null && c.threshold !== undefined &&
          keywords.some(k => desc.includes(k)) && !(excludes || []).some(x => desc.includes(x));
      });
      if (!matches.length) return undefined;
      // Primary = the LOOSER limit (highest threshold for a ceiling test):
      // every dual-threshold case seen so far (Finloc/TLFC's EoT vs
      // Lock-Up, Meridian's EoD vs Lock-Up) has the "more severe event"
      // test at a higher number than the earlier-warning Lock-Up test, so
      // this one rule covers both without depending on category naming,
      // which isn't consistent across deals.
      return matches.reduce((best, c) => (best === undefined || c.threshold > best.threshold) ? c : best, undefined);
    };
    // Genuinely second test on the SAME ratio: a different threshold
    // value from the primary (a covenant that merely restates the
    // primary at the same number is not a second limit). Deliberately
    // NOT requiring a different category -- Meridian OneCap's own two
    // tests share one category despite being genuinely different limits.
    const findSecondCovenantFor = (keywords, excludes, primary) => {
      if (!primary) return null;
      const matches = (d.covenants || []).filter(c => {
        const desc = (c.description || '').toLowerCase();
        return c.threshold !== null && c.threshold !== undefined &&
          keywords.some(k => desc.includes(k)) && !(excludes || []).some(x => desc.includes(x));
      });
      return matches.find(c => c !== primary && c.threshold !== primary.threshold) || null;
    };
    const statTile = (label, value, r) => {
      const kws = r ? LIMIT_TILE_KEYS[r.key] : null;
      const cov = kws ? findCovenantFor(kws, r ? LIMIT_TILE_EXCLUDE[r.key] : null) : null;
      const cov2 = (kws && cov) ? findSecondCovenantFor(kws, r ? LIMIT_TILE_EXCLUDE[r.key] : null, cov) : null;
      // All three TLFC entities (not just Loans -- corrected after
      // checking, since an earlier turn this session wrongly assumed
      // Leases/LP had a Lock-Up pair for these three tests too, which
      // was never true): ICR, Debt/Equity Ratio, and Total Equity/TAG
      // are single-threshold on every one of them -- confirmed directly,
      // no separate Lock-Up version exists in the source for any of the
      // nine (3 tests x 3 entities), category "Event of Termination"
      // throughout. The general rule (only label EoT/Lock-Up when a
      // second threshold exists to tell them apart) would otherwise
      // leave all nine as a bare "Limit X" with no category shown.
      // TPine Leasing added: its own Portfolio Performance tests
      // (Delinquency, Rolling 3-Mo/12-Mo Loss Ratio) are also single-
      // threshold, category "Event of Termination" throughout --
      // confirmed directly, same reasoning as the TLFC family above.
      // VCC IV LP added: its own single-threshold tests, same reasoning
      // as TLFC/TPine above -- category alone would otherwise leave them
      // unlabelled, and here it would in fact be wrong (see shortCat's
      // own VCC IV override: this deal's source uses "Event of Default",
      // confirmed directly, not "Event of Termination" the category
      // field defaults to).
      const forceEoTLabel = ['move-trust-essex-lease-financial-corp', 'move-trust-tlfc-leases', 'move-trust-tlfc-loans', 'move-trust-tlfc-lp-leases', 'move-trust-tpine-leasing-capital-corporation', 'move-trust-vcc-iv-lp', 'f-pil-2-0-stride-capital', 'f-pil-2-0-xpedite-leasing', 'f-pil-2-0-moneda-capital-corp'].includes(d.deal_slug) && cov && !cov2;
      if (!cov) {
        return `<div style="background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:10px 12px">
        <div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.02em;margin-bottom:5px;line-height:1.3">${label}</div>
        <div class="num" style="font-weight:700;font-size:19px;letter-spacing:-.01em">${value}</div>
      </div>`;
      }
      const fmtLim = v => r.format === 'dollar' ? fmtMoney(v) : r.format === 'pct' ? fmtPct(v, 2) : `${v.toFixed(2)}x`;
      const pass = cov.status !== 'BREACH';
      return `<div style="background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
          <div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.02em;margin-bottom:5px;line-height:1.3">${label}</div>
          <div style="text-align:right;flex-shrink:0">
            <span class="pill ${pass ? 'OK' : 'BREACH'}" title="Within limit? ${pass ? 'Yes' : 'No'} -- current ${value} vs. ${isFloorTest(cov) ? `minimum ${fmtLim(cov.threshold)} (${floorHeadroom(cov.current_value, cov.threshold, true)})` : `limit ${fmtLim(cov.threshold)}`}.">${pass ? 'Yes' : 'No'}</span>
            <div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.02em;margin-top:2px">within limit?</div>
          </div>
        </div>
        <div class="num" style="font-weight:700;font-size:19px;letter-spacing:-.01em">${value}</div>
        ${r.vintage ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">Worst Vintage: <b style="color:var(--ink)">${r.vintage}</b></div>` : ''}
        ${cov2 ? `<div style="font-size:10px;color:var(--muted);font-family:'IBM Plex Mono',monospace;margin-top:3px">${shortCat(cov2.description, cov2.category)} ${isFloorTest(cov2) ? 'Minimum' : 'Limit'} ${fmtLim(cov2.threshold)}</div>` : ''}
        <div style="font-size:10px;color:var(--muted);font-family:'IBM Plex Mono',monospace${cov2?'':';margin-top:3px'}">${(cov2 || forceEoTLabel) ? `${shortCat(cov.description, cov.category)} ${isFloorTest(cov) ? 'Minimum' : 'Limit'} ${fmtLim(cov.threshold)}` : `${isFloorTest(cov) ? 'Minimum' : 'Limit'} ${fmtLim(cov.threshold)}`}</div>
      </div>`;
    };
    // total_equity's label comes from the Python side (aggregate_deals.py's
    // RATIO_LABELS, generically "Total Equity" for every deal) -- overridden
    // here with this deal's own name, same reasoning and same per-deal
    // check as leverageLabel/totalEquityLabel above.
    const tileLabel = (r) => r.key === 'total_equity' ? d.totalEquityLabel : r.label;
    const ratioTiles = ratios.map(r => statTile(tileLabel(r), fmtRatioValue(r), r)).join('');
    const ratioGroups = {};
    ratios.forEach(r => { (ratioGroups[r.group] = ratioGroups[r.group] || []).push(r); });
    const BORROWER_GROUP = 'Borrower Data and Financial Ratios';
    const tileGroupHtml = ([group, items]) => `
        <div style="margin-bottom:18px">
          <div style="font-size:10.5px;text-transform:uppercase;color:var(--muted);letter-spacing:.03em;margin-bottom:8px;font-weight:600">${group === BORROWER_GROUP ? borrowerGroupDisplayLabel : group}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:12px">
            ${items.map(r => statTile(tileLabel(r), fmtRatioValue(r), r)).join('')}
          </div>
        </div>`;
    // Panel flow is Portfolio Performance -> Cumulative Net Losses ->
    // Borrower Data. The Borrower Data tile group is split out here so it
    // can be placed after the CNL section, alongside its own 12-month
    // table and trend chart, rather than above them with the pool-level
    // tiles.
    const CNL_GROUP = 'Cumulative Net Losses';
    // Meridian OneCap only: its own three portfolio-level tests
    // (Delinquency/Deemed Default/Charge-Off Ratio, each a Lock-Up vs
    // Event of Default pair) are tested against the SAME aggregate
    // tranches the CNL Ratio section covers, not the pool-level
    // Portfolio Performance group they'd otherwise sit in. Pulled out by
    // key (not by group, since they already share the group with
    // whatever else is in "Portfolio Performance" on this deal) and
    // rendered as their own tile group after the CNL table instead.
    // Defined here (before first use) rather than near where it's also
    // needed for the panel-ordering branch below -- a const referenced
    // before its own declaration in the same scope throws, the same
    // mistake made earlier this session with hasChargeOff/lossesLabel.
    const isMeridianOneCap = d.deal_slug === 'move-trust-meridian-onecap-lp';
    // TLFC family only: their own source page is titled "Servicer Data
    // and Financial Ratios", never "Borrower Data" -- confirmed directly
    // in the PDF (the table of contents itself: "Pg. 15 Servicer Data and
    // Financial Ratios"). The internal BORROWER_GROUP key stays unchanged
    // (used for matching/filtering throughout this function); only the
    // on-screen text changes for these three deals.
    const isTLFCFamily = ['move-trust-tlfc-leases', 'move-trust-tlfc-loans', 'move-trust-tlfc-lp-leases'].includes(d.deal_slug);
    // TLFC Loans only: its own table of contents reads "SELLER DATA, AND
    // FINANCIAL RATIOS" -- confirmed directly, different wording from the
    // other two TLFC entities' "Servicer Data and Financial Ratios".
    const isTLFCLoans = d.deal_slug === 'move-trust-tlfc-loans';
    const borrowerGroupDisplayLabel = isTLFCLoans ? 'Seller Data and Financial Ratios'
      : isTLFCFamily ? 'Servicer Data and Financial Ratios' : 'Borrower Data and Financial Ratios';
    const AGGREGATE_TRANCHE_KEYS = ['delinquency_ratio', 'deemed_default_ratio', 'charge_off_ratio'];
    const isAggregateTrancheRatio = (r) => isMeridianOneCap && AGGREGATE_TRANCHE_KEYS.includes(r.key);
    const ratioTilesGrouped = Object.entries(ratioGroups)
      .filter(([g]) => g !== BORROWER_GROUP && g !== CNL_GROUP)
      .map(([g, items]) => [g, items.filter(r => !isAggregateTrancheRatio(r))])
      .filter(([, items]) => items.length)
      .map(tileGroupHtml).join('');
    const aggregateTrancheItems = isMeridianOneCap ? (ratioGroups['Portfolio Performance'] || []).filter(isAggregateTrancheRatio) : [];
    const aggregateTrancheTiles = aggregateTrancheItems.length
      ? `<div style="margin-top:18px">${tileGroupHtml(['Portfolio Delinquency, Deemed Default and Charge-Off Ratios (Aggregate Tranches)', aggregateTrancheItems])}</div>`
      : '';
    // The CNL card (worst vintage vs the deal's own trigger) sits directly
    // above the CNL-by-advance-period table it summarises, not up with the
    // pool-level tiles -- same tiles -> table -> chart unit as the other
    // two sections.
    // Tile groups carry a bottom margin only -- fine when they follow the
    // "Financial Ratios" header, but these two now follow a collapsible
    // toggle and a table respectively, leaving 0px above them (measured)
    // against 18px everywhere else in the panel. Wrapped to match.
    const spaced = (html) => html ? `<div style="margin-top:18px">${html}</div>` : '';
    const cnlTiles = spaced(Object.entries(ratioGroups).filter(([g]) => g === CNL_GROUP).map(tileGroupHtml).join(''));
    const borrowerTiles = spaced(Object.entries(ratioGroups).filter(([g]) => g === BORROWER_GROUP).map(tileGroupHtml).join(''));

    // --- Multi-period balance history (from separately uploaded monthly
    // reports on file for this deal). Diff colors compare each period's
    // value to the PRIOR chronological period (computed before reversing
    // for most-recent-first display) -- red for a decrease, green for an
    // increase, matching the same convention used everywhere else on this
    // dashboard. ---
    const periodHistChrono = d.period_history || [];
    const diffColor = (curr, prev) => (prev===null||prev===undefined||curr===null||curr===undefined) ? ''
      : curr < prev ? 'var(--breach)' : curr > prev ? 'var(--ok)' : '';
    const periodHistDisplay = periodHistChrono.map((p, idx) => {
      const prev = periodHistChrono[idx - 1];
      return {...p,
        openBalColor: prev ? diffColor(p.opening_balance, prev.opening_balance) : '',
        closeBalColor: prev ? diffColor(p.closing_balance, prev.closing_balance) : '',
        openAmtColor: prev ? diffColor(p.opening_amount, prev.opening_amount) : '',
        closeAmtColor: prev ? diffColor(p.closing_amount, prev.closing_amount) : ''};
    }).reverse();  // most recent period first
    const colTd = (val, color, extraClass) => `<td class="num${extraClass?' '+extraClass:''}"${color?` style="color:${color}"`:''}>${val!==null&&val!==undefined?fmtMoney(val):'n/a'}</td>`;
    const changeTd = (opening, closing) => {
      if (opening === null || opening === undefined || closing === null || closing === undefined) return '<td class="num">n/a</td>';
      const delta = closing - opening;
      const color = delta < 0 ? 'var(--breach)' : delta > 0 ? 'var(--ok)' : 'var(--muted)';
      return `<td class="num" style="color:${color}">${fmtMoney(delta)}</td>`;
    };
    // Dual-currency deals (Finloc): each activity cell breaks out CAD /
    // USD / USD-as-CAD / Total, the same four-row presentation the Balance
    // and Amount cells already use -- the figures come from the same two
    // sets of pages. Single-currency deals keep the plain figure.
    const activityTd = (val, extraClass, p, key) => {
      const abc = p && p.activity_by_currency;
      if (abc && abc.CAD && abc.USD) {
        const cad = abc.CAD[key], usd = abc.USD[key], usdEq = abc.USD_cad_equivalent ? abc.USD_cad_equivalent[key] : null;
        return `<td class="num${extraClass?' '+extraClass:''}">${currencyBreakdownCell(cad, usd, usdEq, val)}</td>`;
      }
      return `<td class="num${extraClass?' '+extraClass:''}">${val!==null&&val!==undefined?fmtMoney(val):'n/a'}</td>`;
    };
    // Same red-means-decreased / green-means-increased convention as the
    // Balance/Amount Change columns, just formatted as a plain count
    // (fmtNum) rather than a dollar figure.
    const changeCountTd = (opening, closing) => {
      if (opening === null || opening === undefined || closing === null || closing === undefined) return '<td class="num">n/a</td>';
      const delta = closing - opening;
      const color = delta < 0 ? 'var(--breach)' : delta > 0 ? 'var(--ok)' : 'var(--muted)';
      return `<td class="num" style="color:${color}">${delta > 0 ? '+' : ''}${fmtNum(delta)}</td>`;
    };
    const closeBalCell = (p) => p.by_currency
      ? `<td class="num">${currencyBreakdownCell(p.by_currency.cad_closing, p.by_currency.usd_closing_raw, p.by_currency.usd_closing_cad_equivalent, p.closing_balance, p.closeBalColor)}</td>`
      : colTd(p.closing_balance, p.closeBalColor);
    const closeAmtCell = (p) => p.amount_by_currency
      ? `<td class="num">${currencyBreakdownCell(p.amount_by_currency.cad_closing, p.amount_by_currency.usd_closing_raw, p.amount_by_currency.usd_closing_cad_equivalent, p.amount_by_currency.total_cad_equivalent, p.closeAmtColor)}</td>`
      : colTd(p.closing_amount, p.closeAmtColor);
    // Balances by period: ONE table whose first row is the current period
    // (always visible, highlighted). The toggle below it reveals the prior
    // periods as extra rows in the same table, so no period or header is ever
    // shown twice.
    const histHead = `<thead>
            <tr><th rowspan="2" style="vertical-align:bottom">Period</th><th colspan="3" class="group-start" style="text-align:center;border-bottom:1px solid var(--line)">${BALANCE_LABEL}</th><th colspan="${d.hasChargeOff ? 6 : 5}" class="group-start" style="text-align:center;border-bottom:1px solid var(--line)">Period Activity</th><th colspan="3" class="group-start" style="text-align:center;border-bottom:1px solid var(--line)">${AMOUNT_LABEL}</th><th colspan="3" class="group-start" style="text-align:center;border-bottom:1px solid var(--line)">Contracts</th></tr>
            <tr><th class="num">Opening</th><th class="num">Closing</th><th class="num">Change</th><th class="num group-start">Principal</th><th class="num sub-divider">Principal Prepayments</th><th class="num">${d.lossesLabel}</th>${d.hasChargeOff ? '<th class="num">Charge-Off Contracts</th>' : ''}<th class="num">Interest</th><th class="num">Recoveries</th><th class="num group-start">Opening</th><th class="num">Closing</th><th class="num">Change</th><th class="num group-start">Opening</th><th class="num">Closing</th><th class="num">Change</th></tr>
          </thead>`;
    const histRow = (p) => `<tr>
                <td>${p.collection_period || p.period}${p.activity_by_currency && p.activity_by_currency.spot_rate ? `<div style="font-size:9px;color:var(--muted);font-family:'IBM Plex Mono',monospace;margin-top:2px;white-space:nowrap" title="USD/CAD spot rate printed in this period's report. Every CAD Equiv figure in this row -- balances and activity alike -- uses this rate; multiplying the report's USD closing balance by it reproduces the report's own CAD-equivalent column to the cent.">USD @ ${p.activity_by_currency.spot_rate.toFixed(4)}</div>` : ''}</td>
                ${colTd(p.opening_balance, p.openBalColor)}
                ${closeBalCell(p)}
                ${changeTd(p.opening_balance, p.closing_balance)}
                ${activityTd(p.principal, 'group-start', p, 'principal')}
                ${activityTd(p.principal_prepayments, 'sub-divider', p, 'principal_prepayments')}
                ${activityTd(p.losses, null, p, 'losses')}
                ${d.hasChargeOff ? activityTd(p.charge_off, null, p, 'charge_off') : ''}
                ${activityTd(p.interest, null, p, 'interest')}
                ${activityTd(p.recoveries, null, p, 'recoveries')}
                ${colTd(p.opening_amount, p.openAmtColor, 'group-start')}
                ${closeAmtCell(p)}
                ${changeTd(p.opening_amount, p.closing_amount)}
                <td class="num group-start">${p.opening_contracts!==null&&p.opening_contracts!==undefined?fmtNum(p.opening_contracts):'n/a'}</td>
                <td class="num">${p.closing_contracts!==null&&p.closing_contracts!==undefined?fmtNum(p.closing_contracts):'n/a'}</td>
                ${changeCountTd(p.opening_contracts, p.closing_contracts)}
              </tr>`;
    window.togglePriorPeriods = window.togglePriorPeriods || function (id, btn, n) {
      const rows = document.querySelectorAll('tr[data-ph="' + id + '"]');
      const show = rows.length && rows[0].style.display === 'none';
      rows.forEach(r => { r.style.display = show ? '' : 'none'; });
      btn.innerHTML = show ? '&#128198; Hide prior periods &#9652;' : '&#128198; Show ' + n + ' prior period' + (n === 1 ? '' : 's') + ' &#9662;';
    };
    const histId = 'ph-' + d.deal_slug;
    const priorPeriods = periodHistDisplay.slice(1);
    const currentRowHtml = periodHistDisplay.length
      ? histRow(periodHistDisplay[0])
          .replace('<tr>', '<tr class="ph-current" style="background:var(--avail-bg);font-weight:600">')
          .replace(/(<td>)([^<]*)/, '$1$2<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--accent);margin-top:2px">Current</div>')
      : '';
    const periodHistoryPanel = periodHistDisplay.length ? `
      <div style="margin-top:10px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700;margin-bottom:4px">Balances by period</div>
        <div style="overflow-x:auto"><table class="mini-table">
          ${histHead}
          <tbody>
            ${currentRowHtml}
            ${priorPeriods.map(p => histRow(p).replace('<tr>', `<tr class="ph-prior" data-ph="${histId}" style="display:none">`)).join('')}
          </tbody>
        </table></div>
        ${priorPeriods.length ? `<button type="button" class="ph-toggle" onclick="togglePriorPeriods('${histId}', this, ${priorPeriods.length})" style="margin-top:8px;cursor:pointer;font-size:11.5px;color:var(--accent);font-weight:700;background:var(--avail-bg);padding:5px 12px;border-radius:14px;border:1px solid var(--avail)">&#128198; Show ${priorPeriods.length} prior period${priorPeriods.length === 1 ? '' : 's'} &#9662;</button>` : ''}
      </div>` : '';

    // --- 12-month trailing ratio history (already embedded in this deal's
    // own report, e.g. Aggregate Portfolio Performance's trailing months --
    // columns shown are only the ones THIS deal actually reports) ---
    // Which of this table's columns get an adjacent "Within Limit?"
    // column -- reuses the exact same covenant-lookup already built for
    // the KPI tiles, so the two never disagree.
    const WITHIN_LIMIT_COLS = Object.keys(LIMIT_TILE_KEYS);
    const RATIO_COL_META = {
      delinquency_ratio_pct: {label: 'Delinquency Ratio', fmt: 'pct', group: 'Portfolio Performance'},
      monthly_delinquency_ratio_pct: {label: 'Monthly Delinquency', fmt: 'pct', group: 'Portfolio Performance'},
      loss_ratio_pct: {label: 'Loss Ratio', fmt: 'pct', group: 'Portfolio Performance'},
      rolling_3month_loss_ratio_pct: {label: 'Roll. 3mo Loss', fmt: 'pct', group: 'Portfolio Performance'},
      rolling_12month_loss_ratio_pct: {label: 'Roll. 12mo Loss', fmt: 'pct', group: 'Portfolio Performance'},
      rvl_ratio_pct: {label: 'RVL Ratio', fmt: 'pct', group: 'Portfolio Performance'},
      interest_coverage_ratio: {label: 'Interest Coverage Ratio', fmt: 'ratio', group: 'Borrower Data and Financial Ratios'},
      debt_equity_ratio: {label: d.leverageLabel, fmt: 'ratio', group: 'Borrower Data and Financial Ratios'},
      total_equity: {label: d.totalEquityLabel, fmt: 'dollar', group: 'Borrower Data and Financial Ratios'},
    };
    const RATIO_COL_ORDER = Object.keys(RATIO_COL_META);
    const ratioHist = [...(d.ratio_history || [])].reverse();  // most recent month first
    const presentCols = RATIO_COL_ORDER.filter(k => ratioHist.some(r => r[k] !== undefined));
    const fmtCol = (val, fmt) => val === undefined ? 'n/a'
      : fmt === 'pct' ? fmtPct(val, 2) : fmt === 'dollar' ? fmtMoney(val) : `${val.toFixed(2)}x`;
    const ratioGroupSpans = [];
    presentCols.forEach(k => {
      const g = RATIO_COL_META[k].group;
      if (ratioGroupSpans.length && ratioGroupSpans[ratioGroupSpans.length-1].group === g) {
        ratioGroupSpans[ratioGroupSpans.length-1].count++;
      } else {
        ratioGroupSpans.push({group: g, count: 1});
      }
    });
    // --- Trend charts: the same 12-month history the table below holds,
    // drawn so a slope is visible at a glance. Each ratio is matched to
    // its covenant threshold (by keyword in the test description) and that
    // limit is drawn as a dashed reference line, so the reader sees not
    // just direction but distance-to-trouble. Credit ratios (percentages)
    // and leverage/coverage (multiples) are charted separately since they
    // live on incompatible scales.
    const chron = [...(d.ratio_history || [])];  // oldest -> newest for a left-to-right timeline
    const chartLabels = chron.map(r => r.month);
    const findThreshold = (keywords) => {
      const matches = (d.covenants || []).filter(cv => cv.threshold !== null && cv.threshold !== undefined && cv.current_value !== null
        && keywords.some(k => (cv.description || '').toLowerCase().includes(k)));
      if (!matches.length) return {threshold: null, kind: null, thresholdLabel: null, threshold2: null, threshold2Label: null};
      // Primary = the LOOSER limit (highest threshold), same rule as
      // findCovenantFor -- not category/is_lookback_test(), which both
      // assign the SAME category to Meridian OneCap's own two tests
      // (Lock-Up Trigger vs Event of Default Trigger), despite them being
      // genuinely different limits.
      const primary = matches.reduce((best, cv) => (best === undefined || cv.threshold > best.threshold) ? cv : best, undefined);
      // A SECOND, genuinely different threshold on the same metric --
      // Finloc/TLFC (Lock-Up Event vs Event of Termination) and Meridian
      // OneCap (Lock-Up Trigger vs Event of Default Trigger) all test the
      // same ratio twice at two different limits. Found by threshold
      // value differing from the primary -- deliberately not requiring a
      // different category, which isn't a reliable distinguisher across
      // deals (see above).
      const other = matches.find(cv => cv !== primary && cv.threshold !== primary.threshold);
      // Short category names, same abbreviations the KPI tiles use.
      const short = shortCat;
      // Same forced-label deals as the KPI tiles (forceEoTLabel above):
      // without a second threshold to disambiguate from, the chart would
      // otherwise show a bare "limit X" even where the category is both
      // known and, for VCC IV, actively different from the generic
      // default -- matching the card's own label here rather than
      // leaving card and chart disagreeing on the same deal.
      const forceLabelDeal = ['move-trust-essex-lease-financial-corp', 'move-trust-tlfc-leases', 'move-trust-tlfc-loans', 'move-trust-tlfc-lp-leases', 'move-trust-tpine-leasing-capital-corporation', 'move-trust-vcc-iv-lp', 'f-pil-2-0-stride-capital', 'f-pil-2-0-xpedite-leasing', 'f-pil-2-0-moneda-capital-corp'].includes(d.deal_slug);
      return {threshold: primary.threshold, kind: primary.kind,
              thresholdLabel: (other || forceLabelDeal) ? short(primary.description, primary.category) : null,
              threshold2: other ? other.threshold : null, threshold2Label: other ? short(other.description, other.category) : null};
    };
    const CHART_PALETTE = ['#2F5BD6', '#C6303E', '#D98A00', '#1B8A5A', '#7C3AED'];
    const creditSeries = [
      {key: 'delinquency_ratio_pct', name: 'Delinquency Ratio', kw: ['delinquency ratio']},
      {key: 'rolling_3month_loss_ratio_pct', name: 'Rolling 3-Mo Loss', kw: ['three month loss', 'rolling three']},
      {key: 'rolling_12month_loss_ratio_pct', name: 'Rolling 12-Mo Loss', kw: ['twelve month loss', 'rolling twelve']},
      {key: 'loss_ratio_pct', name: 'Loss Ratio', kw: ['loss ratio']},
      {key: 'cnl_ratio_pct', name: 'CNL Ratio', kw: ['cnl ratio', 'cumulative net loss']},
      {key: 'rvl_ratio_pct', name: 'RVL Ratio', kw: ['rvl ratio', 'residual value']},
    ].filter(s => chron.some(r => r[s.key] !== undefined && r[s.key] !== null))
     .map((s, i) => { const t = findThreshold(s.kw); return {name: s.name, values: chron.map(r => r[s.key]), color: CHART_PALETTE[i % CHART_PALETTE.length], threshold: t.threshold, kind: t.kind, thresholdLabel: t.thresholdLabel, threshold2: t.threshold2, threshold2Label: t.threshold2Label}; });
    const coverageSeries = [
      {key: 'interest_coverage_ratio', name: 'Interest Coverage Ratio', kw: ['interest coverage']},
      {key: 'debt_equity_ratio', name: d.leverageLabel, kw: ['leverage ratio', 'debt to equity', 'debt-to-equity', 'debt/equity', 'debt / equity']},
    ].filter(s => chron.some(r => r[s.key] !== undefined && r[s.key] !== null))
     .map((s, i) => { const t = findThreshold(s.kw); return {name: s.name, values: chron.map(r => r[s.key]), color: CHART_PALETTE[(i + 3) % CHART_PALETTE.length], threshold: t.threshold, kind: t.kind, thresholdLabel: t.thresholdLabel, threshold2: t.threshold2, threshold2Label: t.threshold2Label}; });
    // chron itself can now be longer than 12 (widened to merge in the
    // TLFC family's own longer quarterly history for the Servicer/TAG
    // chart below), so each chart's own title must count only the
    // months where ITS OWN series actually has data, not the shared
    // chron.length -- using chron.length directly for Portfolio
    // Performance showed "19-Month Trend" on TLFC Loans (12 real months
    // plus 7 quarter-only months that exist solely for the OTHER
    // chart), when Portfolio Performance itself only ever has 12.
    // creditSeries/coverageSeries have already been through .map() by
    // here, so their elements carry 'name', not the original 'key' --
    // checking s.key against them is always undefined. Explicit key
    // lists instead (same keys the two series arrays above are built
    // from), matching how many of this deal's own columns are present.
    const CREDIT_KEYS = ['delinquency_ratio_pct', 'rolling_3month_loss_ratio_pct', 'rolling_12month_loss_ratio_pct', 'loss_ratio_pct', 'cnl_ratio_pct', 'rvl_ratio_pct'];
    const COVERAGE_KEYS = ['interest_coverage_ratio', 'debt_equity_ratio'];
    // Capped at 12 to match the table below each chart, which already
    // caps there itself (buildRatioHistoryPanel's own .slice(0, 12)) --
    // without this cap, a deal with MORE than 12 real months on file
    // (Essex: 13, genuinely all real) showed "13-Month Trend" on the
    // chart title while its own table underneath still said "12-month",
    // an inconsistency between the two for no real reason.
    const creditMonthCount = Math.min(12, chron.filter(r => CREDIT_KEYS.some(k => r[k] !== undefined && r[k] !== null)).length);
    const coverageMonthCount = Math.min(12, chron.filter(r => COVERAGE_KEYS.some(k => r[k] !== undefined && r[k] !== null)).length);
    // Two separate trend panels rather than one side-by-side pair: the
    // Portfolio Performance chart stays with the portfolio-level data
    // above; the Borrower Data chart moves below the CNL table so the
    // borrower/guarantor financials read as their own section after the
    // pool-level material, matching the order the source reports use.
    // TPine Leasing only: its Rolling 3-Mo/12-Mo Loss Ratios run to -40%
    // to -130%, roughly 27x the magnitude of its own Delinquency Ratio
    // (~3%) -- confirmed by comparing against every other deal that
    // reports the same three metrics (Dynamic Capital, Essex), where all
    // three sit on a comparable, normal scale. One shared y-axis across
    // both scales squashes Delinquency's own meaningful 3-4% movement
    // into a sliver at the very top of a chart dominated by the Loss
    // Ratios' much larger range. Split into two charts for this one deal
    // only -- Delinquency alone, Rolling 3-Mo + Rolling 12-Mo together --
    // each gets its own appropriately-scaled axis. Every other deal keeps
    // the single combined chart unchanged.
    const isTPine = d.deal_slug === 'move-trust-tpine-leasing-capital-corporation';
    const delinquencyOnlySeries = creditSeries.filter(s => s.name === 'Delinquency Ratio');
    const rollingLossSeries = creditSeries.filter(s => s.name === 'Rolling 3-Mo Loss' || s.name === 'Rolling 12-Mo Loss');
    const trendChartsPanel = (chron.length > 2 && creditSeries.length) ? (isTPine && rollingLossSeries.length ? `
      <div style="margin-top:14px">
        <div style="font-size:10.5px;text-transform:uppercase;color:var(--muted);letter-spacing:.03em;margin-bottom:8px;font-weight:600">${creditMonthCount}-Month Trend &mdash; dashed line = covenant limit</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;max-width:1160px">
          <div class="kpi" style="padding:10px 12px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.02em;margin-bottom:2px">Portfolio Performance &mdash; Delinquency Ratio</div>${trendChartSVG(chartLabels, delinquencyOnlySeries, {fmt: 'pct'})}</div>
          <div class="kpi" style="padding:10px 12px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.02em;margin-bottom:2px">Portfolio Performance &mdash; Rolling Loss Ratios</div>${trendChartSVG(chartLabels, rollingLossSeries, {fmt: 'pct'})}</div>
        </div>
      </div>` : `
      <div style="margin-top:14px">
        <div style="font-size:10.5px;text-transform:uppercase;color:var(--muted);letter-spacing:.03em;margin-bottom:8px;font-weight:600">${creditMonthCount}-Month Trend &mdash; dashed line = covenant limit</div>
        <div style="max-width:570px">
          <div class="kpi" style="padding:10px 12px"><div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.02em;margin-bottom:2px">Portfolio Performance</div>${trendChartSVG(chartLabels, creditSeries, {fmt: 'pct'})}</div>
        </div>
      </div>`) : '';
    // TPine Leasing only: removed -- its own Leverage Ratio is the only
    // metric in this group, and the chart was requested removed (a CNL
    // Ratio trend chart is added under the CNL card instead, below).
    const borrowerTrendPanel = (chron.length > 2 && coverageSeries.length && !isTPine) ? `
      <div style="margin:14px 0">
        <div style="font-size:10.5px;text-transform:uppercase;color:var(--muted);letter-spacing:.03em;margin-bottom:8px;font-weight:600">${coverageMonthCount}-Month Trend &mdash; ${borrowerGroupDisplayLabel} &mdash; dashed line = covenant limit</div>
        <div style="max-width:570px">
          <div class="kpi" style="padding:10px 12px">${trendChartSVG(chartLabels, coverageSeries, {fmt: 'multiple'})}</div>
        </div>
      </div>` : '';

    const spansFor = (cols) => { const out = []; cols.forEach(k => { const gg = RATIO_COL_META[k].group; if (out.length && out[out.length-1].group === gg) out[out.length-1].count++; else out.push({group: gg, count: 1}); }); return out; };
    const buildRatioHistoryPanel = (cols, titleSuffix) => {
      // Drop any row -- not just leading/trailing -- where EVERY column
      // in THIS table's own cols subset is empty. Started as a trailing-
      // only trim (Finloc: Borrower Data's table lags a month behind the
      // report's own collection period, so only its most recent row was
      // ever all-"n/a"), but the TLFC family's own Servicer Data is
      // reported quarterly while the shared ratioHist array is monthly,
      // so two of every three rows are empty throughout the WHOLE
      // history, not just at the edges -- a leading/trailing-only trim
      // left a table that was 2/3 "n/a" filler (TLFC Leases: 9 rows shown
      // for a 12-month window, only 3 with real data). A row with even
      // one real value in this subset, or any value in a column outside
      // it, is kept; a mixed-cadence table (Xpedite: ICR monthly,
      // Leverage quarterly, same table) is unaffected since ICR alone
      // keeps every month out of the all-empty filter.
      // Cap at this table's own most recent 12 periods once filtered --
      // ratioHist's own merge window is now wide enough (48 months) to
      // carry a quarterly deal's full history (TLFC LP has 14 quarters
      // on file), but the table itself should still show at most 12,
      // consistently with every other deal's own 12-month table.
      // ratioHist is newest-first, so .slice(0, 12) is the most recent
      // 12 -- a deal with FEWER than 12 available periods (TLFC Leases:
      // 9, TLFC Loans: 10) shows all of what it has, never padded.
      const rows = ratioHist.filter(r => !cols.every(k => r[k] === undefined || r[k] === null)).slice(0, 12);
      const rhId = 'rh-' + d.deal_slug + '-' + titleSuffix.replace(/[^A-Za-z]/g, '');
      // Cadence from the gap between consecutive reported rows: quarterly series
      // (TLFC servicer/seller data) are counted in quarters, everything else in months.
      const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const mIdx = (m) => { const [a, b] = String(m).split('-'); return (2000 + Number(b)) * 12 + MON.indexOf(a); };
      const gaps = rows.slice(1).map((r, k) => mIdx(rows[k].month) - mIdx(r.month)).filter(g => g > 0);
      const rhUnit = gaps.length && gaps.filter(g => g >= 3).length > gaps.length / 2 ? 'quarter' : 'month';
      const rhHeading = rows.length
        ? `${titleSuffix.trim()} &mdash; ${rows[0].month} (${rows.length > 1 ? `most recent of ${rows.length} ${rhUnit}s reported` : `only ${rhUnit} reported`})`
        : titleSuffix.trim();
      return (rows.length >= 1 && cols.length) ? `
      <div style="margin-top:10px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:700;margin-bottom:4px" class="rh-heading" data-month="${rows.length ? rows[0].month : ''}">${rhHeading}</div>
        <div style="overflow-x:auto"><table class="mini-table">
          <thead>
            <tr><th rowspan="2" style="vertical-align:bottom">Month</th>${spansFor(cols).map(g => `<th colspan="${g.count + WITHIN_LIMIT_COLS.filter(k => cols.includes(k) && RATIO_COL_META[k].group === g.group).length}" class="group-start" style="text-align:center;border-bottom:1px solid var(--line)">${g.group === BORROWER_GROUP ? borrowerGroupDisplayLabel : g.group}</th>`).join('')}</tr>
            <tr>${cols.map((k,i) => {
              const startsGroup = i===0||RATIO_COL_META[cols[i-1]].group!==RATIO_COL_META[k].group;
              const base = `<th class="num${startsGroup?' group-start':''}">${RATIO_COL_META[k].label}</th>`;
              // Leverage and Total Equity get an adjacent "Within Limit?"
              // column, same as the CNL-by-period table's own pattern --
              // every other column in this generic table stays a bare
              // value, since only these two currently have a per-deal
              // covenant limit worth comparing against here.
              if (!WITHIN_LIMIT_COLS.includes(k)) return base;
              // The limit(s) themselves sit right under the heading, so the
              // Yes / Over Lock-Up / Over EoT column below reads against
              // visible numbers -- previously the table never showed which
              // limit (or which of two) it was testing.
              const covs = findCovenantsFor(LIMIT_TILE_KEYS[k], LIMIT_TILE_EXCLUDE[k]);
              const isFloorK = k === 'total_equity' || k === 'interest_coverage_ratio';
              const labelDeal = ['move-trust-essex-lease-financial-corp', 'move-trust-tlfc-leases', 'move-trust-tlfc-loans', 'move-trust-tlfc-lp-leases', 'move-trust-tpine-leasing-capital-corporation', 'move-trust-vcc-iv-lp', 'f-pil-2-0-stride-capital', 'f-pil-2-0-xpedite-leasing', 'f-pil-2-0-moneda-capital-corp'].includes(d.deal_slug);
              const limText = covs.map(c => `${(covs.length > 1 || labelDeal) ? shortCat(c.description, c.category) + ' ' : (isFloorK ? 'Min ' : 'Limit ')}${fmtCol(c.threshold, RATIO_COL_META[k].fmt)}`).join(' &middot; ');
              return base + `<th class="num">${RATIO_COL_META[k].label} Within ${covs.length > 1 ? 'Limits' : 'Limit'}?${limText ? `<div class="lim-sub">${limText}</div>` : ''}</th>`;
            }).join('')}</tr>
          </thead>
          <tbody>
            ${rows.map((r, ri) => `<tr${ri === 0 ? ' class="ph-current"' : ` class="ph-hide" data-ph="${rhId}"`}>
                <td>${r.month}${ri === 0 ? '<div class="ph-tag">Most recent</div>' : ''}</td>
                ${cols.map((k,i) => {
                  const startsGroup = i===0||RATIO_COL_META[cols[i-1]].group!==RATIO_COL_META[k].group;
                  const base = `<td class="num${startsGroup?' group-start':''}">${fmtCol(r[k], RATIO_COL_META[k].fmt)}</td>`;
                  if (!WITHIN_LIMIT_COLS.includes(k)) return base;
                  const cov = findCovenantFor(LIMIT_TILE_KEYS[k], LIMIT_TILE_EXCLUDE[k]);
                  const val = r[k];
                  if (!cov || val === undefined || val === null) return base + '<td class="num"><span style="color:var(--muted)">n/a</span></td>';
                  // Floor tests (value must stay ABOVE the limit): Total Equity
                  // and Interest Coverage Ratio. Everything else is a ceiling.
                  const isFloor = k === 'total_equity' || k === 'interest_coverage_ratio';
                  const pass = isFloor ? val >= cov.threshold : val <= cov.threshold;
                  const tiers = findCovenantsFor(LIMIT_TILE_KEYS[k], LIMIT_TILE_EXCLUDE[k]);
                  if (tiers.length > 1) {
                    // Two-level test: name the most severe level crossed
                    // ("Over Lock-Up" amber, "Over EoT" red) rather than one
                    // Yes/No that silently ignored the lower level.
                    const crossed = tiers.filter(c => isFloor ? val < c.threshold : val > c.threshold);
                    if (!crossed.length) return base + `<td class="num"><span class="pill OK">Yes</span></td>`;
                    const worst = isFloor ? crossed[0] : crossed[crossed.length - 1];
                    const isTop = isFloor ? worst === tiers[0] : worst === tiers[tiers.length - 1];
                    return base + `<td class="num"><span class="pill ${isTop ? 'BREACH' : 'WATCH'}" style="white-space:nowrap">${isFloor ? 'Under' : 'Over'} ${shortCat(worst.description, worst.category)}</span></td>`;
                  }
                  return base + `<td class="num"><span class="pill ${pass?'OK':'BREACH'}">${pass?'Yes':'No'}</span></td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table></div>
        ${phButton(rhId, rows.length - 1, rhUnit, '&#128200;')}
      </div>` : '';
    };

    // Two tables from one builder: pool-level columns (Portfolio
    // Performance) stay with the pool-level section; Borrower Data
    // columns go after the CNL section with their own tiles and chart.
    const ppCols = presentCols.filter(k => RATIO_COL_META[k].group !== BORROWER_GROUP);
    const borrowerCols = presentCols.filter(k => RATIO_COL_META[k].group === BORROWER_GROUP);
    const ratioHistoryPanel = buildRatioHistoryPanel(ppCols, ' Portfolio Performance');
    const borrowerHistoryPanel = buildRatioHistoryPanel(borrowerCols, ' ' + borrowerGroupDisplayLabel);


    const top10 = d.top10_obligors || [];
    const obligorLimitCell = (o) => o.concentration_limit_desc
      ? o.concentration_limit_desc
      : (o.concentration_limit_pct !== null && o.concentration_limit_pct !== undefined ? fmtPct(o.concentration_limit_pct, 2) : 'n/a');
    const top10Panel = top10.length ? `
      <details style="margin-top:10px">
        <summary style="cursor:pointer;font-size:11.5px;color:var(--accent);font-weight:700;background:var(--avail-bg);display:inline-block;padding:5px 12px;border-radius:14px;border:1px solid var(--avail)">&#128100; Show Top 10 Obligor Concentration &#9662;</summary>
        <table class="mini-table" style="margin-top:8px;table-layout:fixed">
          <thead>
            <tr><th style="width:50px">Rank</th><th style="width:130px">Obligor</th><th class="num group-start">Contract Amount</th><th class="num">Concentration</th><th class="num group-start">Limit</th><th class="num">Limit / Obligor</th><th class="num">Excess</th></tr>
          </thead>
          <tbody>
            ${top10.map(o => `<tr${o.excess_concentration_amount>0?' style="background:var(--breach-bg)"':''}>
                <td>${o.rank}</td>
                <td${o.excess_concentration_amount>0?' style="color:var(--breach);font-weight:700"':''}>${o.obligor_name}${o.excess_concentration_amount>0?' &#9888;':''}</td>
                <td class="num group-start">${fmtMoney(o.aggregate_contract_amount)}</td>
                <td class="num" style="${o.excess_concentration_amount>0?'color:var(--breach);font-weight:700':''}">${fmtPct(o.obligor_concentration_pct, 2)}</td>
                <td class="num group-start">${obligorLimitCell(o)}</td>
                <td class="num">${fmtMoney(o.concentration_limit_per_obligor)}</td>
                <td class="num" style="color:${o.excess_concentration_amount>0?'var(--breach)':'var(--muted)'};font-weight:${o.excess_concentration_amount>0?'700':'400'}">${fmtMoney(o.excess_concentration_amount)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </details>` : '';

    // Field-name -> display label, reusing the same map already used for
    // the ratio history table so labels stay consistent everywhere.
    const restatements = d.restatements || [];
    const restatementsPanel = restatements.length ? `
      <div style="margin-top:10px;padding:10px 12px;border:1px solid var(--breach);background:var(--breach-bg);border-radius:8px">
        <div style="font-weight:700;color:var(--breach);font-size:12px;margin-bottom:6px">&#9888; ${restatements.length} Restatement${restatements.length>1?'s':''} Detected</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">A later report stated a different value than an earlier report did for the same historical month -- the history itself changed, not just this period's own number.</div>
        <table class="mini-table" style="background:transparent">
          <thead><tr><th>Month</th><th>Field</th><th>As Reported (by source period)</th></tr></thead>
          <tbody>
            ${restatements.map(r => `<tr>
                <td>${r.month}</td>
                <td>${(RATIO_COL_META[r.field]||{label:r.field}).label}</td>
                <td>${r.as_reported.map(x => `${x.source_period}: ${fmtCol(x.value, (RATIO_COL_META[r.field]||{fmt:'pct'}).fmt)}`).join(' &rarr; ')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '';

    // Two genuinely different conventions share this table: Meridian
    // OneCap/TPine/Finloc report per annual-vintage Tranches
    // Originated/Tranche Balance Funded/Losses Allocated plus an EOD
    // Trigger and Spread; Xpedite/Moneda/Stride report per advance-period
    // Original NPV/Gross Losses/Cumulative Net Losses with no EOD Trigger
    // concept at all. Forcing F-PIL's rows through the first table's
    // column set produced a real bug -- every cell read "undefined" or
    // "—", since none of Meridian's field names exist on those rows.
    // Detected by which fields are actually present, not by program name,
    // so a future deal sharing either shape is handled automatically.
    const cnlIsVintageStyle = cnlByPeriod.length && cnlByPeriod[0].annual_period !== undefined;
    // TPine Leasing only: a CNL Ratio trend chart under the CNL card,
    // plotting each vintage's own CNL Ratio against the deal's EoT
    // Trigger (3.25%) -- cnlByPeriod is chronological oldest-first
    // already (matching the fix applied two turns ago), so no reordering
    // needed. Labels use each vintage's own origination period rather
    // than a calendar month, since this is a per-vintage trend, not a
    // monthly one.
    // Removed at user request (2026-10-13): TPine's "CNL Ratio by Origination
    // Period" chart is no longer shown. Kept switched off rather than deleted.
    const cnlTrendChart = false ? `
      <div style="margin-top:14px">
        <div style="font-size:10.5px;text-transform:uppercase;color:var(--muted);letter-spacing:.03em;margin-bottom:8px;font-weight:600">CNL Ratio by Origination Period &mdash; dashed line = covenant limit</div>
        <div style="max-width:570px">
          <div class="kpi" style="padding:10px 12px">${trendChartSVG(cnlByPeriod.map(r => r.annual_period), [{
            name: 'CNL Ratio', values: cnlByPeriod.map(r => r.cnl_ratio_pct),
            color: CHART_PALETTE[0], threshold: 0.0325, kind: 'ceiling',
            thresholdLabel: 'EoT', threshold2: null, threshold2Label: null,
          }], {fmt: 'pct'})}</div>
        </div>
      </div>` : '';
    // Some advance-period deals (Xpedite, Moneda) report which specific
    // advances fall into each vintage bucket; others (Stride, confirmed
    // directly against its own source) never print this breakdown at
    // all. A column that would be "—" on every single row for a deal
    // isn't a data gap that varies row to row, it's a structural fact
    // about that deal's report -- so it's hidden entirely rather than
    // left in as a permanent dash.
    const hasAdvanceRange = cnlByPeriod.some(r => r.advance_range);
    // The three TLFC entities' own Cumulative Losses page prints this
    // figure as "Combined (2011-3) Cumulative Net Losses" -- confirmed
    // genuinely multi-pool, not just this deal's own vintages: the
    // page's own "Pool Balance Totals" line ($461.5M) is roughly 50x
    // this specific deal's own closing tranche balance (~$9M), and a
    // separate page in the same report explicitly labels the concept
    // "Combined Pool 2011-3". Every other deal's CNL figure is genuinely
    // single-deal, so only these three get the renamed header + tooltip.
    const isCombinedPoolCNL = ['move-trust-tlfc-leases', 'move-trust-tlfc-loans', 'move-trust-tlfc-lp-leases'].includes(d.deal_slug);
    const cnlDollarLabel = isCombinedPoolCNL ? 'Combined Cumulative Net Losses' : 'Cumulative Net Losses';
    const cnlDollarTitle = isCombinedPoolCNL ? ' title="Combined across the related pools under Series 2011-3 -- includes cumulative net losses for Tricor Loans and Tricor Leases (Rated), not only the vintages reported under this specific deal."' : '';
    // TLFC family only: the deal's own per-period figures, which sit
    // BEFORE the combined pair in the PDF's own column order -- "Original
    // Tranche Balance (2011-3)" then "(2011-3) Cumulative Net Losses".
    // Combined Original Tranche Balance (renamed from the generic
    // "Original Balance" label, same reasoning as the Cumulative Net
    // Losses rename above) comes after these two, also matching the
    // source's own left-to-right order.
    const combinedBalanceLabel = isCombinedPoolCNL ? 'Combined Original ' + BALANCE_LABEL : 'Original ' + BALANCE_LABEL;
    const hasPeriodFigures = cnlByPeriod.some(r => r.period_original_balance !== undefined);
    // Meridian OneCap: no row has ever had a Tranches Originated figure --
    // genuinely absent from this deal's own vintage table, not a per-row
    // gap -- same reasoning as hasAdvanceRange above. Hidden entirely
    // rather than left in as a permanent "n/a" column.
    const hasTranchesOriginated = cnlByPeriod.some(r => r.tranches_originated);
    // Finloc only: CNL Ratio per Semi Annual Period, built from the
    // per-tranche rows on the report's Cumulative Losses page (p.20).
    // Original Tranche Balance and Cumulative Net Losses are each the sum
    // of every tranche tagged with that period (CAD Equivalent, as the
    // report prints them); every computed ratio matches the report's own
    // printed Semi Annual Period CNL Ratio, and the column totals match
    // its Pool Balance Totals line exactly. Laid out like Essex's table.
    const isFinlocSemi = d.deal_slug === 'move-trust-finloc-2000-inc' && cnlByPeriod.length && cnlByPeriod[0].semi_annual_period !== undefined;
    const finlocSemiPanel = !isFinlocSemi ? '' : (() => {
      const totBal = cnlByPeriod.reduce((s, r) => s + (r.period_original_balance || 0), 0);
      const totCum = cnlByPeriod.reduce((s, r) => s + (r.period_cumulative_net_losses || 0), 0);
      const neg = v => (v || 0) < 0 ? 'var(--watch)' : 'var(--ink)';
      return `
      <div style="margin:14px 0;break-inside:avoid;page-break-inside:avoid">
        <div style="font-size:10.5px;text-transform:uppercase;color:var(--muted);letter-spacing:.03em;margin-bottom:8px;font-weight:600;break-after:avoid;page-break-after:avoid">CNL Ratio by Semi-Annual Period</div>
        <div style="overflow-x:auto">
        <table class="mini-table">
          <thead><tr><th>Semi-Annual Period</th><th class="num group-start">Tranches</th><th class="num">Original Tranche Balance</th><th class="num">Cumulative Net Losses</th><th class="num group-start">CNL Ratio</th><th class="num">CNL Limit</th><th class="num">CNL Ratio Within Limit?</th></tr></thead>
          <tbody>
            ${cnlByPeriod.map(r => `<tr${r.cnl_within_limit === false ? ' style="background:color-mix(in srgb, var(--breach) 8%, transparent)"' : ''}>
                <td>Period ${r.semi_annual_period}</td>
                <td class="num group-start">${r.tranches}</td>
                <td class="num">${fmtMoney(r.period_original_balance)}</td>
                <td class="num" style="color:${neg(r.period_cumulative_net_losses)}">${fmtMoney(r.period_cumulative_net_losses)}</td>
                <td class="num group-start" style="color:${r.cnl_within_limit === false ? 'var(--breach)' : neg(r.cnl_ratio_pct)};${r.cnl_within_limit === false ? 'font-weight:700' : ''}" title="${(r.cnl_ratio_pct * 100).toFixed(4)}% (report prints ${(r.cnl_ratio_reported_pct * 100).toFixed(2)}%)">${fmtPct(r.cnl_ratio_pct, 2)}</td>
                <td class="num">${fmtPct(r.cnl_limit, 2)}</td>
                <td class="num">${r.cnl_within_limit ? '<span class="pill OK">Yes</span>' : '<span class="pill BREACH">No</span>'}</td>
              </tr>`).join('')}
            <tr style="font-weight:700;border-top:2px solid var(--line)">
              <td>Total</td>
              <td class="num group-start"></td>
              <td class="num">${fmtMoney(totBal)}</td>
              <td class="num">${fmtMoney(totCum)}</td>
              <td class="num group-start" title="Pool-level figure for reference only; the covenant is tested per Semi Annual Period">${fmtPct(totBal ? totCum / totBal : null, 2)}</td>
              <td class="num"></td>
              <td class="num"></td>
            </tr>
          </tbody>
        </table>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px">Original Tranche Balance and Cumulative Net Losses are the sums of all tranches in each Semi Annual Period, in CAD Equivalent (Cumulative Losses, report p.20). Tested against MSA 8.1 (d): CNL Ratio exceeding 2.50%. Hover a ratio for its unrounded value.</div>
      </div>`;
    })();
    // F-PIL 2.0 only: Gross Losses / Actual Recoveries / Estimated
    // Recoveries columns (where the extractor captured them) and a Total
    // row on the Cumulative Net Losses by Advance Period table.
    const isFpilDeal = (d.deal_slug || '').startsWith('f-pil');
    const fpilLossDetail = isFpilDeal && cnlByPeriod.some(r => r.gross_losses !== undefined && r.gross_losses !== null);
    // Current Period Losses per advance period, summed over the advances in
    // that period (VCC IV, from the report's Cumulative Losses table).
    const hasCurPeriodLosses = cnlByPeriod.some(r => r.current_period_losses !== undefined && r.current_period_losses !== null) && !cnlIsVintageStyle;
    const cnlByPeriodPanel = !cnlByPeriod.length ? '' : isFinlocSemi ? finlocSemiPanel : cnlIsVintageStyle ? `
      <div style="margin:14px 0">
        <div style="font-size:10.5px;text-transform:uppercase;color:var(--muted);letter-spacing:.03em;margin-bottom:8px;font-weight:600">CNL Ratio for Aggregate Tranches</div>
        <table class="mini-table">
          <thead><tr><th>Origination Period</th>${hasTranchesOriginated ? '<th class="num group-start">Tranches Originated</th>' : ''}<th class="num${hasTranchesOriginated?'':' group-start'}">Tranche Balance Funded</th>${isTPine ? '<th class="num">Current Period Losses</th><th class="num">Cumulative Net Losses</th>' : '<th class="num">Losses Allocated</th>'}<th class="num">CNL Ratio</th><th class="num">EOD Trigger</th><th class="num">${isTPine ? 'CNL Ratio Within Limit?' : 'Spread'}</th></tr></thead>
          <tbody>
            ${cnlByPeriod.map(r => `<tr>
                <td>${r.annual_period}</td>
                ${hasTranchesOriginated ? `<td class="num group-start">${r.tranches_originated || 'n/a'}</td>` : ''}
                <td class="num${hasTranchesOriginated?'':' group-start'}">${fmtMoney(r.tranche_balance_funded)}</td>
                ${isTPine ? `<td class="num">${fmtMoney(r.current_period_losses)}</td><td class="num">${fmtMoney(r.cumulative_net_losses)}</td>` : `<td class="num">${fmtMoney(r.losses_allocated)}</td>`}
                <td class="num">${fmtPct(r.cnl_ratio_pct, 2)}</td>
                <td class="num">${fmtPct(r.event_of_default_trigger_pct, 2)}</td>
                <td class="num">${isTPine
                  ? (r.spread_pct === null || r.spread_pct === undefined ? '<span style="color:var(--muted)">n/a</span>'
                     : r.spread_pct >= 0 ? '<span class="pill OK">Yes</span>' : '<span class="pill BREACH">No</span>')
                  : `<span style="color:${r.spread_pct<0?'var(--breach)':r.spread_pct<0.01?'var(--watch)':'var(--ok)'}">${fmtPct(r.spread_pct, 2)}</span>`}</td>
              </tr>`).join('')}
            ${isTPine ? (() => {
              // TPine only: totals row, summing Tranche Balance Funded,
              // Current Period Losses, and Cumulative Net Losses across
              // all origination periods -- the grand total reproduces
              // this deal's own already-verified aggregate Cumulative
              // Net Losses figure ($77,647,064, the Aging Summary
              // panel's own total) exactly.
              const totBal = cnlByPeriod.reduce((s, r) => s + (r.tranche_balance_funded || 0), 0);
              const totCL = cnlByPeriod.reduce((s, r) => s + (r.current_period_losses || 0), 0);
              const totCum = cnlByPeriod.reduce((s, r) => s + (r.cumulative_net_losses || 0), 0);
              return `<tr style="font-weight:700;border-top:2px solid var(--line)">
                <td>Total</td>
                <td class="num group-start"></td>
                <td class="num">${fmtMoney(totBal)}</td>
                <td class="num">${fmtMoney(totCL)}</td>
                <td class="num">${fmtMoney(totCum)}</td>
                <td class="num"></td>
                <td class="num"></td>
                <td class="num"></td>
              </tr>`;
            })() : ''}
          </tbody>
        </table>
      </div>` : `
      <div style="margin:14px 0">
        <div style="font-size:10.5px;text-transform:uppercase;color:var(--muted);letter-spacing:.03em;margin-bottom:8px;font-weight:600">Cumulative Net Losses by Advance Period</div>
        <table class="mini-table">
          <thead><tr><th>Advance Period</th>${hasAdvanceRange ? '<th class="num group-start">Advances</th>' : ''}${hasPeriodFigures ? `<th class="num${hasAdvanceRange?'':' group-start'}">Original Tranche Balance (2011-3)</th><th class="num">(2011-3) Cumulative Net Losses</th>` : ''}<th class="num${(hasAdvanceRange||hasPeriodFigures)?'':' group-start'}">${combinedBalanceLabel}</th>${fpilLossDetail ? '<th class="num">Gross Losses</th><th class="num">Actual Recoveries</th><th class="num">Estimated Recoveries</th>' : ''}${hasCurPeriodLosses ? '<th class="num">Current Period Losses</th>' : ''}<th class="num"${cnlDollarTitle}>${cnlDollarLabel}</th><th class="num group-start">CNL Ratio</th><th class="num">${d.deal_slug === 'move-trust-essex-lease-financial-corp' ? 'CNL EoT Limit' : 'CNL Limit'}</th><th class="num">CNL Ratio Within Limit?</th></tr></thead>
          <tbody>
            ${cnlByPeriod.map(r => `<tr>
                <td>${(r.period || '').replace(/\u2012|\u2013|\u2014/g, '-')}</td>
                ${hasAdvanceRange ? `<td class="num group-start">${r.advance_range || 'n/a'}</td>` : ''}
                ${hasPeriodFigures ? `<td class="num${hasAdvanceRange?'':' group-start'}">${fmtMoney(r.period_original_balance)}</td><td class="num" style="color:${(r.period_cumulative_net_losses||0)<0?'var(--watch)':'var(--ink)'}">${fmtMoney(r.period_cumulative_net_losses)}</td>` : ''}
                <td class="num${(hasAdvanceRange||hasPeriodFigures)?'':' group-start'}">${fmtMoney(r.original_finance_contract_npv !== undefined ? r.original_finance_contract_npv : r.original_finance_contract_nbv)}</td>
                ${fpilLossDetail ? `<td class="num">${fmtMoney(r.gross_losses)}</td><td class="num">${fmtMoney(r.actual_recoveries)}</td><td class="num">${fmtMoney(r.estimated_recoveries)}</td>` : ''}
                ${hasCurPeriodLosses ? `<td class="num" style="color:${(r.current_period_losses||0)<0?'var(--watch)':'var(--ink)'}">${fmtMoney(r.current_period_losses)}</td>` : ''}
                <td class="num" style="color:${(r.cumulative_net_losses||0)<0?'var(--watch)':'var(--ink)'}">${fmtMoney(r.cumulative_net_losses)}</td>
                <td class="num group-start" style="color:${(r.cnl_ratio_pct||0)<0?'var(--watch)':'var(--ink)'}">${fmtPct(r.cnl_ratio_pct, 2)}</td>
                <td class="num"${r.cnl_limit_is_exception ? ' title="This period has its own limit, different from the usual CNL Ratio limit, per the covenant test."' : ''}>${r.cnl_limit !== null && r.cnl_limit !== undefined ? fmtPct(r.cnl_limit, 2) + (r.cnl_limit_is_exception ? ' *' : '') : 'n/a'}</td>
                <td class="num">${r.cnl_within_limit === null || r.cnl_within_limit === undefined ? '<span style="color:var(--muted)">n/a</span>' : r.cnl_within_limit ? '<span class="pill OK">Yes</span>' : '<span class="pill BREACH">No</span>'}</td>
              </tr>`).join('')}
            ${(hasCurPeriodLosses && !hasPeriodFigures && !isFpilDeal) ? (() => {
              // VCC IV: totals for Current Period Losses and Cumulative Net
              // Losses (the report's POOL BALANCE TOTALS line).
              const sum = k => cnlByPeriod.reduce((s, r) => s + (r[k] || 0), 0);
              const cur = sum('current_period_losses'), cum = sum('cumulative_net_losses');
              const neg = v => v < 0 ? 'var(--watch)' : 'var(--ink)';
              return `<tr style="font-weight:700;border-top:2px solid var(--line)">
                <td colspan="${1 + (hasAdvanceRange ? 1 : 0) + 1}">Total</td>
                <td class="num" style="color:${neg(cur)}">${fmtMoney(cur)}</td>
                <td class="num" style="color:${neg(cum)}">${fmtMoney(cum)}</td>
                <td class="num group-start"></td><td class="num"></td><td class="num"></td>
              </tr>`;
            })() : ''}
            ${(hasPeriodFigures && !isFpilDeal) ? (() => {
              // TLFC (Tricor) deals: totals for the individual (2011-3)
              // cumulative net losses column and the combined column.
              const sum = k => cnlByPeriod.reduce((s, r) => s + (r[k] || 0), 0);
              const ind = sum('period_cumulative_net_losses'), comb = sum('cumulative_net_losses');
              const neg = v => v < 0 ? 'var(--watch)' : 'var(--ink)';
              return `<tr style="font-weight:700;border-top:2px solid var(--line)">
                <td>Total</td>
                ${hasAdvanceRange ? '<td class="num group-start"></td>' : ''}
                <td class="num${hasAdvanceRange?'':' group-start'}"></td>
                <td class="num" style="color:${neg(ind)}">${fmtMoney(ind)}</td>
                <td class="num"></td>
                <td class="num" style="color:${neg(comb)}">${fmtMoney(comb)}</td>
                <td class="num group-start"></td><td class="num"></td><td class="num"></td>
              </tr>`;
            })() : ''}
            ${isFpilDeal ? (() => {
              // F-PIL 2.0: totals for the loss columns, matching the
              // report's own Total line under its Cumulative Net Losses table.
              const sum = k => cnlByPeriod.reduce((s, r) => s + (r[k] || 0), 0);
              const leadCols = 1 + (hasAdvanceRange ? 1 : 0) + (hasPeriodFigures ? 2 : 0) + 1;
              return `<tr style="font-weight:700;border-top:2px solid var(--line)">
                <td colspan="${leadCols}">Total</td>
                ${fpilLossDetail ? `<td class="num">${fmtMoney(sum('gross_losses'))}</td><td class="num">${fmtMoney(sum('actual_recoveries'))}</td><td class="num">${fmtMoney(sum('estimated_recoveries'))}</td>` : ''}
                <td class="num" style="color:${sum('cumulative_net_losses')<0?'var(--watch)':'var(--ink)'}">${fmtMoney(sum('cumulative_net_losses'))}</td>
                <td class="num group-start"></td><td class="num"></td><td class="num"></td>
              </tr>`;
            })() : ''}
          </tbody>
        </table>
        ${cnlByPeriod.some(r => r.cnl_limit_is_exception) ? '<div style="font-size:10px;color:var(--muted);margin-top:4px">* This period has its own limit, different from the usual CNL Ratio limit, per the covenant test.</div>' : ''}
      </div>`;

    const RATIO_TEST_TITLES = {
      portfolio_delinquency_ratio: 'Portfolio Delinquency Ratio (3 Month Rolling Average)',
      portfolio_deemed_default_ratio: 'Portfolio Deemed Default Ratio (6 Month Rolling Average)',
      portfolio_charge_off_ratio: 'Portfolio Charge-Off Ratio (3 Month Rolling Average)',
    };
    // Numerator Amount means something different per test (the dollar
    // figure being divided by Portfolio Balance to get the ratio) -- named
    // specifically per test rather than with one generic label, since
    // "Numerator Amount" on its own required explaining what it was.
    const NUMERATOR_LABELS = {
      portfolio_delinquency_ratio: 'Delinquent Balance',
      portfolio_deemed_default_ratio: 'Deemed Default Balance',
      portfolio_charge_off_ratio: 'Charge-Off Amount',
    };
    // The last column was a bare "Ratio" in all three tables -- fine on
    // its own, but reading as the same figure across all three when
    // they're not (a Delinquency Ratio next to a Charge-Off Ratio).
    // Named per test, matching each one's own section title.
    const RATIO_COL_LABELS = {
      portfolio_delinquency_ratio: 'Delinquency Ratio',
      portfolio_deemed_default_ratio: 'Deemed Default Ratio',
      portfolio_charge_off_ratio: 'Charge-Off Ratio',
    };
    const ratioTestDetail = d.ratio_test_detail || {};
    const ratioTestPanels = Object.entries(ratioTestDetail).map(([key, v], idx) => {
      if (!v || !v.history || !v.history.length) return '';
      // Test Result / Lock-Up / EOD Trigger are single values, not full
      // rows -- putting them in the last (Ratio) column meant they were
      // invisible without scrolling right, reading as blank at a glance.
      // Putting the value in the Base Amount column instead keeps it
      // visible in the default view, at the cost of it not literally
      // being a "base amount" -- an acceptable trade since these rows are
      // visually distinguished (bold, top border) from the data rows above.
      const summaryRow = (label, value, bold, withinLimitCell) => `<tr${bold?' style="font-weight:700;border-top:2px solid var(--line)"':''}>
              <td>${label}</td>
              <td class="num group-start">${fmtPct(value, 2)}</td>
              <td class="num"></td>
              <td class="num"></td>
              <td class="num">${withinLimitCell || ''}</td>
            </tr>`;
      return `
      <div style="margin:${idx?'22px':'10px'} 0 10px">
        <div style="font-size:10.5px;text-transform:uppercase;color:var(--muted);letter-spacing:.03em;margin-bottom:8px;font-weight:600">${RATIO_TEST_TITLES[key] || key} &mdash; Trailing History</div>
        <table class="mini-table">
          <thead><tr><th>Period</th><th class="num group-start">Portfolio Balance</th><th class="num">${NUMERATOR_LABELS[key] || 'Numerator Amount'}</th><th class="num">${RATIO_COL_LABELS[key] || 'Ratio'}</th><th class="num">${RATIO_COL_LABELS[key] || 'Ratio'} Within Limit?</th></tr></thead>
          <tbody>
            ${v.history.map(h => `<tr>
                <td>${h.period}</td>
                <td class="num group-start">${fmtMoney(h.base_amount)}</td>
                <td class="num">${fmtMoney(h.numerator_amount)}</td>
                <td class="num">${fmtPct(h.ratio_pct, 2)}</td>
                <td class="num"></td>
              </tr>`).join('')}
            ${(() => {
              // Within Limit? sits on the Test Result row, not a data row
              // above -- Test Result IS this test's own current-period
              // verdict (same value as the Current Month row, printed as
              // its own summary line), so the pass/fail belongs there.
              // Compared against the Event of Default Trigger -- the
              // binding, looser limit -- same convention as this deal's
              // own CNL card and the Lock-Up/EoD KPI tiles above.
              const eod = v.event_of_default_trigger;
              const tr = v.current_test_result;
              const withinLimit = (tr !== null && tr !== undefined && eod !== null && eod !== undefined)
                ? `<span class="pill ${tr <= eod ? 'OK' : 'BREACH'}" title="Within limit? ${tr <= eod ? 'Yes' : 'No'} -- current ${fmtPct(tr,2)} vs. Event of Default Trigger ${fmtPct(eod,2)}.">${tr <= eod ? 'Yes' : 'No'}</span>`
                : '';
              return summaryRow('Test Result', tr, true, withinLimit);
            })()}
            ${summaryRow('Lock-Up Trigger', v.lockup_trigger, false)}
            ${summaryRow('Event of Default Trigger', v.event_of_default_trigger, false)}
          </tbody>
        </table>
      </div>`;
    }).join('');

    const agingHistory = d.aging_history || [];
    // TPine Leasing only: its own Aging Summary table has no 61-90 Days
    // bucket at all -- confirmed directly against the source ("Current |
    // 31-60 Days | Over 60 Days", with the table's own printed formula
    // e=(a+b) excluding Over 60 from the closing balance). Every other
    // deal's own template genuinely has this bucket, so hidden for this
    // one deal only rather than removed for everyone.
    const hasDays6190 = d.deal_slug !== 'move-trust-tpine-leasing-capital-corporation';
    // Meridian OneCap only: each period row in the Aggregate table is
    // clickable when it carries its own per-tranche breakdown
    // (tranche_rows) -- expands inline immediately below that row,
    // collapses on a second click. Each of the three periods on file has
    // its own genuine per-tranche data (13/13/14 rows -- tranche #14 was
    // funded in June), not one snapshot repeated three times, so this is
    // real per-period history, consistent with how every other
    // expandable row on this dashboard works (click to reveal detail
    // directly below, not a separate tab).
    const agingTrancheRowHtml = (r, periodIdx) => !r.tranche_rows ? '' : `
      <tr id="aging-tranche-${i}-${periodIdx}" style="display:none"><td colspan="9" style="padding:10px 16px;background:var(--subtle-bg)">
        <table class="mini-table">
          <thead><tr><th>Funding Date</th><th class="num group-start">Tranche #</th><th class="num">Current</th><th class="num">31-60 Days</th><th class="num">61-90 Days</th><th class="num">Deemed Defaults</th><th class="num">Cumulative Net Losses</th><th class="num">Closing Tranche Contract Balance</th><th class="num">Net Book Value</th></tr></thead>
          <tbody>
            ${r.tranche_rows.map(tr => `<tr>
                <td>${tr.funding_date}</td>
                <td class="num group-start">${tr.tranche}</td>
                <td class="num">${fmtMoney(tr.current)}</td>
                <td class="num">${fmtMoney(tr.days_31_60)}</td>
                <td class="num">${fmtMoney(tr.days_61_90)}</td>
                <td class="num">${fmtMoney(tr.deemed_defaults)}</td>
                <td class="num">${fmtMoney(tr.cumulative_net_losses)}</td>
                <td class="num">${fmtMoney(tr.closing_tranche_contract_balance)}</td>
                <td class="num">${fmtMoney(tr.net_book_value)}</td>
              </tr>`).join('')}
            <tr style="font-weight:700;border-top:2px solid var(--line)">
              <td>Tranche Balance Totals</td>
              <td class="num group-start"></td>
              <td class="num">${fmtMoney(r.current_0_30)}</td>
              <td class="num">${fmtMoney(r.days_31_60)}</td>
              <td class="num">${fmtMoney(r.days_61_90)}</td>
              <td class="num">${fmtMoney(r.written_off)}</td>
              <td class="num">${fmtMoney(r.cumulative_net_losses)}</td>
              <td class="num">${fmtMoney(r.closing_balance)}</td>
              <td class="num">${fmtMoney(r.bucket_sum_with_writeoff)}</td>
            </tr>
          </tbody>
        </table>
      </td></tr>`;
    const agingSummaryPanel = agingHistory.length ? `
      <div style="margin:14px 0">
        <div style="font-size:10.5px;text-transform:uppercase;color:var(--muted);letter-spacing:.03em;margin-bottom:8px;font-weight:600">Aging Summary</div>
        ${agingHistory.some(r => r.tranche_rows) ? `<div style="font-size:10px;color:var(--muted);margin-bottom:6px">Click a period to view its own per-tranche breakdown.</div>` : ''}
        <table class="mini-table">
          <thead>
            <tr>
              <th rowspan="2" style="vertical-align:bottom">Period</th>
              <th colspan="${hasDays6190 ? 4 : 3}" class="group-start" style="text-align:center;border-bottom:1px solid var(--line)">Aging Buckets</th>
              <th colspan="4" class="group-start" style="text-align:center;border-bottom:1px solid var(--line)">Reconciliation</th>
            </tr>
            <tr>
              <th class="num group-start">Current (0-30)</th><th class="num group-start">31-60 Days</th>${hasDays6190 ? '<th class="num group-start">61-90 Days</th>' : ''}<th class="num group-start">${agingHistory[0].written_off_bucket_label || '91+ / Other Defaults'}</th>
              <th class="num group-start">Cumulative Net Losses</th><th class="num">Current Period Losses</th><th class="num group-start">Closing Balance</th><th class="num group-start">Reconciles?</th>
            </tr>
          </thead>
          <tbody>
            ${agingHistory.map((r, idx) => {
              const prior = agingHistory[idx + 1];  // rows are most-recent-first, so the next row is the prior period
              const change = (prior && r.cumulative_net_losses !== null && r.cumulative_net_losses !== undefined
                             && prior.cumulative_net_losses !== null && prior.cumulative_net_losses !== undefined)
                             ? r.cumulative_net_losses - prior.cumulative_net_losses : null;
              const clickable = !!r.tranche_rows;
              const toggleAttr = clickable ? ` style="cursor:pointer" onclick="const row=document.getElementById('aging-tranche-${i}-${idx}'); row.style.display = row.style.display==='none' ? 'table-row' : 'none';"` : (r.reconciles===false?' style="background:var(--breach-bg)"':'');
              const agId = 'ag-' + d.deal_slug;
              const phAttr = idx === 0 ? ' class="ph-current"' : ` class="ph-hide" data-ph="${agId}"`;
              return `<tr${phAttr}${toggleAttr}${clickable?` title="Click to view this period's per-tranche breakdown."`:''}>
                <td>${clickable?'&#9656; ':''}${r.collection_period || r.period}${idx === 0 ? '<div class="ph-tag">Current</div>' : ''}</td>
                <td class="num group-start">${fmtMoney(r.current_0_30)}</td>
                <td class="num group-start">${fmtMoney(r.days_31_60)}</td>
                ${hasDays6190 ? `<td class="num group-start">${fmtMoney(r.days_61_90)}</td>` : ''}
                <td class="num group-start">${fmtMoney(r.written_off)}</td>
                <td class="num group-start">${fmtMoney(r.cumulative_net_losses)}</td>
                <td class="num" style="${change!==null?`color:${change<0?'var(--watch)':'var(--muted)'}`:'color:var(--muted)'}" title="${change!==null&&change<0?'A decrease in a cumulative figure is unusual -- worth checking whether this reflects a restatement or correction, not just normal loss recognition.':''}">${change!==null?(change>0?'+':'')+fmtMoney(change):'n/a'}</td>
                <td class="num group-start">${fmtMoney(r.closing_balance)}</td>
                <td class="num group-start" style="color:${r.reconciles===false?'var(--breach)':r.reconciles===true?'var(--ok)':'var(--muted)'};font-weight:${r.reconciles===false?'700':'400'}">${r.reconciles===false?`&#10007; off by ${fmtMoney(Math.abs((r.bucket_sum||0)-(r.closing_balance||0)))}`:r.reconciles===true?'Yes':'n/a'}</td>
              </tr>${idx === 0 ? agingTrancheRowHtml(r, idx) : agingTrancheRowHtml(r, idx).replace('<tr id=', `<tr data-ph-detail="ag-${d.deal_slug}" id=`)}`;
            }).join('')}
          </tbody>
        </table>
        ${phButton('ag-' + d.deal_slug, agingHistory.length - 1, 'period', '&#128198;')}
      </div>` : '';

    // Meridian OneCap only: Aging Summary moves from its usual spot (right
    // after Balance History, before the Financial Ratios tiles) to sit
    // right after the CNL Ratio section (card + the aggregate-tranches
    // table + the three aggregate-tranche ratio tiles) -- and that whole
    // CNL block itself sits after ratioTestPanels (this deal's own
    // Delinquency/Deemed Default/Charge-Off "Trailing History" panels),
    // not before it. Final order: ratio history table -> Trailing
    // History panels -> CNL block -> Aging Summary -> Status. Every
    // other deal keeps the shared order unchanged.
    const financialRatiosHeader = `<div style="font-size:10.5px;text-transform:uppercase;color:var(--muted);margin:12px 0 8px;font-weight:600">Financial Ratios (as reported, ${d.collection_period || 'period n/a'})</div>`;
    const ratiosPanel = isMeridianOneCap ? `
      <div style="margin-bottom:14px">
        ${restatementsPanel}
        ${periodHistoryPanel}
        ${financialRatiosHeader}
        ${aggregateTrancheTiles}
        ${ratioTilesGrouped}
        ${trendChartsPanel}
        ${ratioHistoryPanel}
        ${ratioTestPanels}
        ${cnlTiles}
        ${cnlByPeriodPanel}
        ${agingSummaryPanel}
        ${borrowerTiles}
        ${borrowerTrendPanel}
        ${borrowerHistoryPanel}
        ${top10Panel}
      </div>` : `
      <div style="margin-bottom:14px">
        ${restatementsPanel}
        ${periodHistoryPanel}
        ${agingSummaryPanel}
        ${financialRatiosHeader}
        ${ratioTilesGrouped}
        ${trendChartsPanel}
        ${ratioTestPanels}
        ${ratioHistoryPanel}
        ${cnlTiles}
        ${cnlTrendChart}
        ${cnlByPeriodPanel}
        ${borrowerTiles}
        ${borrowerTrendPanel}
        ${borrowerHistoryPanel}
        ${top10Panel}
      </div>`;

    let covRows = '';
    for (const c of flagged) {
      const priorStatus = priorByKey[stableKey(c)];
      const changedNote = (priorStatus !== undefined && priorStatus !== c.status)
        ? `<div style="color:var(--breach);font-size:11px;margin-top:2px;font-weight:600">was ${priorStatus} last period (${d.prior_period})</div>` : '';
      covRows += `<tr>
        <td><span class="pill ${statusClass(c.status)}" title="${covenantTooltip(c)}" style="cursor:help">${statusLabel(c.status)}</span></td>
        <td>${displayCategory(c, d.deal_slug)}</td>
        <td class="num">${c.legal_ref}</td>
        <td class="cov-desc">${c.description}${c.note?`<div style="color:var(--muted);font-size:11px;margin-top:2px">${c.note}</div>`:''}${changedNote}</td>
      </tr>`;
    }
    if (!flagged.length) covRows = `<tr><td colspan="4" style="color:var(--muted)">All tests OK at this watch threshold — nothing flagged for this deal.</td></tr>`;
    rows += `<tr class="deal-detail" id="detail-${i}"><td colspan="17"><div class="inner">
      ${ratiosPanel}
      <table class="mini-table">
        <thead><tr><th>Status</th><th>Category</th><th class="num">Reference</th><th>Test</th></tr></thead>
        <tbody>${covRows}</tbody>
      </table>
    </div></td></tr>`;
  });
  document.getElementById('dealTable').innerHTML =
    `<thead><tr><th>Deal</th><th>Current Status</th><th style="white-space:nowrap" title="Every measured ratio (ICR, Delinquency, Loss, CNL...) currently within the watch buffer of its trigger threshold, or already over it -- tightest first, with its 12-month trend. Dashed line = the threshold. Updates with the watch-threshold slider below. A deal can be OK overall and still have one or more ratios worth watching.">Ratio Watchlist</th><th>Current Status vs. Last Period</th><th class="num">${BALANCE_LABEL}</th><th class="num">Change</th><th class="num">${AMOUNT_LABEL}</th><th class="num">Change</th><th class="num">Contracts</th><th class="num">Change</th><th class="num group-start">Total Enhancement ($)</th><th class="num">Total Enhancement (%)</th><th class="num group-start">Program Limit</th><th class="num" title="Program Amount / Program Limit. For a deal with a warehouse facility, the term and warehouse facilities share one limit: Program Limit shows the max facility limit, with the warehouse amount outstanding in brackets, and Program Util. = (term outstanding + warehouse outstanding) / max facility limit.">Program Util.</th><th class="num" title="Warehouse Facility -- deals without one show —">WH Opening Advances</th><th class="num" title="Warehouse Facility -- deals without one show —. Cannot exceed the Max WH Limit column -- a structural ceiling, not just a covenant test.">WH Closing Advances</th><th class="num">WH Change</th><th class="num print-hide">Max WH Limit</th><th class="num print-hide">Max Program Limit</th></tr></thead>
     <tbody>${rows}
     <tr style="font-weight:700;border-top:2px solid var(--line)">
       <td>Total (${dealsComputed.length} deal(s))</td>
       <td></td>
       <td></td>
       <td></td>
       <td class="num">${fmtMoney(t.closing_tranche_balance)}</td>
       <td class="num" style="color:${t.tranche_balance_change_abs<0?'var(--breach)':'var(--ok)'}">${fmtMoney(t.tranche_balance_change_abs)} (${fmtPct(t.tranche_balance_change_pct,1)})</td>
       <td class="num">${t.closing_tranche_amount?fmtMoney(t.closing_tranche_amount):'n/a'}</td>
       <td class="num" style="color:${t.tranche_amount_change_abs<0?'var(--breach)':'var(--ok)'}">${t.closing_tranche_amount?`${fmtMoney(t.tranche_amount_change_abs)} (${fmtPct(t.tranche_amount_change_pct,1)})`:'n/a'}</td>
       <td class="num">${fmtNum(t.closing_contracts)}</td>
       <td class="num" style="color:${t.contracts_change_abs<0?'var(--breach)':'var(--ok)'}">${t.contracts_change_abs>0?'+':''}${t.contracts_change_abs}</td>
       <td class="num">${(() => { const vals = dealsComputed.map(d => d.total_enhancement && d.total_enhancement.total_enhancement_amount).filter(v => v!==null && v!==undefined); return vals.length ? fmtMoney(vals.reduce((a,b)=>a+b,0)) : 'n/a'; })()}</td>
       <td></td>
       <td class="num">${(() => { const u = utilParts(dealsComputed); if (!u) return t.total_program_limit ? fmtMoney(t.total_program_limit) : 'n/a'; return fmtMoney(u.total.lim) + (u.wh ? `<div style="font-size:9.5px;color:var(--muted);white-space:nowrap">(WH ${u.wh.amt ? fmtMoney(u.wh.amt) : '$0'})</div>` : ''); })()}</td>
       <td class="num">${(() => { const u = utilParts(dealsComputed); return u ? fmtPct(u.total.pct, 1) : ''; })()}</td>
       <td class="num">${t.deals_with_warehouse&&t.deals_with_warehouse.length?fmtMoney(t.total_warehouse_opening_advances):'n/a'}</td>
       <td class="num">${t.deals_with_warehouse&&t.deals_with_warehouse.length?fmtMoney(t.total_warehouse_closing_advances):'n/a'}</td>
       <td class="num" style="color:${t.warehouse_advances_change_abs<0?'var(--breach)':t.warehouse_advances_change_abs>0?'var(--ok)':'var(--muted)'}">${t.deals_with_warehouse&&t.deals_with_warehouse.length?fmtMoney(t.warehouse_advances_change_abs):'n/a'}</td>
       <td class="print-hide"></td>
       <td class="print-hide"></td>
     </tr>
     </tbody>`;

  // preserve open/closed state isn't attempted across re-render (buffer
  // changes are infrequent and re-collapsing is a fine trade-off for
  // always-correct recomputed statuses)
}

const watchInput = document.getElementById('watchBufferInput');
const defaultBuffer = Math.round((DATA.deals[0]?.watch_buffer_pct ?? 0.10) * 100);
watchInput.value = defaultBuffer;
watchInput.addEventListener('input', () => {
  let v = parseFloat(watchInput.value);
  if (isNaN(v) || v < 0) v = 0;
  if (v > 50) v = 50;
  render(v);
});
render(defaultBuffer);

function syncPhantomScroll() {
  // A native horizontal scrollbar on a wide table sits at the bottom of
  // that table's own box -- for a fully-expanded deals table that can be
  // many screens tall, that means scrolling all the way down just to
  // scroll sideways. This phantom scrollbar mirrors the real one and is
  // kept pinned to the bottom of the viewport (position:fixed, positioned
  // and shown/hidden via JS rather than CSS position:sticky -- sticky
  // did not behave correctly in this app's rendering environment even in
  // a minimal isolated test, verified directly, so this is the more
  // reliable mechanism) for as long as the actual table is in view.
  const track = document.getElementById('phantomScrollTrack');
  const inner = document.getElementById('phantomScrollInner');
  const real = document.getElementById('dealTableScroll');
  if (!track || !inner || !real) return;
  inner.style.width = real.scrollWidth + 'px';
  const realRect = real.getBoundingClientRect();
  track.style.left = (window.scrollX + realRect.left) + 'px';
  track.style.width = realRect.width + 'px';
  let syncing = false;
  track.onscroll = () => { if (syncing) return; syncing = true; real.scrollLeft = track.scrollLeft; syncing = false; };
  real.onscroll = () => { if (syncing) return; syncing = true; track.scrollLeft = real.scrollLeft; syncing = false; };
  updatePhantomVisibility();
}
function updatePhantomVisibility() {
  const track = document.getElementById('phantomScrollTrack');
  const real = document.getElementById('dealTableScroll');
  if (!track || !real) return;
  // Only needed at all if the table is actually wider than it can show --
  // and only shown while some part of the real table is in the viewport,
  // so it doesn't float over unrelated content once you've scrolled well
  // past the table.
  const scrollable = real.scrollWidth > real.clientWidth + 2;
  const rect = real.getBoundingClientRect();
  const inView = rect.top < window.innerHeight && rect.bottom > 0;
  // Stays visible the whole time the deals table is on screen, except
  // for the moment a deal panel's own table scrollbar passes under it:
  // the bar would sit exactly on top of that scrollbar and swallow drags
  // meant for it, so it steps aside only while the two overlap.
  let coversTableBar = false;
  if (scrollable && inView) {
    const barTop = window.innerHeight - (track.offsetHeight || 16) - 2;
    for (const w of real.querySelectorAll('.deal-detail.open .fit-scroll')) {
      if (w.scrollWidth <= w.clientWidth + 1) continue;
      const r = w.getBoundingClientRect();
      if (!r.height) continue;
      const sbTop = r.bottom - (w.offsetHeight - w.clientHeight) - 2;
      if (r.bottom > barTop && sbTop < window.innerHeight) { coversTableBar = true; break; }
    }
  }
  track.style.display = (scrollable && inView && !coversTableBar) ? 'block' : 'none';
}
syncPhantomScroll();
window.addEventListener('resize', syncPhantomScroll);
window.addEventListener('scroll', updatePhantomVisibility);

function toggleDeal(i) {
  document.getElementById(`detail-${i}`).classList.toggle('open');
  document.getElementById(`chev-${i}`).classList.toggle('open');
  syncPhantomScroll();
}

function setAllDeals(open) {
  document.querySelectorAll('.deal-detail').forEach(r => r.classList.toggle('open', open));
  document.querySelectorAll('.chev').forEach(c => c.classList.toggle('open', open));
  syncPhantomScroll();
}

function printDashboard() {
  // Nothing hidden behind a click should be missing from a printed copy:
  // temporarily expand every collapsed deal row and every <details>
  // panel (balance history, ratio history, Top 10 Obligor, etc.), print,
  // then restore exactly how it looked before -- so printing doesn't
  // permanently change what the person was looking at on screen.
  const openedDetails = Array.from(document.querySelectorAll('details:not([open])'));
  openedDetails.forEach(d => d.setAttribute('open', ''));
  const openedRows = Array.from(document.querySelectorAll('.deal-detail:not(.open)'));
  openedRows.forEach(r => r.classList.add('open', 'print-forced'));
  const openedChevs = openedRows.map(r => document.getElementById(r.id.replace('detail-', 'chev-')))
    .filter(c => c && !c.classList.contains('open'));
  openedChevs.forEach(c => c.classList.add('open', 'print-forced'));

  const restore = () => {
    openedDetails.forEach(d => d.removeAttribute('open'));
    openedRows.forEach(r => r.classList.remove('open', 'print-forced'));
    openedChevs.forEach(c => c.classList.remove('open', 'print-forced'));
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}
