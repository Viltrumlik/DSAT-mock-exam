"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { IconName } from "@/components/ui/Icon";
import { ChipCount, Select, TextInput, chipClass, follow, type ListOption } from "@/features/console/ui";
import { cn } from "@/lib/cn";
import type { ChangeListFilter } from "./ChangeList";

/**
 * The filter card's fields and the chip row of lc-up's list shape (canvas boards "Students" and "Groups"). Every one
 * writes the list's address, like any changelist filter, so a reload or a pasted link lands on the same list.
 */

/** A typed filter (name, phone, price): it applies 300 ms after typing stops, or at once on Enter. */
export function FilterText({
  value,
  placeholder,
  onCommit,
  icon,
  inputMode,
}: {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
  icon?: IconName;
  inputMode?: "text" | "tel" | "numeric";
}) {
  const [text, setText] = useState(value);
  // What the address last held: our own commit coming back must not overwrite what has been typed since.
  const committed = useRef(value);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    commitRef.current = onCommit;
  });

  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setText(value);
  }, [value]);

  const commit = (raw: string) => {
    const next = raw.trim();
    if (next === committed.current) return;
    committed.current = next;
    commitRef.current(next);
  };

  useEffect(() => {
    if (text.trim() === committed.current) return;
    const t = window.setTimeout(() => commit(text), 300);
    return () => window.clearTimeout(t);
  }, [text]);

  return (
    <TextInput
      type="search"
      icon={icon}
      value={text}
      inputMode={inputMode}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(text);
      }}
    />
  );
}

/**
 * One facet as a select: its choices with their counts, "Any …" first to clear it. Before the list has loaded (or
 * when the server offers no such facet) it shows its name, disabled.
 */
export function FacetSelect({
  filter,
  label,
  selected,
  onPick,
  optionLabel,
  anyLabel,
}: {
  filter: ChangeListFilter | undefined;
  /** The field's name, shown while nothing is chosen: "Group". */
  label: string;
  selected: string | null;
  onPick: (value: string | null) => void;
  /** The words for a choice, when the server's need changing ("ODD" → "Mon Wed Fri"). */
  optionLabel?: (value: string, label: string) => string;
  /** The first choice, which clears the filter: "Any group" by default. */
  anyLabel?: string;
}) {
  const choices = filter?.options ?? [];
  const options: ListOption<string>[] = [
    { value: "", label: anyLabel ?? `Any ${label.toLowerCase()}` },
    ...choices.map((o) => ({
      value: o.value,
      label: optionLabel ? optionLabel(o.value, o.label) : o.label,
      meta: o.count.toLocaleString("en-US"),
    })),
  ];
  // A chosen value the facet no longer lists (a stale link) still shows what is in force.
  if (selected && !choices.some((o) => o.value === selected)) options.push({ value: selected, label: selected });
  return (
    <Select<string>
      value={selected}
      onChange={(v) => onPick(v || null)}
      options={options}
      placeholder={label}
      aria-label={label}
      disabled={!filter}
    />
  );
}

export type QuickChip = {
  key: string;
  label: string;
  /** The server's count; none drawn when unknown. */
  count?: number;
  on: boolean;
  href: string;
  onPick: () => void;
  /** A small dot in the chip's verdict or category colour: "var(--ms-critical)". */
  dot?: string;
};

/** The chip row (All / Owe money / Trial …): real links, so a new tab works; a plain click goes through `onPick`. */
export function QuickChips({ label, chips }: { label: string; chips: QuickChip[] }): ReactNode {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-wrap items-center gap-2">
      {chips.map((c) => (
        <a
          key={c.key}
          href={c.href}
          aria-current={c.on ? "true" : undefined}
          onClick={(e) => follow(e, c.onPick)}
          className={cn(chipClass(c.on, c.count === 0 && !c.on))}
        >
          {c.dot ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: c.dot }} /> : null}
          {c.label}
          {c.count !== undefined ? <ChipCount n={c.count} on={c.on} /> : null}
        </a>
      ))}
    </div>
  );
}

/** A facet's choice count, `undefined` when the server sent no such choice. */
export function facetCount(filters: ChangeListFilter[] | undefined, key: string, value: string): number | undefined {
  return filters?.find((f) => f.key === key)?.options.find((o) => o.value === value)?.count;
}
