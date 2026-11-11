"use client";

import { useQuery } from "@tanstack/react-query";

import type { IconName } from "@/components/ui/Icon";
import { financeApi, type FinanceSummary } from "@/features/finance/financeApi";
import { financeKeys } from "@/features/finance/financeHooks";
import { lcupApi, type LcupFollowups, type LcupStatus } from "@/features/lcup/lcupApi";
import { lcupKeys } from "@/features/lcup/lcupHooks";
import { smsApi, type SmsOverview } from "@/features/ops/sms/smsApi";
import { smsKeys } from "@/features/ops/sms/smsHooks";
import api from "@/lib/api";
import { formatSom } from "./entitySearch";
import { fetchLessonsToday, lessonsTodayKey, notMarkedItem } from "./lessonsToday";

/**
 * "Needs you" (design handoff v0.3, AdminToday / BuilderHome boards and the top bar's bell): the
 * things someone has to act on now, most urgent first. Each comes from an endpoint that already
 * exists, under that endpoint's own react-query key, so the bell, the dashboard and the page the
 * item links to share one fetch.
 *
 * Every source keeps its own state: still loading, failed (said so, with Retry — a failed source is
 * never shown as "nothing to do"), or done, with an item only when its count is above zero.
 */
export type AttentionItem = {
  id: string;
  icon: IconName;
  tone: "critical" | "attention" | "info";
  title: string;
  detail?: string;
  action: { label: string; href: string };
};

export type AttentionSource = {
  id: string;
  /** What the source is, for its error line: "SMS", "lc-up groups". */
  label: string;
  status: "loading" | "error" | "done";
  item: AttentionItem | null;
  retry: () => void;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function smsItem(o: SmsOverview): AttentionItem | null {
  const s = o.today.by_status;
  const failed = (s.UNDELIVERED ?? 0) + (s.REJECTED ?? 0) + (s.FAILED ?? 0);
  if (failed > 0) {
    return {
      id: "sms",
      icon: "ms-undelivered",
      tone: "critical",
      title: `${plural(failed, "SMS", "SMS")} did not arrive today`,
      detail: o.eskiz.last_error || (o.forecast.short ? "The balance is too low for the next 24 hours" : undefined),
      action: { label: "Open SMS", href: "/ops/sms" },
    };
  }
  if (o.forecast.short) {
    return {
      id: "sms",
      icon: "wallet",
      tone: "attention",
      title: "SMS balance runs short in the next 24 hours",
      detail: o.balance !== null ? `${formatSom(o.balance)} left · ${formatSom(o.forecast.total)} needed` : undefined,
      action: { label: "Open SMS", href: "/ops/sms" },
    };
  }
  return null;
}

export function trialsItem(f: LcupFollowups): AttentionItem | null {
  if (!f.pending) return null;
  const missing = f.not_on_list?.length ?? 0;
  return {
    id: "trials",
    icon: "ms-trial",
    tone: "attention",
    title: `${plural(f.pending, "trial student", "trial students")} to call back`,
    detail: missing ? `${plural(missing, "lc-up member", "lc-up members")} missing from a class list` : undefined,
    action: { label: "Open trials", href: "/ops/trials" },
  };
}

export function debtItem(s: FinanceSummary): AttentionItem | null {
  if (!s.debtors) return null;
  const detail = [s.frozen ? `${s.frozen} frozen for debt` : "", s.exempt ? `${s.exempt} exempt` : ""].filter(Boolean).join(" · ");
  return {
    id: "debt",
    icon: "wallet",
    tone: "critical",
    title: `${plural(s.debtors, "student owes", "students owe")} ${formatSom(s.total_debt)}`,
    detail: detail || undefined,
    action: { label: "Debtors", href: "/ops/finance" },
  };
}

export function pairingItem(s: LcupStatus): AttentionItem | null {
  const n = s.counts?.groups_pending ?? 0;
  if (!n) return null;
  return {
    id: "lcup",
    icon: "ms-sync",
    tone: "attention",
    title: `${plural(n, "lc-up group", "lc-up groups")} to pair with a class`,
    action: { label: "Pair", href: "/ops/lcup" },
  };
}

type Facet = { key: string; options: { value: string; label: string; count: number }[] };
type FacetPage = { count: number; filters?: Facet[] };

/** Active classes with no teacher: the list's count minus the teacher facet (one teacher per class). */
export function noTeacherCount(page: FacetPage): number {
  const teacher = page.filters?.find((f) => f.key === "teacher");
  if (!teacher) return 0;
  return Math.max(0, page.count - teacher.options.reduce((sum, o) => sum + (o.count ?? 0), 0));
}

export function noTeacherItem(page: FacetPage): AttentionItem | null {
  const n = noTeacherCount(page);
  if (!n) return null;
  return {
    id: "teacher",
    icon: "warn",
    tone: "attention",
    title: n === 1 ? "1 class has no teacher" : `${n} classes have no teacher`,
    action: { label: "Assign", href: "/ops/classrooms?status=active" },
  };
}

const facetCount = (page: FacetPage, key: string, value: string) =>
  page.filters?.find((f) => f.key === key)?.options.find((o) => o.value === value)?.count ?? 0;

export function reviewItem(page: FacetPage): AttentionItem | null {
  const n = facetCount(page, "status", "TRIAGE");
  if (!n) return null;
  return {
    id: "review",
    icon: "ms-review",
    tone: "attention",
    title: `${plural(n, "question", "questions")} waiting for review`,
    action: { label: "Start reviewing", href: "/builder/question-bank/triage" },
  };
}

export function unclassifiedItem(page: FacetPage): AttentionItem | null {
  const n = facetCount(page, "classified", "no");
  if (!n) return null;
  return {
    id: "unclassified",
    icon: "tag",
    tone: "info",
    title: `${plural(n, "question", "questions")} without a skill`,
    detail: "They won’t show in students’ error reports",
    action: { label: "Classify", href: "/builder/question-bank?classified=no" },
  };
}

/** This month, by the learning center's clock: "2026-11". */
export function tashkentMonth(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit" }).format(now);
}

function source<T>(
  id: string,
  label: string,
  q: { status: "pending" | "error" | "success"; data: T | undefined; refetch: () => unknown },
  derive: (data: T) => AttentionItem | null,
): AttentionSource {
  const retry = () => void q.refetch();
  if (q.status === "pending") return { id, label, status: "loading", item: null, retry };
  if (q.status === "error" || q.data === undefined) return { id, label, status: "error", item: null, retry };
  try {
    return { id, label, status: "done", item: derive(q.data), retry };
  } catch {
    // A reply that is not the shape we know is a failure to read it — never "nothing to do".
    return { id, label, status: "error", item: null, retry };
  }
}

/** Admin's sources. `enabled` only for super admins and admins: every endpoint here refuses others. */
export function useAdminAttention(enabled: boolean): AttentionSource[] {
  const lessons = useQuery({ queryKey: lessonsTodayKey, queryFn: fetchLessonsToday, enabled, staleTime: 60_000, refetchInterval: 120_000 });
  const sms = useQuery({ queryKey: smsKeys.overview, queryFn: () => smsApi.overview(), enabled, staleTime: 60_000 });
  const trials = useQuery({ queryKey: lcupKeys.followups, queryFn: () => lcupApi.followups(), enabled, refetchInterval: 60_000 });
  const month = tashkentMonth();
  const debt = useQuery({ queryKey: financeKeys.summary(month), queryFn: () => financeApi.summary(month), enabled, staleTime: 60_000 });
  const lcup = useQuery({ queryKey: lcupKeys.status, queryFn: () => lcupApi.status(), enabled, staleTime: 60_000 });
  const teacher = useQuery({
    queryKey: ["console", "attention", "classes-no-teacher"],
    queryFn: async () => (await api.get<FacetPage>("/classes/admin/classrooms/", { params: { status: "active", page_size: 25 } })).data,
    enabled,
    staleTime: 60_000,
  });
  if (!enabled) return [];
  return [
    source("lessons", "today's lessons", lessons, notMarkedItem),
    source("sms", "SMS", sms, smsItem),
    source("debt", "debts", debt, debtItem),
    source("trials", "trials", trials, trialsItem),
    source("lcup", "lc-up groups", lcup, pairingItem),
    source("teacher", "classes", teacher, noTeacherItem),
  ];
}

/** The Builder's sources: one question-bank request answers both (its status and classified facets). */
export function useBuilderAttention(enabled: boolean): AttentionSource[] {
  const bank = useQuery({
    queryKey: ["console", "attention", "qb-facets"],
    queryFn: async () => (await api.get<FacetPage>("/questionbank/questions/changelist/", { params: { page_size: 25 } })).data,
    enabled,
    staleTime: 60_000,
  });
  if (!enabled) return [];
  return [source("review", "the review queue", bank, reviewItem), source("unclassified", "questions", bank, unclassifiedItem)];
}

/** How many KINDS of problem there are (the bell's number), not how many people. */
export function attentionCount(sources: readonly AttentionSource[]): number {
  return sources.filter((s) => s.item).length;
}
