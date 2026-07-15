import { describe, it, expect } from "vitest";
import {
  answersNeedingPersist,
  answersMapFromAttempt,
  detectAnswerConflicts,
  sameAnswer,
} from "@/features/assessments/attemptSync";

describe("sameAnswer (submit-time draft-vs-buffer reconciliation)", () => {
  it("treats identical scalar answers as equal", () => {
    expect(sameAnswer("A", "A")).toBe(true);
    expect(sameAnswer("0", "0")).toBe(true);
  });
  it("treats a stale buffered pick that diverges from the draft as NOT equal", () => {
    // draft "B" (resolved) vs a lingering buffered "C" -> divergent, so it is dropped.
    expect(sameAnswer("C", "B")).toBe(false);
    expect(sameAnswer("C", undefined)).toBe(false);
  });
  it("handles null/array values deterministically", () => {
    expect(sameAnswer(null, null)).toBe(true);
    expect(sameAnswer(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameAnswer(["a"], ["a", "b"])).toBe(false);
  });
});

describe("answersNeedingPersist (submit-time self-heal against Omitted grades)", () => {
  it("returns questions the server is missing", () => {
    // The student answered Q1 and Q2 in the runner, but only Q1 reached the server.
    const draft = { 1: "A", 2: "B" };
    const server = { 1: "A" };
    expect(answersNeedingPersist(draft, server).sort()).toEqual([2]);
  });

  it("returns questions whose server value differs from the draft", () => {
    const draft = { 1: "C" };
    const server = { 1: "A" };
    expect(answersNeedingPersist(draft, server)).toEqual([1]);
  });

  it("ignores questions already correctly persisted", () => {
    const draft = { 1: "A", 2: "B" };
    const server = { 1: "A", 2: "B" };
    expect(answersNeedingPersist(draft, server)).toEqual([]);
  });

  it("never force-persists a blank / never-answered draft", () => {
    const draft = { 1: "", 2: null, 3: [], 4: "   " } as Record<number, unknown>;
    const server = {};
    expect(answersNeedingPersist(draft, server)).toEqual([]);
  });

  it("does not treat a legitimate '0' SPR answer as blank", () => {
    const draft = { 1: "0" };
    const server = {};
    expect(answersNeedingPersist(draft, server)).toEqual([1]);
  });

  it("scenario: a pick made while a conflict banner was open is recovered at submit", () => {
    // Server has Q1; a conflict banner opened; the student then answered Q5, which
    // the conflict gate kept out of the network flush. It must be flushed at submit.
    const attempt = {
      answers: [{ question_id: 1, answer: "A", client_seq: 3 }],
    };
    const server = answersMapFromAttempt(attempt);
    const draft = { 1: "A", 5: "D" };
    expect(answersNeedingPersist(draft, server)).toEqual([5]);
    // And Q1 is not a conflict (same value) so nothing spurious surfaces.
    expect(detectAnswerConflicts(draft, server)).toEqual([]);
  });
});
