"use client";

/**
 * The pieces both standalone midterm screens draw with.
 *
 * The list and the detail were one 955-line file, and the half of it that was neither screen —
 * a search box, two dropdowns, a tab strip, the way a midterm states its own shape — is here so
 * that changing how a filter looks is one edit rather than two that drift apart.
 *
 * The kit (`@/features/teacher/ui`) has no form controls and no tab strip yet. The three below
 * are deliberately local rather than pushed up into it: a second page needing one is the signal
 * to promote it, and until then the kit stays the small, argued-over thing it is.
 */

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import {
  midtermLevelLabel,
  scoringScaleLabel,
  subjectLabel,
  type MidtermCatalogItem,
  type MidtermProgress,
} from "@/lib/midtermApi";
import { Pill, type Tone } from "@/features/teacher/ui";

/** Which tone each stage of a sitting wears. The words come from `midtermStateLabel`. */
export const PROGRESS_TONE: Record<MidtermProgress, Tone> = {
  not_started: "neutral",
  in_progress: "info",
  scoring: "warning",
  completed: "success",
  voided: "warning",
};

export const PROGRESS_FILTERS: { id: MidtermProgress | "all"; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "not_started", label: "Not started" },
  { id: "in_progress", label: "In progress" },
  { id: "scoring", label: "Scoring" },
  { id: "completed", label: "Completed" },
  { id: "voided", label: "Voided" },
];

/**
 * "We do not know", rendered honestly. A mean with nobody in the denominator is not zero, and
 * a midterm whose check failed is not a midterm with no students. The title is the whole point
 * of the component: an em dash on its own tells the reader nothing about WHY it is an em dash.
 */
export function Unknown({ title }: { title: string }) {
  return (
    <span style={{ color: "var(--dz-faint)", cursor: "help" }} title={title}>
      —
    </span>
  );
}

/** A midterm's own shape: subject, length, question count, scale, and its difficulty tier. */
export function MidtermMeta({ m }: { m: MidtermCatalogItem }) {
  const level = midtermLevelLabel(m.level);
  return (
    <span
      style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 7px",
        fontSize: 13, color: "var(--dz-mute)",
      }}
    >
      <span>{subjectLabel(m.subject)}</span>
      <span aria-hidden>·</span>
      <span>{m.duration_minutes} min</span>
      <span aria-hidden>·</span>
      <span>{m.question_count} questions</span>
      <span aria-hidden>·</span>
      <span>{scoringScaleLabel(m.scoring_scale, m.score_ceiling)}</span>
      {level && <Pill tone="neutral">{level}</Pill>}
    </span>
  );
}

/** A row of figures inside a Card. Two columns on a phone, four from a tablet up. */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 18,
      }}
    >
      {children}
    </div>
  );
}

/** A header cell that explains what it counts. The hint is the column's definition, not decoration. */
export function ColumnHint({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <span style={{ cursor: "help" }} title={hint}>
      {children}
    </span>
  );
}

export function SearchBox({ value, onChange, placeholder, label }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string;
}) {
  return (
    <label style={{ position: "relative", flex: "1 1 200px", minWidth: 180 }}>
      <span
        style={{
          position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)",
          color: "var(--dz-faint)", display: "flex", pointerEvents: "none",
        }}
      >
        <Search size={15} aria-hidden />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        style={{
          width: "100%", boxSizing: "border-box",
          border: "1px solid var(--dz-border)", background: "var(--dz-panel)",
          borderRadius: 14, padding: "10px 14px 10px 36px",
          fontFamily: "inherit", fontSize: 14, color: "var(--dz-ink)", outline: "none",
        }}
      />
    </label>
  );
}

/**
 * A dropdown in the kit's skin.
 *
 * A native `<select>` rather than a menu of divs: these lists run to six options, a teacher on
 * a phone gets the platform's own picker, and the whole thing already works from a keyboard.
 * `appearance: none` only takes the OS chrome off the box; the chevron is drawn as a background
 * so the control still reads as openable.
 */
export function Choice<T extends string>({ value, onChange, label, options, width = 176 }: {
  value: T;
  onChange: (v: T) => void;
  label: string;
  options: { value: T; label: string }[];
  width?: number;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={label}
      style={{
        width, boxSizing: "border-box", appearance: "none",
        border: "1px solid var(--dz-border)", background: "var(--dz-panel)",
        borderRadius: 14, padding: "10px 34px 10px 14px",
        fontFamily: "inherit", fontSize: 14, fontWeight: 600, color: "var(--dz-ink)",
        outline: "none", cursor: "pointer",
        // The one literal colour in this file. A data URI cannot read a custom property or
        // `currentColor`, and a mid grey is the one value that stays legible against both the
        // light panel and the dark one — which is the test a hardcoded colour has to pass here.
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%23888' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 12px center",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The two views of the list page, with how many are in each.
 *
 * `role="tablist"` is deliberately NOT used. These buttons swap a panel below them without
 * moving focus and without arrow-key navigation, which is a segmented control; claiming the
 * tab role would promise a keyboard behaviour that is not implemented, and a screen-reader
 * user would arrow around a strip that does not answer.
 */
export function Tabs<T extends string>({ value, onChange, items }: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string; count: number; icon: ReactNode }[];
}) {
  return (
    <div
      role="group"
      aria-label="What to show"
      style={{ display: "flex", gap: 4, background: "var(--dz-neutral-soft)", borderRadius: 14, padding: 4, flexWrap: "wrap" }}
    >
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(it.id)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              padding: "8px 14px", borderRadius: 11, border: "none", cursor: "pointer",
              fontFamily: "inherit", fontSize: 13, fontWeight: 700,
              background: active ? "var(--dz-indigo)" : "transparent",
              color: active ? "#fff" : "var(--dz-mute)",
            }}
          >
            {it.icon}
            {it.label}
            <span
              style={{
                fontSize: 12, fontWeight: 800, padding: "1px 7px", borderRadius: 999,
                background: active ? "rgba(255,255,255,.22)" : "var(--dz-card)",
                color: active ? "#fff" : "var(--dz-faint)",
              }}
            >
              {it.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The filter strip above a table: controls on one line, wrapping to their own on a phone. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>{children}</div>;
}

/** What the table below is currently showing, in words rather than as a silent shortening. */
export function ShowingLine({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dz-mute)" }}>{children}</div>;
}
