/** Student-facing Question Bank practice API (APPROVED-only; no answer leak). */
import api from "@/lib/api";

export type PracticeListItem = {
  id: number;
  qb_id: string;
  subject: string;
  question_type: string;
  difficulty: string;
  domain_name: string | null;
  skill_name: string | null;
  question_text: string;
  has_image: boolean;
};

export type PracticeChoice = { id: string; text: string; image: string | null };

export type PracticeDetail = {
  id: number;
  qb_id: string;
  subject: string;
  question_type: string;
  difficulty: string;
  domain_name: string | null;
  skill_name: string | null;
  passage_text: string | null;
  question_text: string;
  question_prompt: string;
  question_image: string | null;
  choices: PracticeChoice[];
  points: number;
};

export type PracticeResult = { is_correct: boolean; correct_answer: unknown; explanation: string };

export type PracticeTaxonomy = {
  domains: Array<{ id: number; subject: string; name: string }>;
  skills: Array<{ id: number; domain: number; subject: string; name: string }>;
};

export type PracticeFilters = {
  subject?: string;
  domain?: number;
  skill?: number;
  difficulty?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type PracticePage = { count: number; results: PracticeListItem[] };

const BASE = "/questionbank/practice";

function clean(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

export const practiceApi = {
  list: async (f?: PracticeFilters): Promise<PracticePage> => {
    const r = await api.get(`${BASE}/`, { params: clean(f as Record<string, unknown>) });
    return r.data;
  },
  get: async (id: number): Promise<PracticeDetail> => {
    const r = await api.get(`${BASE}/${id}/`);
    return r.data;
  },
  answer: async (id: number, answer: string): Promise<PracticeResult> => {
    const r = await api.post(`${BASE}/${id}/answer/`, { answer });
    return r.data;
  },
  taxonomy: async (subject?: string): Promise<PracticeTaxonomy> => {
    const r = await api.get(`${BASE}/taxonomy/`, { params: subject ? { subject } : undefined });
    return r.data;
  },
};

/** Resolve a relative media path against the API origin. */
export function resolveMedia(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  const base = process.env.NEXT_PUBLIC_API_URL?.replace("/api", "") || "";
  return `${base}${path}`;
}
