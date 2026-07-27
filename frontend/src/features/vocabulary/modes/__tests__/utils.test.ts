import { describe, expect, it } from "vitest";

import {
  accuracyPercent,
  buildMatchCards,
  buildSpeedPrompts,
  buildTestQuestions,
  chunkForMatching,
  isMatchingPair,
  maskWord,
  pickDistractors,
  pickRevealIndex,
  shuffle,
  spellingIsCorrect,
  TEST_KIND_CYCLE,
} from "../utils";
import type { DistractorWord } from "../utils";

/** Deterministic rng that walks a fixed script and then repeats it. */
function scripted(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const word = (id: number): DistractorWord => ({
  id,
  word: `word${id}`,
  definition: `definition ${id}`,
});

const words = (n: number): DistractorWord[] => Array.from({ length: n }, (_, i) => word(i + 1));

describe("shuffle", () => {
  it("returns a permutation without touching the input", () => {
    const input = words(6);
    const out = shuffle(input, scripted([0.1, 0.9, 0.4, 0.7, 0.2]));
    expect(out).toHaveLength(6);
    expect(out.map((w) => w.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(input.map((w) => w.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("never indexes past the end when the rng returns 1", () => {
    const out = shuffle([1, 2, 3], () => 1);
    expect(out.sort()).toEqual([1, 2, 3]);
  });
});

describe("chunkForMatching", () => {
  it("deals 25 words as 6, 6, 6, 7 — the tail of 1 merges back", () => {
    expect(chunkForMatching(words(25)).map((c) => c.length)).toEqual([6, 6, 6, 7]);
  });

  it("leaves a tail of 3 or more alone", () => {
    expect(chunkForMatching(words(9)).map((c) => c.length)).toEqual([6, 3]);
    expect(chunkForMatching(words(12)).map((c) => c.length)).toEqual([6, 6]);
  });

  it("merges any tail below the minimum", () => {
    expect(chunkForMatching(words(7)).map((c) => c.length)).toEqual([7]);
    expect(chunkForMatching(words(8)).map((c) => c.length)).toEqual([8]);
    expect(chunkForMatching(words(14)).map((c) => c.length)).toEqual([6, 8]);
  });

  it("keeps a single short round rather than inventing one", () => {
    expect(chunkForMatching(words(2)).map((c) => c.length)).toEqual([2]);
    expect(chunkForMatching([])).toEqual([]);
  });

  it("preserves order and loses nothing", () => {
    const flat = chunkForMatching(words(25)).flat();
    expect(flat.map((w) => w.id)).toEqual(words(25).map((w) => w.id));
  });
});

describe("pickDistractors", () => {
  const pool = words(5);

  it("never returns the target word", () => {
    const picked = pickDistractors(pool, pool[2], 4, scripted([0.3, 0.8, 0.1, 0.6]));
    expect(picked.map((w) => w.id)).not.toContain(3);
    expect(picked).toHaveLength(4);
  });

  it("returns as many as the pool allows, no padding", () => {
    expect(pickDistractors(words(2), word(1), 3, () => 0)).toHaveLength(1);
    expect(pickDistractors([], word(1), 3, () => 0)).toEqual([]);
    expect(pickDistractors(pool, pool[0], 0, () => 0)).toEqual([]);
  });

  it("drops same-spelled duplicates so two options are never identical", () => {
    const dupes: DistractorWord[] = [
      { id: 1, word: "candid", definition: "frank" },
      { id: 2, word: "Candid", definition: "open and honest" },
      { id: 3, word: "opaque", definition: "not transparent" },
    ];
    const picked = pickDistractors(dupes, { id: 9, word: "CANDID", definition: "x" }, 3, () => 0);
    expect(picked.map((w) => w.word)).toEqual(["opaque"]);
  });

  it("drops a candidate that means the same thing — it would be a second right answer", () => {
    const twins: DistractorWord[] = [
      { id: 1, word: "candid", definition: "  Frank and open  " },
      { id: 2, word: "opaque", definition: "not transparent" },
    ];
    const picked = pickDistractors(twins, { id: 9, word: "forthright", definition: "frank and open" }, 3, () => 0);
    expect(picked.map((w) => w.word)).toEqual(["opaque"]);
  });

  it("dedupes candidates spelled the same as each other", () => {
    const dupes: DistractorWord[] = [
      { id: 1, word: "lucid", definition: "clear" },
      { id: 2, word: "lucid", definition: "clear-headed" },
    ];
    expect(pickDistractors(dupes, word(99), 2, () => 0)).toHaveLength(1);
  });
});

describe("maskWord / pickRevealIndex", () => {
  it("blanks every letter except the revealed one", () => {
    expect(maskWord("candid", 2)).toEqual(["_", "_", "n", "_", "_", "_"]);
  });

  it("keeps non-letters visible — they are structure, not answer", () => {
    expect(maskWord("well-known", 0)).toEqual(["w", "_", "_", "_", "-", "_", "_", "_", "_", "_"]);
  });

  it("reveals nothing when the index is out of range", () => {
    expect(maskWord("abc", -1)).toEqual(["_", "_", "_"]);
  });

  it("picks a letter position for both extremes of the rng", () => {
    expect(pickRevealIndex("candid", () => 0)).toBe(0);
    expect(pickRevealIndex("candid", () => 1)).toBe(5);
  });

  it("never lands on a non-letter", () => {
    const positions = new Set(
      [0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => pickRevealIndex("well-known", () => r)),
    );
    expect([...positions]).not.toContain(4); // the hyphen
    for (const p of positions) expect("well-known"[p]).toMatch(/[a-z]/);
  });

  it("returns -1 when there is no letter to reveal", () => {
    expect(pickRevealIndex("---", () => 0)).toBe(-1);
  });
});

describe("spellingIsCorrect", () => {
  it("compares trimmed and case-insensitively", () => {
    expect(spellingIsCorrect("  Candid ", "candid")).toBe(true);
    expect(spellingIsCorrect("CANDID", "candid")).toBe(true);
  });

  it("rejects near misses and blanks", () => {
    expect(spellingIsCorrect("candi", "candid")).toBe(false);
    expect(spellingIsCorrect("can did", "candid")).toBe(false);
    expect(spellingIsCorrect("", "candid")).toBe(false);
    expect(spellingIsCorrect("   ", "   ")).toBe(false);
  });
});

describe("buildMatchCards", () => {
  it("emits a word card and a definition card per word", () => {
    const cards = buildMatchCards(words(6), scripted([0.4, 0.1, 0.7]));
    expect(cards).toHaveLength(12);
    expect(new Set(cards.map((c) => c.key)).size).toBe(12);
    expect(cards.filter((c) => c.face === "word")).toHaveLength(6);
    expect(cards.filter((c) => c.face === "definition")).toHaveLength(6);
  });

  it("pairs only opposite faces of the same word", () => {
    const cards = buildMatchCards(words(2), () => 0);
    const w1 = cards.find((c) => c.wordId === 1 && c.face === "word")!;
    const d1 = cards.find((c) => c.wordId === 1 && c.face === "definition")!;
    const d2 = cards.find((c) => c.wordId === 2 && c.face === "definition")!;
    expect(isMatchingPair(w1, d1)).toBe(true);
    expect(isMatchingPair(w1, d2)).toBe(false);
    expect(isMatchingPair(d1, d2)).toBe(false);
  });
});

describe("buildSpeedPrompts", () => {
  it("gives every word exactly one prompt with one correct definition", () => {
    const pool = words(8);
    const prompts = buildSpeedPrompts(pool, pool, scripted([0.2, 0.5, 0.9, 0.1]));
    expect(prompts).toHaveLength(8);
    expect(new Set(prompts.map((p) => p.wordId)).size).toBe(8);
    for (const p of prompts) {
      expect(p.options).toHaveLength(2);
      expect(p.options.filter((o) => o.correct)).toHaveLength(1);
      expect(p.options.find((o) => o.correct)?.text).toBe(`definition ${p.wordId}`);
    }
  });

  it("falls back to a single option when there is nothing to contrast against", () => {
    const only = words(1);
    expect(buildSpeedPrompts(only, only, () => 0)[0].options).toHaveLength(1);
  });
});

describe("buildTestQuestions", () => {
  const pool = words(9);

  it("uses every word exactly once, cycling the question kinds", () => {
    const qs = buildTestQuestions(pool, pool, scripted([0.3, 0.6, 0.2, 0.8]));
    expect(qs).toHaveLength(9);
    expect(new Set(qs.map((q) => q.wordId)).size).toBe(9);
    expect(qs.map((q) => q.kind)).toEqual([...TEST_KIND_CYCLE, ...TEST_KIND_CYCLE, ...TEST_KIND_CYCLE]);
  });

  it("builds MCQs with four distinct word options and a valid answer index", () => {
    const qs = buildTestQuestions(pool, pool, scripted([0.3, 0.6, 0.2, 0.8]));
    for (const q of qs) {
      if (q.kind !== "mcq") continue;
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.options[q.answerIndex]).toBe(q.word);
    }
  });

  it("never offers two correct words when the pool holds a same-definition twin", () => {
    // `twin` means exactly what word 1 means, so "which word means definition 1?"
    // would have two right answers if it were ever dealt as a decoy.
    const twin: DistractorWord = { id: 99, word: "twin", definition: " Definition 1 " };
    // Exactly three candidates for three decoy slots: the twin is dealt unless
    // it is rejected outright, whatever the shuffle does.
    const tightPool = [word(1), twin, word(2), word(3)];
    for (const rnd of [0, 0.25, 0.5, 0.75, 1]) {
      const mcq = buildTestQuestions([word(1)], tightPool, () => rnd)[0];
      expect(mcq.kind).toBe("mcq");
      if (mcq.kind !== "mcq") continue;
      expect(mcq.options).not.toContain("twin");
      expect(mcq.options[mcq.answerIndex]).toBe("word1");
    }
  });

  it("makes a genuine true/false pairing when the rng says so", () => {
    const genuine = buildTestQuestions(words(2), words(2), scripted([0.4])).find(
      (q) => q.kind === "truefalse",
    );
    expect(genuine).toBeDefined();
    if (genuine?.kind === "truefalse") {
      expect(genuine.isGenuine).toBe(true);
      expect(genuine.shownDefinition).toBe(genuine.definition);
    }
  });

  it("borrows another word's definition for a false pairing", () => {
    // 0.9 ≥ 0.5 → the builder wants a mismatch.
    const qs = buildTestQuestions(pool, pool, () => 0.9);
    const tf = qs.filter((q) => q.kind === "truefalse");
    expect(tf.length).toBeGreaterThan(0);
    for (const q of tf) {
      if (q.kind !== "truefalse") continue;
      expect(q.isGenuine).toBe(false);
      expect(q.shownDefinition).not.toBe(q.definition);
    }
  });

  it("falls back to a genuine pairing when no decoy definition exists", () => {
    const solo = words(1);
    const q = buildTestQuestions(solo, solo, () => 0.9)[0];
    expect(q.kind).toBe("mcq");
    const tfOnly = buildTestQuestions(
      [word(1), word(2)],
      [word(1)],
      scripted([0, 0.9]),
    ).find((x) => x.kind === "truefalse");
    if (tfOnly?.kind === "truefalse" && tfOnly.wordId === 1) {
      expect(tfOnly.isGenuine).toBe(true);
    }
  });

  it("reveals exactly one letter on spelling questions", () => {
    const qs = buildTestQuestions(pool, pool, scripted([0.3, 0.6, 0.2, 0.8]));
    for (const q of qs) {
      if (q.kind !== "spelling") continue;
      const masked = maskWord(q.word, q.revealIndex);
      // Fixture words end in a digit, which is structure and always visible —
      // exactly one *letter* may be given away.
      const revealedLetters = masked.filter((ch, i) => ch !== "_" && /\p{L}/u.test(q.word[i]));
      expect(revealedLetters).toHaveLength(1);
      expect(masked).toHaveLength(q.word.length);
    }
  });
});

describe("accuracyPercent", () => {
  it("rounds to a whole percentage and survives an empty round", () => {
    expect(accuracyPercent(0, 0)).toBe(0);
    expect(accuracyPercent(3, 4)).toBe(75);
    expect(accuracyPercent(2, 3)).toBe(67);
  });
});
