"use client";

/**
 * The /ops/access console's own parts, in the console's look (design handoff v0.3): the card, the
 * selectable row, the hairline table, the status pill, the avatar, the filter chips and the row's icon
 * actions. `accessUi.tsx` keeps the old look because `StudentMultiSelect` — which the teacher's midterm
 * screens use too — still draws with it.
 */

import { useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { AVATAR_TONE, Badge, chipClass, initialsOf, toneOf, type BadgeTone } from "@/features/console/ui";
import { cn } from "@/lib/cn";

// ── look ─────────────────────────────────────────────────────────────────
// `cn` does not merge Tailwind classes, so each constant is whole and a caller only adds what differs.

/** A console card. */
export const CARD = "rounded-ms-card bg-ms-card shadow-ms-1";
/** A small label over a group: "Classroom", "Recipients · 3". */
export const EYEBROW = "text-ms-over flex items-center gap-1.5 text-ms-fg-3";
/** A pickable row (a student, a test, a mode); `ROW_ON` once picked. */
export const ROW = "ms-transition ms-press flex w-full items-center gap-3 rounded-ms-ctl border px-3.5 py-3 text-left";
export const ROW_OFF = "border-ms-border bg-ms-card hover:border-ms-border-strong hover:bg-ms-surface";
export const ROW_ON = "border-ms-primary bg-ms-primary-soft";
/** A line in a read-only list (the confirm step's recipients and tests). */
export const LINE = "flex min-w-0 items-center gap-3 rounded-ms-ctl border border-ms-border bg-ms-card px-3.5 py-2.5";
/** Nothing to list, said in a dashed box. */
export const EMPTY_BOX = "rounded-ms-ctl border border-dashed border-ms-border-strong p-6 text-center text-[14px] text-ms-fg-3";
/** A plain text action ("Clear all"). */
export const TEXT_ACTION = "ms-transition rounded-[6px] text-[13px] font-medium text-ms-fg-3 hover:text-ms-fg";

// Tables: the card clips (rows have a hover background), the inner div scrolls sideways.
export const TABLE_CARD = "overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1";
export const TABLE = "w-full border-separate border-spacing-0 text-[14px] text-ms-fg";
const TH_BASE = "h-10 whitespace-nowrap border-b border-ms-border bg-ms-card px-3 text-[13px] font-medium text-ms-fg-3 first:pl-5 last:pr-5";
export const TH = `${TH_BASE} text-left`;
export const TH_R = `${TH_BASE} text-right`;
export const TD = "border-b border-ms-line px-3 py-2.5 align-middle first:pl-5 last:pr-5";
export const TR = "ms-transition hover:bg-ms-surface [&:last-child>td]:border-b-0";

// ── status ───────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: "positive",
  REVOKED: "critical",
  EXPIRED: "attention",
};

/** A grant's status, in its own word ("ACTIVE"), as a console pill. */
export function GrantStatus({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"} dot>
      {status}
    </Badge>
  );
}

// ── avatar ───────────────────────────────────────────────────────────────

const AVATAR_SIZE = {
  xs: "size-5 text-[9px]",
  sm: "size-8 text-[12px]",
  md: "size-10 text-[15px]",
  lg: "size-11 text-[16px]",
} as const;

/**
 * The console's round avatar: initials in a tone picked from `seed`, the photo when there is one. A photo
 * that fails to load falls back to the initials, so a dead media URL looks like an ordinary no-photo account.
 * Decorative: the name is always written next to it.
 */
export function AccessAvatar({
  name,
  seed,
  size = "md",
  src,
}: {
  name: string;
  seed?: string | number;
  size?: keyof typeof AVATAR_SIZE;
  src?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold leading-none",
        AVATAR_SIZE[size],
        AVATAR_TONE[toneOf(seed ?? name)],
      )}
    >
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}

// ── chips ────────────────────────────────────────────────────────────────

/** A filter choice (resource type, subject): the chosen one inverted. */
export function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={chipClass(active)}>
      {children}
    </button>
  );
}

/** Something picked, with its own ×. */
export function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="animate-ms-fade-in inline-flex h-8 max-w-full items-center gap-1 rounded-full bg-ms-primary-soft pl-3 pr-[3px] text-[13px] font-medium leading-none text-ms-primary-text">
      <span className="max-w-[220px] truncate">{label}</span>
      <button
        type="button"
        aria-label="Remove"
        onClick={onRemove}
        className="ms-press grid size-[26px] shrink-0 place-items-center rounded-full hover:bg-ms-primary-soft-2"
      >
        <Icon name="x" size="sm" />
      </button>
    </span>
  );
}

/** The tick box drawn on a pickable row; the row itself is the button. */
export function PickMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "ms-transition grid size-5 shrink-0 place-items-center rounded-[6px] border-[1.5px] text-white",
        checked ? "border-ms-primary bg-ms-primary" : "border-ms-border-input bg-ms-card",
      )}
    >
      {checked ? <Icon name="check" size="sm" className="animate-ms-check-pop size-3.5" /> : null}
    </span>
  );
}

// ── inputs and actions ───────────────────────────────────────────────────

/** A search box that reports every keystroke, as these lists always have (no debounce, nothing trimmed). */
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full">
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ms-fg-3" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="ms-transition h-(--ms-h-ctl) w-full rounded-ms-ctl border border-ms-border-input bg-ms-card pl-10 pr-3 text-[15px] text-ms-fg placeholder:text-ms-fg-3 focus-visible:border-ms-primary focus-visible:shadow-[0_0_0_3px_var(--ms-primary-soft-2)] focus-visible:outline-none"
      />
    </div>
  );
}

/** A table row's icon action; `title` names it (tooltip and screen reader). */
export function RowAction({
  title,
  icon,
  onClick,
  danger = false,
  busy = false,
}: {
  title: string;
  icon: IconName;
  onClick: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-busy={busy || undefined}
      onClick={onClick}
      disabled={busy}
      className={cn(
        "ms-transition ms-press grid size-9 shrink-0 place-items-center rounded-ms-ctl disabled:cursor-not-allowed disabled:opacity-60",
        danger ? "text-ms-critical-fg hover:bg-ms-critical-soft" : "text-ms-fg-2 hover:bg-ms-surface-2 hover:text-ms-fg",
      )}
    >
      {busy ? <Icon name="loader" size="sm" className="animate-ms-spin" /> : <Icon name={icon} size="sm" />}
    </button>
  );
}

/** A table's loading rows: shimmer bars in the table's own frame. */
export function LoadingRows({ cols, rows = 3 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} aria-hidden="true">
          <td colSpan={cols} className={TD}>
            <div className="h-6 animate-ms-shimmer rounded-ms-ctl bg-ms-surface-2" />
          </td>
        </tr>
      ))}
    </>
  );
}
