import api from "@/lib/api";
import type { ChangeListData } from "@/features/ops/changelist/ChangeList";
import type { ChangeListParams } from "@/features/ops/changelist/useChangeListParams";

/**
 * `/sms/admin/…` — the /ops SMS panel (plan 2026-10-18-sms-ops-panel.md). Every shape here is the
 * binding contract in 2026-10-18-sms-ops-panel-api.md, written by hand on both sides: a field the
 * server adds is not seen until it is named here, and one renamed there is a type error here.
 *
 * Paths are root-relative to the axios instance, whose baseURL already ends in the API prefix —
 * writing the prefix again would double it and trip `check:api-layer`.
 */

// ── enums ────────────────────────────────────────────────────────────────

export type SmsStatus = "PENDING" | "SENT" | "DELIVERED" | "UNDELIVERED" | "REJECTED" | "FAILED" | "UNCERTAIN";
export type SmsKind = "debt_warning" | "campaign" | "test";
export type CampaignStatus = "SCHEDULED" | "SENDING" | "DONE" | "CANCELLED" | "FAILED";
export type AudienceKind = "student" | "group" | "debtors" | "filter";
export type SlotRole = "student" | "debt" | "text";
export type TemplateStatus = "service" | "reklama" | "moderation" | "inproccess" | "rejected" | "gone";
/**
 * Why a person a campaign meant to reach gets nothing. `stale_balance`: a debtors list, or a text
 * naming the debt, and lc-up's balance is older than 24 h. `same_phone`: a sibling on the same
 * phone gets the same words, so one SMS goes between them.
 */
export type SkipReason = "no_link" | "no_phone" | "stale_balance" | "not_debtor" | "bad_text" | "same_phone" | "excluded";

/** `{DELIVERED: 2}` — only the statuses that occurred are present. */
export type StatusCounts = Partial<Record<SmsStatus, number>>;

// ── overview ─────────────────────────────────────────────────────────────

export interface SmsOverview {
  /** eskiz's keys are in the server's environment. */
  configured: boolean;
  /** Whole so'm; null when eskiz could not be asked. Cached 5 min on the server. */
  balance: number | null;
  price_per_part: number;
  sender: string;
  eskiz: {
    token_cached: boolean;
    login_refused: boolean;
    /** The newest non-empty SmsMessage.error, or "". */
    last_error: string;
  };
  debt: {
    /** = env_enabled AND db_enabled AND freeze_enabled. */
    enabled: boolean;
    /** SMS_DEBT_WARNINGS_ENABLED — the master kill-switch. */
    env_enabled: boolean;
    /** The panel's own switch. */
    db_enabled: boolean;
    /** lc-up's debt freeze — no freeze, no warning. */
    freeze_enabled: boolean;
    hour: number;
    /** "YYYY-MM-DD", Tashkent; null when there is none ahead. */
    next_day: string | null;
    next_count: number;
    /** On a warning day: the warnings today's runs did, and those still to go (0 / 0 on other days). */
    today_sent: number;
    today_left: number;
  };
  today: { total: number; by_status: StatusCounts };
  last7: { total: number; by_status: StatusCounts };
  /** What the next 24 hours will spend, against the balance (plan sms-v2, Task 3). */
  forecast: Forecast;
  /** The current Tashkent month at a glance. */
  month: MonthGlance;
}

/** so'm the next 24 hours will spend; `short` = the balance is known and below `total`. */
export interface Forecast {
  debt: number;
  campaigns: number;
  automations: number;
  total: number;
  balance: number | null;
  short: boolean;
}

export interface MonthGlance {
  sent: number;
  /** delivered ÷ (delivered + undelivered + rejected); null before anything reached its end. */
  rate: number | null;
  cost: number;
}

// ── statistics ───────────────────────────────────────────────────────────

/** Inclusive Tashkent days, "YYYY-MM-DD"; `campaign` narrows it to that campaign's messages. */
export interface StatsRange {
  from: string;
  to: string;
  campaign?: number;
}

export interface SmsStatsTotals {
  /** What eskiz took: SENT + DELIVERED + UNDELIVERED. */
  sent: number;
  delivered: number;
  undelivered: number;
  rejected: number;
  failed: number;
  /** Not at its end yet: SENT + PENDING + UNCERTAIN. */
  pending: number;
  rate: number | null;
  /** so'm, an estimate: FAILED and REJECTED cost nothing. */
  cost: number;
}

export interface SmsStatsDay extends SmsStatsTotals {
  day: string;
}

export interface SmsStatsOperator {
  operator: string;
  total: number;
  delivered: number;
  rate: number | null;
}

export interface SmsStatsCostMonth {
  month: string;
  debt_warning: number;
  campaign: number;
  automation: number;
  test: number;
  total: number;
}

/** Of the students a month's debt warning reached, how many paid within 1, 3 and 5 days. */
export interface DebtEffectMonth {
  month: string;
  warned: number;
  paid_1: number;
  paid_3: number;
  paid_5: number;
  /** Not paid yet, but their 5 days are not over: not counted as unpaid. */
  open: number;
  unpaid: number;
}

export interface SmsStats {
  from: string;
  to: string;
  totals: SmsStatsTotals;
  by_day: SmsStatsDay[];
  by_operator: SmsStatsOperator[];
  cost_by_month: SmsStatsCostMonth[];
  debt_effect: DebtEffectMonth[];
}

// ── messages ─────────────────────────────────────────────────────────────

export interface SmsMessage {
  id: number;
  created_at: string;
  sent_at: string | null;
  kind: SmsKind;
  status: SmsStatus;
  /** eskiz's own word for it, as its callback or status check said. */
  eskiz_status: string;
  phone: string;
  text: string;
  parts: number;
  /** "" when eskiz never answered with one. */
  request_id: string;
  error: string;
  user: { id: number; name: string } | null;
  lcup_student_id: number | null;
  campaign_id: number | null;
  /** "" for what the system sent by itself (the debt warning). */
  created_by_name: string;
  /** 1, plus one for each time it was sent again. */
  attempts: number;
  /** When eskiz last said where it stands. */
  checked_at: string | null;
  /** From the two digits after 998; "Other" when no listed operator claims it. */
  operator: string;
  /** The student's active classes now, by name. */
  groups: string[];
  source: MessageSource;
  template: MessageTemplateRef;
  /** so'm; FAILED and REJECTED cost nothing. */
  cost: number;
  /** Resend may take it now: it did not arrive, and a debt warning only on its own day, switched on. */
  can_resend: boolean;
}

export interface MessageSource {
  type: SmsKind | "automation";
  id: number | null;
  /** "Debt warning", "Campaign #7 · Debtors", "Test". */
  label: string;
}

export interface MessageTemplateRef {
  id: number | null;
  /** "#64942" (its name once it has one), "" when none. */
  label: string;
}

/** What may be sent again by hand: it did not arrive, and nothing says it might have. */
export const RESENDABLE: readonly SmsStatus[] = ["UNDELIVERED", "REJECTED", "FAILED"];

export interface ResendResult {
  queued: number[];
  not_resendable: number[];
}

export interface StudentSms {
  summary: StatusCounts;
  results: SmsMessage[];
}

export type SmsMessagePage = ChangeListData<SmsMessage>;

/** The filter keys the journal understands; anything else in the address is not sent. */
export const MESSAGE_FILTER_KEYS = [
  "kind", "status", "when", "operator", "group", "teacher", "template", "campaign", "from", "to", "resendable",
] as const;

/** The query string `messages/` takes, from the journal's address state. */
export function messagesQuery(params: ChangeListParams): Record<string, string | number> {
  const out = exportQuery(params);
  if (params.page > 1) out.page = params.page;
  out.page_size = params.pageSize;
  return out;
}

/** The journal's search and filters without its page: what `messages/export/` takes. */
export function exportQuery(params: ChangeListParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (params.q) out.q = params.q;
  for (const key of MESSAGE_FILTER_KEYS) {
    const value = params.filters[key];
    if (value) out[key] = value;
  }
  return out;
}

// ── campaigns ────────────────────────────────────────────────────────────

export interface SkippedPerson {
  user_id: number;
  name: string;
}

/** Reason → the people it covers. A reason with nobody may be absent or an empty list. */
export type Skipped = Partial<Record<SkipReason | string, SkippedPerson[]>>;

export interface CampaignResult {
  sent: number;
  failed: number;
  rejected: number;
  uncertain: number;
  /** Counted live from the campaign's messages. */
  delivered: number;
  undelivered: number;
  errors: number;
  skipped: Skipped;
}

export interface Campaign {
  id: number;
  status: CampaignStatus;
  template_eskiz_id: number;
  /** A snapshot of eskiz's moderated pattern at create time. */
  pattern: string;
  original: string;
  slot_roles: SlotRole[];
  /** One per slot; "" for the slots that are not `text`. */
  slot_texts: string[];
  audience: AudienceKind;
  audience_ids: number[];
  /** Server-made: "Debtors", "Group: <name>", "2 groups", "Math · Junior", "3 students", "Student: <name>". */
  audience_label: string;
  /** `{}` unless the audience is `filter`. */
  audience_filter: Partial<AudienceFilter>;
  /** People taken out by hand. */
  excluded_user_ids: number[];
  scheduled_at: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_by_name: string;
  error: string;
  /** Partly filled before the send: the live delivered/undelivered counts are always there. */
  result: Partial<CampaignResult>;
}

/** A filter audience: active classes, AND across the keys, OR within one. */
export interface AudienceFilter {
  subjects: string[];
  levels: string[];
  /** Branch ids. */
  branches: number[];
  days: string[];
}

/** Who a campaign goes to: the body of `audience/preview/`, and part of a draft. */
export interface AudienceBody {
  audience: AudienceKind;
  /** student: user ids (1–300); group: classroom ids (1–50); debtors, filter: []. */
  audience_ids: number[];
  audience_filter?: AudienceFilter;
  excluded_user_ids?: number[];
}

/** The body of `campaigns/preview/` and `campaigns/`. */
export interface CampaignDraft extends AudienceBody {
  /** An EskizTemplate.eskiz_id. */
  template_id: number;
  slot_roles: SlotRole[];
  slot_texts: string[];
  /** ISO; null means now. */
  scheduled_at: string | null;
}

export interface PreviewRecipient {
  user_id: number;
  name: string;
  /** Masked: 99890***4567. */
  phone: string;
  /** The active classes they sit in now. */
  groups: string[];
}

/** Who an audience is before any template is chosen. */
export interface AudiencePreview {
  count: number;
  over_limit: boolean;
  limit: number;
  skipped: Skipped;
  recipients: PreviewRecipient[];
}

export interface AudienceOption<V = string> {
  value: V;
  label: string;
  /** Active classes with this value. */
  classes: number;
}

export interface AudienceOptions {
  subjects: AudienceOption[];
  levels: AudienceOption[];
  branches: AudienceOption<number>[];
  days: AudienceOption[];
}

export interface CampaignPreview {
  count: number;
  over_limit: boolean;
  limit: number;
  /** At most 3. */
  samples: { name: string; phone: string; text: string; parts: number }[];
  parts_total: number;
  /** parts_total × price_per_part. */
  cost: number;
  skipped: Skipped;
  recipients?: PreviewRecipient[];
}

// ── settings ─────────────────────────────────────────────────────────────

export interface SmsSettings {
  debt_enabled: boolean;
  debt_hour: number;
  warning_template_id: number;
  warning_pattern: string;
  warning_slots: SlotRole[];
  last_day_template_id: number;
  last_day_pattern: string;
  last_day_slots: SlotRole[];
  updated_at: string | null;
  updated_by_name: string;
  env_enabled: boolean;
  freeze_enabled: boolean;
  /** lc-up's freeze day of the month: warnings go out the days before it. */
  freeze_day: number;
}

/** Any of these. A template id travels with its slots: the server copies that template's pattern. */
export interface SmsSettingsPatch {
  debt_enabled?: boolean;
  debt_hour?: number;
  warning_template_id?: number;
  warning_slots?: SlotRole[];
  last_day_template_id?: number;
  last_day_slots?: SlotRole[];
}

// ── debt warning ─────────────────────────────────────────────────────────

export interface DebtWarningRow {
  lcup_student_id: number;
  name: string;
  phone: string;
  /** Whole so'm owed, positive. */
  debt: number;
  text: string;
  parts: number;
}

export interface DebtPreview {
  day: string;
  /** The day before the freeze — the last-day template. */
  is_last_day: boolean;
  /** Why nothing would go out that day, "" when it would. */
  blocked: string;
  /** Reason → how many. */
  skipped: Record<string, number>;
  /** Everyone the plan would warn that day, sent or not. */
  count: number;
  /** That day's warnings already out (any status but FAILED): never sent again. */
  sent_today: number;
  /** The planned warnings still to go: no SMS that day yet, or a FAILED one. */
  to_send: number;
  /** The `to_send` ones' parts × price_per_part. */
  cost: number;
  warnings: DebtWarningRow[];
}

export interface DebtRun {
  run_on: string;
  total: number;
  by_status: StatusCounts;
  parts: number;
  cost: number;
}

// ── templates ────────────────────────────────────────────────────────────

export interface TemplateSlot {
  kind: "d" | "w";
  min: number;
  max: number;
}

export interface EskizTemplate {
  eskiz_id: number;
  /** The panel's own name; "" when it has none. */
  alias: string;
  /** The alias, else "#<eskiz_id>". */
  label: string;
  /** Messages with this template in the last 90 days. */
  used_count: number;
  last_used_at: string | null;
  status: TemplateStatus;
  /** What eskiz moderated, with %w / %d slots — the text an SMS must match. */
  pattern: string;
  /** What was submitted, with (STUDENT)-style placeholders. */
  original: string;
  slots: TemplateSlot[];
  guessed_roles: SlotRole[];
  parts: number;
  ascii: boolean;
  /** service or reklama. */
  usable: boolean;
  synced_at: string;
  submitted_by_name: string;
  submitted_at: string | null;
}

export interface TemplateSync {
  added: number;
  updated: number;
  gone: number;
  total: number;
}

// ── test SMS, audience pickers ───────────────────────────────────────────

export interface TestSmsBody {
  phone: string;
  template_id: number;
  slot_texts: string[];
}

export interface AudienceClassroom {
  id: number;
  name: string;
  students: number;
  with_phone: number;
}

export interface AudienceStudent {
  id: number;
  name: string;
  lcup_name: string;
  phone: string;
  /** lc-up's, whole so'm; negative is a debt. */
  balance: number | null;
}

// ── calls ────────────────────────────────────────────────────────────────

const BASE = "/sms/admin";

export const smsApi = {
  async overview(): Promise<SmsOverview> {
    const { data } = await api.get<SmsOverview>(`${BASE}/overview/`);
    return data;
  },
  async messages(params: ChangeListParams): Promise<SmsMessagePage> {
    const { data } = await api.get<SmsMessagePage>(`${BASE}/messages/`, { params: messagesQuery(params) });
    return data;
  },
  async stats(range: StatsRange): Promise<SmsStats> {
    const params = { from: range.from, to: range.to, ...(range.campaign ? { campaign: range.campaign } : {}) };
    const { data } = await api.get<SmsStats>(`${BASE}/stats/`, { params });
    return data;
  },
  async studentMessages(userId: number): Promise<StudentSms> {
    const { data } = await api.get<StudentSms>(`${BASE}/students/${userId}/messages/`);
    return data;
  },
  /** The filtered journal, every page, as the CSV the server writes. */
  async exportMessages(params: ChangeListParams): Promise<Blob> {
    const { data } = await api.get<Blob>(`${BASE}/messages/export/`, { params: exportQuery(params), responseType: "blob" });
    return data;
  },
  async resend(ids: number[]): Promise<ResendResult> {
    const { data } = await api.post<ResendResult>(`${BASE}/messages/resend/`, { ids });
    return data;
  },

  async campaigns(): Promise<Campaign[]> {
    const { data } = await api.get<{ campaigns: Campaign[] }>(`${BASE}/campaigns/`);
    return data?.campaigns ?? [];
  },
  async campaign(id: number): Promise<{ campaign: Campaign; messages: SmsMessage[] }> {
    const { data } = await api.get<{ campaign: Campaign; messages: SmsMessage[] }>(`${BASE}/campaigns/${id}/`);
    return data;
  },
  async previewCampaign(draft: CampaignDraft): Promise<CampaignPreview> {
    const { data } = await api.post<CampaignPreview>(`${BASE}/campaigns/preview/`, { ...draft, include_recipients: true });
    return data;
  },
  async createCampaign(draft: CampaignDraft): Promise<Campaign> {
    const { data } = await api.post<{ campaign: Campaign }>(`${BASE}/campaigns/`, draft);
    return data?.campaign;
  },
  async cancelCampaign(id: number): Promise<Campaign> {
    const { data } = await api.post<{ campaign: Campaign }>(`${BASE}/campaigns/${id}/cancel/`);
    return data?.campaign;
  },
  async retryCampaign(id: number): Promise<{ queued: number }> {
    const { data } = await api.post<{ queued: number }>(`${BASE}/campaigns/${id}/retry/`);
    return { queued: Number(data?.queued ?? 0) };
  },

  async settings(): Promise<SmsSettings> {
    const { data } = await api.get<SmsSettings>(`${BASE}/settings/`);
    return data;
  },
  async updateSettings(patch: SmsSettingsPatch): Promise<SmsSettings> {
    const { data } = await api.patch<SmsSettings>(`${BASE}/settings/`, patch);
    return data;
  },

  /** No `day` → the server's next warning day. */
  async debtPreview(day?: string): Promise<DebtPreview> {
    const { data } = await api.get<DebtPreview>(`${BASE}/debt/preview/`, { params: day ? { day } : {} });
    return data;
  },
  async debtSendNow(): Promise<{ queued: boolean }> {
    const { data } = await api.post<{ queued: boolean }>(`${BASE}/debt/send-now/`);
    return { queued: Boolean(data?.queued) };
  },
  async debtRuns(): Promise<DebtRun[]> {
    const { data } = await api.get<{ runs: DebtRun[] }>(`${BASE}/debt/runs/`);
    return data?.runs ?? [];
  },

  async templates(): Promise<{ templates: EskizTemplate[]; synced_at: string | null }> {
    const { data } = await api.get<{ templates: EskizTemplate[]; synced_at: string | null }>(`${BASE}/templates/`);
    return { templates: data?.templates ?? [], synced_at: data?.synced_at ?? null };
  },
  async syncTemplates(): Promise<TemplateSync> {
    const { data } = await api.post<TemplateSync>(`${BASE}/templates/sync/`);
    return data;
  },
  /** `template` is null when eskiz has not listed the new text yet. */
  async renameTemplate(eskizId: number, alias: string): Promise<EskizTemplate> {
    const { data } = await api.patch<{ template: EskizTemplate }>(`${BASE}/templates/${eskizId}/`, { alias });
    return data.template;
  },
  async submitTemplate(text: string): Promise<{ template: EskizTemplate | null; sync: TemplateSync }> {
    const { data } = await api.post<{ template: EskizTemplate | null; sync: TemplateSync }>(`${BASE}/templates/`, {
      text,
    });
    return data;
  },

  async sendTest(body: TestSmsBody): Promise<SmsMessage> {
    const { data } = await api.post<{ message: SmsMessage }>(`${BASE}/test/`, body);
    return data?.message;
  },

  async previewAudience(body: AudienceBody): Promise<AudiencePreview> {
    const { data } = await api.post<AudiencePreview>(`${BASE}/audience/preview/`, body);
    return data;
  },
  async audienceOptions(): Promise<AudienceOptions> {
    const { data } = await api.get<AudienceOptions>(`${BASE}/audience/options/`);
    return data;
  },
  async classrooms(): Promise<AudienceClassroom[]> {
    const { data } = await api.get<{ classrooms: AudienceClassroom[] }>(`${BASE}/audience/classrooms/`);
    return data?.classrooms ?? [];
  },
  async students(q: string): Promise<AudienceStudent[]> {
    const { data } = await api.get<{ students: AudienceStudent[] }>(`${BASE}/audience/students/`, { params: { q } });
    return data?.students ?? [];
  },
};
