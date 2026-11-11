import type { MouseEvent } from "react";

/** A plain click goes through the router; a modified click (new tab, new window) opens the link the browser's way. */
export function follow(e: MouseEvent<HTMLAnchorElement>, go: () => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go();
}
