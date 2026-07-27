/**
 * Pure game logic for the four study modes — shuffling, round chunking,
 * distractor selection, spelling masks and question construction.
 *
 * Deliberately React-free so it can be unit-tested without a DOM, and so a mode
 * component never has to re-derive a question set on every render. Every helper
 * takes an injectable `rng` for deterministic tests.
 */

/** Random source. Injected so tests can pin every shuffle. */
export type Rng = () => number;

/**
 * The minimum word shape the helpers need. Satisfied structurally by both
 * `VocabWord` (from the set detail) and `VocabWordSearchResult` (the bank-search
 * top-up used when a set is too small to supply its own distractors).
 */
export interface DistractorWord {
  id: number;
  word: string;
  definition: string;
}

/** Matching deals 6 words per round… */
export const MATCHING_CHUNK_SIZE = 6;
/** …unless the leftovers would make a round of fewer than 3, which is no fun. */
export const MATCHING_MIN_TAIL = 3;

/** Speed round length, in seconds. */
export const SPEED_ROUND_SECONDS = 60;
/** Ticks of the big 3-2-1 lead-in before a speed round. */
export const SPEED_LEAD_IN_TICKS = 3;
/** How long one lead-in digit stays on screen. */
export const SPEED_LEAD_IN_STEP_MS = 750;

/** Options shown on an MCQ test question. */
export const TEST_MCQ_OPTION_COUNT = 4;

const LETTER = /\p{L}/u;

function pickIndex(length: number, rng: Rng): number {
  // rng() is nominally [0,1) but clamp anyway — a stubbed rng returning 1 in a
  // test must not index past the end.
  return Math.min(length - 1, Math.floor(rng() * length));
}

/** Fisher–Yates. Returns a new array; the input is never mutated. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = pickIndex(i + 1, rng);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Split a set into matching rounds. Groups of `size`; a trailing group holding
 * fewer than `minTail` is merged into the one before it, so 25 words deal as
 * 6, 6, 6, 7 rather than 6, 6, 6, 6, 1.
 */
export function chunkForMatching<T>(
  items: readonly T[],
  size: number = MATCHING_CHUNK_SIZE,
  minTail: number = MATCHING_MIN_TAIL,
): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  const tail = chunks[chunks.length - 1];
  if (chunks.length > 1 && tail.length < minTail) {
    chunks.pop();
    chunks[chunks.length - 1] = [...chunks[chunks.length - 1], ...tail];
  }
  return chunks;
}

const normalizeText = (s: string) => s.trim().toLowerCase();

/**
 * Wrong answers for matching / speed / test. Drawn from `pool` (the set itself,
 * topped up from the bank when the set is too small), never repeating the target
 * word, a same-spelled duplicate from another section, or a word that *means*
 * the target: every mode asks the student to tell a definition from the word it
 * belongs to, so a same-definition candidate is a second correct answer rather
 * than a distractor.
 */
export function pickDistractors<T extends DistractorWord>(
  pool: readonly T[],
  exclude: DistractorWord,
  count: number,
  rng: Rng = Math.random,
): T[] {
  if (count <= 0) return [];
  const seenWords = new Set<string>([normalizeText(exclude.word)]);
  const excludedDefinition = normalizeText(exclude.definition);
  const candidates: T[] = [];
  for (const candidate of pool) {
    if (candidate.id === exclude.id) continue;
    const key = normalizeText(candidate.word);
    if (seenWords.has(key)) continue;
    // Checked before `key` is reserved: a twin dropped here must not block a
    // genuinely different word that happens to share its spelling.
    if (normalizeText(candidate.definition) === excludedDefinition) continue;
    seenWords.add(key);
    candidates.push(candidate);
  }
  return shuffle(candidates, rng).slice(0, count);
}

// ─── Matching ────────────────────────────────────────────────────────────────

export interface MatchCard {
  /** Stable per-card key — a word and its definition share a `wordId`. */
  key: string;
  wordId: number;
  face: "word" | "definition";
  text: string;
}

/** One round's worth of cards: every word and every definition, shuffled together. */
export function buildMatchCards(words: readonly DistractorWord[], rng: Rng = Math.random): MatchCard[] {
  const cards: MatchCard[] = [];
  for (const w of words) {
    cards.push({ key: `w-${w.id}`, wordId: w.id, face: "word", text: w.word });
    cards.push({ key: `d-${w.id}`, wordId: w.id, face: "definition", text: w.definition });
  }
  return shuffle(cards, rng);
}

/** Two cards pair up when they describe the same word from opposite faces. */
export function isMatchingPair(a: MatchCard, b: MatchCard): boolean {
  return a.wordId === b.wordId && a.face !== b.face;
}

// ─── Speed ───────────────────────────────────────────────────────────────────

export interface SpeedOption {
  text: string;
  correct: boolean;
}

export interface SpeedPrompt {
  wordId: number;
  word: string;
  options: SpeedOption[];
}

/** One prompt per word: the word, plus its definition and one decoy definition. */
export function buildSpeedPrompts(
  words: readonly DistractorWord[],
  pool: readonly DistractorWord[],
  rng: Rng = Math.random,
): SpeedPrompt[] {
  return shuffle(words, rng).map((w) => {
    const [decoy] = pickDistractors(pool, w, 1, rng);
    const options: SpeedOption[] = [{ text: w.definition, correct: true }];
    // A one-word set has nothing to contrast against; show the single option
    // rather than inventing a decoy.
    if (decoy) options.push({ text: decoy.definition, correct: false });
    return { wordId: w.id, word: w.word, options: shuffle(options, rng) };
  });
}

// ─── Spelling ────────────────────────────────────────────────────────────────

/** Choose which letter of `word` is given away. -1 when there is no letter to reveal. */
export function pickRevealIndex(word: string, rng: Rng = Math.random): number {
  const letterPositions: number[] = [];
  Array.from(word).forEach((ch, i) => {
    if (LETTER.test(ch)) letterPositions.push(i);
  });
  if (letterPositions.length === 0) return -1;
  return letterPositions[pickIndex(letterPositions.length, rng)];
}

/**
 * Render the word as blanks with one position already filled in. Non-letters
 * (spaces, hyphens, apostrophes) stay visible — they are structure, not answer.
 */
export function maskWord(word: string, revealIndex: number): string[] {
  return Array.from(word).map((ch, i) => (i === revealIndex || !LETTER.test(ch) ? ch : "_"));
}

/** Trimmed, case-insensitive — the spec's comparison rule, in one place. */
export function spellingIsCorrect(input: string, word: string): boolean {
  return normalizeText(input) === normalizeText(word) && normalizeText(word).length > 0;
}

// ─── Test ────────────────────────────────────────────────────────────────────

export type TestQuestionKind = "mcq" | "truefalse" | "spelling";

/** Round-robin order the test walks through, one word per question. */
export const TEST_KIND_CYCLE: TestQuestionKind[] = ["mcq", "truefalse", "spelling"];

interface TestQuestionBase {
  wordId: number;
  word: string;
  definition: string;
}

export interface McqQuestion extends TestQuestionBase {
  kind: "mcq";
  /** Word options, A–D. */
  options: string[];
  answerIndex: number;
}

export interface TrueFalseQuestion extends TestQuestionBase {
  kind: "truefalse";
  /** The definition the statement claims belongs to `word`. */
  shownDefinition: string;
  isGenuine: boolean;
}

export interface SpellingQuestion extends TestQuestionBase {
  kind: "spelling";
  revealIndex: number;
}

export type TestQuestion = McqQuestion | TrueFalseQuestion | SpellingQuestion;

/**
 * Every word exactly once, question kind cycling MCQ → True/False → Spelling.
 * True/False statements are genuine roughly half the time.
 */
export function buildTestQuestions(
  words: readonly DistractorWord[],
  pool: readonly DistractorWord[],
  rng: Rng = Math.random,
): TestQuestion[] {
  return shuffle(words, rng).map((w, i) => {
    const kind = TEST_KIND_CYCLE[i % TEST_KIND_CYCLE.length];
    const base: TestQuestionBase = { wordId: w.id, word: w.word, definition: w.definition };

    if (kind === "mcq") {
      const decoys = pickDistractors(pool, w, TEST_MCQ_OPTION_COUNT - 1, rng);
      const options = shuffle([w.word, ...decoys.map((d) => d.word)], rng);
      return { ...base, kind, options, answerIndex: options.indexOf(w.word) };
    }

    if (kind === "truefalse") {
      const wantsGenuine = rng() < 0.5;
      const decoy = wantsGenuine ? undefined : pickDistractors(pool, w, 1, rng)[0];
      // No usable decoy (tiny set) → fall back to a genuine pairing.
      return decoy
        ? { ...base, kind, shownDefinition: decoy.definition, isGenuine: false }
        : { ...base, kind, shownDefinition: w.definition, isGenuine: true };
    }

    return { ...base, kind: "spelling", revealIndex: pickRevealIndex(w.word, rng) };
  });
}

/** Accuracy as a whole percentage, 0 when nothing was answered. */
export function accuracyPercent(correct: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((correct / total) * 100);
}

/** A–D labels for MCQ options. */
export const CHOICE_LABELS = ["A", "B", "C", "D"] as const;
