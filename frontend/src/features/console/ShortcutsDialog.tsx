"use client";

import { useEffect, useId, useState } from "react";

import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";

/** Ask the shell to show the list from anywhere (the user menu's "Keyboard shortcuts"). */
export const SHORTCUTS_EVENT = "ms:shortcuts";
export function openShortcuts(): void {
  window.dispatchEvent(new Event(SHORTCUTS_EVENT));
}

const ROWS: { keys: string[]; what: string }[] = [
  { keys: ["⌘", "K"], what: "Search people, classes, questions and pages" },
  { keys: ["/"], what: "Search this list" },
  { keys: ["["], what: "Collapse or pin the panel" },
  { keys: ["G", "…"], what: "Jump to a category: G, then the letter the panel shows" },
  { keys: ["?"], what: "This list" },
  { keys: ["Esc"], what: "Close what is open" },
];

/**
 * The keyboard shortcuts (design handoff v0.3, Overlays board, "Keyboard shortcuts"): `?` anywhere
 * but in a field, or the user menu. Windows reads ⌘ as Ctrl.
 */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      setOpen(true);
    };
    const onAsk = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(SHORTCUTS_EVENT, onAsk);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(SHORTCUTS_EVENT, onAsk);
    };
  }, []);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} labelledBy={id} width={460}>
      <div className="flex flex-col gap-4 px-[22px] pb-2 pt-[22px]">
        <h2 id={id} className="text-[20px] font-bold text-ms-fg">
          Keyboard shortcuts
        </h2>
        <dl className="flex flex-col">
          {ROWS.map((r) => (
            <div key={r.what} className="flex items-center justify-between gap-4 border-b border-ms-line py-2.5 last:border-b-0">
              <dt className="text-[15px] text-ms-fg-2">{r.what}</dt>
              <dd className="flex shrink-0 gap-1">
                {r.keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] border border-ms-border-strong bg-ms-surface px-1.5 font-ms-mono text-[12px] text-ms-fg-2 shadow-[inset_0_-1px_0_var(--ms-border-strong)]"
                  >
                    {k}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="mt-3 flex justify-end border-t border-ms-border bg-ms-surface px-5 py-3.5">
        <Button variant="secondary" data-autofocus onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
