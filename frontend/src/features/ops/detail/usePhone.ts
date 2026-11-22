"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the screen is a phone (below 768 px, Tailwind's `md`): the detail pages change shape there, not only
 * size — the group page's roster becomes a tab (PhoneGroup board, 22 Nov 2026). False on the server and where
 * `matchMedia` is missing (jsdom), so the desktop shape is the default.
 */
const QUERY = "(max-width: 767px)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const list = window.matchMedia(QUERY);
  list.addEventListener?.("change", onChange);
  return () => list.removeEventListener?.("change", onChange);
}

const phoneNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;

export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, phoneNow, () => false);
}
