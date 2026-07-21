"use client";

import { useState } from "react";
import {
  AXIS_GUTTER,
  BAR_RADIUS,
  LABEL_ANGLE,
  LABEL_BAND,
  MAX_BAR_WIDTH,
  PAD_RIGHT,
  PAD_TOP,
  PLOT_HEIGHT,
  SLOT_WIDTH,
  accuracyPercent,
  barPath,
  leftOverhang,
  niceTicks,
  truncateLabel,
} from "./chartGeometry";
import { ErrorReportStyles } from "./errorReportStyles";
import type { ErrorReportSkill } from "./errorReportApi";

/**
 * Mistakes per skill, as a single-series vertical column chart drawn by hand in SVG.
 *
 * `skills` arrives from the API already filtered to wrong > 0 and already sorted
 * decreasing. It is rendered in the order given and never re-sorted or re-filtered here —
 * the PDF is built from the same payload, and a UI-side sort would let the two disagree.
 */
export default function SkillMistakeChart({ skills }: { skills: ErrorReportSkill[] }) {
  const [active, setActive] = useState<number | null>(null);

  const { top, ticks } = niceTicks(skills.reduce((m, s) => Math.max(m, s.wrong), 0));
  const labels = skills.map((s) => truncateLabel(s.skill));
  const padLeft = AXIS_GUTTER + leftOverhang(labels);
  const innerWidth = skills.length * SLOT_WIDTH;
  const width = padLeft + innerWidth + PAD_RIGHT;
  const height = PAD_TOP + PLOT_HEIGHT + LABEL_BAND;
  const baseline = PAD_TOP + PLOT_HEIGHT;
  const barWidth = Math.min(MAX_BAR_WIDTH, SLOT_WIDTH - 20);
  const y = (value: number) => baseline - (value / top) * PLOT_HEIGHT;

  const columns = skills.map((s, i) => {
    const center = padLeft + i * SLOT_WIDTH + SLOT_WIDTH / 2;
    const capY = y(s.wrong);
    return { skill: s, center, capY, barX: center - barWidth / 2, barHeight: baseline - capY };
  });

  const headline = skills
    .slice(0, 3)
    .map((s) => `${s.skill}, ${s.wrong} of ${s.total} missed`)
    .join("; ");
  const ariaLabel =
    `Column chart of mistakes by skill. ${skills.length} skill${skills.length === 1 ? "" : "s"} with mistakes. ` +
    `Most missed: ${headline}. The same numbers are in the table below the chart.`;

  const hovered = active == null ? null : columns[active];
  // A tall column leaves no room above its cap, and the scroll container clips whatever
  // escapes upwards — so the tooltip flips under the cap instead.
  const tooltipAbove = hovered ? hovered.capY > 132 : true;
  const tooltipX = hovered ? Math.min(Math.max(hovered.center, 120), width - 120) : 0;

  return (
    <div>
      <ErrorReportStyles />
      {/* The chart, not the page, absorbs the horizontal overflow on narrow screens. */}
      <div className="mer-scroll">
        <div className="mer-plot" style={{ width, minWidth: "100%" }}>
          <svg
            role="img"
            aria-label={ariaLabel}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            style={{ display: "block", maxWidth: "none" }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  className={t === 0 ? "mer-axis-line" : "mer-grid-line"}
                  x1={padLeft}
                  x2={padLeft + innerWidth}
                  y1={y(t) + 0.5}
                  y2={y(t) + 0.5}
                />
                <text className="mer-axis-text" x={padLeft - 10} y={y(t)} textAnchor="end" dominantBaseline="middle">
                  {t}
                </text>
              </g>
            ))}

            {columns.map((c, i) => (
              <g key={`${c.skill.skill_id ?? c.skill.skill}`} className="mer-slot" data-active={active === i}>
                <path className="mer-bar" d={barPath(c.barX, c.capY, barWidth, c.barHeight)} />
                <text className="mer-value-text" x={c.center} y={c.capY - 8} textAnchor="middle">
                  {c.skill.wrong}
                </text>
                <text
                  className="mer-axis-text"
                  x={c.center}
                  y={baseline + 14}
                  textAnchor="end"
                  transform={`rotate(${LABEL_ANGLE} ${c.center} ${baseline + 14})`}
                >
                  {labels[i]}
                </text>
                {/* Hit target spans the whole slot, so the tooltip is reachable without
                    hitting a 24px column. */}
                <rect
                  className="mer-hit"
                  x={c.center - SLOT_WIDTH / 2}
                  y={PAD_TOP}
                  width={SLOT_WIDTH}
                  height={PLOT_HEIGHT}
                  rx={BAR_RADIUS}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive((prev) => (prev === i ? null : prev))}
                />
              </g>
            ))}
          </svg>

          {hovered && (
            <div
              className={`mer-tooltip${tooltipAbove ? "" : " mer-tooltip-below"}`}
              style={{ left: tooltipX, top: tooltipAbove ? hovered.capY - 12 : hovered.capY + 14 }}
            >
              <p className="text-[13px] font-extrabold leading-snug">{hovered.skill.skill}</p>
              <p className="mer-tooltip-sub mt-0.5 text-[11px] font-semibold">{hovered.skill.domain}</p>
              <p className="mt-1.5 text-[12px] font-bold">
                {hovered.skill.wrong} wrong of {hovered.skill.total}
              </p>
              <p className="mer-tooltip-sub text-[11px] font-semibold">
                {accuracyPercent(hovered.skill.total, hovered.skill.wrong)}% accuracy
              </p>
            </div>
          )}
        </div>
      </div>

      <details className="mer-details mt-4">
        <summary>View the same numbers as a table</summary>
        <div className="mer-scroll mt-3">
          <table className="mer-table">
            <thead>
              <tr>
                <th scope="col">Skill</th>
                <th scope="col">Domain</th>
                <th scope="col" className="mer-num">Mistakes</th>
                <th scope="col" className="mer-num">Questions</th>
                <th scope="col" className="mer-num">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((s) => (
                <tr key={`${s.skill_id ?? s.skill}`}>
                  <td>{s.skill}</td>
                  <td>{s.domain}</td>
                  <td className="mer-num">{s.wrong}</td>
                  <td className="mer-num">{s.total}</td>
                  <td className="mer-num">{accuracyPercent(s.total, s.wrong)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
