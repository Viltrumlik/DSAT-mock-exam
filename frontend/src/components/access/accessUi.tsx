"use client";

/* Shared UI primitives for the /ops/access redesign — colored avatars, filter
   pills, removable chips, the logo watermark, and the card / button class
   strings, so every access surface reads as one system. */

import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import styles from "./access.module.css";

// ── class-string tokens (mockup) ────────────────────────────────────────────
export const accClass = {
  scope: styles.scope,
  serif: styles.serif,
  rise: styles.rise,
  /** Cream/white card with 14px radius + soft border. */
  card: "rounded-2xl border border-border bg-card",
  /** Selectable row/card, unselected. */
  selectable:
    "rounded-2xl border border-border bg-card transition-[transform,border-color,box-shadow] duration-150 hover:border-[color:var(--primary)]/40 hover:-translate-y-px",
  /** Selectable row/card, selected — blue ring + soft glow + tinted bg. */
  selectableOn:
    "rounded-2xl border border-[color:var(--primary)] bg-[var(--acc-card-sel)] shadow-[0_8px_20px_-12px_rgba(42,104,192,0.45)]",
  /** Primary CTA. */
  primaryBtn:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-[15px] font-bold text-primary-foreground transition-[transform,box-shadow,background] duration-150 hover:bg-[var(--primary-hover)] hover:-translate-y-px active:translate-y-0 disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:bg-primary",
  /** Secondary / back button. */
  ghostBtn:
    "inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-[15px] font-bold text-foreground transition-[transform,border-color] duration-150 hover:border-[color:var(--primary)]/40 hover:-translate-y-px",
  /** Search input. */
  search:
    "w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-[color:var(--primary)]/25",
  /** Section eyebrow label. */
  eyebrow: "flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
};

// ── colored avatar ──────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "#2a68c0", "#16a34a", "#d97706", "#7c3aed", "#0d9488",
  "#db2777", "#0891b2", "#dc2626", "#4f46e5", "#65a30d",
];

export function avatarColor(seed: string | number): string {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({ name, seed, size = 40 }: { name: string; seed?: string | number; size?: number }) {
  const initial = (name.trim()[0] || "?").toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: avatarColor(seed ?? name),
      }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

// ── filter pill (subject / version / year / resource-type tab) ───────────────
export function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[11px] border px-[15px] py-[9px] text-[13px] font-semibold transition-[background,border-color,color,transform] duration-150 active:scale-[0.97]",
        active
          ? "border-[var(--acc-navy)] bg-[var(--acc-navy)] text-white"
          : "border-border bg-card text-muted-foreground hover:border-[color:var(--primary)]/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ── removable selection chip ─────────────────────────────────────────────────
export function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--acc-chip-border)] bg-card py-[5px] pl-3 pr-[6px] text-[13px] font-semibold text-foreground transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-px hover:shadow-sm">
      <span className="max-w-[220px] truncate">{label}</span>
      <button
        type="button"
        aria-label="Remove"
        onClick={onRemove}
        className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ── logo watermark ───────────────────────────────────────────────────────────
export function Watermark() {
  return (
    <div className={styles.watermark} aria-hidden>
      <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="100" cy="100" r="70" stroke="currentColor" strokeWidth="14" />
        <path d="M68 100l22 22 42-46" stroke="currentColor" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
