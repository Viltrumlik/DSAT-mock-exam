"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { inputShell, useFieldControl } from "./Field";
import { usePresence } from "./presence";
import { LISTBOX, OptionRow, type ListOption } from "./Select";

/**
 * Combobox (design handoff v0.3, Controls board): type to narrow a long list ("mid" → the Middle classes,
 * the typed part bold). Options carry a second line and a meta; one that can't be picked says why. With
 * `multiple`, picks become removable chips and the list stays open; Backspace on an empty box removes the
 * last chip. Nothing found says so in words — and offers "Create …" when the caller can create.
 * WAI-ARIA combobox with a listbox popup: focus stays in the box, ↑ ↓ move, Enter picks, Esc closes.
 */
type Common = {
  options: ListOption[];
  placeholder?: string;
  /** Over the list: "Classes you can add to". */
  heading?: string;
  /** For "No class matches 'xyz'" and "Create class 'xyz'". */
  noun?: string;
  onCreate?: (text: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
};
type Single = Common & { multiple?: false; value: string | null; onChange: (v: string | null) => void };
type Multiple = Common & { multiple: true; value: string[]; onChange: (v: string[]) => void; summary?: (picked: ListOption[]) => ReactNode };

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Options whose label, second line or meta contain the query (case and accents aside), in the given order. */
export function filterOptions(options: readonly ListOption[], query: string): ListOption[] {
  const q = norm(query.trim());
  if (!q) return [...options];
  return options.filter((o) => norm(`${o.label} ${o.sub ?? ""} ${o.meta ?? ""}`).includes(q));
}

/** The label with the typed part bold: "Mid" + "dle M3 · English". */
export function highlight(label: string, query: string): ReactNode {
  const q = norm(query.trim());
  if (!q) return label;
  const at = norm(label).indexOf(q);
  if (at < 0) return label;
  return (
    <>
      {label.slice(0, at)}
      <b className="font-bold">{label.slice(at, at + q.length)}</b>
      {label.slice(at + q.length)}
    </>
  );
}

const CREATE = "\u0000create";

export function Combobox(props: Single | Multiple) {
  const { options, placeholder, heading, noun = "item", onCreate, disabled = false, className } = props;
  const f = useFieldControl();
  const listId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const { mounted, closing } = usePresence(open, 120);
  const [query, setQuery] = useState("");
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState(-1);
  const picked = props.multiple ? props.value : props.value ? [props.value] : [];
  const pickedOptions = picked.map((v) => options.find((o) => o.value === v)).filter((o): o is ListOption => Boolean(o));

  const shown = useMemo(() => filterOptions(options, typing ? query : ""), [options, query, typing]);
  const canCreate = Boolean(onCreate && query.trim() && !options.some((o) => norm(o.label) === norm(query.trim())));
  const rows: ListOption[] = canCreate ? [...shown, { value: CREATE, label: `Create ${noun} “${query.trim()}”` }] : shown;
  const firstEnabled = rows.findIndex((o) => !o.disabledReason);
  const at = active >= 0 && active < rows.length && !rows[active].disabledReason ? active : firstEnabled;

  const close = () => {
    setOpen(false);
    setTyping(false);
    setQuery("");
    setActive(-1);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      setOpen(false);
      setTyping(false);
      setQuery("");
      setActive(-1);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open && at >= 0) box.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, at]);

  const pick = (i: number) => {
    const o = rows[i];
    if (!o || o.disabledReason) return;
    if (o.value === CREATE) {
      onCreate?.(query.trim());
      close();
      return;
    }
    if (props.multiple) {
      const has = props.value.includes(o.value);
      props.onChange(has ? props.value.filter((v) => v !== o.value) : [...props.value, o.value]);
      setQuery("");
      setTyping(false);
      input.current?.focus();
    } else {
      props.onChange(o.value);
      close();
    }
  };

  const move = (step: 1 | -1) => {
    const n = rows.length;
    for (let k = 1; k <= n; k++) {
      const i = (((at + step * k) % n) + n) % n;
      if (!rows[i].disabledReason) return setActive(i);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      if (open && at >= 0) {
        e.preventDefault();
        pick(at);
      }
    } else if (e.key === "Escape") {
      if (open || query) {
        e.preventDefault();
        close();
      }
    } else if (e.key === "Backspace" && props.multiple && !query && props.value.length) {
      props.onChange(props.value.slice(0, -1));
    } else if (e.key === "Tab") {
      close();
    }
  };

  const single = !props.multiple ? pickedOptions[0] : undefined;
  const text = typing ? query : (single?.label ?? "");

  return (
    <div ref={box} className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="relative">
        <div
          onMouseDown={(e) => {
            if (e.target !== input.current) e.preventDefault();
            input.current?.focus();
            if (!disabled) setOpen(true);
          }}
          className={cn(
            inputShell({ invalid: f.invalid, disabled }),
            props.multiple && pickedOptions.length > 0 && "h-auto min-h-[var(--ms-h-ctl)] flex-wrap py-1.5",
            "cursor-text",
          )}
        >
          <Icon name="search" size="sm" className="shrink-0 text-ms-fg-3" />
          {props.multiple
            ? pickedOptions.map((o) => (
                <span key={o.value} className="animate-ms-pop inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-ms-surface-2 pl-2.5 pr-1 text-[14px] font-medium text-ms-fg">
                  <span className="truncate">{o.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${o.label}`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => props.onChange(props.value.filter((v) => v !== o.value))}
                    className="grid size-5 shrink-0 place-items-center rounded-full text-ms-fg-3 hover:bg-ms-surface-3 hover:text-ms-fg focus-visible:outline-2 focus-visible:outline-ms-ring"
                  >
                    <Icon name="x" size="sm" className="size-3" />
                  </button>
                </span>
              ))
            : null}
          <input
            ref={input}
            id={f.id}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && at >= 0 ? `${listId}-${at}` : undefined}
            aria-label={props["aria-label"]}
            aria-describedby={f.describedBy}
            aria-invalid={f.invalid || undefined}
            disabled={disabled}
            autoComplete="off"
            value={text}
            placeholder={props.multiple && pickedOptions.length ? `Add ${noun}…` : placeholder}
            onFocus={() => !disabled && setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setTyping(true);
              setActive(-1);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            className="min-w-[6rem] flex-1 bg-transparent outline-none placeholder:text-ms-fg-3 disabled:cursor-not-allowed"
          />
          {!props.multiple && single && !typing ? (
            <button
              type="button"
              aria-label={`Clear ${single.label}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => props.onChange(null)}
              className="grid size-6 shrink-0 place-items-center rounded-full text-ms-fg-3 hover:bg-ms-surface-2 hover:text-ms-fg"
            >
              <Icon name="x" size="sm" className="size-3.5" />
            </button>
          ) : null}
        </div>
        {mounted ? (
          <div
            id={listId}
            role="listbox"
            aria-label={heading ?? props["aria-label"]}
            aria-multiselectable={props.multiple || undefined}
            className={cn(LISTBOX, "origin-top", closing ? "animate-ms-dialog-out" : "animate-ms-dialog-in")}
          >
            {heading ? <div className="px-2.5 pb-1 pt-2 text-[13px] font-semibold leading-[18px] text-ms-fg-3">{heading}</div> : null}
            {shown.length === 0 ? (
              <p className="px-2.5 py-2.5 text-[14px] text-ms-fg-2" role="status">
                No {noun} matches “{query.trim()}”.
              </p>
            ) : null}
            {rows.map((o, i) =>
              o.value === CREATE ? (
                <div
                  key={CREATE}
                  id={`${listId}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={cn("flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-[15px] font-semibold text-ms-primary-text", i === at && "bg-ms-surface-2")}
                >
                  <Icon name="plus" size="sm" />
                  {o.label}
                </div>
              ) : (
                <OptionRow
                  key={o.value}
                  id={`${listId}-${i}`}
                  index={i}
                  option={o}
                  active={i === at}
                  selected={picked.includes(o.value)}
                  onPick={() => pick(i)}
                  onHover={() => setActive(i)}
                  label={highlight(o.label, typing ? query : "")}
                />
              ),
            )}
          </div>
        ) : null}
      </div>
      {props.multiple && props.summary && pickedOptions.length ? (
        <span className="text-[13px] leading-[18px] text-ms-fg-3">{props.summary(pickedOptions)}</span>
      ) : null}
    </div>
  );
}
