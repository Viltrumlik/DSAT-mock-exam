"use client";

/**
 * The SMS Overview (plan 2026-11-01-sms-v2, Task 8). Four figures lead — what the balance holds,
 * today, this month's delivery and its cost — then, over a range kept in the address: delivery by
 * day and by operator, the cost by kind, what the debt warning makes people do, and what did not
 * arrive, with Resend. Below them, as before, the account itself (sender, eskiz's health, the debt
 * warning's next run) and a test SMS, the one way to see the whole chain work end to end.
 *
 * Two states mean nothing at all goes out, and each gets a warning above everything: eskiz has
 * no keys on this server, or the server's master switch holds the debt warning off whatever the
 * panel says.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { Alert, Badge } from "./consoleKit";
import { LineChart, StackedBarChart } from "@/components/ui/charts";
import { DebtEffect } from "./charts/DebtEffect";
import { DeliveryChart } from "./charts/DeliveryChart";
import { OperatorChart } from "./charts/OperatorChart";
import { costByDayRows, costRows } from "./charts/rows";
import { dayLabel, hourLabel, money, plural, splitCounts, todayInTashkent } from "./format";
import { StatTile } from "./look";
import { LoadError, Loading, Section, TEXT_BUTTON } from "./panelKit";
import { parseRange, rangeDates, RangePicker, serializeRange, type RangeValue } from "./RangePicker";
import type { SmsOverview, SmsStats } from "./smsApi";
import { useSmsOverview, useSmsStats } from "./smsHooks";
import { SMS_PATH, smsTabHref } from "./smsTabs";
import { TestSmsForm } from "./TestSmsForm";
import { UndeliveredList } from "./UndeliveredList";

const COST_SERIES = [
  { key: "debt_warning", label: "Debt warnings", color: "var(--chart-1)" },
  { key: "campaign", label: "Campaigns", color: "var(--chart-2)" },
  { key: "automation", label: "Automations", color: "var(--chart-6)" },
  { key: "test", label: "Tests", color: "var(--text-secondary)" },
];

function Card({ title, children, foot }: { title: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <Section title={title}>
      <div className="space-y-1 px-3 py-2.5 text-[13px]">
        {children}
        {foot ? <div className="text-ms-fg-3">{foot}</div> : null}
      </div>
    </Section>
  );
}

const Figure = ({ children }: { children: ReactNode }) => (
  <p className="text-lg font-semibold tabular-nums text-ms-fg">{children}</p>
);

function debtOffReason(debt: SmsOverview["debt"]): string {
  if (!debt.env_enabled) return "the server's master switch is off";
  if (!debt.db_enabled) return "switched off on the Debt warnings tab";
  if (!debt.freeze_enabled) return "lc-up's debt freeze is off";
  return "";
}

function eskizBadge(eskiz: SmsOverview["eskiz"]) {
  if (eskiz.login_refused) return <Badge variant="danger">Login refused</Badge>;
  if (eskiz.token_cached) return <Badge variant="success">Signed in</Badge>;
  // No token yet is normal: the account logs in on the next send, and logins are kept rare.
  return <Badge variant="neutral">Signs in on the next send</Badge>;
}

const percent = (rate: number | null) => (rate === null ? null : Math.round(rate * 100));

function Tiles({ o }: { o: SmsOverview }) {
  const today = splitCounts(o.today.total, o.today.by_status);
  const covers = o.balance !== null && o.price_per_part > 0 ? Math.floor(o.balance / o.price_per_part) : null;
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatTile
        label="Balance"
        value={o.balance}
        format={money}
        tone={o.forecast.short ? "bad" : "default"}
        hint={o.balance === null ? "Couldn't ask eskiz just now." : `≈ ${covers} SMS · ${money(o.price_per_part)} a part`}
      />
      <StatTile
        label="Today"
        value={o.today.total}
        hint={`${today.delivered} delivered${o.debt.today_left > 0 ? ` · ${o.debt.today_left} left` : ""}`}
      />
      <StatTile
        label="Delivered this month"
        value={percent(o.month.rate)}
        format={(n) => `${n}%`}
        tone={o.month.rate === null ? "default" : o.month.rate >= 0.9 ? "good" : "warn"}
        hint={`${o.month.sent} sent`}
      />
      <StatTile label="Cost this month" value={o.month.cost} format={money} hint="An estimate" />
    </div>
  );
}

function Charts({ stats }: { stats: SmsStats }) {
  if (!stats.by_day.length) {
    return <p className="rounded-ms-card bg-ms-card px-5 py-8 text-center text-[14px] text-ms-fg-3 shadow-ms-1">No SMS in this range.</p>;
  }
  const inThousands = (v: number) => money(v * 1000);
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Section title={`Delivery by day · ${percent(stats.totals.rate) ?? "—"}% delivered`} className="xl:col-span-2">
        <div className="px-2 py-3">
          <DeliveryChart data={stats.by_day} />
        </div>
      </Section>
      <Section title="By operator">
        <div className="px-2 py-3">
          <OperatorChart data={stats.by_operator} />
        </div>
      </Section>
      <Section title={`Cost · ${money(stats.totals.cost)}`}>
        <div className="space-y-2 px-2 py-3">
          <ul aria-label="Kinds" className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[12px] text-ms-fg-3">
            {COST_SERIES.map((s) => (
              <li key={s.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </li>
            ))}
            <li className="ml-auto">thousand so&apos;m</li>
          </ul>
          <StackedBarChart data={costRows(stats.cost_by_month)} xKey="month" series={COST_SERIES} height={160} valueFormatter={inThousands} />
          <LineChart
            data={costByDayRows(stats.by_day)}
            xKey="day"
            series={[{ key: "cost", label: "Per day", color: "var(--sms-accent)" }]}
            height={110}
            valueFormatter={inThousands}
          />
        </div>
      </Section>
    </div>
  );
}

export function OverviewPanel() {
  const overview = useSmsOverview();
  const search = useSearchParams();
  const router = useRouter();
  const range = parseRange(search.get("range"));
  const dates = rangeDates(range, todayInTashkent());
  const stats = useSmsStats(dates);

  const pickRange = (value: RangeValue) => {
    const params = new URLSearchParams(search.toString());
    params.set("range", serializeRange(value));
    router.replace(`${SMS_PATH}?${params.toString()}`, { scroll: false });
  };

  if (overview.isPending) return <Loading />;
  if (overview.isError || !overview.data) {
    return <LoadError what="overview" onRetry={() => void overview.refetch()} />;
  }

  const o = overview.data;
  const off = debtOffReason(o.debt);

  return (
    <div className="space-y-4">
      {!o.configured ? (
        <Alert tone="warning">
          eskiz is not configured on this server — no SMS can be sent. Its login goes in the server&apos;s environment.
        </Alert>
      ) : null}
      {!o.debt.env_enabled ? (
        <Alert tone="warning">
          The debt warning&apos;s master switch is off on this server (SMS_DEBT_WARNINGS_ENABLED) — no warning goes
          out, whatever the Debt warnings tab says.
        </Alert>
      ) : null}

      <Tiles o={o} />

      <RangePicker value={range} onChange={pickRange} />

      {stats.isPending ? (
        <Loading />
      ) : stats.isError || !stats.data ? (
        <LoadError what="statistics" onRetry={() => void stats.refetch()} />
      ) : (
        <>
          <Charts stats={stats.data} />
          <Section title="Debt warning: who paid">
            <DebtEffect months={stats.data.debt_effect} />
          </Section>
        </>
      )}

      <UndeliveredList filter={dates} pricePerPart={o.price_per_part} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Card title="Sender" foot="The name the SMS arrive from.">
          <Figure>{o.sender || "—"}</Figure>
        </Card>

        <Card title="eskiz" foot={o.eskiz.last_error ? `Last error: ${o.eskiz.last_error}` : "No errors."}>
          <p>{eskizBadge(o.eskiz)}</p>
        </Card>

        <Card
          title="Debt warning"
          foot={
            <Link href={smsTabHref("debt")} className={TEXT_BUTTON}>
              Debt warnings
            </Link>
          }
        >
          <p className="flex flex-wrap items-center gap-2">
            {o.debt.enabled ? <Badge variant="success">On</Badge> : <Badge variant="neutral">Off</Badge>}
            <span>{o.debt.enabled ? `Sends at ${hourLabel(o.debt.hour)}` : off}</span>
          </p>
          {/* Either count: when every warning so far FAILED, nothing is "sent" yet some are still to go. */}
          {o.debt.today_sent > 0 || o.debt.today_left > 0 ? (
            <p className="text-ms-fg">{`Today: ${o.debt.today_sent} sent · ${o.debt.today_left} left`}</p>
          ) : null}
          <p className="text-ms-fg">
            {o.debt.next_day
              ? `Next: ${dayLabel(o.debt.next_day)} · ${plural(o.debt.next_count, "student")}`
              : o.debt.enabled
                ? "No warning day ahead."
                : "Switched off — no warning day ahead until it is on."}
          </p>
        </Card>
      </div>

      <TestSmsForm pricePerPart={o.price_per_part} />
    </div>
  );
}
