"use client";

/**
 * The assessment library, as the teacher panel reads it: GET /assessments/admin/sets/.
 *
 * Read-only. The backend narrows the list to what the caller may see — a teacher gets their own
 * domain subject, a test_admin only the sets they authored — so nothing here filters by access;
 * the Math/English buttons on the page sort a shelf the server has already scoped.
 *
 * The walk below exists because the list is paginated and the page it feeds is not. The view
 * pins `paginator.max_limit = 200` (assessments/views_authoring.py), so the old single request
 * for `limit: 500` was silently clamped and the page kept the first 200 rows while the search
 * box went on answering "no assessment matches" for the 201st. A client-side search over a
 * truncated array is a search that lies, and it lies about the thing a teacher is most likely
 * to be looking for — the set they just authored is the newest, and the list is newest-first
 * only until a subject has more than 200. So we ask for the whole list, page by page, using the
 * `offset` the client already accepts. No new endpoint, no changed payload: `count` and `next`
 * were always in the envelope and were simply being thrown away.
 */

import { assessmentsAdminApi } from "@/lib/api";

/** One set in the library. Everything here is a field the serializer already sends. */
export type TeacherAssessment = {
  id: number;
  title: string;
  /** Platform subject, lowercased: "math", "english", or whatever else was stored. */
  subject: string;
  level: string;
  category: string;
  description: string;
  /** `is_active: false` — authored but not given out yet. */
  isDraft: boolean;
  /** The questions a sitting would actually serve. See `activeQuestions` below. */
  questionCount: number;
};

export type TeacherAssessmentLibrary = {
  sets: TeacherAssessment[];
  /** What the server says exists, which is not always the number of rows it sent. */
  total: number;
  /** True only when the walk stopped at its own ceiling rather than at the end of the list. */
  truncated: boolean;
};

type RawQuestion = { is_active?: boolean } | null;

type RawSet = {
  id: number;
  title?: string | null;
  subject?: string | null;
  level?: string | null;
  category?: string | null;
  description?: string | null;
  is_active?: boolean;
  questions?: RawQuestion[] | null;
};

/** The view's own `max_limit`. Asking for more is not an error — it is quietly reduced to this. */
const PAGE_SIZE = 200;

/**
 * A ceiling on the walk, not on the library: 4,000 sets is an order of magnitude past anything
 * this learning center has authored, and a loop that trusts `next` alone would hang the page on
 * a server that kept answering. When it trips the page says so rather than pretending the list
 * it drew is the whole one.
 */
const MAX_PAGES = 20;

function pageOf(data: unknown): { rows: RawSet[]; count: number | null; hasNext: boolean } {
  if (Array.isArray(data)) return { rows: data as RawSet[], count: data.length, hasNext: false };
  const d = (data ?? {}) as Record<string, unknown>;
  // `results` is what LimitOffsetPagination sends and the only shape that can be walked — the
  // other three keys are carried over from the page this replaced, where they were a guess at
  // envelopes this endpoint has never produced. A list arriving under one of them is a whole
  // list, so it ends the walk rather than continuing it.
  if (Array.isArray(d.results)) {
    return {
      rows: d.results as RawSet[],
      count: typeof d.count === "number" ? d.count : null,
      hasNext: typeof d.next === "string" && d.next !== "",
    };
  }
  for (const key of ["items", "sets", "data"]) {
    if (Array.isArray(d[key])) {
      const rows = d[key] as RawSet[];
      return { rows, count: rows.length, hasNext: false };
    }
  }
  return { rows: [], count: null, hasNext: false };
}

/**
 * The count a teacher quotes when they hand the set to a class has to be the count the runner
 * will deal. A deactivated question is prefetched with the rest and serialized with the rest,
 * and the practice view drops it (`q.is_active !== false`), so counting the raw array printed
 * "20 questions" on a card whose runner then opened at "Question 1 of 17". `question_count` is
 * not a field on AssessmentSetSerializer — the old code read it first and always fell through —
 * and it would not help here even if it were, because a set's size and a sitting's length are
 * different numbers once anything has been retired.
 */
function activeQuestions(raw: RawSet): number {
  return (raw.questions ?? []).filter((q) => q?.is_active !== false).length;
}

function toAssessment(raw: RawSet): TeacherAssessment {
  return {
    id: raw.id,
    title: (raw.title || "").trim(),
    subject: (raw.subject || "").trim().toLowerCase(),
    level: (raw.level || "").trim(),
    category: (raw.category || "").trim(),
    description: (raw.description || "").trim(),
    isDraft: raw.is_active === false,
    questionCount: activeQuestions(raw),
  };
}

export async function listTeacherAssessments(): Promise<TeacherAssessmentLibrary> {
  const sets: TeacherAssessment[] = [];
  let total: number | null = null;
  let truncated = false;

  // Sequential, not parallel: the offsets are only knowable one answer at a time, and a library
  // this size is one request for everybody except the accounts that see every subject.
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { rows, count, hasNext } = pageOf(
      await assessmentsAdminApi.adminListSets({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    );
    if (count !== null) total = count;
    for (const row of rows) sets.push(toAssessment(row));
    if (!hasNext || rows.length === 0) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return { sets, total: total ?? sets.length, truncated };
}
