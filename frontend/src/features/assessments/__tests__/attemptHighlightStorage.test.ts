/**
 * attemptHighlightStorage — storage-boundary unit tests.
 *
 * These are NOT UI tests. They exercise only the localStorage persistence layer
 * for assessment highlights, with one overriding contract:
 *
 *   Storage corruption / failure must NEVER throw out of these functions.
 *   The assessment runner must always be able to fall back to in-session-only
 *   highlighting if persistence is unavailable.
 *
 * Coverage (1 test per named scenario):
 *   1. round-trip persistence
 *   2. separate attempt isolation
 *   3. separate question isolation
 *   4. malformed JSON recovery
 *   5. missing storage recovery
 *   6. corrupted envelope recovery
 *   7. quota eviction behavior
 *   8. overwrite behavior
 *   9. empty highlight behavior
 *  10. hydrate-after-save behavior
 *  11. fail-safe: non-quota write error is swallowed (graceful degradation)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearHighlightStore,
  readHighlightStore,
  saveHighlight,
  writeHighlightStore,
  type HighlightStore,
} from "../attemptHighlightStorage";

const KEY = (attemptId: number) => `assessment_highlights_v1:${attemptId}`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("attemptHighlightStorage", () => {
  // 1 ─────────────────────────────────────────────────────────────────────────
  it("round-trips question and passage highlights for an attempt", () => {
    const store: HighlightStore = {
      v: 1,
      question: { 10: "<mark>a</mark>" },
      passage: { 10: "<mark>p</mark>" },
    };
    writeHighlightStore(1, store);
    const out = readHighlightStore(1);
    expect(out.question[10]).toBe("<mark>a</mark>");
    expect(out.passage[10]).toBe("<mark>p</mark>");
  });

  // 2 ─────────────────────────────────────────────────────────────────────────
  it("isolates highlights between different attempts", () => {
    saveHighlight(1, "question", 5, "<mark>attempt-1</mark>");
    saveHighlight(2, "question", 5, "<mark>attempt-2</mark>");
    expect(readHighlightStore(1).question[5]).toBe("<mark>attempt-1</mark>");
    expect(readHighlightStore(2).question[5]).toBe("<mark>attempt-2</mark>");
    // Reading an attempt that was never written returns an empty (not shared) store
    expect(readHighlightStore(3).question).toEqual({});
  });

  // 3 ─────────────────────────────────────────────────────────────────────────
  it("isolates highlights between questions and between fields", () => {
    saveHighlight(1, "question", 100, "<mark>q100</mark>");
    saveHighlight(1, "question", 200, "<mark>q200</mark>");
    saveHighlight(1, "passage", 100, "<mark>passage-100</mark>");
    const out = readHighlightStore(1);
    expect(out.question[100]).toBe("<mark>q100</mark>");
    expect(out.question[200]).toBe("<mark>q200</mark>");
    // Same qid, different field — must not bleed across question/passage maps
    expect(out.passage[100]).toBe("<mark>passage-100</mark>");
    expect(out.passage[200]).toBeUndefined();
  });

  // 4 ─────────────────────────────────────────────────────────────────────────
  it("recovers from malformed JSON without throwing", () => {
    localStorage.setItem(KEY(1), "{not valid json::");
    expect(() => readHighlightStore(1)).not.toThrow();
    const out = readHighlightStore(1);
    expect(out).toEqual({ v: 1, question: {}, passage: {} });
  });

  // 5 ─────────────────────────────────────────────────────────────────────────
  it("returns an empty store when nothing has been saved", () => {
    const out = readHighlightStore(999);
    expect(out).toEqual({ v: 1, question: {}, passage: {} });
  });

  // 6 ─────────────────────────────────────────────────────────────────────────
  it("recovers from a structurally corrupted envelope", () => {
    // Valid JSON, wrong shapes: array instead of object, numeric/empty values,
    // non-numeric keys. Nothing should throw; only well-formed entries survive.
    localStorage.setItem(
      KEY(1),
      JSON.stringify({
        v: 1,
        question: [1, 2, 3], // array, not a map
        passage: { "7": "<mark>ok</mark>", abc: "<mark>bad-key</mark>", 8: 42, 9: "" },
      }),
    );
    const out = readHighlightStore(1);
    expect(out.question).toEqual({}); // array discarded
    expect(out.passage[7]).toBe("<mark>ok</mark>"); // good entry kept
    expect(out.passage).not.toHaveProperty("abc"); // non-numeric key dropped
    expect(out.passage[8]).toBeUndefined(); // non-string value dropped
    expect(out.passage[9]).toBeUndefined(); // empty string dropped
  });

  // 7 ─────────────────────────────────────────────────────────────────────────
  it("evicts other attempts' highlights on quota error, then retries", () => {
    // Seed a highlight for a DIFFERENT attempt — it is the eviction candidate.
    writeHighlightStore(2, { v: 1, question: { 1: "<mark>other</mark>" }, passage: {} });

    const real = Storage.prototype.setItem;
    let calls = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k: string,
      val: string,
    ) {
      calls += 1;
      if (calls === 1) {
        // First write of the target attempt hits quota.
        throw new DOMException("quota", "QuotaExceededError");
      }
      return real.call(this, k, val);
    });

    expect(() =>
      writeHighlightStore(1, { v: 1, question: { 1: "<mark>target</mark>" }, passage: {} }),
    ).not.toThrow();

    // Other attempt evicted to make room; target written on retry.
    expect(localStorage.getItem(KEY(2))).toBeNull();
    expect(readHighlightStore(1).question[1]).toBe("<mark>target</mark>");
  });

  // 8 ─────────────────────────────────────────────────────────────────────────
  it("overwrites an existing highlight with the latest value", () => {
    saveHighlight(1, "question", 5, "<mark>first</mark>");
    saveHighlight(1, "question", 5, "<mark>second</mark>");
    expect(readHighlightStore(1).question[5]).toBe("<mark>second</mark>");
    // A full writeHighlightStore replaces the whole envelope, not merges.
    writeHighlightStore(1, { v: 1, question: { 9: "<mark>fresh</mark>" }, passage: {} });
    const out = readHighlightStore(1);
    expect(out.question[5]).toBeUndefined();
    expect(out.question[9]).toBe("<mark>fresh</mark>");
  });

  // 9 ─────────────────────────────────────────────────────────────────────────
  it("treats an empty highlight as no highlight, and ignores invalid qids", () => {
    // Clearing a highlight may store "" — it must not surface as a highlight,
    // so the review page falls back to the normal rendered text.
    saveHighlight(1, "question", 5, "");
    expect(readHighlightStore(1).question[5]).toBeUndefined();
    // Guard: a non-positive / non-finite question id is a no-op.
    saveHighlight(1, "question", 0, "<mark>x</mark>");
    saveHighlight(1, "question", NaN, "<mark>x</mark>");
    expect(readHighlightStore(1).question).toEqual({});
  });

  // 10 ────────────────────────────────────────────────────────────────────────
  it("survives a simulated reload (hydrate-after-save)", () => {
    // Simulates: student highlights (save) → closes/refreshes → page reads back.
    // localStorage persists across the two calls, so the second "load" sees it.
    saveHighlight(42, "question", 3, "<mark>kept</mark>");
    saveHighlight(42, "passage", 3, "<mark>kept-passage</mark>");
    const hydrated = readHighlightStore(42);
    expect(hydrated.question[3]).toBe("<mark>kept</mark>");
    expect(hydrated.passage[3]).toBe("<mark>kept-passage</mark>");
    // clearHighlightStore removes it entirely
    clearHighlightStore(42);
    expect(readHighlightStore(42)).toEqual({ v: 1, question: {}, passage: {} });
  });

  // 11 ────────────────────────────────────────────────────────────────────────
  it("swallows a non-quota write error so the runner degrades gracefully", () => {
    // Restricted contexts (Safari ITP, disabled storage) may throw a plain error.
    // The function must not propagate it — highlighting stays in-session only.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() =>
      writeHighlightStore(1, { v: 1, question: { 1: "<mark>x</mark>" }, passage: {} }),
    ).not.toThrow();
    expect(() => saveHighlight(1, "question", 2, "<mark>y</mark>")).not.toThrow();
  });
});
