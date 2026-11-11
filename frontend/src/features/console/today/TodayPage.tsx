"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Icon, type IconName } from "@/components/ui/Icon";
import { financeApi } from "@/features/finance/financeApi";
import { financeKeys } from "@/features/finance/financeHooks";
import { isAdminOpsPath, isScopedOpsAdmin } from "@/features/ops/adminScope";
import { isOpsSuperAdmin } from "@/features/ops/shell/opsNav";
import { useMe } from "@/hooks/useMe";
import { usersAdminApi } from "@/lib/usersAdminApi";
import { attentionCount, tashkentMonth, useAdminAttention } from "../attention";
import { AttentionList } from "../AttentionList";
import { formatSom } from "../entitySearch";

const SHORTCUTS: { href: string; icon: IconName; title: string; cta: string }[] = [
  { href: "/ops/students", icon: "users", title: "Students", cta: "Manage" },
  { href: "/ops/public", icon: "user", title: "Public users", cta: "Manage" },
  { href: "/ops/staff", icon: "shield", title: "Staff", cta: "Manage" },
  { href: "/ops/classrooms", icon: "cap", title: "Classrooms", cta: "View" },
  { href: "/ops/midterms", icon: "ms-midterm", title: "Midterm results", cta: "Report" },
  { href: "/ops/access", icon: "key", title: "Access", cta: "Manage" },
  { href: "/ops/journals", icon: "ms-journal", title: "Journals", cta: "Open" },
];

/** "Good afternoon" and "Wednesday, 11 November", by the learning center's clock. */
export function todayHeading(now = new Date()): { greeting: string; date: string } {
  const tz = "Asia/Tashkent";
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hour12: false }).format(now));
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(now);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "long" }).format(now);
  return { greeting: hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening", date: `${weekday}, ${day}` };
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-ms-card bg-ms-card p-5 shadow-ms-1">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-ms-h text-ms-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Failed({ what, retry }: { what: string; retry: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3.5 py-3 text-[14px]">
      <Icon name="alert" className="text-ms-critical-fg" />
      <span className="flex-1 text-ms-fg">Couldn’t load {what}. This is not zero.</span>
      <button type="button" onClick={retry} className="ms-transition min-h-9 rounded-[8px] px-2.5 font-semibold text-ms-primary-text hover:bg-ms-card">
        Retry
      </button>
    </div>
  );
}

function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 py-1">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="animate-ms-shimmer h-4 rounded-[6px]" style={{ width: `${80 - i * 15}%` }} />
      ))}
    </div>
  );
}

function Learners({ enabled }: { enabled: boolean }) {
  const q = useQuery({ queryKey: ["users", "population"], queryFn: usersAdminApi.population, enabled });
  if (!enabled) return null;
  const p = q.data;
  const tiles = p
    ? [
        { href: "/ops/students", label: "Learning center", value: p.centre, sub: "students in active classes" },
        { href: "/ops/public", label: "Public users", value: p.public, sub: `+${p.signups_7d} this week` },
        { href: "/ops/students?status=frozen_debt", label: "Frozen — debt", value: p.frozen_debt, sub: "access paused, seats kept", frozen: true },
      ]
    : [];
  return (
    <Card title="Learners">
      {q.isPending ? <Skeleton /> : q.isError ? <Failed what="learners" retry={() => void q.refetch()} /> : (
        <div className="flex flex-col">
          {tiles.map((t) => (
            <Link key={t.href} href={t.href} className="ms-transition -mx-2 flex items-center gap-3 rounded-[12px] px-2 py-2.5 hover:bg-ms-surface">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5 text-[14px] font-medium text-ms-fg-2">
                  {t.frozen ? <Icon name="ms-freeze" size="sm" className="text-ms-frozen-fg" /> : null}
                  {t.label}
                </span>
                <span className="text-[13px] text-ms-fg-3">{t.sub}</span>
              </span>
              <span className="text-ms-num tabular-nums text-ms-fg">{t.value}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function DebtByGroup({ enabled }: { enabled: boolean }) {
  const month = tashkentMonth();
  const q = useQuery({ queryKey: financeKeys.summary(month), queryFn: () => financeApi.summary(month), enabled, staleTime: 60_000 });
  if (!enabled) return null;
  const groups = (q.data?.by_group ?? []).filter((g) => g.debt > 0).sort((a, b) => b.debt - a.debt);
  const top = groups.slice(0, 4);
  const rest = groups.slice(4);
  return (
    <Card
      title="Where debt sits"
      action={<Link href="/ops/finance" className="text-[14px] font-semibold text-ms-primary-text hover:underline">Open Finance</Link>}
    >
      {q.isPending ? <Skeleton rows={4} /> : q.isError ? <Failed what="debts from lc-up" retry={() => void q.refetch()} /> : groups.length === 0 ? (
        <p className="flex items-center gap-2.5 text-[15px] text-ms-fg-2">
          <Icon name="ok" className="text-ms-positive-fg" />
          No one owes this month.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          <span className="text-[13px] text-ms-fg-3">This month · {formatSom(q.data!.total_debt)}</span>
          {top.map((g) => (
            <div key={g.group}>
              <span className="flex items-baseline justify-between gap-3 text-[14px]">
                <span className="truncate text-ms-fg">{g.group}</span>
                <span className="shrink-0 tabular-nums font-semibold text-ms-critical-fg">{formatSom(g.debt)}</span>
              </span>
            </div>
          ))}
          {rest.length ? (
            <span className="flex justify-between text-[14px] text-ms-fg-3">
              <span>{rest.length} more {rest.length === 1 ? "group" : "groups"}</span>
              <span className="tabular-nums">{formatSom(rest.reduce((s, g) => s + g.debt, 0))}</span>
            </span>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/**
 * /ops — Today (design handoff v0.3, AdminToday board): it opens on what needs someone now. Super
 * admins and admins get "Needs you" (the bell's items) and where the debt sits; anyone the people
 * API admits gets the learner numbers; everyone gets the shortcuts (⌘K finds all of these too).
 */
export function TodayPage() {
  const { me } = useMe();
  const role = String(me?.role ?? "").toLowerCase();
  const desk = isOpsSuperAdmin(me) || isScopedOpsAdmin(me);
  const attention = useAdminAttention(desk);
  const settled = attention.every((s) => s.status === "done");
  const count = attentionCount(attention);
  const { greeting, date } = todayHeading();
  const first = typeof me?.first_name === "string" && me.first_name.trim() ? me.first_name.trim() : "";
  const links = isScopedOpsAdmin(me) ? SHORTCUTS.filter((l) => isAdminOpsPath(l.href)) : SHORTCUTS;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-ms-display text-ms-fg">{first ? `${greeting}, ${first}` : greeting}</h1>
        <p className="text-ms-body text-ms-fg-2">
          {date}
          {desk && settled ? (count ? ` · ${count} ${count === 1 ? "thing needs" : "things need"} you` : " · nothing needs you right now") : ""}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="flex min-w-0 flex-col gap-5">
          {desk ? (
            <Card title="Needs you" action={count ? <span className="text-[13px] text-ms-fg-3">Most urgent first</span> : undefined}>
              <AttentionList sources={attention} />
            </Card>
          ) : null}
          <DebtByGroup enabled={desk} />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Learners enabled={desk || role === "teacher"} />
          <Card title="Shortcuts" action={<span className="text-[13px] text-ms-fg-3">⌘K finds these too</span>}>
            <div className="grid grid-cols-2 gap-2">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="ms-transition ms-hover-lift flex min-h-[72px] flex-col justify-between gap-2 rounded-[14px] bg-ms-surface p-3 text-ms-fg"
                >
                  <Icon name={l.icon} className="text-ms-fg-2" />
                  <span className="flex flex-col leading-tight">
                    <span className="text-[14px] font-semibold">{l.title}</span>
                    <span className="text-[12px] text-ms-fg-3">{l.cta}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
