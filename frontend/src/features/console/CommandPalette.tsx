"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "./ui/presence";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { filterCommands, type Command } from "./commands";
import { useEntitySearch, type EntityKind, type HitBadge } from "./entitySearch";

const BADGE: Record<HitBadge["tone"], string> = {
  critical: "bg-ms-critical-soft text-ms-critical-fg",
  attention: "bg-ms-attention-soft text-ms-attention-fg",
  positive: "bg-ms-positive-soft text-ms-positive-fg",
  info: "bg-ms-info-soft text-ms-info-fg",
  frozen: "bg-ms-frozen-soft text-ms-frozen-fg",
  neutral: "bg-ms-neutral-soft text-ms-neutral-fg",
};

const NOUN: Record<EntityKind, string> = { Students: "students", Classes: "classes", Questions: "questions" };

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const q = query.trim();
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-ms-attention-soft px-px text-inherit shadow-[inset_0_-2px_0_var(--ms-attention-line)]">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  );
}

/**
 * ⌘K / Ctrl+K from anywhere in a console (design handoff v0.3, Overlays board): a search box over
 * every page this person may open and a few actions. Arrows move, Enter goes, Escape closes and
 * focus returns to where it was. Full-screen on a phone.
 *
 * Portalled into <body>, outside the console surface, so it sets the UI face itself.
 */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
  entityKinds = [],
  placeholder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly Command[];
  /** What else this person may search on the server, in this console (see `entityScope`). */
  entityKinds?: readonly EntityKind[];
  placeholder?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  // ⌘K / Ctrl+K toggles it from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Opening remembers where focus was and starts fresh; closing puts focus back.
  useEffect(() => {
    if (open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setActive(0);
      inputRef.current?.focus();
    } else if (returnTo.current) {
      returnTo.current.focus();
      returnTo.current = null;
    }
  }, [open]);

  const { groups: entityGroups, retry } = useEntitySearch(open ? query : "", entityKinds);
  // Found students, classes and questions first (the person at the desk), then pages and actions.
  const results = useMemo(() => {
    const found: Command[] = entityGroups.flatMap((g) =>
      g.status === "done"
        ? g.hits.map((h) => ({ id: h.id, label: h.label, group: g.kind, icon: h.icon, href: h.href, hint: h.hint, badge: h.badge }))
        : [],
    );
    return [...found, ...filterCommands(commands, query)];
  }, [entityGroups, commands, query]);
  const pending = entityGroups.filter((g) => g.status !== "done");
  const groups = useMemo(() => {
    const out: { name: Command["group"]; items: { command: Command; index: number }[] }[] = [];
    results.forEach((command, index) => {
      const last = out[out.length - 1];
      if (last && last.name === command.group) last.items.push({ command, index });
      else out.push({ name: command.group, items: [{ command, index }] });
    });
    return out;
  }, [results]);

  // Mounted while it plays its exit (Motion board: things leave the way they came).
  const { mounted, closing } = usePresence(open);
  if (!mounted || typeof document === "undefined") return null;

  // A modal dialog keeps focus: Tab and Shift+Tab cycle through its own controls, never the page
  // behind the scrim.
  function trapTab(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const focusables = [
      ...(e.currentTarget.querySelectorAll<HTMLElement>('input, button, [href], [tabindex]:not([tabindex="-1"])') ?? []),
    ].filter((el) => !el.hasAttribute("disabled"));
    if (!focusables.length) return;
    e.preventDefault();
    const at = focusables.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (at <= 0 ? focusables.length - 1 : at - 1) : (at + 1) % focusables.length;
    focusables[next].focus();
  }

  const optionId = (index: number) => `${baseId}-opt-${index}`;
  const current = Math.min(active, Math.max(results.length - 1, 0));

  function go(command: Command | undefined) {
    if (!command) return;
    onOpenChange(false);
    if (command.run) command.run();
    else if (command.href) {
      if (/^https?:\/\//.test(command.href)) window.location.href = command.href;
      else router.push(command.href);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[current]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  }

  return createPortal(
    <div className={`fixed inset-0 z-[70] font-ms-sans text-[15px] text-ms-fg${closing ? " pointer-events-none" : ""}`}>
      <div
        aria-hidden="true"
        className={`${closing ? "animate-ms-scrim-out" : "animate-ms-scrim-in"} absolute inset-0 bg-ms-scrim`}
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onKeyDown={trapTab}
        className={`${closing ? "animate-ms-dialog-out" : "animate-ms-dialog-in"} absolute inset-0 flex flex-col overflow-hidden bg-ms-card shadow-ms-3 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[12vh] sm:max-h-[min(560px,76vh)] sm:w-[min(640px,calc(100vw-32px))] sm:-translate-x-1/2 sm:rounded-ms-pop`}
      >
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-ms-border px-4">
          <Icon name="search" size="lg" className="text-ms-fg-3" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? optionId(current) : undefined}
            aria-label={entityKinds.length ? `Search ${entityKinds.map((k) => NOUN[k]).join(", ")}, pages and actions` : "Search pages and actions"}
            value={query}
            placeholder={placeholder ?? (entityKinds.length ? `Search ${entityKinds.map((k) => NOUN[k]).join(", ")}, pages…` : "Search pages and actions…")}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-ms-fg outline-none placeholder:text-ms-fg-3"
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="ms-transition grid min-h-11 place-items-center px-1"
          >
            <span className="rounded-[6px] border border-ms-border-strong px-1.5 py-0.5 font-ms-mono text-[12px] text-ms-fg-2">Esc</span>
          </button>
        </div>

        {pending.map((g) => (
          <div key={g.kind} role="status" className="flex min-h-11 items-center gap-3 px-4 text-[14px] text-ms-fg-3">
            {g.status === "loading" ? (
              <>
                <span className="animate-ms-spin inline-flex">
                  <Icon name="loader" size="sm" />
                </span>
                Searching {NOUN[g.kind]}…
              </>
            ) : (
              <>
                <Icon name="alert" size="sm" className="text-ms-critical-fg" />
                <span className="text-ms-critical-fg">Couldn’t search {NOUN[g.kind]}.</span>
                <button type="button" onClick={retry} className="ms-transition ml-auto min-h-9 rounded-[8px] px-2.5 font-semibold text-ms-primary-text hover:bg-ms-surface-2">
                  Retry
                </button>
              </>
            )}
          </div>
        ))}
        <div id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && pending.length === 0 ? (
            <p className="px-4 py-10 text-center text-[14px] text-ms-fg-3">
              Nothing called “{query.trim()}”. Try a page name — Students, Finance, Full mocks.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.name} role="group" aria-label={group.name}>
                <div className="px-2.5 pb-1 pt-2.5 text-[13px] font-semibold text-ms-fg-3">{group.name}</div>
                {group.items.map(({ command, index }) => {
                  const selected = index === current;
                  return (
                    <div
                      key={command.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={selected}
                      data-href={command.href}
                      onMouseMove={() => setActive(index)}
                      onClick={() => go(command)}
                      className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-2.5 ${selected ? "bg-ms-surface-2" : ""}`}
                    >
                      <Icon name={command.icon} className="text-ms-fg-2" />
                      <span className="min-w-0 truncate">
                        <Highlight text={command.label} query={query} />
                      </span>
                      {command.hint ? (
                        <span className={`min-w-0 truncate text-[13px] text-ms-fg-3 ${command.badge ? "" : "ml-auto shrink-0"}`}>{command.hint}</span>
                      ) : null}
                      {command.badge ? (
                        <span className={`ml-auto inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[12px] font-semibold ${BADGE[command.badge.tone]}`}>
                          {command.badge.text}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="hidden shrink-0 items-center gap-4 border-t border-ms-border bg-ms-surface px-4 py-2 text-[12px] text-ms-fg-3 sm:flex">
          <span><kbd className="font-ms-mono">↑ ↓</kbd> move</span>
          <span><kbd className="font-ms-mono">Enter</kbd> open</span>
          <span><kbd className="font-ms-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
