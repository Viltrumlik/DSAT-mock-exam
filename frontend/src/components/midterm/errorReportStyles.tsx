/**
 * Theme tokens for the student error report. They are declared as custom properties rather
 * than Tailwind classes because the SVG chart paints fills/strokes from the same values the
 * surrounding card uses, and an inline SVG cannot read a Tailwind utility.
 *
 * The app switches themes with next-themes' `class` strategy, so `.dark`/`.light` on <html>
 * must win; `data-theme` and the OS preference are honoured too so the same markup survives
 * being exported or printed outside the app shell. Order matters: the explicit light
 * selectors come last so a light-themed app on a dark-preferring OS stays light.
 */

const LIGHT = `
  --mer-surface: #ffffff;
  --mer-surface-2: #f8fafc;
  --mer-border: #e7ebf3;
  --mer-grid: #eef2f6;
  --mer-axis: #dde5f0;
  --mer-text: #0f1729;
  --mer-text-2: #475569;
  --mer-text-muted: #64748b;
  --mer-series: #2a68c0;
  --mer-series-hover: #21539e;
  --mer-tooltip-bg: #0f1729;
  --mer-tooltip-border: transparent;
  --mer-tooltip-text: #ffffff;
  --mer-tooltip-muted: #a8b4c8;
`;

const DARK = `
  --mer-surface: #111827;
  --mer-surface-2: #1e293b;
  --mer-border: rgba(255, 255, 255, 0.10);
  --mer-grid: #1c2637;
  --mer-axis: #2c3a4f;
  --mer-text: #f1f5f9;
  --mer-text-2: #cbd5e1;
  --mer-text-muted: #94a3b8;
  --mer-series: #3987e5;
  --mer-series-hover: #63a3ee;
  --mer-tooltip-bg: #1e293b;
  --mer-tooltip-border: rgba(255, 255, 255, 0.14);
  --mer-tooltip-text: #f1f5f9;
  --mer-tooltip-muted: #94a3b8;
`;

const CSS = `
:root {${LIGHT}}
@media (prefers-color-scheme: dark) { :root {${DARK}} }
:root[data-theme="dark"], :root.dark {${DARK}}
:root[data-theme="light"], :root.light {${LIGHT}}

.mer-card {
  background: var(--mer-surface);
  border: 1px solid var(--mer-border);
  color: var(--mer-text);
}
.mer-tile {
  background: var(--mer-surface-2);
  border: 1px solid var(--mer-border);
}
.mer-scroll { overflow-x: auto; overflow-y: visible; }
.mer-plot { position: relative; }
.mer-tooltip {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  transform: translate(-50%, -100%);
  min-width: 168px;
  max-width: 240px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--mer-tooltip-border);
  background: var(--mer-tooltip-bg);
  color: var(--mer-tooltip-text);
  box-shadow: 0 8px 24px rgba(15, 23, 41, 0.22);
}
.mer-tooltip-below { transform: translate(-50%, 0); }
.mer-tooltip-sub { color: var(--mer-tooltip-muted); }
.mer-hit { fill: transparent; cursor: default; }
.mer-bar { fill: var(--mer-series); transition: fill 120ms ease; }
.mer-slot:hover .mer-bar, .mer-slot[data-active="true"] .mer-bar { fill: var(--mer-series-hover); }
.mer-grid-line { stroke: var(--mer-grid); stroke-width: 1; shape-rendering: crispEdges; }
.mer-axis-line { stroke: var(--mer-axis); stroke-width: 1; shape-rendering: crispEdges; }
.mer-axis-text { fill: var(--mer-text-muted); font-size: 11px; font-weight: 600; }
.mer-value-text { fill: var(--mer-text-2); font-size: 11px; font-weight: 800; }
.mer-table { width: 100%; border-collapse: collapse; }
.mer-table th, .mer-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--mer-border);
  font-size: 13px;
}
.mer-table th { color: var(--mer-text-muted); font-weight: 700; }
.mer-table td { color: var(--mer-text-2); }
.mer-table td.mer-num, .mer-table th.mer-num { text-align: right; font-variant-numeric: tabular-nums; }
.mer-details > summary {
  cursor: pointer;
  list-style: none;
  font-size: 13px;
  font-weight: 700;
  color: var(--mer-text-muted);
}
.mer-details > summary::-webkit-details-marker { display: none; }

/* Print-to-PDF of the report card alone — visibility rather than display so the card keeps
   its position while everything around it drops out. */
@media print {
  body * { visibility: hidden !important; }
  .mer-card, .mer-card * { visibility: visible !important; }
  .mer-card {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    border: none;
    padding: 0;
  }
  .mer-card button { display: none; }
  .mer-scroll { overflow: visible !important; }
  .mer-details > summary { display: none; }
  .mer-tile, .mer-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export function ErrorReportStyles() {
  return <style href="midterm-error-report" precedence="default" dangerouslySetInnerHTML={{ __html: CSS }} />;
}
