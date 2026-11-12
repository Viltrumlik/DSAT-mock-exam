"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { Button, chipClass, inputShell } from "@/features/console/ui";
import { cn } from "@/lib/cn";
import type { AdminPastpaperSection, PastpaperModuleBrief, SectionPublishViolation } from "@/lib/api";
import { SAT_MODULE_TIME_LIMIT_MINUTES } from "@/lib/satRules";
import type { CoverBlock } from "./LibraryCard";

/**
 * What the past-paper and practice-test libraries share on the library card (design handoff v0.3, Modern board
 * "Tests as a media library", PR 15b): a section is one subject and two modules. The words are the pages' own.
 */

// ── fields ───────────────────────────────────────────────────────────────

export const FIELD_LABEL = "mb-1.5 block text-[14px] font-medium leading-5 text-ms-fg";
export const FIELD_HINT = "mt-1.5 text-[13px] leading-[18px] text-ms-fg-3";
/** The console field shell on a native input or select; it draws its own focus. */
export const FIELD = inputShell({
  className:
    "w-full outline-none placeholder:text-ms-fg-3 disabled:cursor-not-allowed disabled:bg-ms-surface-2 disabled:text-ms-fg-disabled",
});

/** One option of a radio group: a bordered row that lights up when chosen. */
export function RadioRow({
  name,
  value,
  checked,
  disabled,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "ms-transition flex cursor-pointer items-start gap-2.5 rounded-ms-ctl border px-3 py-2.5 text-[14px] leading-5 text-ms-fg",
        checked ? "border-ms-primary bg-ms-primary-soft" : "border-ms-border-input bg-ms-card hover:bg-ms-surface",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--ms-primary)]"
      />
      <span>{children}</span>
    </label>
  );
}

// ── the page ─────────────────────────────────────────────────────────────

/** The Builder's page header: an eyebrow, the title in the display face, a line, and the page's buttons. */
export function LibraryHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: ReactNode; actions: ReactNode }) {
  return (
    <header data-header className="animate-ms-fade-in flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-ms-over mb-1.5 uppercase text-ms-primary-text">{eyebrow}</p>
        <h1 className="font-ms-display text-ms-b-display text-ms-fg">{title}</h1>
        <p className="mt-1 max-w-2xl text-[14px] text-ms-fg-2">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}

/** A filter as console chips under its name; `data-filter` keeps the group findable. */
export function LibraryFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5" data-filter={label.toLowerCase()}>
      <span className="text-ms-over uppercase text-ms-fg-3">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)} className={chipClass(value === o.v)}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Something went wrong on the page (a load, a delete the server refused): the server's words, in red. */
export function LibraryError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="animate-ms-fade-in flex items-start gap-2.5 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3.5 py-2.5 text-[14px] leading-5 text-ms-critical-fg">
      <Icon name="alert" size="sm" className="mt-0.5" />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

// ── the card's parts ─────────────────────────────────────────────────────

/** The section's subject as the Builder colours it: R&W rose, Math violet. */
export function SubjectBadge({ subject }: { subject: string }) {
  const math = subject === "MATH";
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-[9px] text-[13px] font-semibold leading-none",
        math ? "bg-ms-math-soft text-ms-math-fg" : "bg-ms-rw-soft text-ms-rw-fg",
      )}
    >
      <Icon name={math ? "sigma" : "book"} size="sm" className="size-3.5" />
      {math ? "Math" : "R&W"}
    </span>
  );
}

function moduleName(m: PastpaperModuleBrief): string {
  return m.module_order != null ? `Module ${m.module_order}` : `Module #${m.id}`;
}

/** The section's modules in order. */
export function sortedModules(section: AdminPastpaperSection): PastpaperModuleBrief[] {
  return [...(section.modules ?? [])].sort((a, b) => (a.module_order ?? 0) - (b.module_order ?? 0));
}

/**
 * A section's shape for its cover: its modules in the subject's colour, as long as their time limits (the SAT's
 * 32 / 35 min when a module has none). The list carries no question counts, so a module is drawn solid.
 */
export function sectionShape(section: AdminPastpaperSection): { blocks: CoverBlock[]; minutes: number } {
  const math = section.subject === "MATH";
  const fallback = SAT_MODULE_TIME_LIMIT_MINUTES[math ? "MATH" : "READING_WRITING"];
  const words = math ? "Math" : "Reading & Writing";
  const modules = sortedModules(section);
  if (modules.length === 0) {
    return { blocks: [{ key: "none", tone: math ? "math" : "rw", weight: 1, fill: 0, title: "No modules yet." }], minutes: 0 };
  }
  let minutes = 0;
  const blocks = modules.map((m, i): CoverBlock => {
    const mins = m.time_limit_minutes ?? fallback;
    minutes += mins;
    return { key: String(m.id), tone: math ? "math" : "rw", weight: 1, second: i > 0, title: `${words} · ${moduleName(m)} · ${mins} min` };
  });
  return { blocks, minutes };
}

/** One link per module into the question editor ("Module 1 — edit questions"). */
export function ModuleLinks({ section, hrefFor }: { section: AdminPastpaperSection; hrefFor: (m: PastpaperModuleBrief) => string }) {
  const modules = sortedModules(section);
  const math = section.subject === "MATH";
  if (modules.length === 0) {
    return <p className="rounded-[12px] border border-dashed border-ms-border-strong px-3 py-2 text-[13px] italic text-ms-fg-3">No modules yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {modules.map((m) => (
        <Link
          key={m.id}
          href={hrefFor(m)}
          className="ms-transition ms-press inline-flex h-9 min-w-0 items-center gap-1.5 rounded-[12px] bg-ms-surface-2 px-3 text-[14px] font-medium text-ms-fg hover:bg-ms-surface-3"
        >
          <Icon name="ms-module" size="sm" className={math ? "text-ms-math-fg" : "text-ms-rw-fg"} />
          <span className="truncate">{moduleName(m)} — edit questions</span>
          <Icon name="right" size="sm" className="text-ms-fg-3" />
        </Link>
      ))}
    </div>
  );
}

/** The server's list of what blocks a publish (SAT rules), as it wrote it. */
export function PublishViolations({ violations }: { violations: SectionPublishViolation[] | null }) {
  if (!violations || violations.length === 0) return null;
  return (
    <div role="alert" className="animate-ms-fade-in flex items-start gap-2 rounded-[12px] border border-ms-attention-line bg-ms-attention-soft px-3 py-2.5 text-[13px] leading-[18px] text-ms-attention-fg">
      <Icon name="warn" size="sm" className="mt-px size-4" />
      <div>
        <strong className="font-semibold">Can&apos;t publish yet:</strong>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {violations.map((v, i) => (
            <li key={`${v.code}-${i}`}>{v.message}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Delete asks first, in place: Confirm / Cancel. */
export function InlineDelete({ label, busy = false, onDelete }: { label: string; busy?: boolean; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  return asking ? (
    <div className="animate-ms-fade-in ml-auto flex items-center gap-1.5">
      <Button
        variant="danger"
        size="sm"
        disabled={busy}
        onClick={() => {
          setAsking(false);
          onDelete();
        }}
      >
        Confirm
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </div>
  ) : (
    <Button variant="ghost" size="sm" icon="trash" aria-label={label} onClick={() => setAsking(true)} className="ml-auto text-ms-critical-fg hover:text-ms-critical-fg">
      Delete
    </Button>
  );
}

// ── the section dialog ───────────────────────────────────────────────────

/**
 * The New / Edit dialog in the console's look. It stays on the page (no portal) as before; Esc and the scrim
 * close it like every console dialog.
 */
export function LibraryModal({
  open,
  title,
  error,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  error: string | null;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="animate-ms-scrim-in absolute inset-0 bg-ms-scrim" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-ms-dialog-in relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-y-auto rounded-ms-dlg bg-ms-card p-[22px] shadow-ms-3"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">{title}</h2>
          <Button variant="ghost" size="sm" icon="x" aria-label="Close" tooltip={false} onClick={onClose} />
        </div>
        {error ? (
          <div className="mb-4">
            <LibraryError>{error}</LibraryError>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** Cancel and Save, side by side, at the foot of the dialog's form. */
export function ModalActions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return (
    <div className="flex gap-2 pt-2">
      <Button variant="secondary" className="flex-1" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" className="flex-1" state={saving ? "busy" : "idle"} busyLabel="Saving…" disabled={saving}>
        Save
      </Button>
    </div>
  );
}
