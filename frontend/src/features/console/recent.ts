"use client";

import { useSyncExternalStore } from "react";

/**
 * What this browser opened last, newest first, eight at most per console. Kept in this browser only — it
 * is a way back, not a log.
 *
 * - ops: the people and classes (Today's "Recently opened", AdminToday board).
 * - builder: the questions, sets, full mocks and past papers (Studio home's "Continue where you left off",
 *   BuilderHome board). A separate list, so one console's visits never push the other's out.
 */
export type RecentKind = "person" | "class" | "question" | "set" | "mock" | "pastpaper";
export type RecentItem = { kind: RecentKind; id: number; name: string; href: string; at: number };
export type RecentScope = "ops" | "builder";

const KEYS: Record<RecentScope, string> = { ops: "ms-recent", builder: "ms-recent-builder" };
const KINDS: Record<RecentScope, readonly RecentKind[]> = {
  ops: ["person", "class"],
  builder: ["question", "set", "mock", "pastpaper"],
};
const EVENT = "ms:recent";
const MAX = 8;
const EMPTY: RecentItem[] = [];

export const scopeOf = (kind: RecentKind): RecentScope => (kind === "person" || kind === "class" ? "ops" : "builder");

function valid(scope: RecentScope) {
  return (x: unknown): x is RecentItem => {
    const r = x as RecentItem;
    return Boolean(r) && KINDS[scope].includes(r.kind) && Number.isFinite(r.id) && typeof r.name === "string" && typeof r.href === "string";
  };
}

function read(scope: RecentScope): RecentItem[] {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(KEYS[scope]) ?? "[]");
    return Array.isArray(list) ? list.filter(valid(scope)) : [];
  } catch {
    return [];
  }
}

/** A page was opened: its item moves to the front of its console's list. */
export function recordRecent(item: Omit<RecentItem, "at">): void {
  const scope = scopeOf(item.kind);
  try {
    const next = [{ ...item, at: Date.now() }, ...read(scope).filter((r) => !(r.kind === item.kind && r.id === item.id))].slice(0, MAX);
    window.localStorage.setItem(KEYS[scope], JSON.stringify(next));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage blocked: nothing is remembered, nothing else changes */
  }
}

const cache: Record<RecentScope, { raw: string; list: RecentItem[] }> = {
  ops: { raw: "\u0000", list: EMPTY },
  builder: { raw: "\u0000", list: EMPTY },
};
function snapshot(scope: RecentScope): RecentItem[] {
  let raw = "";
  try {
    raw = window.localStorage.getItem(KEYS[scope]) ?? "";
  } catch {
    raw = "";
  }
  if (raw !== cache[scope].raw) cache[scope] = { raw, list: raw ? read(scope) : EMPTY };
  return cache[scope].list;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useRecent(scope: RecentScope = "ops"): RecentItem[] {
  return useSyncExternalStore(subscribe, () => snapshot(scope), () => EMPTY);
}
