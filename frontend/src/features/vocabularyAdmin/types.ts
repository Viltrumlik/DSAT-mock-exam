/**
 * vocabularyAdmin DTOs — the builder authoring surface (`/api/vocabulary/admin/`).
 *
 * DISTINCT from `@/features/vocabulary/types`, which is the student contract:
 * that one carries per-student progress, this one carries authoring counts and
 * the raw editable fields. Never mix the two.
 */

export type VocabPartOfSpeech =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "pronoun"
  | "preposition"
  | "conjunction"
  | "interjection"
  | "other";

/** Mirrors `VocabWord.PART_CHOICES` — order drives the editor's select. */
export const VOCAB_PARTS_OF_SPEECH: VocabPartOfSpeech[] = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "preposition",
  "conjunction",
  "interjection",
  "other",
];

export const VOCAB_PART_LABEL: Record<VocabPartOfSpeech, string> = {
  noun: "Noun",
  verb: "Verb",
  adjective: "Adjective",
  adverb: "Adverb",
  pronoun: "Pronoun",
  preposition: "Preposition",
  conjunction: "Conjunction",
  interjection: "Interjection",
  other: "Other",
};

/**
 * `VocabSet.TARGET_WORD_COUNT`. Guidance only — the builder shows progress
 * against it and flags an overshoot, but never refuses a save.
 */
export const VOCAB_SET_TARGET_WORDS = 25;

/** The importer's column contract, shown inline so an author needn't guess. */
export const VOCAB_CSV_COLUMNS = "set,word,definition,part_of_speech,example,synonyms";

export interface AdminVocabSection {
  id: number;
  title: string;
  slug: string;
  description: string;
  order: number;
  is_published: boolean;
  set_count: number;
  word_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface AdminVocabSet {
  id: number;
  section: number;
  title: string;
  order: number;
  word_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface AdminVocabWord {
  id: number;
  section: number;
  word: string;
  definition: string;
  part_of_speech: VocabPartOfSpeech;
  example: string;
  synonyms: string[];
  created_at?: string;
  updated_at?: string;
}

// ─── Write payloads ──────────────────────────────────────────────────────────

export interface SectionCreatePayload {
  title: string;
  description?: string;
  /** Derived from the title server-side unless supplied. */
  slug?: string;
  order?: number;
  is_published?: boolean;
}

export type SectionUpdatePayload = Partial<SectionCreatePayload>;

export interface SetCreatePayload {
  title: string;
  order?: number;
}

export type SetUpdatePayload = Partial<SetCreatePayload>;

export interface WordCreatePayload {
  word: string;
  definition: string;
  part_of_speech?: VocabPartOfSpeech;
  example?: string;
  synonyms?: string[];
}

export type WordUpdatePayload = Partial<WordCreatePayload>;

// ─── CSV import results ──────────────────────────────────────────────────────

export interface SectionCsvImportResult {
  section_id: number;
  created_sets: number;
  created_words: number;
  /** Words that already existed in the section and were linked, not duplicated. */
  linked_words: number;
  set_ids: number[];
}

export interface SetCsvImportResult {
  set_id: number;
  /** Items added to the set — `created_words + linked_words`. */
  created_count: number;
  /** Words this import authored for the first time. */
  created_words: number;
  /** Words that already existed in the section and were linked, not duplicated. */
  linked_words: number;
  word_ids: number[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Narrow an arbitrary server string onto the select's option list. */
export function asPartOfSpeech(value: string | null | undefined): VocabPartOfSpeech {
  const normalized = (value ?? "").trim().toLowerCase() as VocabPartOfSpeech;
  return VOCAB_PARTS_OF_SPEECH.includes(normalized) ? normalized : "other";
}

/** Editor field ⇄ JSON list. Semicolon-separated, matching the CSV contract. */
export function parseSynonyms(raw: string): string[] {
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatSynonyms(synonyms: string[] | null | undefined): string {
  return (synonyms ?? []).join("; ");
}
