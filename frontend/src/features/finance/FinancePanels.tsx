"use client";

import { type ButtonHTMLAttributes } from "react";
import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/Icon";
import { Badge, CourseTag, StatTile, buttonClass, courseLevelOf, signedAmount } from "@/features/console/ui";
import { ChartFrame, ShareBars } from "@/features/console/graphics";
import type { MonthPayment } from "./financeApi";
import { useFinanceSummary, useMonthPayments } from "./financeHooks";

/**
 * The panels of /ops/finance — money as lc-up keeps it — and the look every finance tab shares. Balances (and so
 * debt, debtors, freezes) are as of the latest sync; payments belong to the month picked above the panel. The
 * Debtors tab is its own file (`DebtorsPanel`), the ledger too (`LedgerPanel`).
 *
 * The v0.7 admin look (lc-up structure canvas, owner 22 Nov 2026): cards with a 1 px edge, tables ruled like Excel
 * by `globals.css`, amounts as signed numbers grouped by spaces with "so’m" in the column's head, and a verdict tint
 * on a money cell only when it says something.
 *
 * A failed read renders an error with a retry, never the empty state: "nobody owes anything"
 * and "the debtor list did not load" must not look the same on a page about money.
 */

// ── look ─────────────────────────────────────────────────────────────────
// `cn` does not merge Tailwind classes, so a cell's alignment and colour are never set twice: the table carries the
// colour and `nowrap` (both inherit), a cell only adds what differs. Cell edges, the header's line, row heights and
// the row hover are the stylesheet's (every admin table is ruled), so none is set here.

/** The unit, in every money column's head: "Balance, so’m". */
export const SOM = "so’m";

/** "1 250 000 so’m" — an amount in a sentence. In a table the column says the unit and the cell has the number. */
export function som(amount: number): string {
  return `${signedAmount(amount)} ${SOM}`;
}

// `relative`, not `overflow-hidden`: a table scrolls inside its own `overflow-x-auto`, and a positioned
// sr-only label in a cell must stay inside the box (it pushed the whole page sideways once).
export const BOX = "relative rounded-ms-card border border-ms-border bg-ms-card";
export const CAPTION = "border-b border-ms-border px-4 py-3 text-[15px] font-semibold text-ms-fg";
export const TABLE = "w-full whitespace-nowrap text-ms-fg";
const TH_BASE = "px-3 first:pl-4 last:pr-4";
export const TH = `${TH_BASE} text-left`;
export const TH_R = `${TH_BASE} text-right`;
export const TD = "px-3 py-1 first:pl-4 last:pr-4";
export const TD_R = `${TD} text-right tabular-nums`;
export const TR = "ms-transition";
export const CONTROL =
  "ms-transition h-9 rounded-ms-ctl border border-ms-border-input bg-ms-card px-3 text-[14px] text-ms-fg outline-none placeholder:text-ms-fg-3 focus:border-ms-primary focus:shadow-[0_0_0_3px_var(--ms-primary-soft-2)]";
export const TEXT_BUTTON =
  "rounded-[6px] text-[14px] font-medium text-ms-primary-text hover:underline disabled:cursor-not-allowed disabled:text-ms-fg-disabled disabled:hover:no-underline";

/** The console's 36 px button; `primary` is the one blue button of its row. */
export function Btn({ primary, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button type="button" {...rest} className={buttonClass({ variant: primary ? "primary" : "secondary", size: "sm", className })} />;
}

/** A long list of names in one cell, cut to the column with the whole of it on hover. */
export function Clipped({ text, width = "max-w-[14rem]" }: { text: string; width?: string }) {
  if (!text || text === "—") return <span className="text-ms-fg-3">—</span>;
  return (
    <span title={text} className={cn("block truncate", width)}>
      {text}
    </span>
  );
}

/** A group as lc-up names it, in its course's hue (the level from the class, else the name's first word). */
export function GroupTag({ name, level }: { name: string; level?: string | null }) {
  if (!name) return <span className="text-ms-fg-3">—</span>;
  return (
    <CourseTag level={courseLevelOf(level, name)} size="sm" title={name} className="max-w-[16rem]">
      {name}
    </CourseTag>
  );
}

// ── months ───────────────────────────────────────────────────────────────

/** "YYYY-MM" of today, in the viewer's own calendar. */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const d = new Date(year, mon - 1 + delta, 1);
  return currentMonth(d);
}

export function monthLabel(month: string, style: "long" | "short" = "long"): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(year, mon - 1, 1).toLocaleDateString("en-GB", { month: style, year: "numeric" });
}

/** "2026-10-03" → "3 Oct 2026". Parsed by hand: `new Date("2026-10-03")` is UTC midnight. */
export function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [year, mon, date] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !mon || !date) return iso;
  return new Date(year, mon - 1, date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function MonthPicker({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  // Payments are filed by the day they were made, so a month still to come has none.
  const atLatest = value >= currentMonth();
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label="Month">
      <button type="button" aria-label="Previous month" className={buttonClass({ variant: "ghost", size: "sm", square: true })} onClick={() => onChange(shiftMonth(value, -1))}>
        <Icon name="left" size="sm" />
      </button>
      <span className="min-w-[9rem] text-center text-[15px] font-semibold text-ms-fg" aria-live="polite">
        {monthLabel(value)}
      </span>
      <button type="button" aria-label="Next month" disabled={atLatest} className={buttonClass({ variant: "ghost", size: "sm", square: true })} onClick={() => onChange(shiftMonth(value, 1))}>
        <Icon name="right" size="sm" />
      </button>
    </div>
  );
}

// ── shared states ────────────────────────────────────────────────────────

export function Loading() {
  return (
    <div role="status" aria-busy className="flex flex-col gap-3">
      <span className="sr-only">Loading…</span>
      <div className="h-24 animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
      <div className="h-64 animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
    </div>
  );
}

export function LoadError({ error, onRetry, what = "This did not load." }: { error: unknown; onRetry: () => void; what?: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-4 py-3 text-[14px]">
      <Icon name="alert" className="shrink-0 text-ms-critical-fg" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-ms-critical-fg">{what}</span>{" "}
        <span className="text-ms-fg-2">{formatApiErrorForToast(error)}</span>
      </span>
      <button type="button" onClick={onRetry} className={buttonClass({ variant: "secondary", size: "sm" })}>
        <Icon name="refresh" size="sm" />
        Retry
      </button>
    </div>
  );
}

/** lc-up names its payment methods in Uzbek; an unknown one is shown as lc-up wrote it. */
const METHOD_LABEL: Record<string, string> = {
  "Naqd pul": "Cash",
  "Plastik karta": "Card",
  "Bank hisobi": "Bank transfer",
};

export function methodLabel(method: string): string {
  const key = method.trim();
  if (!key || key === "—") return "—";
  return METHOD_LABEL[key] ?? key;
}

function list(names: string[]): string {
  return names.length ? names.join(", ") : "—";
}

// ── overview ─────────────────────────────────────────────────────────────

export function Figure({ label, value, debt = false }: { label: string; value: string; debt?: boolean }) {
  return (
    <div className="bg-ms-card px-4 py-3">
      <dt className="text-[13px] text-ms-fg-3">{label}</dt>
      <dd className={cn("mt-0.5 text-[20px] font-bold leading-6 tabular-nums", debt ? "text-ms-critical-fg" : "text-ms-fg")}>
        {value}
      </dd>
    </div>
  );
}

/** "1 250 000" — the number alone; the tile says the unit beside it. */
const amount = (n: number) => signedAmount(n);

/** The one line under "Owed by group": the group owed the most, and how much of the whole that is. */
export function debtFinding(rows: { label: string; value: number }[]): string {
  const owing = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (!owing.length) return "No group is owed anything.";
  const total = owing.reduce((s, r) => s + r.value, 0);
  const top = owing[0];
  if (owing.length === 1) return `Only ${top.label} is owed: ${som(top.value)}.`;
  return `${top.label} is owed the most: ${som(top.value)}, ${Math.round((100 * top.value) / total)}% of the whole.`;
}

/** The one line under "Payments by method": the method most of the month's money came by. */
export function methodFinding(rows: { label: string; value: number }[]): string {
  const paid = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (!paid.length) return "";
  const total = paid.reduce((s, r) => s + r.value, 0);
  return `${paid[0].label} brought ${Math.round((100 * paid[0].value) / total)}% of the month's payments.`;
}

export function FinanceOverviewPanel({ month, debtorsHref }: { month: string; debtorsHref?: string }) {
  const q = useFinanceSummary(month);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const short = monthLabel(month, "short");
  const groupRows = s.by_group.map((g) => ({ label: g.group, value: g.debt }));
  const methodRows = Object.entries(s.by_method)
    .sort(([, a], [, b]) => b - a)
    .map(([method, value]) => ({ label: methodLabel(method), value }));

  return (
    <div className="flex flex-col gap-7">
      <p className="flex flex-wrap items-center gap-2 text-[13px] text-ms-fg-3">
        {s.freeze.enabled ? (
          <Badge tone="frozen" icon="snow">
            {s.freeze.rule === "lesson"
              ? "Debt freeze: on — the moment a balance drops below zero"
              : `Debt freeze: on — from day ${s.freeze.day} of each month`}
          </Badge>
        ) : (
          <Badge tone="neutral">Debt freeze: off</Badge>
        )}
        <span>Balances, debtors and freezes are as of the latest lc-up sync. Payments and refunds are for {monthLabel(month)}.</span>
      </p>

      {/* Three a row: so'm amounts run to ten digits, and six a row cut "19 250 000" at 1440 px. */}
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Owed in total"
          value={amount(s.total_debt)}
          unit={SOM}
          tone={s.total_debt > 0 ? "critical" : "positive"}
          href={s.total_debt > 0 ? debtorsHref : undefined}
          sub={s.total_debt > 0 ? "see the debtors" : "nobody owes"}
        />
        <StatTile label="Students who owe" value={s.debtors} href={s.debtors ? debtorsHref : undefined} delay={30} />
        <StatTile label="Frozen for debt" value={s.frozen} tone={s.frozen ? "frozen" : undefined} delay={60} />
        <StatTile label="Exempt from freeze" value={s.exempt} delay={90} />
        <StatTile label={`Payments in ${short}`} value={amount(s.paid)} unit={SOM} delay={120} />
        <StatTile label={`Refunds in ${short}`} value={amount(s.refunded)} unit={SOM} delay={150} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className={cn(BOX, "p-5")}>
          <ChartFrame
            title="Owed by group"
            sub="as of the latest sync"
            insight={debtFinding(groupRows)}
            table={{ head: ["Group", `Owed, ${SOM}`, "Students who owe"], rows: s.by_group.map((g) => [g.group, amount(g.debt), g.debtors]) }}
          >
            <ShareBars rows={groupRows} format={som} restNoun={["group", "groups"]} tone="critical" />
          </ChartFrame>
        </div>
        <div className={cn(BOX, "p-5")}>
          <ChartFrame
            title="Payments by method"
            sub={monthLabel(month)}
            insight={methodFinding(methodRows) || undefined}
            note={s.other ? `Other entries this month: ${som(s.other)}` : undefined}
            table={{ head: ["Method", `Amount, ${SOM}`], rows: methodRows.map((r) => [r.label, amount(r.value)]) }}
          >
            {methodRows.length ? (
              <ShareBars rows={methodRows} format={som} restNoun={["method", "methods"]} tone="primary" />
            ) : (
              <p className="text-[14px] text-ms-fg-3">No payments in {monthLabel(month)}.</p>
            )}
          </ChartFrame>
        </div>
      </div>

      <section aria-label="By group" className={BOX}>
        <h2 className={CAPTION}>By group</h2>
        {s.by_group.length ? (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <caption className="sr-only">Money by group, {monthLabel(month)}</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Group</th>
                  <th scope="col" className={TH}>Teacher(s)</th>
                  <th scope="col" className={TH_R}>Monthly price, {SOM}</th>
                  <th scope="col" className={TH_R}>Students</th>
                  <th scope="col" className={TH_R}>Students who owe</th>
                  <th scope="col" className={TH_R}>Their balance, {SOM}</th>
                  <th scope="col" className={TH_R}>Income ({short}), {SOM}</th>
                </tr>
              </thead>
              <tbody>
                {s.by_group.map((g) => (
                  <tr key={g.group} className={TR}>
                    <td className={TD}>
                      <GroupTag name={g.group} />
                    </td>
                    <td className={cn(TD, "text-ms-fg-2")}>
                      <Clipped text={list(g.teachers)} />
                    </td>
                    <td className={TD_R}>{signedAmount(g.monthly_cost)}</td>
                    <td className={TD_R}>{g.students}</td>
                    <td className={TD_R}>{g.debtors}</td>
                    {/* What the group's debtors owe, as their balance: below zero. */}
                    <td className={cn(TD_R, g.debt > 0 && "font-semibold text-ms-critical-fg")} data-verdict={g.debt > 0 ? "critical" : undefined}>
                      {signedAmount(-g.debt)}
                    </td>
                    <td className={TD_R}>{signedAmount(g.income)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-4 text-[14px] text-ms-fg-3">No paired lc-up groups yet. They appear once a group is paired with a class.</p>
        )}
      </section>
    </div>
  );
}

// ── payments ─────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = { payment: "Payment", refund: "Refund" };

/** A refund is money going back out, so it is shown — and counted — below zero. */
function signed(p: MonthPayment): number {
  // `|| 0` so an empty refund reads "0", not "−0".
  return p.kind === "refund" ? -Math.abs(p.amount) || 0 : p.amount;
}

function Total({ label, amount: value }: { label: string; amount: number }) {
  return (
    <span>
      {label} <span className="font-semibold tabular-nums text-ms-fg">{signedAmount(value)}</span>
    </span>
  );
}

export function PaymentsPanel({ month }: { month: string }) {
  const q = useMonthPayments(month);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) {
    return (
      <p className={cn(BOX, "px-4 py-4 text-[14px] text-ms-fg-3")}>
        No payments in {monthLabel(month)}. Payments appear here once lc-up records them and the next sync brings them in.
      </p>
    );
  }

  const rows = [...q.data].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const paid = rows.filter((p) => p.kind === "payment").reduce((sum, p) => sum + p.amount, 0);
  const refunded = rows.filter((p) => p.kind === "refund").reduce((sum, p) => sum + Math.abs(p.amount), 0);
  const other = rows.filter((p) => p.kind !== "payment" && p.kind !== "refund").reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] text-ms-fg-2">
        <span className="tabular-nums">
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
        {" · "}
        <Total label="Payments" amount={paid} />
        {" · "}
        <Total label="Refunds" amount={-refunded || 0} />
        {" · "}
        <Total label="Net" amount={paid - refunded} />
        {other ? (
          <>
            {" · "}
            <Total label="Other" amount={other} />
          </>
        ) : null}{" "}
        {SOM}
      </p>
      <div className={cn(BOX, "overflow-x-auto")}>
        <table className={TABLE}>
          <caption className="sr-only">Payments in {monthLabel(month)}</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Date</th>
              <th scope="col" className={TH}>Student</th>
              <th scope="col" className={TH}>Group</th>
              <th scope="col" className={TH}>Method</th>
              <th scope="col" className={TH}>Type</th>
              <th scope="col" className={TH_R}>Amount, {SOM}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={TR}>
                <td className={cn(TD, "tabular-nums")}>{day(p.date)}</td>
                <td className={cn(TD, "font-medium")}>{p.student || "—"}</td>
                <td className={TD}>
                  <GroupTag name={p.group} />
                </td>
                <td className={TD}>{methodLabel(p.method)}</td>
                <td className={TD}>
                  <Badge tone="line">{KIND_LABEL[p.kind] ?? "Other"}</Badge>
                </td>
                <td
                  className={cn(TD_R, "font-semibold")}
                  data-verdict={p.kind === "payment" ? "positive" : p.kind === "refund" ? "attention" : undefined}
                >
                  {signedAmount(signed(p))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
