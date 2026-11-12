"use client";

import Link from "next/link";
import { Fragment, useId, type ReactNode, type RefObject } from "react";

import { Icon } from "@/components/ui/Icon";
import { Badge, Button, Dialog } from "@/features/console/ui";
import { CONTROL, FIELD_LABEL } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";
import { VOCAB_CSV_COLUMNS, VOCAB_SET_TARGET_WORDS } from "./types";

/**
 * What the Builder's three vocabulary pages share (design handoff v0.3, PR 19): the breadcrumb, the inline rename,
 * the CSV import dialog and the word-count meter against the 25-word target. The words are the pages' own.
 */

/** "← Vocabulary › College Panda › Set 3": the earlier steps are links, the last one is where you are. */
export function VocabCrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Vocabulary" className="animate-ms-fade-in flex flex-wrap items-center gap-1 text-[14px]">
      {items.map((it, i) => (
        <Fragment key={`${i}-${it.label}`}>
          {i > 0 ? <Icon name="right" size="sm" className="text-ms-fg-3" /> : null}
          {it.href ? (
            <Link
              href={it.href}
              className="ms-transition inline-flex items-center gap-1 rounded-[8px] px-2 py-1 font-semibold text-ms-primary-text hover:bg-ms-surface-2"
            >
              {i === 0 ? <Icon name="left" size="sm" className="size-3.5" /> : null}
              {it.label}
            </Link>
          ) : (
            <span aria-current="page" className="rounded-[8px] px-2 py-1 font-semibold text-ms-fg">
              {it.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

/** Rename in place: the title in a field, Save and Cancel beside it. */
export function RenameForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  busy,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  /** The field's name for a screen reader: "Section title". */
  label: string;
  className?: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="animate-ms-fade-in flex flex-wrap items-center gap-2"
    >
      <input
        autoFocus
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(CONTROL, className ?? "max-w-sm")}
      />
      <Button type="submit" variant="primary" size="sm" icon="check" state={busy ? "busy" : "idle"} disabled={!value.trim() || busy}>
        Save
      </Button>
      <Button variant="secondary" size="sm" icon="x" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/** Progress against the 25-word target. Guidance only — nothing is blocked. */
export function WordCountMeter({ count }: { count: number }) {
  const over = count > VOCAB_SET_TARGET_WORDS;
  const pct = Math.min(100, Math.round((count / VOCAB_SET_TARGET_WORDS) * 100));
  return (
    <span className="inline-flex items-center gap-2 text-[13px]">
      <span aria-hidden="true" className="h-1.5 w-20 overflow-hidden rounded-full bg-ms-surface-3">
        <span
          className={cn("ms-transition block h-full rounded-full", over ? "bg-ms-attention" : "bg-ms-primary")}
          style={{ width: `${over ? 100 : pct}%` }}
        />
      </span>
      <span className={cn("font-semibold tabular-nums", over ? "text-ms-attention-fg" : "text-ms-fg")}>
        {count} / {VOCAB_SET_TARGET_WORDS}
      </span>
      {over ? <Badge tone="attention">{count - VOCAB_SET_TARGET_WORDS} over</Badge> : null}
    </span>
  );
}

/**
 * The CSV import (a section's or a set's): the columns and their rules, the file — it uploads as soon as it is
 * picked — Importing…, what happened, Done.
 */
export function CsvImportDialog({
  open,
  onClose,
  title,
  intro,
  help,
  inputId,
  inputRef,
  busy,
  msg,
  onFile,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  intro: ReactNode;
  help: ReactNode;
  inputId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  busy: boolean;
  msg: { ok: boolean; text: string } | null;
  onFile: (file: File | null) => void;
}) {
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId} width={480} locked={busy}>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-[22px] pb-2 pt-[22px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">
              {title}
            </h2>
            <p className="mt-1 text-[14px] text-ms-fg-2">{intro}</p>
          </div>
          <Button variant="ghost" size="sm" icon="x" aria-label="Close" tooltip={false} disabled={busy} onClick={onClose} />
        </div>

        <div className="rounded-ms-ctl bg-ms-surface px-3.5 py-3">
          <p className="text-ms-over uppercase text-ms-fg-3">Columns</p>
          <code className="mt-1 block font-ms-mono text-[12px] leading-5 text-ms-fg">{VOCAB_CSV_COLUMNS}</code>
          <p className="mt-2 text-[13px] leading-[19px] text-ms-fg-2">{help}</p>
        </div>

        <div>
          <label htmlFor={inputId} className={FIELD_LABEL}>
            CSV file
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[14px] text-ms-fg-2 file:mr-3 file:h-9 file:cursor-pointer file:rounded-[10px] file:border-0 file:bg-ms-primary-soft file:px-3 file:text-[14px] file:font-semibold file:text-ms-primary-text disabled:opacity-50"
          />
        </div>

        {busy ? (
          <p className="inline-flex items-center gap-2 text-[14px] font-medium text-ms-fg-2">
            <Icon name="loader" size="sm" className="animate-ms-spin" />
            Importing…
          </p>
        ) : null}

        {msg ? (
          <p
            role={msg.ok ? "status" : "alert"}
            className={cn(
              "animate-ms-fade-in flex items-start gap-2 rounded-ms-ctl border px-3.5 py-2.5 text-[14px] font-medium leading-5",
              msg.ok ? "border-ms-positive-line bg-ms-positive-soft text-ms-positive-fg" : "border-ms-critical-line bg-ms-critical-soft text-ms-critical-fg",
            )}
          >
            <Icon name={msg.ok ? "ok" : "alert"} size="sm" className="mt-0.5 shrink-0" />
            {msg.text}
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex shrink-0 items-center justify-end gap-2 border-t border-ms-border bg-ms-surface px-5 py-3.5">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
