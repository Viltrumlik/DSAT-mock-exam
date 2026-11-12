"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * A list's search (DataDisplay board): it searches 300 ms after typing stops, or at once on Enter,
 * and `/` puts the cursor in it from anywhere on the page (not while typing in another field).
 */
export function SearchField({
  value,
  placeholder,
  onSearch,
  className,
}: {
  value: string;
  placeholder: string;
  onSearch: (q: string) => void;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement | null>(null);
  // What was last sent to the address — so the address catching up with our own search does not
  // overwrite what has been typed since, while back/forward (a different value) still does.
  const committed = useRef(value);
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
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
    onSearchRef.current(next);
  };

  useEffect(() => {
    if (text.trim() === committed.current) return;
    const t = window.setTimeout(() => commit(text), 300);
    return () => window.clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      className={cn("relative w-full", className)}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        commit(text);
      }}
    >
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ms-fg-3" />
      <input
        ref={input}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-keyshortcuts="/"
        className={cn(
          "ms-transition h-(--ms-h-ctl) w-full rounded-ms-ctl border border-ms-border-input bg-ms-card pl-10 pr-10 text-[15px] text-ms-fg placeholder:text-ms-fg-3",
          "focus-visible:border-ms-primary focus-visible:shadow-[0_0_0_3px_var(--ms-primary-soft-2)] focus-visible:outline-none",
          "[&::-webkit-search-cancel-button]:hidden",
        )}
      />
      {text ? null : (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 inline-flex h-[22px] min-w-[22px] -translate-y-1/2 items-center justify-center rounded-[6px] border border-ms-border-strong bg-ms-surface px-1.5 font-ms-mono text-[12px] text-ms-fg-2"
        >
          /
        </kbd>
      )}
    </form>
  );
}
