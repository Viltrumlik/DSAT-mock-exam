/**
 * Uploading the marks a browser already holds.
 *
 * This is the kind of code that fails by doing nothing: one character wrong in the key prefix
 * and it silently uploads zero rows, which looks exactly like "there was nothing to upload".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const write = vi.fn().mockResolvedValue(undefined);
vi.mock("@/features/annotations/api", () => ({
  annotationsApi: { write: (...args: unknown[]) => write(...args), list: vi.fn() },
}));

import {
  backfillLocalAnnotations,
  clearAnnotationSync,
  flushAnnotations,
  setAnnotationSync,
} from "../highlight/annotationStore";

const HL = [{ start: 0, end: 4, kind: "highlight", color: "yellow" }];

describe("backfillLocalAnnotations", () => {
  beforeEach(() => {
    localStorage.clear();
    write.mockClear();
    clearAnnotationSync();
    setAnnotationSync("exam", 42);
  });

  function sent() {
    flushAnnotations(); // the push is debounced; a test should not wait 600ms
    return write.mock.calls.map((c) => ({ questionId: c[2], container: c[3] }));
  }

  it("uploads a region the server has never seen", () => {
    localStorage.setItem("ts.annot.42.7.passage", JSON.stringify(HL));
    backfillLocalAnnotations(42, []);
    expect(sent()).toEqual([{ questionId: 7, container: "passage" }]);
  });

  it("leaves alone a region the server already has", () => {
    // The local copy could be stale — an older device, or a tab open across a change made
    // elsewhere. Overwriting the server with it would lose the newer marks.
    localStorage.setItem("ts.annot.42.7.passage", JSON.stringify(HL));
    backfillLocalAnnotations(42, [{ target_id: 7, container: "passage", data: [] }]);
    expect(sent()).toEqual([]);
  });

  it("ignores another attempt's keys", () => {
    localStorage.setItem("ts.annot.99.7.passage", JSON.stringify(HL));
    backfillLocalAnnotations(42, []);
    expect(sent()).toEqual([]);
  });

  it("ignores the legacy two-part key", () => {
    // `ts.annot.<attempt>.<question>` has no container segment. It is migrated forward on
    // read, where the passage container is known; guessing here would file it wrong.
    localStorage.setItem("ts.annot.42.7", JSON.stringify(HL));
    backfillLocalAnnotations(42, []);
    expect(sent()).toEqual([]);
  });

  it("ignores unrelated localStorage entries", () => {
    localStorage.setItem("some.other.app.key", "{}");
    localStorage.setItem("ts.annot.42.7.passage", JSON.stringify(HL));
    backfillLocalAnnotations(42, []);
    expect(sent()).toEqual([{ questionId: 7, container: "passage" }]);
  });

  it("skips an empty list rather than sending a pointless delete", () => {
    localStorage.setItem("ts.annot.42.7.passage", JSON.stringify([]));
    backfillLocalAnnotations(42, []);
    expect(sent()).toEqual([]);
  });

  it("carries a container key that contains a dot-free colon, as vocabulary uses", () => {
    localStorage.setItem("ts.annot.42.0.w12:definition", JSON.stringify(HL));
    backfillLocalAnnotations(42, []);
    expect(sent()).toEqual([{ questionId: 0, container: "w12:definition" }]);
  });

  it("does nothing when no surface is syncing", () => {
    clearAnnotationSync();
    localStorage.setItem("ts.annot.42.7.passage", JSON.stringify(HL));
    backfillLocalAnnotations(42, []);
    expect(sent()).toEqual([]);
  });
});
