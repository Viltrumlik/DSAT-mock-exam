"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon, type IconName } from "@/components/ui/Icon";
import { eventsApi, type LearningEvent } from "@/features/events/eventsApi";
import { financeApi, type FinanceGroupRow } from "@/features/finance/financeApi";
import { financeKeys } from "@/features/finance/financeHooks";
import { lcupApi } from "@/features/lcup/lcupApi";
import { lcupKeys } from "@/features/lcup/lcupHooks";
import { mobileApi } from "@/features/mobile/mobileApi";
import { mockSessionsApi, type MockSession } from "@/features/mockSessions/api";
import { isAdminOpsPath } from "@/features/ops/adminScope";
import { smsApi, type SmsStatsDay } from "@/features/ops/sms/smsApi";
import { smsKeys } from "@/features/ops/sms/smsHooks";
import api, { examsAdminApi } from "@/lib/api";
import { usersAdminApi } from "@/lib/usersAdminApi";
import { tashkentMonth } from "../attention";
import { formatSom } from "../entitySearch";
import { fetchLessonsToday, isNotMarked, lessonsTodayKey, type LessonsToday } from "../lessonsToday";
import { useRecent, type RecentItem } from "../recent";
import { RollNumber } from "../RollNumber";
import { toast } from "../toast";
import { Badge, Button, buttonClass, type ButtonState } from "../ui";
import { Card, Failed, Skeleton } from "./parts";

const TZ = "Asia/Tashkent";
const fmt = (n: number) => Math.round(n).toLocaleString("en-US").replace(/,/g, " ");

/** "2026-11-11", by the learning center's clock. */
export function tashkentDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayLabel(day: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

// ─── pure helpers (tested) ───────────────────────────────────────────────────

/** Today's registers so far: who came (present + late) of those marked, and how many absent or late. */
export function cameToday(d: LessonsToday | undefined): { came: number; of: number; absent: number; late: number } | null {
  if (!d) return null;
  let came = 0, of = 0, absent = 0, late = 0;
  for (const l of d.lessons) {
    if (!l.register.marked) continue;
    came += l.register.present + l.register.late;
    of += l.register.marked;
    absent += l.register.absent;
    late += l.register.late;
  }
  return of ? { came, of, absent, late } : null;
}

/** Where the "Mark attendance" button goes: the first register still to fix, else the lesson on now. */
export function markAttendanceHref(d: LessonsToday | undefined): string {
  const lesson = d?.lessons.find(isNotMarked) ?? d?.lessons.find((l) => l.phase === "now");
  return lesson ? `/ops/classrooms/${lesson.classroom.id}?tab=attendance` : "/ops/classrooms";
}

/** What the debt bars say that the numbers alone do not: how concentrated the debt is. */
export function debtFinding(groups: readonly Pick<FinanceGroupRow, "group" | "debt">[]): string | null {
  const owing = groups.filter((g) => g.debt > 0).sort((a, b) => b.debt - a.debt);
  const total = owing.reduce((s, g) => s + g.debt, 0);
  if (!total || owing.length < 2) return null;
  const share = (n: number) => Math.round((n / total) * 100);
  const top = share(owing[0].debt);
  if (top >= 35) return `${owing[0].group} holds ${top} % of the debt.`;
  const two = share(owing[0].debt + owing[1].debt);
  if (owing.length >= 4 && two >= 40) return `Two groups hold ${two} % of the debt.`;
  return `Spread across ${owing.length} groups; the largest holds ${top} %.`;
}

/** When the SMS balance runs out at the last days' spend; null when nothing was spent or nothing is known. */
export function runsOut(balance: number | null, days: readonly Pick<SmsStatsDay, "day" | "cost">[], today: string): { perDay: number; days: number; date: string } | null {
  if (balance === null || !days.length) return null;
  const perDay = days.reduce((s, d) => s + d.cost, 0) / days.length;
  if (perDay <= 0) return null;
  const left = Math.max(0, Math.floor(balance / perDay));
  return { perDay, days: left, date: addDays(today, left) };
}

/** The next active SAT date on or after today. */
export function nextExamDate(dates: readonly { exam_date: string; label?: string; is_active?: boolean }[], today: string) {
  return [...dates].filter((d) => d.is_active !== false && d.exam_date >= today).sort((a, b) => a.exam_date.localeCompare(b.exam_date))[0] ?? null;
}

/** The next mock sitting that has not happened yet. */
export function nextSitting(sessions: readonly MockSession[], today: string): MockSession | null {
  return [...sessions].filter((s) => s.session_date.slice(0, 10) >= today && s.status !== "ENDED" && s.status !== "CANCELLED").sort((a, b) => a.session_date.localeCompare(b.session_date))[0] ?? null;
}

/** Events starting in the coming seven days. */
export function eventsThisWeek(events: readonly Pick<LearningEvent, "starts_at">[], now: Date = new Date()): number {
  const from = now.getTime();
  const to = from + 7 * 86_400_000;
  return events.filter((e) => {
    const t = new Date(e.starts_at).getTime();
    return t >= from && t < to;
  }).length;
}

// ─── Learners: 2 × 2 tiles ───────────────────────────────────────────────────

function Tile({ href, label, value, sub, tone, icon, delay }: { href: string; label: string; value: string | number; sub: string; tone?: "frozen"; icon?: IconName; delay: number }) {
  const frozen = tone === "frozen";
  return (
    <Link
      href={href}
      style={{ animationDelay: `${delay}ms` }}
      className={`animate-ms-fade-in ms-hover-lift flex min-w-0 flex-col items-start gap-1 rounded-[16px] p-3.5 ${frozen ? "bg-ms-frozen-soft" : "bg-ms-surface"}`}
    >
      <span className={`flex items-center gap-1.5 text-[13px] ${frozen ? "text-ms-frozen-fg" : "text-ms-fg-2"}`}>
        {icon ? <Icon name={icon} size="sm" /> : null}
        {label}
      </span>
      <RollNumber value={value} className={`text-[26px] font-bold leading-8 tabular-nums ${frozen ? "text-ms-frozen-fg" : "text-ms-fg"}`} />
      <span className="truncate text-[13px] text-ms-fg-3">{sub}</span>
    </Link>
  );
}

export function LearnersCard({ enabled, withLessons, delay }: { enabled: boolean; withLessons: boolean; delay: number }) {
  const q = useQuery({ queryKey: ["users", "population"], queryFn: usersAdminApi.population, enabled });
  const lessons = useQuery({ queryKey: lessonsTodayKey, queryFn: fetchLessonsToday, enabled: enabled && withLessons, staleTime: 60_000 });
  if (!enabled) return null;
  const p = q.data;
  const came = cameToday(lessons.data);
  return (
    <Card title="Learners" delay={delay}>
      {q.isPending ? <Skeleton /> : q.isError ? <Failed what="learners" retry={() => void q.refetch()} /> : (
        <div className="grid grid-cols-2 gap-2.5">
          <Tile href="/ops/students" label="Learning center" value={p!.centre} sub="students in active classes" delay={delay + 60} />
          {withLessons ? (
            came ? (
              <Tile href="/ops/classrooms" label="Came today" value={`${came.came} of ${came.of}`} sub={`${came.absent} absent · ${came.late} late`} delay={delay + 100} />
            ) : (
              <Tile href="/ops/classrooms" label="Came today" value="—" sub={lessons.isError ? "registers didn’t load" : "no register marked yet"} delay={delay + 100} />
            )
          ) : (
            <Tile href="/ops/public" label="Signed up" value={p!.signups_30d} sub="in the last 30 days" delay={delay + 100} />
          )}
          <Tile href="/ops/public" label="Public users" value={p!.public} sub={`+${p!.signups_7d} this week`} delay={delay + 140} />
          <Tile href="/ops/students?status=frozen_debt" label="Frozen — debt" value={p!.frozen_debt} sub="access paused, seats kept" tone="frozen" icon="ms-freeze" delay={delay + 180} />
        </div>
      )}
    </Card>
  );
}

// ─── Recently opened ─────────────────────────────────────────────────────────

const AV = [
  "bg-ms-av1-bg text-ms-av1-fg",
  "bg-ms-av2-bg text-ms-av2-fg",
  "bg-ms-av3-bg text-ms-av3-fg",
  "bg-ms-av4-bg text-ms-av4-fg",
  "bg-ms-av5-bg text-ms-av5-fg",
  "bg-ms-av6-bg text-ms-av6-fg",
];
function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
function shortName(r: RecentItem): string {
  if (r.kind === "class") return r.name.split(/\s*[|·]\s*/)[0];
  const [first, second] = r.name.trim().split(/\s+/);
  return second ? `${first} ${second[0]}.` : first;
}

export function RecentlyOpened({ delay }: { delay: number }) {
  const items = useRecent().slice(0, 5);
  return (
    <Card title="Recently opened" delay={delay}>
      {items.length === 0 ? (
        <p className="text-[14px] text-ms-fg-2">Students and classes you open show up here, for a quick way back.</p>
      ) : (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {items.map((r, i) => (
            <Link
              key={`${r.kind}-${r.id}`}
              href={r.href}
              title={r.name}
              style={{ animationDelay: `${delay + 60 + i * 40}ms` }}
              className="animate-ms-fade-in ms-hover-lift flex w-[76px] shrink-0 flex-col items-center gap-1.5 rounded-[14px] p-1 text-center text-[12.5px] font-medium leading-4 text-ms-fg"
            >
              <span className={`grid size-14 place-items-center text-[18px] font-semibold ${r.kind === "class" ? "rounded-[16px]" : "rounded-full"} ${AV[r.id % AV.length]}`}>
                {r.kind === "class" ? <Icon name="cap" size="lg" /> : initials(r.name)}
              </span>
              <span className="line-clamp-2">{shortName(r)}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Where debt sits ─────────────────────────────────────────────────────────

export function DebtCard({ enabled, delay }: { enabled: boolean; delay: number }) {
  const month = tashkentMonth();
  const q = useQuery({ queryKey: financeKeys.summary(month), queryFn: () => financeApi.summary(month), enabled, staleTime: 60_000 });
  if (!enabled) return null;
  const groups = (q.data?.by_group ?? []).filter((g) => g.debt > 0).sort((a, b) => b.debt - a.debt);
  const top = groups.slice(0, 4);
  const rest = groups.slice(4);
  const max = top[0]?.debt ?? 1;
  const restSum = rest.reduce((s, g) => s + g.debt, 0);
  const finding = debtFinding(groups);
  const monthName = dayLabel(`${month}-01`, { month: "long" });
  return (
    <Card
      title="Where debt sits"
      delay={delay}
      action={q.data && groups.length ? <span className="text-[13px] tabular-nums text-ms-fg-3">{monthName} · {formatSom(q.data.total_debt)}</span> : undefined}
    >
      {q.isPending ? <Skeleton rows={4} /> : q.isError ? <Failed what="debts from lc-up" retry={() => void q.refetch()} /> : groups.length === 0 ? (
        <p className="flex items-center gap-2.5 text-[15px] text-ms-fg-2">
          <Icon name="ok" className="text-ms-positive-fg" />
          No one owes this month.
        </p>
      ) : (
        <div className="animate-ms-fade-in flex flex-col gap-2.5">
          {finding ? <p className="text-[14px] font-medium text-ms-fg-2">{finding}</p> : null}
          {top.map((g, i) => (
            <div key={g.group} className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_auto] items-center gap-2.5 text-[13.5px]">
              <span className="truncate text-ms-fg" title={g.group}>{g.group}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-ms-surface-2">
                <span className="animate-ms-wipe-in block h-full rounded-full bg-ms-critical" style={{ width: `${(g.debt / max) * 100}%`, animationDelay: `${delay + 120 + i * 60}ms` }} />
              </span>
              <span className="text-right font-semibold tabular-nums text-ms-critical-fg">{fmt(g.debt)}</span>
            </div>
          ))}
          {rest.length ? (
            <div className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_auto] items-center gap-2.5 text-[13.5px] text-ms-fg-2">
              <span>{rest.length} more {rest.length === 1 ? "group" : "groups"}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-ms-surface-2">
                <span className="block h-full rounded-full bg-ms-surface-3" style={{ width: `${Math.min(100, (restSum / max) * 100)}%` }} />
              </span>
              <span className="text-right tabular-nums">{fmt(restSum)}</span>
            </div>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-2">
            <Link href="/ops/sms?tab=debt" className={buttonClass({ size: "sm" })}>
              <Icon name="send" size="sm" />
              Debt reminders
            </Link>
            <Link href="/ops/finance" className={buttonClass({ variant: "ghost", size: "sm" })}>
              Open Finance
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── SMS ─────────────────────────────────────────────────────────────────────

/** The balance falling at the recent spend, to the day it runs out (no invented history: top-ups are unknown). */
function RunsOutGraphic({ balance, perDay, days, date }: { balance: number; perDay: number; days: number; date: string }) {
  const span = Math.min(days, 30);
  const endX = 8 + 344 * (span / 30);
  const endY = days > 30 ? 84 - 72 * (1 - (perDay * 30) / balance) : 84;
  const label = days > 30 ? "lasts beyond 30 days" : days === 0 ? "runs out today" : `runs out ≈ ${dayLabel(date)}`;
  return (
    <svg viewBox="0 0 360 96" role="img" aria-label={`Balance falling, ${label}`} className="h-24 w-full font-ms-sans">
      <path d="M8 84H352" className="stroke-ms-border-strong" strokeWidth={1} />
      <path className="animate-ms-wipe-in stroke-ms-attention" d={`M8 12 L${endX.toFixed(1)} ${endY.toFixed(1)}`} strokeWidth={2.5} strokeDasharray="5 5" strokeLinecap="round" fill="none" />
      <circle cx={8} cy={12} r={4.5} className="fill-ms-primary" />
      <circle cx={endX} cy={endY} r={4.5} className="fill-ms-card stroke-ms-attention" strokeWidth={2.5} />
      <text x={Math.min(Math.max(endX, 120), 352)} y={Math.min(endY, 84) - 12} textAnchor="end" className="fill-ms-attention-fg text-[12px] font-semibold">
        {label}
      </text>
    </svg>
  );
}

export function SmsCard({ enabled, delay }: { enabled: boolean; delay: number }) {
  const today = tashkentDay();
  const overview = useQuery({ queryKey: smsKeys.overview, queryFn: () => smsApi.overview(), enabled, staleTime: 60_000 });
  const stats = useQuery({
    queryKey: ["sms", "stats", "today-card", today],
    queryFn: () => smsApi.stats({ from: addDays(today, -13), to: today }),
    enabled,
    staleTime: 5 * 60_000,
  });
  if (!enabled) return null;
  const o = overview.data;
  const by = o?.today.by_status ?? {};
  const notDelivered = (by.UNDELIVERED ?? 0) + (by.REJECTED ?? 0) + (by.FAILED ?? 0);
  const outlook = o ? runsOut(o.balance, stats.data?.by_day ?? [], today) : null;
  return (
    <Card
      title="SMS"
      delay={delay}
      action={notDelivered ? <Badge tone="critical" icon="ms-undelivered">{notDelivered} not delivered</Badge> : undefined}
    >
      {overview.isPending ? <Skeleton rows={3} /> : overview.isError ? <Failed what="the SMS balance" retry={() => void overview.refetch()} /> : (
        <div className="animate-ms-fade-in flex flex-col gap-2">
          {o!.balance === null ? (
            <p className="text-[15px] text-ms-fg-2">{o!.configured ? "Eskiz didn’t say the balance." : "Eskiz is not connected yet."}</p>
          ) : (
            <p className="flex flex-wrap items-baseline gap-1.5">
              <RollNumber value={fmt(o!.balance)} className="text-[28px] font-bold leading-[34px] tabular-nums text-ms-fg" />
              <span className="text-ms-fg-2">
                so’m left{o!.price_per_part ? ` · ≈ ${fmt(o!.balance / o!.price_per_part)} SMS` : ""}
              </span>
            </p>
          )}
          {o!.balance !== null && outlook ? (
            <>
              <RunsOutGraphic balance={o!.balance} {...outlook} />
              <span className="text-[13px] text-ms-fg-3">Spends ≈ {fmt(outlook.perDay)} so’m a day (last 14 days).</span>
            </>
          ) : stats.isError ? (
            <span className="text-[13px] text-ms-fg-3">The last 14 days’ spend didn’t load, so there is no forecast.</span>
          ) : o!.balance !== null && !stats.isPending ? (
            <span className="text-[13px] text-ms-fg-3">Nothing spent in the last 14 days.</span>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-2">
            <Link href="/ops/sms?tab=campaigns" className={buttonClass({ size: "sm" })}>
              <Icon name="plus" size="sm" />
              New campaign
            </Link>
            <Link href="/ops/sms?tab=journal" className={buttonClass({ variant: "ghost", size: "sm" })}>
              Journal
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Income ──────────────────────────────────────────────────────────────────

const METHOD: Record<string, string> = { cash: "Cash", click: "Click", payme: "Payme", card: "Card", transfer: "Transfer", uzum: "Uzum" };

export function IncomeCard({ enabled, delay }: { enabled: boolean; delay: number }) {
  const month = tashkentMonth();
  const q = useQuery({ queryKey: financeKeys.summary(month), queryFn: () => financeApi.summary(month), enabled, staleTime: 60_000 });
  if (!enabled) return null;
  const monthName = dayLabel(`${month}-01`, { month: "long" });
  const methods = Object.entries(q.data?.by_method ?? {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return (
    <Card title={`Income · ${monthName}`} delay={delay}>
      {q.isPending ? <Skeleton rows={3} /> : q.isError ? (
        <Failed what="from lc-up" why="This is not zero — the link didn’t answer. Other numbers are up to date." retry={() => void q.refetch()} />
      ) : (
        <div className="animate-ms-fade-in flex flex-col gap-2.5">
          <p className="flex flex-wrap items-baseline gap-1.5">
            <RollNumber value={fmt(q.data!.paid)} className="text-[28px] font-bold leading-[34px] tabular-nums text-ms-fg" />
            <span className="text-ms-fg-2">so’m paid</span>
          </p>
          {methods.length ? (
            <div className="flex flex-col gap-1.5 text-[14px]">
              {methods.map(([m, v]) => (
                <span key={m} className="flex justify-between gap-3">
                  <span className="text-ms-fg-2">{METHOD[m.toLowerCase()] ?? m}</span>
                  <span className="tabular-nums text-ms-fg">{fmt(v)}</span>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[14px] text-ms-fg-3">No payment recorded yet this month.</span>
          )}
          {q.data!.refunded ? <span className="text-[13px] text-ms-fg-3">Refunded {formatSom(q.data!.refunded)}</span> : null}
        </div>
      )}
    </Card>
  );
}

// ─── Platform (super admin) ──────────────────────────────────────────────────

function Row({ icon, label, children, href }: { icon: IconName; label: string; children: React.ReactNode; href?: string }) {
  const body = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-ms-surface-2 text-ms-fg-2">
        <Icon name={icon} size="sm" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="text-[14px] font-semibold text-ms-fg">{label}</b>
        <span className="truncate text-[13px] text-ms-fg-3">{children}</span>
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="ms-transition -mx-2 flex items-center gap-3 rounded-[12px] px-2 py-2 hover:bg-ms-surface">
      {body}
    </Link>
  ) : (
    <div className="flex items-center gap-3 py-2">{body}</div>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  const day = tashkentDay(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
  const today = tashkentDay();
  return day === today ? time : day === addDays(today, -1) ? `${time} yesterday` : `${time} · ${dayLabel(day)}`;
}

export function PlatformCard({ delay }: { delay: number }) {
  const today = tashkentDay();
  const queryClient = useQueryClient();
  const lcup = useQuery({ queryKey: lcupKeys.status, queryFn: () => lcupApi.status(), staleTime: 60_000 });
  const policy = useQuery({ queryKey: ["mobile", "policy", "ios"], queryFn: () => mobileApi.policy(), staleTime: 5 * 60_000 });
  const dates = useQuery({ queryKey: ["exam-dates", "admin"], queryFn: () => examsAdminApi.listExamDatesAdmin() as Promise<{ exam_date: string; label?: string; is_active?: boolean }[]>, staleTime: 5 * 60_000 });
  const sittings = useQuery({ queryKey: ["mock-sessions", "admin"], queryFn: () => mockSessionsApi.list(), staleTime: 60_000 });
  const [sync, setSync] = useState<ButtonState>("idle");

  const run = lcup.data?.last_run;
  const exam = nextExamDate(Array.isArray(dates.data) ? dates.data : [], today);
  const sitting = nextSitting(sittings.data ?? [], today);
  const syncNow = async () => {
    setSync("busy");
    try {
      await lcupApi.sync();
      setSync("done");
      toast.show({ icon: "ms-sync", message: "lc-up sync started · about 1 minute", action: { label: "View", run: () => window.location.assign("/ops/lcup") } });
      void queryClient.invalidateQueries({ queryKey: lcupKeys.status });
      window.setTimeout(() => setSync("idle"), 1600);
    } catch {
      setSync("idle");
      toast.show({ tone: "error", message: "lc-up sync didn’t start. Try again in a minute." });
    }
  };

  return (
    <Card title="Platform" aside={<Badge tone="line">Super admin</Badge>} delay={delay}>
      <div className="flex flex-col">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <Row icon="ms-sync" label="lc-up sync" href="/ops/lcup">
              {lcup.isPending ? "Checking…" : lcup.isError ? "Couldn’t check" : !run ? "Never ran" : `${run.ok ? "OK" : "Failed"} · ${when(run.finished_at ?? run.started_at)}`}
            </Row>
          </div>
          <Button size="sm" state={sync} busyLabel="Starting…" doneLabel="Started" onClick={() => void syncNow()}>
            Sync now
          </Button>
        </div>
        <Row icon="ms-appversion" label="iOS app" href="/ops/mobile">
          {policy.isPending ? "Checking…" : policy.isError ? "Couldn’t check" : `Minimum ${policy.data!.minimum_version || "—"} · latest ${policy.data!.latest_version || "—"}`}
        </Row>
        <Row icon="ms-examdate" label="Next SAT" href="/ops/exam-dates">
          {dates.isPending ? "Checking…" : dates.isError ? "Couldn’t check" : exam ? `${dayLabel(exam.exam_date, { day: "numeric", month: "short", year: "numeric" })}${exam.label ? ` · ${exam.label}` : ""}` : "No date set"}
        </Row>
        <Row icon="ms-room" label="Next mock sitting" href="/ops/mock-sessions">
          {sittings.isPending ? "Checking…" : sittings.isError ? "Couldn’t check" : sitting ? `${dayLabel(sitting.session_date.slice(0, 10), { weekday: "short", day: "numeric", month: "short" })} · ${sitting.title || sitting.mock_title}` : "None planned"}
        </Row>
      </div>
    </Card>
  );
}

// ─── Shortcuts, with their counts ────────────────────────────────────────────

type Shortcut = { href: string; icon: IconName; title: string; cta: string; count?: (c: Counts) => string | null };
type Counts = { centre?: number; public?: number; classes?: number; events?: number };

const SHORTCUTS: Shortcut[] = [
  { href: "/ops/students", icon: "users", title: "Students", cta: "manage", count: (c) => (c.centre !== undefined ? fmt(c.centre) : null) },
  { href: "/ops/public", icon: "user", title: "Public users", cta: "manage", count: (c) => (c.public !== undefined ? fmt(c.public) : null) },
  { href: "/ops/staff", icon: "shield", title: "Staff", cta: "manage" },
  { href: "/ops/classrooms", icon: "cap", title: "Classrooms", cta: "view", count: (c) => (c.classes !== undefined ? `${fmt(c.classes)} classes` : null) },
  { href: "/ops/access", icon: "key", title: "Access", cta: "manage" },
  { href: "/ops/events", icon: "ticket", title: "Events", cta: "check-in", count: (c) => (c.events !== undefined ? `${c.events} this week` : null) },
  { href: "/ops/midterms", icon: "ms-midterm", title: "Midterm results", cta: "report" },
  { href: "/ops/journals", icon: "ms-journal", title: "Journals", cta: "open" },
];

export function ShortcutsCard({ desk, scoped, delay }: { desk: boolean; scoped: boolean; delay: number }) {
  const links = scoped ? SHORTCUTS.filter((l) => isAdminOpsPath(l.href)) : SHORTCUTS;
  const pop = useQuery({ queryKey: ["users", "population"], queryFn: usersAdminApi.population, enabled: desk });
  const classes = useQuery({
    queryKey: ["console", "today", "classes-count"],
    queryFn: async () => (await api.get<{ count: number }>("/classes/admin/classrooms/", { params: { page_size: 1 } })).data.count,
    enabled: desk,
    staleTime: 5 * 60_000,
  });
  const events = useQuery({ queryKey: ["events", "admin"], queryFn: () => eventsApi.adminList(), enabled: desk && links.some((l) => l.href === "/ops/events"), staleTime: 5 * 60_000 });
  const counts: Counts = {
    centre: pop.data?.centre,
    public: pop.data?.public,
    classes: classes.data,
    events: events.data ? eventsThisWeek(events.data) : undefined,
  };
  return (
    <Card title="Shortcuts" delay={delay} action={<span className="text-[13px] text-ms-fg-3">⌘K finds all of these too</span>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {links.map((l, i) => {
          const n = l.count?.(counts);
          return (
            <Link
              key={l.href}
              href={l.href}
              className="animate-ms-fade-in ms-hover-lift flex min-h-[76px] flex-col justify-between gap-2 rounded-[14px] bg-ms-surface p-3 text-ms-fg"
              style={{ animationDelay: `${delay + 60 + i * 35}ms` }}
            >
              <Icon name={l.icon} className="text-ms-fg-2" />
              <span className="flex flex-col leading-tight">
                <span className="text-[14px] font-semibold">{l.title}</span>
                <span className="text-[12px] tabular-nums text-ms-fg-3">{n ? `${n} · ${l.cta}` : l.cta}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
