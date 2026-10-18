"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeListParams } from "@/features/ops/changelist/useChangeListParams";
import { messagesQuery, smsApi, type CampaignDraft, type SmsSettingsPatch, type TestSmsBody } from "./smsApi";

/**
 * React Query over smsApi. Every key sits under `["sms"]` and every write invalidates all of it:
 * one send moves the balance, the journal, the day's counts and a campaign's figures at once, and
 * the panel is small enough that refetching it whole is cheaper than knowing which part moved.
 * The overview's balance is cached on the server for 5 minutes, so a refetch never costs an
 * eskiz login.
 */

export const smsKeys = {
  all: ["sms"] as const,
  overview: ["sms", "overview"] as const,
  messages: (query: Record<string, string | number>) => ["sms", "messages", query] as const,
  campaigns: ["sms", "campaigns"] as const,
  campaign: (id: number) => ["sms", "campaign", id] as const,
  settings: ["sms", "settings"] as const,
  debtPreview: (day: string) => ["sms", "debt", "preview", day] as const,
  debtRuns: ["sms", "debt", "runs"] as const,
  templates: ["sms", "templates"] as const,
  classrooms: ["sms", "audience", "classrooms"] as const,
  students: (q: string) => ["sms", "audience", "students", q] as const,
};

/** The fewest letters a student search needs before it asks. */
export const STUDENT_SEARCH_MIN = 2;

function useInvalidateSms() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: smsKeys.all });
}

// ── reads ────────────────────────────────────────────────────────────────

export function useSmsOverview() {
  return useQuery({ queryKey: smsKeys.overview, queryFn: () => smsApi.overview() });
}

/** One page of the journal. The previous page stays on screen while the next loads. */
export function useSmsMessages(params: ChangeListParams) {
  return useQuery({
    queryKey: smsKeys.messages(messagesQuery(params)),
    queryFn: () => smsApi.messages(params),
    placeholderData: keepPreviousData,
  });
}

export function useSmsCampaigns() {
  return useQuery({ queryKey: smsKeys.campaigns, queryFn: () => smsApi.campaigns() });
}

export function useSmsCampaign(id: number) {
  return useQuery({
    queryKey: smsKeys.campaign(id),
    queryFn: () => smsApi.campaign(id),
    // A disabled v5 query reports "pending" forever; only a real id is fetched.
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useSmsSettings() {
  return useQuery({ queryKey: smsKeys.settings, queryFn: () => smsApi.settings() });
}

/** `day` empty → the server's next warning day. */
export function useDebtPreview(day = "") {
  return useQuery({ queryKey: smsKeys.debtPreview(day), queryFn: () => smsApi.debtPreview(day || undefined) });
}

export function useDebtRuns() {
  return useQuery({ queryKey: smsKeys.debtRuns, queryFn: () => smsApi.debtRuns() });
}

export function useSmsTemplates() {
  return useQuery({ queryKey: smsKeys.templates, queryFn: () => smsApi.templates(), staleTime: 60_000 });
}

export function useAudienceClassrooms() {
  return useQuery({ queryKey: smsKeys.classrooms, queryFn: () => smsApi.classrooms(), staleTime: 60_000 });
}

export function useAudienceStudents(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: smsKeys.students(term),
    queryFn: () => smsApi.students(term),
    enabled: term.length >= STUDENT_SEARCH_MIN,
    placeholderData: keepPreviousData,
  });
}

// ── writes ───────────────────────────────────────────────────────────────

/**
 * The one POST that changes nothing: it resolves the audience and prices the send. It invalidates
 * nothing, so a preview does not refetch the whole panel behind the wizard.
 */
export function usePreviewCampaign() {
  return useMutation({ mutationFn: (draft: CampaignDraft) => smsApi.previewCampaign(draft) });
}

export function useCreateCampaign() {
  const invalidate = useInvalidateSms();
  return useMutation({ mutationFn: (draft: CampaignDraft) => smsApi.createCampaign(draft), onSuccess: invalidate });
}

export function useCancelCampaign(id: number) {
  const invalidate = useInvalidateSms();
  return useMutation({ mutationFn: () => smsApi.cancelCampaign(id), onSuccess: invalidate });
}

export function useRetryCampaign(id: number) {
  const invalidate = useInvalidateSms();
  return useMutation({ mutationFn: () => smsApi.retryCampaign(id), onSuccess: invalidate });
}

export function useUpdateSmsSettings() {
  const invalidate = useInvalidateSms();
  return useMutation({ mutationFn: (patch: SmsSettingsPatch) => smsApi.updateSettings(patch), onSuccess: invalidate });
}

export function useDebtSendNow() {
  const invalidate = useInvalidateSms();
  return useMutation({ mutationFn: () => smsApi.debtSendNow(), onSuccess: invalidate });
}

export function useSyncTemplates() {
  const invalidate = useInvalidateSms();
  return useMutation({ mutationFn: () => smsApi.syncTemplates(), onSuccess: invalidate });
}

export function useSubmitTemplate() {
  const invalidate = useInvalidateSms();
  return useMutation({ mutationFn: (text: string) => smsApi.submitTemplate(text), onSuccess: invalidate });
}

export function useSendTestSms() {
  const invalidate = useInvalidateSms();
  return useMutation({ mutationFn: (body: TestSmsBody) => smsApi.sendTest(body), onSuccess: invalidate });
}
