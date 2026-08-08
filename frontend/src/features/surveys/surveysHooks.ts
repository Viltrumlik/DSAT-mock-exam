"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { surveysApi, type Survey, type SurveyAnswerValue, type SurveyQuestion } from "./surveysApi";

const keys = {
  open: ["surveys", "open"] as const,
  detail: (id: number) => ["surveys", "detail", id] as const,
  adminList: ["surveys", "admin", "list"] as const,
  adminDetail: (id: number) => ["surveys", "admin", "detail", id] as const,
  responses: (id: number) => ["surveys", "admin", "responses", id] as const,
};

// ── student ──────────────────────────────────────────────────────────────────

export function useOpenSurveys() {
  // Also drives the top-bar survey button, so it runs on every page — see useMyRewards.
  return useQuery({ queryKey: keys.open, queryFn: () => surveysApi.open(), staleTime: 60_000 });
}

export function useSurvey(id: number) {
  return useQuery({
    queryKey: keys.detail(id),
    queryFn: () => surveysApi.detail(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useRespond(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answers: Record<string, SurveyAnswerValue>) => surveysApi.respond(id, answers),
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

export function useSurveyResponses(id: number | null) {
  return useQuery({
    queryKey: keys.responses(id ?? 0),
    queryFn: () => surveysApi.responses(id as number),
    enabled: id != null && id > 0,
  });
}

/** Every authoring mutation refreshes both the list and the open survey, since publishing
 *  changes what students can see and the counts on the list. */
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
    (patch: Partial<Pick<Survey, "title" | "description" | "status" | "closes_at">>) =>
      surveysApi.adminUpdate(id as number, patch),
    id,
  );
}

export function useDeleteSurvey() {
  return useAuthoringMutation((surveyId: number) => surveysApi.adminDelete(surveyId), null);
}

export function useAddQuestion(surveyId: number | null) {
  return useAuthoringMutation(
    (body: Partial<SurveyQuestion>) => surveysApi.addQuestion(surveyId as number, body),
    surveyId,
  );
}

export function useUpdateQuestion(surveyId: number | null) {
  return useAuthoringMutation(
    (vars: { questionId: number; patch: Partial<SurveyQuestion> }) =>
      surveysApi.updateQuestion(surveyId as number, vars.questionId, vars.patch),
    surveyId,
  );
}

export function useDeleteQuestion(surveyId: number | null) {
  return useAuthoringMutation(
    (questionId: number) => surveysApi.deleteQuestion(surveyId as number, questionId),
    surveyId,
  );
}
