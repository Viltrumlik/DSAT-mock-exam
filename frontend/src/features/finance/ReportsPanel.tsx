"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Segmented, StatTile, signedAmount } from "@/features/console/ui";
import { BarChart, ChartFrame, ShareBars } from "@/features/console/graphics";
import { monthBounds } from "./ExpensesPanel";
import { BOX, CAPTION, CONTROL, LoadError, Loading, SOM, TABLE, TD, TD_R, TH, TH_R, TR, day, methodLabel, som } from "./FinancePanels";
import { usePeriodReport, type PeriodReport } from "./reportApi";

/**
 * Reports for a period, lc-up's "Hisobotlar" (owner 22 Nov 2026: reports leave lc-up too; design approved the same
 * day): today, this week, this month or any stretch. What came in and how, what went out and on what, the net, what
 * the lessons earned, the students in a paid seat each day (lc-up's "Aktiv talabalar hisoboti"), who started, left or
 * froze, and what was owed as the period ended.
 */

type Period = "today" | "week" | "month" | "range";

const LABEL = "flex flex-col gap-1 text-[12px] text-ms-fg-3";

function iso(date: Date): string {
  const part = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
}

/** The stretch a period covers, on the admin's own calendar: a week runs Monday to Sunday. */
export function periodBounds(period: Exclude<Period, "range">, now: Date = new Date()): { from: string; to: string } {
  if (period === "today") return { from: iso(now), to: iso(now) };
  if (period === "month") return monthBounds(now);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: iso(monday), to: iso(sunday) };
}

const amount = (n: number) => signedAmount(n);

function MoneyTiles({ r }: { r: PeriodReport }) {
  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
      <StatTile label="Money in" value={amount(r.money_in.paid)} unit={SOM} sub={r.money_in.payments === 1 ? "1 payment" : `${r.money_in.payments} payments`} />
      <StatTile label="Refunds" value={amount(r.money_in.refunded)} unit={SOM} delay={30} />
      <StatTile
        label="Money out"
        value={amount(-r.money_out.total)}
        unit={SOM}
        sub={r.money_out.count === 1 ? "1 expense" : `${r.money_out.count} expenses`}
        delay={60}
      />
      <StatTile
        label="Net"
        value={amount(r.net)}
        unit={SOM}
        tone={r.net < 0 ? "critical" : r.net > 0 ? "positive" : undefined}
        sub="in, less refunds and expenses"
        delay={90}
      />
      <StatTile label="Earned by lessons" value={amount(r.earned.total)} unit={SOM} sub="charged to students, less lessons given back" delay={120} />
      <StatTile
        label={`Owed on ${day(r.debt.as_of)}`}
        value={amount(r.debt.total)}
        unit={SOM}
        tone={r.debt.total > 0 ? "critical" : "positive"}
        sub={r.debt.debtors === 1 ? "1 student owes" : `${r.debt.debtors} students owe`}
        delay={150}
      />
    </div>
  );
}

function Shares({ r }: { r: PeriodReport }) {
  const methods = r.money_in.by_method.map((m) => ({ label: methodLabel(m.method), value: m.total }));
  const categories = r.money_out.by_category.map((c) => ({ label: c.name, value: c.total }));
  return (
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <div className={cn(BOX, "p-5")}>
        <ChartFrame title="Money in by method" table={{ head: ["Method", `Amount, ${SOM}`], rows: methods.map((m) => [m.label, amount(m.value)]) }}>
          {methods.length ? (
            <ShareBars rows={methods} format={som} restNoun={["method", "methods"]} tone="primary" />
          ) : (
            <p className="text-[14px] text-ms-fg-3">No payments in this period.</p>
          )}
        </ChartFrame>
      </div>
      <div className={cn(BOX, "p-5")}>
        <ChartFrame
          title="Money out by category"
          table={{ head: ["Category", `Amount, ${SOM}`], rows: categories.map((c) => [c.label, amount(c.value)]) }}
        >
          {categories.length ? (
            <ShareBars rows={categories} format={som} restNoun={["category", "categories"]} tone="critical" />
          ) : (
            <p className="text-[14px] text-ms-fg-3">No expenses in this period.</p>
          )}
        </ChartFrame>
      </div>
    </div>
  );
}

function Earned({ r }: { r: PeriodReport }) {
  const e = r.earned;
  const rows: [string, number][] = [
    ["Lessons", e.lessons],
    ["First months", e.first_months],
    ["Monthly fees", e.monthly],
    ...(e.other ? ([["Other charges", e.other]] as [string, number][]) : []),
    ["Lessons given back", -e.given_back],
  ];
  return (
    <section aria-label="Earned" className={BOX}>
      <h2 className={CAPTION}>Earned</h2>
      <table className={TABLE}>
        <caption className="sr-only">What the lessons earned</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>From</th>
            <th scope="col" className={TH_R}>Amount, {SOM}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className={TR}>
              <td className={TD}>{label}</td>
              <td className={TD_R}>{amount(value)}</td>
            </tr>
          ))}
          <tr className={TR}>
            <td className={cn(TD, "font-semibold")}>Total</td>
            <td className={cn(TD_R, "font-semibold")}>{amount(e.total)}</td>
          </tr>
        </tbody>
      </table>
      {e.adjustments ? (
        <p className="border-t border-ms-border px-4 py-2 text-[13px] text-ms-fg-3">
          Adjustments in this period, not counted above: {som(e.adjustments)}.
        </p>
      ) : null}
    </section>
  );
}

function Students({ r }: { r: PeriodReport }) {
  const s = r.students;
  const bars = s.active_per_day.map((d) => ({ label: String(Number(d.day.slice(8))), full: day(d.day), values: [d.count] }));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="In a paid seat" value={s.active_at_end} sub="on the last day so far" />
        <StatTile label="Started" value={s.new} sub="their first paid day" delay={30} />
        <StatTile label="Left" value={s.left} sub="not moved to another group" delay={60} />
        <StatTile label="Froze a seat" value={s.froze} delay={90} />
        <StatTile
          label="Frozen for debt"
          value={s.frozen_for_debt_now}
          tone={s.frozen_for_debt_now ? "frozen" : undefined}
          sub="now"
          delay={120}
        />
      </div>
      {bars.length > 1 ? (
        <div className={cn(BOX, "p-5")}>
          <BarChart title="Students in a paid seat, each day" series={[{ label: "Students", tone: "primary" }]} bars={bars} />
        </div>
      ) : null}
    </div>
  );
}

export function ReportsPanel() {
  const [period, setPeriod] = useState<Period>("month");
  const [range, setRange] = useState(() => monthBounds());
  const bounds = period === "range" ? range : periodBounds(period);
  const q = usePeriodReport(bounds.from, bounds.to);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented<Period>
          label="Report period"
          size="sm"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "today", label: "Today" },
            { value: "week", label: "This week" },
            { value: "month", label: "This month" },
            { value: "range", label: "From–to" },
          ]}
        />
        {period === "range" ? (
          <>
            <label className={LABEL}>
              From
              <input
                aria-label="From"
                type="date"
                className={CONTROL}
                value={range.from}
                onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
              />
            </label>
            <label className={LABEL}>
              To
              <input
                aria-label="To"
                type="date"
                className={CONTROL}
                value={range.to}
                onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
              />
            </label>
          </>
        ) : null}
        <span className="pb-2 text-[13px] text-ms-fg-3">
          {day(bounds.from)}
          {bounds.to !== bounds.from ? ` – ${day(bounds.to)}` : ""}
        </span>
      </div>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <LoadError error={q.error} onRetry={() => void q.refetch()} what="The report did not load." /> : null}
      {q.data ? (
        <>
          <MoneyTiles r={q.data} />
          <Shares r={q.data} />
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Earned r={q.data} />
            <Students r={q.data} />
          </div>
        </>
      ) : null}
    </div>
  );
}
