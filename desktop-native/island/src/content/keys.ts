// The runner's keyboard shortcuts while the island has focus (architecture.md §2.8 "Keyboard
// and focus"). Flutter owns the shortcut table; the island only forwards the keys of the
// website's useKeyboardShortcuts.ts — ←, →, a–d, m, r, ? — plus Escape, with the website's
// guards: never with Ctrl/Alt/Meta, never while typing in a text field (the SPR input —
// not even Escape, per the schema).
// Upper-case letters (Shift held) map to the same key, as on the website.
import type { KeyMessage } from "../protocol";
import { isTextField } from "./hardening";

export type ForwardedKey = KeyMessage["key"];

const MAP: Record<string, ForwardedKey> = {
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  a: "a",
  A: "a",
  b: "b",
  B: "b",
  c: "c",
  C: "c",
  d: "d",
  D: "d",
  m: "m",
  M: "m",
  r: "r",
  R: "r",
  "?": "?",
  Escape: "Escape",
};

/** The key to forward for `e`, or null. */
export function forwardedKey(e: KeyboardEvent): ForwardedKey | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.isComposing) return null;
  const key = MAP[e.key];
  if (!key) return null;
  // Never from the SPR input, Escape included (protocol schema, `key`): there it is typing.
  if (isTextField(e.target)) return null;
  return key;
}
