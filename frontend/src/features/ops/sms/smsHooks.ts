"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangeListParams } from "@/features/ops/changelist/useChangeListParams";
import { mayHaveBeenSent } from "./panelKit";
import {
  messagesQuery,
  smsApi,
  type CampaignDraft,
  type CampaignStatus,
  type SmsSettingsPatch,
  type TestSmsBody,
} from "./smsApi";

/**
 * React Query over smsApi. Every key sits under `["sms"]` and every write invalidates all of it:
 * one send moves the balance, the journal, the day's counts and a campaign's figures at once, and
 * the panel is small enough that refetching it whole is cheaper than knowing which part moved.
 * The overview's balance is cached on the server for 5 minutes, so a refetch never costs an
 * eskiz login.
 *
 * **No mutation here is retried** (`retry: false`). QueryProvider retries every mutation once by
 * default, and a POST that reached the server before it failed — a timeout, a dropped
 * connection — has already sent its SMS: a retry would put it on a parent's phone twice, at our
 * cost. A paid POST (a campaign, "Send now", a test SMS) that fails with no answer refreshes the
 * panel, so whatever did go out shows.
 */

/** The options every SMS mutation starts from. */
export const MUTATION_DEFAULTS = { retry: false } as const;

/** How often a campaign page asks again while the campaign waits or goes out. */
export const CAMPAIGN_POLL_MS = 5_000;
/** How often the debt tab asks again after "Send now", and for how long at most. */
export const DEBT_POLL_MS = 5_000;
export const DEBT_POLL_FOR_MS = 2 * 60_000;

const LIVE_CAMPAIGN: ReadonlySet<CampaignStatus> = new Set<CampaignStatus>(["SCHEDULED", "SENDING"]);

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

/** One campaign, asked again every CAMPAIGN_POLL_MS while it is SCHEDULED or SENDING. */
export function useSmsCampaign(id: number) {
  return useQuery({
    queryKey: smsKeys.campaign(id),
    queryFn: () => smsApi.campaign(id),
    // A disabled v5 query reports "pending" forever; only a real id is fetched.
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.campaign?.status;
      return status && LIVE_CAMPAIGN.has(status) ? CAMPAIGN_POLL_MS : false;
    },
  });
}

export function useSmsSettings() {
  return useQuery({ queryKey: smsKeys.settings, queryFn: () => smsApi.settings() });
}

/**
 * `day` empty → the server's next warning day. Until `pollUntil` (ms since the epoch; 0 = never)
 * it is asked again every DEBT_POLL_MS while the server still has warnings to send — "Send now"
 * is queued, and the list empties as they go out.
 */
export function useDebtPreview(day = "", pollUntil = 0) {
  return useQuery({
    queryKey: smsKeys.debtPreview(day),
    queryFn: () => smsApi.debtPreview(day || undefined),
    refetchInterval: (query) =>
      Date.now() < pollUntil && (query.state.data?.to_send ?? 0) > 0 ? DEBT_POLL_MS : false,
  });
}

/** The past runs; asked again every DEBT_POLL_MS until `pollUntil`, as "Send now" fills today's. */
export function useDebtRuns(pollUntil = 0) {
  return useQuery({
    queryKey: smsKeys.debtRuns,
    queryFn: () => smsApi.debtRuns(),
    refetchInterval: () => (Date.now() < pollUntil ? DEBT_POLL_MS : false),
  });
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
  return useMutation({ ...MUTATION_DEFAULTS, mutationFn: (draft: CampaignDraft) => smsApi.previewCampaign(draft) });
}

/** For a POST that sends SMS: with no answer it may have gone out, so the panel is asked again. */
function useRefreshIfMaybeSent() {
  const invalidate = useInvalidateSms();
  return (e: unknown) => {
    if (mayHaveBeenSent(e)) void invalidate();
  };
}

export function useCreateCampaign() {
  const invalidate = useInvalidateSms();
  const onError = useRefreshIfMaybeSent();
  return useMutation({
    ...MUTATION_DEFAULTS,
    mutationFn: (draft: CampaignDraft) => smsApi.createCampaign(draft),
    onSuccess: invalidate,
    onError,
  });
}

export function useCancelCampaign(id: number) {
  const invalidate = useInvalidateSms();
  return useMutation({ ...MUTATION_DEFAULTS, mutationFn: () => smsApi.cancelCampaign(id), onSuccess: invalidate });
}

export function useRetryCampaign(id: number) {
  const invalidate = useInvalidateSms();
  return useMutation({ ...MUTATION_DEFAULTS, mutationFn: () => smsApi.retryCampaign(id), onSuccess: invalidate });
}

export function useUpdateSmsSettings() {
  const invalidate = useInvalidateSms();
  return useMutation({
    ...MUTATION_DEFAULTS,
    mutationFn: (patch: SmsSettingsPatch) => smsApi.updateSettings(patch),
    onSuccess: invalidate,
  });
}

export function useDebtSendNow() {
  const invalidate = useInvalidateSms();
  const onError = useRefreshIfMaybeSent();
  return useMutation({ ...MUTATION_DEFAULTS, mutationFn: () => smsApi.debtSendNow(), onSuccess: invalidate, onError });
}

export function useSyncTemplates() {
  const invalidate = useInvalidateSms();
  return useMutation({ ...MUTATION_DEFAULTS, mutationFn: () => smsApi.syncTemplates(), onSuccess: invalidate });
}

export function useSubmitTemplate() {
  const invalidate = useInvalidateSms();
  return useMutation({ ...MUTATION_DEFAULTS, mutationFn: (text: string) => smsApi.submitTemplate(text), onSuccess: invalidate });
}

export function useSendTestSms() {
  const invalidate = useInvalidateSms();
  const onError = useRefreshIfMaybeSent();
  return useMutation({
    ...MUTATION_DEFAULTS,
    mutationFn: (body: TestSmsBody) => smsApi.sendTest(body),
    onSuccess: invalidate,
    onError,
  });
}
