"use client";

import { useEffect, useRef } from "react";

/** Mirrors the exam runner's guard: never hijack a key meant for an input. */
function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
}

/**
 * Window-level shortcuts for a study mode. `handler` returns true when it
 * consumed the key, which suppresses the browser default (space scrolling the
 * page, arrows moving focus).
 */
export function useModeKeys(enabled: boolean, handler: (key: string) => boolean): void {
  const handlerRef = useRef(handler);
  const enabledRef = useRef(enabled);

  // Synced in an effect, not during render — the house pattern from the exam
  // runner's useKeyboardShortcuts.
  useEffect(() => {
    handlerRef.current = handler;
    enabledRef.current = enabled;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!enabledRef.current || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (handlerRef.current(e.key)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
