"use client";

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { CARD_SURFACE, TONE_INK, TONE_WASH, type Tone } from "./tones";

/**
 * A card in the dashboard look: title row with an optional icon chip, optional actions on the
 * right, content below. `spine` paints the left edge in a tone — the one place the kit uses
 * colour structurally rather than decoratively.
 */
export function Card({
  title, subtitle, icon, spine, actions, children, padded = true,
}: {
  title?: ReactNode; subtitle?: ReactNode; icon?: ReactNode; spine?: Tone;
  actions?: ReactNode; children?: ReactNode; padded?: boolean;
}) {
  return (
    <section
      style={{
        ...CARD_SURFACE,
        overflow: "hidden",
        borderLeft: spine ? `4px solid ${TONE_INK[spine]}` : CARD_SURFACE.border,
      }}
    >
      {(title || actions) && (
        <header
          style={{
            display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap",
            padding: "22px 24px", borderBottom: children ? "1px solid var(--dz-border)" : undefined,
          }}
        >
          {icon && (
            <span
              style={{
                width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                background: "var(--dz-indigo-soft)", color: "var(--dz-indigo)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {icon}
            </span>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)", margin: 0 }}>
              {title}
            </h2>
            {subtitle && (
              <div style={{ fontSize: 13, color: "var(--dz-mute)", fontWeight: 500, marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
          {actions}
        </header>
      )}
      {children != null && <div style={{ padding: padded ? "18px 24px 22px" : 0 }}>{children}</div>}
    </section>
  );
}

/** One figure with its label. A null value reads as an em dash — never as a zero. */
export function Stat({ label, value, unit, tone = "neutral", hint }: {
  label: string; value: number | string | null | undefined; unit?: string; tone?: Tone; hint?: string;
}) {
  const shown = value === null || value === undefined || value === "" ? "—" : value;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--dz-faint)" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
        <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.02em", color: shown === "—" ? "var(--dz-faint)" : TONE_INK[tone] }}>
          {shown}
        </span>
        {unit && <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dz-mute)" }}>{unit}</span>}
      </div>
      {hint && <div style={{ fontSize: 12, color: "var(--dz-mute)", marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/** A status chip: tinted, borderless, never a bare coloured dot the reader has to decode. */
export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "3px 10px", borderRadius: 999,
        background: TONE_WASH[tone], color: TONE_INK[tone],
        fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style"> & {
  variant?: "primary" | "ghost" | "danger";
  busy?: boolean;
  children: ReactNode;
};

/** The kit's only button. `busy` disables it and shows a spinner in place of nothing moving. */
export function Button({ variant = "primary", busy = false, children, disabled, ...rest }: ButtonProps) {
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: "10px 18px", borderRadius: 14, fontSize: 14, fontWeight: 700,
    cursor: busy || disabled ? "not-allowed" : "pointer", opacity: busy || disabled ? 0.6 : 1,
    fontFamily: "inherit", transition: "filter .15s",
  } as const;
  const skin =
    variant === "primary"
      ? { background: "var(--dz-indigo)", color: "#fff", border: "1px solid var(--dz-indigo)" }
      : variant === "danger"
        ? { background: "var(--dz-danger-soft)", color: "var(--dz-danger)", border: "1px solid transparent" }
        : { background: "transparent", color: "var(--dz-ink)", border: "1px solid var(--dz-border)" };
  return (
    <button type="button" {...rest} disabled={busy || disabled} style={{ ...base, ...skin }}>
      {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** Label, control, then either a hint or an error — never both, so the error is never missed. */
export function Field({ label, htmlFor, hint, error, children }: {
  label: string; htmlFor?: string; hint?: string; error?: string | null; children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={htmlFor} style={{ fontSize: 13, fontWeight: 700, color: "var(--dz-ink)" }}>{label}</label>
      {children}
      {error ? (
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dz-danger)" }}>{error}</span>
      ) : hint ? (
        <span style={{ fontSize: 12, color: "var(--dz-mute)" }}>{hint}</span>
      ) : null}
    </div>
  );
}

/** Loading placeholder. Sized by the caller to the block it stands in for, so nothing jumps. */
export function Skeleton({ height = 16, width = "100%", radius = 8, count = 1 }: {
  height?: number; width?: number | string; radius?: number; count?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        // `ds-skeleton` rather than a flat `--dz-*` fill, for two reasons that both bit us.
        //
        // It is the product's shared shimmer. A placeholder that does not move does not read as
        // "loading" — it reads as a layout that has broken, and the teacher waits for nothing.
        //
        // It is also the MARKER the rest of the codebase settles on: `pageSettled()` in the load
        // tests asks whether any `.ds-skeleton` is left. A kit skeleton without the class was
        // invisible to that question, so pages on the kit had to widen the selector or add
        // `aria-busy` of their own, and two spellings of "still loading" is how one of them
        // eventually gets missed. No inline background here: the class carries a gradient, and
        // an inline fill would win and kill the animation.
        <div key={i} className="ds-skeleton" style={{ height, width, borderRadius: radius }} />
      ))}
    </div>
  );
}
