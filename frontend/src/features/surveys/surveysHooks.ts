"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  surveysApi,
  type QuestionPatch,
  type SurveyAnswerValue,
  type SurveyPatch,
} from "./surveysApi";

const keys = {
  open: ["surveys", "open"] as const,
  detail: (id: number) => ["surveys", "detail", id] as const,
  adminList: ["surveys", "admin", "list"] as const,
  adminDetail: (id: number) => ["surveys", "admin", "detail", id] as const,
  results: (id: number) => ["surveys", "admin", "results", id] as const,
  participation: (id: number) => ["surveys", "admin", "participation", id] as const,
  draft: (id: number) => ["surveys", "draft", id] as const,
};

// ── student ──────────────────────────────────────────────────────────────────

export function useOpenSurveys() {
  // Also drives the top-bar survey button, so it runs on every page — see useMyRewards.
  return useQuery({ queryKey: keys.open, queryFn: () => surveysApi.open(), staleTime: 60_000 });
}

export function useSurvey(id: number) {
  // `Number.isInteger`, not `isFinite`: /surveys/abc gives NaN and /surveys/0 gives 0, and a
  // DISABLED react-query v5 query reports status "pending" forever — which the page renders
  // as a skeleton that never resolves. The route guard branches on this same predicate so
  // the two cannot disagree.
  return useQuery({
    queryKey: keys.detail(id),
    queryFn: () => surveysApi.detail(id),
    enabled: isValidSurveyId(id),
  });
}

/** Whether `id` could name a survey at all. Shared by the route guard and the query gate. */
export function isValidSurveyId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}

export function useRespond(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      answers: Record<string, SurveyAnswerValue>;
      follow_ups?: Record<string, string>;
      anonymous?: boolean;
    }) => surveysApi.respond(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.open });
      qc.invalidateQueries({ queryKey: keys.detail(id) });
      // Completing a survey is worth 40 points, so the Points page is stale immediately.
      qc.invalidateQueries({ queryKey: ["rewards"] });
    },
  });
}

// ── authoring ────────────────────────────────────────────────────────────────

export function useAdminSurveys() {
  return useQuery({ queryKey: keys.adminList, queryFn: () => surveysApi.adminList() });
}

export function useAdminSurvey(id: number | null) {
  return useQuery({
    queryKey: keys.adminDetail(id ?? 0),
    queryFn: () => surveysApi.adminDetail(id as number),
    enabled: id != null && id > 0,
  });
}

export function useSurveyResults(
  id: number | null,
  filters?: { classroom?: number; level?: string },
) {
  return useQuery({
    // The filter is part of the key, or switching class would show the previous class's
    // numbers until the refetch landed.
    queryKey: [...keys.results(id ?? 0), filters?.classroom ?? null, filters?.level ?? null],
    queryFn: () => surveysApi.results(id as number, filters),
    enabled: id != null && id > 0,
  });
}

/** Every authoring mutation refreshes both the list and the survey being edited, since
 *  publishing changes what students can see and the counts on the list. */
function useAuthoringMutation<TVars, TData>(
  fn: (vars: TVars) => Promise<TData>,
  surveyId: number | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.adminList });
      if (surveyId) qc.invalidateQueries({ queryKey: keys.adminDetail(surveyId) });
    },
  });
}

export function useCreateSurvey() {
  return useAuthoringMutation(
    (body: { title: string; description?: string }) => surveysApi.adminCreate(body),
    null,
  );
}

export function useUpdateSurvey(id: number | null) {
  return useAuthoringMutation(
    (vars: { patch: SurveyPatch; image?: File | null }) =>
      surveysApi.adminUpdate(id as number, vars.patch, vars.image),
    id,
  );
}

export function useDeleteSurvey() {
  return useAuthoringMutation((surveyId: number) => surveysApi.adminDelete(surveyId), null);
}

export function useAddQuestion(surveyId: number | null) {
  return useAuthoringMutation(
    (vars: { body: QuestionPatch; image?: File | null }) =>
      surveysApi.addQuestion(surveyId as number, vars.body, vars.image),
    surveyId,
  );
}

export function useUpdateQuestion(surveyId: number | null) {
  return useAuthoringMutation(
    (vars: { questionId: number; patch: QuestionPatch; image?: File | null }) =>
      surveysApi.updateQuestion(surveyId as number, vars.questionId, vars.patch, vars.image),
    surveyId,
  );
}

export function useDeleteQuestion(surveyId: number | null) {
  return useAuthoringMutation(
    (questionId: number) => surveysApi.deleteQuestion(surveyId as number, questionId),
    surveyId,
  );
}

export function useReorderQuestions(surveyId: number | null) {
  return useAuthoringMutation(
    (order: number[]) => surveysApi.reorderQuestions(surveyId as number, order),
    surveyId,
  );
}

/**
 * Read a DRF error body into one sentence.
 *
 * `detail` covers the hand-written 400s; the field map covers everything a serializer
 * raises, which is most of them. Reading only `detail` is why the console used to spin,
 * stop, and show nothing at all when a title ran past 200 characters.
 */
export function errorText(error: unknown): string | undefined {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (!data) return undefined;
  if (typeof data === "string") return data;
  const body = data as Record<string, unknown>;
  if (typeof body.detail === "string") return body.detail;
  for (const [field, value] of Object.entries(body)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") {
      // Named, because "This field is required" alone leaves the author hunting for which.
      return field === "non_field_errors" ? first : `${field}: ${first}`;
    }
  }
  return undefined;
}


/** A student's saved-but-unsubmitted answers, fetched once when the form opens. */
export function useSurveyDraft(id: number) {
  return useQuery({
    queryKey: keys.draft(id),
    queryFn: () => surveysApi.draft(id),
    enabled: isValidSurveyId(id),
    // Fetched once for the life of the form. Refetching would race the autosave and could
    // stamp a stale server copy over what the student is typing right now.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

/**
 * Autosave, debounced.
 *
 * Deliberately silent about failure: a dropped keystroke-save is not worth a banner, and the
 * student still holds everything in component state — the draft is a safety net under the
 * form, not the form itself. A real failure surfaces at Submit, which is validated properly.
 */
export function useSaveDraft(id: number) {
  return useMutation({
    mutationFn: (body: {
      answers: Record<string, SurveyAnswerValue>;
      follow_ups?: Record<string, string>;
    }) => surveysApi.saveDraft(id, body),
    retry: false,
  });
}

export function useSurveyParticipation(id: number | null) {
  return useQuery({
    queryKey: keys.participation(id ?? 0),
    queryFn: () => surveysApi.participation(id as number),
    enabled: id != null && id > 0,
  });
}

export function useDuplicateSurvey() {
  return useAuthoringMutation((surveyId: number) => surveysApi.duplicate(surveyId), null);
}
