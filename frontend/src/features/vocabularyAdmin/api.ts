/**
 * vocabularyAdmin API client — builder authoring for `/api/vocabulary/admin/`.
 *
 * Bank content only: every endpoint here refuses a student's custom set
 * server-side, so the builder never has to filter by owner.
 */

import api from "@/lib/api";
import { normalizeApiError } from "@/lib/apiError";

import type {
  AdminVocabSection,
  AdminVocabSet,
  AdminVocabWord,
  SectionCreatePayload,
  SectionCsvImportResult,
  SectionUpdatePayload,
  SetCreatePayload,
  SetCsvImportResult,
  SetUpdatePayload,
  WordCreatePayload,
  WordUpdatePayload,
} from "./types";

const BASE = "/vocabulary/admin";

/** DRF may return a bare array or a paginated `{ results: [...] }` object. */
function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)) {
    return (data as { results: T[] }).results;
  }
  return [];
}

export const vocabularyAdminApi = {
  // ── Sections ───────────────────────────────────────────────────────────────
  listSections: async (): Promise<AdminVocabSection[]> => {
    const r = await api.get(`${BASE}/sections/`);
    return unwrapList<AdminVocabSection>(r.data);
  },
  createSection: async (payload: SectionCreatePayload): Promise<AdminVocabSection> => {
    const r = await api.post(`${BASE}/sections/`, payload);
    return r.data as AdminVocabSection;
  },
  updateSection: async (id: number, patch: SectionUpdatePayload): Promise<AdminVocabSection> => {
    const r = await api.patch(`${BASE}/sections/${id}/`, patch);
    return r.data as AdminVocabSection;
  },
  deleteSection: async (id: number): Promise<void> => {
    await api.delete(`${BASE}/sections/${id}/`);
  },

  // ── Sets ───────────────────────────────────────────────────────────────────
  listSets: async (sectionId: number): Promise<AdminVocabSet[]> => {
    const r = await api.get(`${BASE}/sections/${sectionId}/sets/`);
    return unwrapList<AdminVocabSet>(r.data);
  },
  createSet: async (sectionId: number, payload: SetCreatePayload): Promise<AdminVocabSet> => {
    const r = await api.post(`${BASE}/sections/${sectionId}/sets/`, payload);
    return r.data as AdminVocabSet;
  },
  updateSet: async (setId: number, patch: SetUpdatePayload): Promise<AdminVocabSet> => {
    const r = await api.patch(`${BASE}/sets/${setId}/`, patch);
    return r.data as AdminVocabSet;
  },
  /** 409 when the set is already assigned as homework. */
  deleteSet: async (setId: number): Promise<void> => {
    await api.delete(`${BASE}/sets/${setId}/`);
  },

  // ── Words ──────────────────────────────────────────────────────────────────
  listWords: async (setId: number): Promise<AdminVocabWord[]> => {
    const r = await api.get(`${BASE}/sets/${setId}/words/`);
    return unwrapList<AdminVocabWord>(r.data);
  },
  /** Creates the word in the set's section and appends it to the set. */
  createWord: async (setId: number, payload: WordCreatePayload): Promise<AdminVocabWord> => {
    const r = await api.post(`${BASE}/sets/${setId}/words/`, payload);
    return r.data as AdminVocabWord;
  },
  updateWord: async (wordId: number, patch: WordUpdatePayload): Promise<AdminVocabWord> => {
    const r = await api.patch(`${BASE}/words/${wordId}/`, patch);
    return r.data as AdminVocabWord;
  },
  deleteWord: async (wordId: number): Promise<void> => {
    await api.delete(`${BASE}/words/${wordId}/`);
  },

  // ── CSV import ─────────────────────────────────────────────────────────────
  // Axios infers the multipart boundary from FormData and the shared client's
  // interceptor raises the timeout to 300s — never set Content-Type by hand.
  importSectionCsv: async (sectionId: number, file: File): Promise<SectionCsvImportResult> => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await api.post(`${BASE}/sections/${sectionId}/import-csv/`, fd);
    return r.data as SectionCsvImportResult;
  },
  importSetCsv: async (setId: number, file: File): Promise<SetCsvImportResult> => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await api.post(`${BASE}/sets/${setId}/import-csv/`, fd);
    return r.data as SetCsvImportResult;
  },
};

/**
 * The importer is all-or-nothing and names the offending row, so surface
 * "Row 7 · word: Already in this set." rather than a bare "Request failed." —
 * without it the author has to bisect the file by hand.
 */
export function csvImportErrorText(e: unknown): string {
  const data = (
    e as {
      response?: {
        data?: { detail?: string; errors?: Array<{ row?: number; errors?: Record<string, unknown> }> };
      };
    }
  )?.response?.data;
  let text = normalizeApiError(e).message;
  if (data?.detail) {
    text = data.detail;
    const first = Array.isArray(data.errors) ? data.errors[0] : undefined;
    if (first?.row && first.errors && typeof first.errors === "object") {
      const [field, msgs] = Object.entries(first.errors)[0] ?? [];
      const msg = Array.isArray(msgs) ? String(msgs[0]) : String(msgs ?? "");
      text = `Row ${first.row}${field ? ` · ${field}` : ""}: ${msg || data.detail}`;
    }
  }
  return text;
}

export default vocabularyAdminApi;
