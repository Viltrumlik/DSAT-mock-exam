"use client";

import { useSyncExternalStore } from "react";

/**
 * "Recently opened" (design handoff v0.3, AdminToday board): the people and classes this browser
 * opened last, newest first, eight at most. Kept in this browser only — it is a way back, not a log.
 */
export type RecentItem = { kind: "person" | "class"; id: number; name: string; href: string; at: number };

const KEY = "ms-recent";
const EVENT = "ms:recent";
const MAX = 8;
const EMPTY: RecentItem[] = [];

function valid(x: unknown): x is RecentItem {
  const r = x as RecentItem;
  return Boolean(r) && (r.kind === "person" || r.kind === "class") && Number.isFinite(r.id) && typeof r.name === "string" && typeof r.href === "string";
}

function read(): RecentItem[] {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter(valid) : [];
  } catch {
    return [];
  }
}

/** A person or class page was opened: it moves to the front. */
export function recordRecent(item: Omit<RecentItem, "at">): void {
  try {
    const next = [{ ...item, at: Date.now() }, ...read().filter((r) => !(r.kind === item.kind && r.id === item.id))].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage blocked: nothing is remembered, nothing else changes */
  }
}

let cache: { raw: string; list: RecentItem[] } = { raw: "\u0000", list: EMPTY };
function snapshot(): RecentItem[] {
  let raw = "";
  try {
    raw = window.localStorage.getItem(KEY) ?? "";
  } catch {
    raw = "";
  }
  if (raw !== cache.raw) cache = { raw, list: raw ? read() : EMPTY };
  return cache.list;
}

export function useRecent(): RecentItem[] {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener(EVENT, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(EVENT, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    snapshot,
    () => EMPTY,
  );
}
