"use client";

import { Fragment, useId, useMemo, useState, type ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/Icon";
import { Badge, StatTile, buttonClass } from "@/features/console/ui";
import { ChartFrame, ShareBars } from "@/features/console/graphics";
import type { BadgeTone } from "@/features/console/ui";
import { Pill } from "@/features/ops/people/Fieldset";
import { NEW_CAMPAIGN_PATH } from "@/features/ops/sms/smsTabs";
import { formatUzs, type Debtor, type MonthPayment } from "./financeApi";
import { P } from "@/features/ops/permissions";
import { useCan } from "@/features/ops/useCan";
import { useDebtors, useFinanceSummary, useMonthPayments, useSetExempt } from "./financeHooks";

/**
 * The three panels of /ops/finance — money as lc-up keeps it. Balances (and so debt, debtors,
 * freezes) are as of the latest sync; payments belong to the month picked above the panel.
 *
 * Drawn like the console's changelists (features/ops/changelist/ChangeList): hairline borders,
 * 13px text, 34px rows, a filter panel on the right — figures and tables, no tiles.
 *
 * A failed read renders an error with a retry, never the empty state: "nobody owes anything"
 * and "the debtor list did not load" must not look the same on a page about money.
 */

// ── look ─────────────────────────────────────────────────────────────────
// The console's (design handoff v0.3, PR 12a): cards, hairline tables, 44 px controls. `cn` does not merge
// Tailwind classes, so a cell's alignment and colour are never set twice: the table carries the colour and
// `nowrap` (both inherit), a cell only adds what differs.

// `relative`, not `overflow-hidden`: a table scrolls inside its own `overflow-x-auto`, and a positioned
// sr-only label in a cell must stay inside the box (it pushed the whole page sideways once).
export const BOX = "relative rounded-ms-card bg-ms-card shadow-ms-1";
export const CAPTION = "text-ms-over border-b border-ms-line px-5 py-3 text-ms-fg-3";
export const TABLE = "w-full border-separate border-spacing-0 whitespace-nowrap text-[14px] text-ms-fg";
const TH_BASE = "h-10 border-b border-ms-border bg-ms-card px-3 text-[13px] font-medium text-ms-fg-3 first:pl-5 last:pr-5";
export const TH = `${TH_BASE} text-left`;
export const TH_R = `${TH_BASE} text-right`;
export const TD = "h-11 border-b border-ms-line px-3 py-1 first:pl-5 last:pr-5";
export const TD_R = `${TD} text-right tabular-nums`;
export const TR = "ms-transition hover:bg-ms-surface [&:last-child>td]:border-b-0";
export const CONTROL =
  "ms-transition h-9 rounded-ms-ctl border border-ms-border-input bg-ms-card px-3 text-[14px] text-ms-fg outline-none placeholder:text-ms-fg-3 focus:border-ms-primary focus:shadow-[0_0_0_3px_var(--ms-primary-soft-2)]";
export const TEXT_BUTTON =
  "rounded-[6px] text-[14px] font-medium text-ms-primary-text hover:underline disabled:cursor-not-allowed disabled:text-ms-fg-disabled disabled:hover:no-underline";

/** The console's 36 px button; `primary` is the one blue button of its row. */
export function Btn({ primary, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button type="button" {...rest} className={buttonClass({ variant: primary ? "primary" : "secondary", size: "sm", className })} />;
}

/** A long list of names in one cell, cut to the column with the whole of it on hover. */
function Clipped({ text, width = "max-w-[14rem]" }: { text: string; width?: string }) {
  if (!text || text === "—") return <span className="text-ms-fg-3">—</span>;
  return (
    <span title={text} className={cn("block truncate", width)}>
      {text}
    </span>
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

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-4 py-3 text-[14px]">
      <span className="font-semibold text-ms-critical-fg">This did not load.</span>{" "}
      <span className="text-ms-fg-2">{formatApiErrorForToast(error)}</span>{" "}
      <button type="button" onClick={onRetry} className={TEXT_BUTTON}>
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
    <div className="bg-ms-surface px-4 py-3">
      <dt className="text-[13px] text-ms-fg-3">{label}</dt>
      <dd className={cn("mt-0.5 text-[20px] font-bold leading-6 tabular-nums", debt ? "text-ms-critical-fg" : "text-ms-fg")}>
        {value}
      </dd>
    </div>
  );
}

/** "1,250,000" — the number alone; the tile says the unit beside it. */
const amount = (n: number) => (Math.round(n) || 0).toLocaleString("en-US");

/** The one line under "Debt by group": who owes the most, and how much of the whole that is. */
export function debtFinding(rows: { label: string; value: number }[]): string {
  const owing = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (!owing.length) return "No group owes anything.";
  const total = owing.reduce((s, r) => s + r.value, 0);
  const top = owing[0];
  if (owing.length === 1) return `Only ${top.label} owes: ${formatUzs(top.value)}.`;
  return `${top.label} owes the most: ${formatUzs(top.value)}, ${Math.round((100 * top.value) / total)}% of the debt.`;
}

/** The one line under "Paid by method": the method most of the month's money came by. */
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
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-2 text-[13px] text-ms-fg-3">
        {s.freeze.enabled ? (
          <Badge tone="frozen" icon="snow">{`Debt freeze: on — from day ${s.freeze.day} of each month`}</Badge>
        ) : (
          <Badge tone="neutral">Debt freeze: off</Badge>
        )}
        <span>Debt, debtors and freezes are as of the latest lc-up sync. Payments and refunds are for {monthLabel(month)}.</span>
      </p>

      {/* Three a row: so'm amounts run to ten digits, and six a row cut "19,250,000" at 1440 px. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile
          label="Total debt"
          value={amount(s.total_debt)}
          unit="UZS"
          tone={s.total_debt > 0 ? "critical" : "positive"}
          href={s.total_debt > 0 ? debtorsHref : undefined}
          sub={s.total_debt > 0 ? "see who owes" : "nobody owes"}
        />
        <StatTile label="Debtors" value={s.debtors} unit={s.debtors === 1 ? "student" : "students"} href={s.debtors ? debtorsHref : undefined} delay={30} />
        <StatTile label="Frozen for debt" value={s.frozen} tone={s.frozen ? "frozen" : undefined} delay={60} />
        <StatTile label="Exempt from freeze" value={s.exempt} delay={90} />
        <StatTile label={`Paid in ${short}`} value={amount(s.paid)} unit="UZS" tone={s.paid > 0 ? "positive" : undefined} delay={120} />
        <StatTile label={`Refunded in ${short}`} value={amount(s.refunded)} unit="UZS" tone={s.refunded > 0 ? "attention" : undefined} delay={150} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="rounded-ms-card bg-ms-card p-5 shadow-ms-1">
          <ChartFrame
            title="Debt by group"
            sub="as of the latest sync"
            insight={debtFinding(groupRows)}
            table={{ head: ["Group", "Debt", "Debtors"], rows: s.by_group.map((g) => [g.group, formatUzs(g.debt), g.debtors]) }}
          >
            <ShareBars rows={groupRows} format={formatUzs} restNoun={["group", "groups"]} tone="critical" />
          </ChartFrame>
        </div>
        <div className="rounded-ms-card bg-ms-card p-5 shadow-ms-1">
          <ChartFrame
            title="Paid by method"
            sub={monthLabel(month)}
            insight={methodFinding(methodRows) || undefined}
            note={s.other ? `Other entries this month: ${formatUzs(s.other)}` : undefined}
            table={{ head: ["Method", "Amount"], rows: methodRows.map((r) => [r.label, formatUzs(r.value)]) }}
          >
            {methodRows.length ? (
              <ShareBars rows={methodRows} format={formatUzs} restNoun={["method", "methods"]} tone="primary" />
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
                  <th scope="col" className={TH_R}>Monthly price</th>
                  <th scope="col" className={TH_R}>Students</th>
                  <th scope="col" className={TH_R}>Debtors</th>
                  <th scope="col" className={TH_R}>Debt</th>
                  <th scope="col" className={TH_R}>Income ({short})</th>
                </tr>
              </thead>
              <tbody>
                {s.by_group.map((g) => (
                  <tr key={g.group} className={TR}>
                    <td className={cn(TD, "font-medium")}>{g.group}</td>
                    <td className={cn(TD, "text-ms-fg-3")}>
                      <Clipped text={list(g.teachers)} />
                    </td>
                    <td className={TD_R}>{formatUzs(g.monthly_cost)}</td>
                    <td className={TD_R}>{g.students}</td>
                    <td className={TD_R}>{g.debtors}</td>
                    <td className={cn(TD_R, g.debt > 0 && "font-semibold text-ms-critical-fg")}>{formatUzs(g.debt)}</td>
                    <td className={TD_R}>{formatUzs(g.income)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-4 text-[14px] text-ms-fg-3">No paired lc-up groups yet. They appear once a group is paired with a class.</p>
        )}
      </section>
    </div>
  );
}

// ── debtors ──────────────────────────────────────────────────────────────

const COLUMNS = 7;

function DebtorRow({ debtor }: { debtor: Debtor }) {
  const setExempt = useSetExempt();
  // Exempting from the debt freeze is `debt_freeze`'s; everyone else on this tab only reads.
  const mayExempt = useCan()(P.debtFreeze);
  const [confirming, setConfirming] = useState(false);
  const busy = setExempt.isPending;

  const status = [
    debtor.frozen ? { word: "Frozen", tone: "frozen" as BadgeTone } : null,
    debtor.exempt ? { word: "Exempt", tone: "info" as BadgeTone } : null,
    debtor.user ? null : { word: "No account", tone: "line" as BadgeTone },
    debtor.in_group ? null : { word: "Not in a group", tone: "attention" as BadgeTone },
  ].filter((s): s is { word: string; tone: BadgeTone } => s !== null);

  const exempt = () =>
    setExempt.mutate({ linkId: debtor.link_id, exempt: true }, { onSuccess: () => setConfirming(false) });

  return (
    <Fragment>
      <tr className={TR}>
        <td className={TD}>
          <span className="font-medium">{debtor.name}</span>
          {debtor.user ? <span className="text-ms-fg-3"> @{debtor.user.username}</span> : null}
        </td>
        <td className={cn(TD, "text-ms-fg-3")}>
          <Clipped text={list(debtor.groups)} />
        </td>
        <td className={cn(TD, "text-ms-fg-3")}>
          <Clipped text={list(debtor.teachers)} width="max-w-[11rem]" />
        </td>
        <td className={cn(TD_R, "font-semibold text-ms-critical-fg")}>{formatUzs(debtor.debt)}</td>
        <td className={TD}>{day(debtor.last_payment_on)}</td>
        <td className={TD}>
          {status.length ? (
            <span className="inline-flex flex-wrap gap-1">
              {status.map((s) => (
                <Pill key={s.word} tone={s.tone}>
                  {s.word}
                </Pill>
              ))}
            </span>
          ) : (
            <span className="text-ms-fg-3">—</span>
          )}
        </td>
        <td className={cn(TD, "text-right")}>
          {!mayExempt ? null : debtor.exempt ? (
            <button
              type="button"
              className={TEXT_BUTTON}
              disabled={busy}
              aria-label={`Remove exemption for ${debtor.name}`}
              onClick={() => setExempt.mutate({ linkId: debtor.link_id, exempt: false })}
            >
              Remove exemption
            </button>
          ) : (
            <button
              type="button"
              className={TEXT_BUTTON}
              disabled={busy || confirming}
              aria-label={`Exempt ${debtor.name} from freeze`}
              onClick={() => setConfirming(true)}
            >
              Exempt from freeze
            </button>
          )}
        </td>
      </tr>
      {mayExempt && confirming && !debtor.exempt ? (
        <tr>
          <td colSpan={COLUMNS} className="whitespace-normal border-b border-ms-line bg-ms-surface px-5 py-3 text-[14px]">
            <p>
              Exempt {debtor.name} from the debt freeze? Their account will not be frozen for an unpaid month while
              the exemption stands — for example, a student on a grant.
              {debtor.frozen ? " They are frozen now and will be unfrozen right away." : ""} The debt itself stays in
              lc-up.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn primary disabled={busy} onClick={exempt}>
                Yes, exempt
              </Btn>
              <Btn disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Btn>
            </div>
          </td>
        </tr>
      ) : null}
      {setExempt.error ? (
        <tr>
          <td colSpan={COLUMNS} role="alert" className="whitespace-normal border-b border-ms-line bg-ms-critical-soft px-5 py-2 text-[13px] text-ms-critical-fg">
            {formatApiErrorForToast(setExempt.error)}
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

type DebtorFilters = { needle: string; group: string; teacher: string; onlyInGroup: boolean };

/** Whether a debtor passes the filters — all but `skip`, which is how a facet counts its choices. */
function passes(d: Debtor, f: DebtorFilters, skip?: "group" | "teacher"): boolean {
  if (f.onlyInGroup && !d.in_group) return false;
  if (skip !== "group" && f.group && !d.groups.includes(f.group)) return false;
  if (skip !== "teacher" && f.teacher && !d.teachers.includes(f.teacher)) return false;
  if (f.needle) {
    const haystack = [d.name, d.user?.name ?? "", d.user?.username ?? ""].join(" ").toLowerCase();
    if (!haystack.includes(f.needle)) return false;
  }
  return true;
}

type Facet = { title: string; value: string; options: { value: string; count: number }[]; onPick: (value: string) => void };

/** The changelist's right-hand filter, for a list filtered in the browser: "By group: All · …". */
function FilterPanel({ facets, onClear }: { facets: Facet[]; onClear: () => void }) {
  const anyActive = facets.some((f) => f.value);
  return (
    <div className="text-[13px]">
      <div className="flex min-h-10 items-center gap-2 border-b border-ms-border px-3 py-1.5">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ms-fg-3">Filter</h2>
        {anyActive ? (
          <button type="button" onClick={onClear} className={cn(TEXT_BUTTON, "ml-auto text-[12px] font-normal")}>
            Clear all filters
          </button>
        ) : null}
      </div>
      {facets.map((facet) => {
        const items: { value: string; label: string; count?: number }[] = [
          { value: "", label: "All" },
          ...facet.options.map((o) => ({ value: o.value, label: o.value, count: o.count })),
        ];
        return (
          <section key={facet.title} className="border-b border-ms-border px-3 py-2 last:border-b-0">
            <h3 className="mb-1 text-[12px] font-semibold text-ms-fg">By {facet.title}</h3>
            <ul className="space-y-px">
              {items.map((item) => {
                const on = item.value === facet.value;
                return (
                  <li key={item.value || "__all"}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => facet.onPick(item.value)}
                      className={cn(
                        "flex w-full items-baseline justify-between gap-2 rounded-sm px-1.5 py-0.5 text-left hover:bg-ms-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ms-ring",
                        on ? "font-semibold text-ms-fg" : "text-ms-primary-text ",
                      )}
                    >
                      <span className="min-w-0 truncate">{item.label}</span>
                      {item.count !== undefined ? (
                        <span className="shrink-0 font-normal tabular-nums text-ms-fg-3">{item.count}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function DebtorsPanel() {
  const q = useDebtors();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [teacher, setTeacher] = useState("");
  const [onlyInGroup, setOnlyInGroup] = useState(true);
  const checkboxId = useId();

  const all = useMemo(() => q.data ?? [], [q.data]);
  const groups = useMemo(() => uniqueSorted(all.flatMap((d) => d.groups)), [all]);
  const teachers = useMemo(() => uniqueSorted(all.flatMap((d) => d.teachers)), [all]);
  const filters = useMemo<DebtorFilters>(
    () => ({ needle: search.trim().toLowerCase(), group, teacher, onlyInGroup }),
    [search, group, teacher, onlyInGroup],
  );
  const rows = useMemo(() => all.filter((d) => passes(d, filters)), [all, filters]);
  const facets = useMemo<Facet[]>(
    () => [
      {
        title: "group",
        value: group,
        onPick: setGroup,
        options: groups.map((name) => ({
          value: name,
          count: all.filter((d) => d.groups.includes(name) && passes(d, filters, "group")).length,
        })),
      },
      {
        title: "teacher",
        value: teacher,
        onPick: setTeacher,
        options: teachers.map((name) => ({
          value: name,
          count: all.filter((d) => d.teachers.includes(name) && passes(d, filters, "teacher")).length,
        })),
      },
    ],
    [all, filters, group, groups, teacher, teachers],
  );

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!all.length) {
    return (
      <p className="text-[13px] text-ms-fg-3">
        Nobody owes money right now. A student appears here when their lc-up balance goes below zero.
      </p>
    );
  }

  const total = rows.reduce((sum, d) => sum + d.debt, 0);

  return (
    <div className="flex items-start gap-6">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          <input
            type="search"
            aria-label="Search by name"
            placeholder="Search by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(CONTROL, "w-full max-w-xs")}
          />
          <label htmlFor={checkboxId} className="inline-flex cursor-pointer items-center gap-1.5 text-ms-fg">
            <input
              id={checkboxId}
              type="checkbox"
              checked={onlyInGroup}
              onChange={(e) => setOnlyInGroup(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer accent-[var(--ms-primary)]"
            />
            Only students in a group
          </label>
          {/* Below xl the filter panel is hidden, so its two choices are offered here instead. */}
          <select aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value)} className={cn(CONTROL, "max-w-[14rem] xl:hidden")}>
            <option value="">All groups</option>
            {groups.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select aria-label="Teacher" value={teacher} onChange={(e) => setTeacher(e.target.value)} className={cn(CONTROL, "max-w-[12rem] xl:hidden")}>
            <option value="">All teachers</option>
            {teachers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] text-ms-fg-3" aria-live="polite">
            {rows.length} {rows.length === 1 ? "student" : "students"} ·{" "}
            <span className="font-semibold tabular-nums text-ms-critical-fg">{formatUzs(total)}</span> owed
          </p>
          {/* Handoff scenario 6: the composer is the review sheet — recipients, the text, the cost and the
              balance — before anything is sent. Its Debtors audience is every lc-up learner who owes. */}
          <Link href={`${NEW_CAMPAIGN_PATH}?audience=debtors`} className={buttonClass({ variant: "primary", size: "sm" })}>
            <Icon name="msg" size="sm" />
            {`Remind all ${all.length}`}
          </Link>
        </div>

        {rows.length ? (
          <div className={cn(BOX, "overflow-x-auto")}>
            <table className={TABLE}>
              <caption className="sr-only">Students who owe money</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Student</th>
                  <th scope="col" className={TH}>Group(s)</th>
                  <th scope="col" className={TH}>Teacher(s)</th>
                  <th scope="col" className={TH_R}>Debt</th>
                  <th scope="col" className={TH}>Last payment</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={TH_R}>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((debtor) => (
                  <DebtorRow key={debtor.link_id} debtor={debtor} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={cn(BOX, "px-3 py-3 text-[13px] text-ms-fg-3")}>No debtor matches these filters.</p>
        )}
      </div>

      <aside aria-label="Filters" className={cn(BOX, "hidden w-56 shrink-0 xl:block")}>
        <FilterPanel
          facets={facets}
          onClear={() => {
            setGroup("");
            setTeacher("");
          }}
        />
      </aside>
    </div>
  );
}

// ── payments ─────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = { payment: "Payment", refund: "Refund" };

/** A refund is money going back out, so it is shown — and counted — below zero. */
function signed(p: MonthPayment): number {
  // `|| 0` so an empty refund reads "0 UZS", not "-0 UZS" (-0 formats with its sign).
  return p.kind === "refund" ? -Math.abs(p.amount) || 0 : p.amount;
}

function Total({ label, amount }: { label: string; amount: number }) {
  return (
    <span>
      {label} <span className="font-semibold tabular-nums text-ms-fg">{formatUzs(amount)}</span>
    </span>
  );
}

export function PaymentsPanel({ month }: { month: string }) {
  const q = useMonthPayments(month);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) {
    return (
      <p className="text-[13px] text-ms-fg-3">
        No payments in {monthLabel(month)}. Payments appear here once lc-up records them and the next sync brings them in.
      </p>
    );
  }

  const rows = [...q.data].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const paid = rows.filter((p) => p.kind === "payment").reduce((sum, p) => sum + p.amount, 0);
  const refunded = rows.filter((p) => p.kind === "refund").reduce((sum, p) => sum + Math.abs(p.amount), 0);
  const other = rows.filter((p) => p.kind !== "payment" && p.kind !== "refund").reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-2">
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
              <th scope="col" className={TH_R}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={TR}>
                <td className={TD}>{day(p.date)}</td>
                <td className={TD}>{p.student || "—"}</td>
                <td className={cn(TD, "text-ms-fg-3")}>
                  <Clipped text={p.group || "—"} />
                </td>
                <td className={TD}>{methodLabel(p.method)}</td>
                <td className={TD}>
                  <Pill tone={p.kind === "payment" ? "positive" : p.kind === "refund" ? "attention" : "neutral"}>{KIND_LABEL[p.kind] ?? "Other"}</Pill>
                </td>
                <td className={TD_R}>{formatUzs(signed(p))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[13px] text-ms-fg-3">
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
        ) : null}
      </p>
    </div>
  );
}
