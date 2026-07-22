/**
 * Domain API: Question Bank (admin). Thin wrapper over the axios client.
 * All callers should use this module / the hooks, not @/lib/api directly.
 */
import api from "@/lib/api";
import type {
  QbBulkInput,
  QbBulkResult,
  QbClassifyInput,
  QbClearImages,
  QbDomain,
  QbImageFiles,
  QbImportBatch,
  QbImportCandidate,
  QbPaginated,
  QbQuestionDetail,
  QbQuestionFilters,
  QbQuestionListItem,
  QbSkill,
  QbValidation,
  QbWritePayload,
} from "./types";

const _IMG_FIELD: Record<string, string> = {
  question: "question_image",
  a: "option_a_image",
  b: "option_b_image",
  c: "option_c_image",
  d: "option_d_image",
};

/** JSON body when there are no images; multipart FormData when images change. */
function buildWriteBody(
  payload: QbWritePayload,
  files?: QbImageFiles,
  clears?: QbClearImages,
): QbWritePayload | FormData {
  const hasFiles = !!files && Object.keys(files).length > 0;
  const hasClears = !!clears && Object.values(clears).some(Boolean);
  if (!hasFiles && !hasClears) return payload;
  const fd = new FormData();
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined && v !== null) fd.append(k, String(v));
  }
  for (const [key, file] of Object.entries(files ?? {})) {
    if (file) fd.append(_IMG_FIELD[key], file);
  }
  for (const [key, on] of Object.entries(clears ?? {})) {
    if (on) fd.append(`clear_${_IMG_FIELD[key]}`, "true");
  }
  return fd;
}

const BASE = "/questionbank";

/** Drop empty/undefined params so we never send `?domain=` etc. */
function clean(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

export const questionBankApi = {
  // ── Read ──────────────────────────────────────────────────────────────────
  listQuestions: async (filters?: QbQuestionFilters): Promise<QbPaginated<QbQuestionListItem>> => {
    const r = await api.get(`${BASE}/questions/`, { params: clean(filters as Record<string, unknown>) });
    return r.data;
  },
  getQuestion: async (id: number): Promise<QbQuestionDetail> => {
    const r = await api.get(`${BASE}/questions/${id}/`);
    return r.data;
  },
  listDomains: async (subject?: string): Promise<QbDomain[]> => {
    const r = await api.get(`${BASE}/domains/`, { params: clean({ subject }) });
    return r.data;
  },
  listSkills: async (params?: { domain?: number; subject?: string }): Promise<QbSkill[]> => {
    const r = await api.get(`${BASE}/skills/`, { params: clean(params as Record<string, unknown>) });
    return r.data;
  },

  // ── Content authoring / edit / archive ────────────────────────────────────
  createQuestion: async (
    payload: QbWritePayload,
    files?: QbImageFiles,
    clears?: QbClearImages,
  ): Promise<QbQuestionDetail> => {
    const r = await api.post(`${BASE}/questions/`, buildWriteBody(payload, files, clears));
    return r.data;
  },
  updateQuestion: async (
    id: number,
    payload: QbWritePayload,
    files?: QbImageFiles,
    clears?: QbClearImages,
  ): Promise<QbQuestionDetail> => {
    const r = await api.patch(`${BASE}/questions/${id}/`, buildWriteBody(payload, files, clears));
    return r.data;
  },
  archiveQuestion: async (id: number): Promise<QbQuestionDetail> => {
    const r = await api.post(`${BASE}/questions/${id}/archive/`);
    return r.data;
  },
  restoreQuestion: async (id: number): Promise<QbQuestionDetail> => {
    const r = await api.post(`${BASE}/questions/${id}/restore/`);
    return r.data;
  },

  // ── Triage writes ─────────────────────────────────────────────────────────
  classify: async (id: number, payload: QbClassifyInput): Promise<QbQuestionDetail> => {
    const r = await api.post(`${BASE}/questions/${id}/classify/`, payload);
    return r.data;
  },
  approve: async (id: number): Promise<QbQuestionDetail> => {
    const r = await api.post(`${BASE}/questions/${id}/approve/`);
    return r.data;
  },
  reject: async (id: number, reason = ""): Promise<QbQuestionDetail> => {
    const r = await api.post(`${BASE}/questions/${id}/reject/`, { reason });
    return r.data;
  },
  acceptSuggestion: async (id: number): Promise<QbQuestionDetail> => {
    const r = await api.post(`${BASE}/questions/${id}/accept-suggestion/`);
    return r.data;
  },
  bulk: async (payload: QbBulkInput): Promise<{ action: string; results: QbBulkResult[] }> => {
    const r = await api.post(`${BASE}/questions/bulk/`, payload);
    return r.data;
  },

  // ── Import batches ────────────────────────────────────────────────────────
  listBatches: async (status?: string): Promise<QbPaginated<QbImportBatch>> => {
    const r = await api.get(`${BASE}/import-batches/`, { params: clean({ status }) });
    return r.data;
  },
  getBatch: async (id: number): Promise<QbImportBatch> => {
    const r = await api.get(`${BASE}/import-batches/${id}/`);
    return r.data;
  },
  listCandidates: async (
    batchId: number,
    validationStatus?: QbValidation,
  ): Promise<QbPaginated<QbImportCandidate>> => {
    const r = await api.get(`${BASE}/import-batches/${batchId}/candidates/`, {
      params: clean({ validation_status: validationStatus }),
    });
    return r.data;
  },
  promoteBatch: async (id: number): Promise<QbImportBatch> => {
    const r = await api.post(`${BASE}/import-batches/${id}/promote/`);
    return r.data;
  },
  uploadBatch: async (file: File, sourceReference?: string): Promise<QbImportBatch> => {
    const form = new FormData();
    form.append("file", file);
    if (sourceReference) form.append("source_reference", sourceReference);
    // Let axios set the multipart boundary; don't override Content-Type.
    const r = await api.post(`${BASE}/import-batches/upload/`, form);
    return r.data;
  },
};
