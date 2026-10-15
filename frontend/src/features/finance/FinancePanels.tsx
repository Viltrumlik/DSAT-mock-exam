"use client";

import { Fragment, useId, useMemo, useState, type ButtonHTMLAttributes } from "react";
import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { formatUzs, type Debtor, type MonthPayment } from "./financeApi";
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
// `cn` does not merge Tailwind classes, so a cell's alignment and colour are never set twice:
// the table carries the colour and `nowrap` (both inherit), a cell only adds what differs.

const BOX = "border border-border bg-card";
const CAPTION =
  "border-b border-border px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
const TABLE = "w-full border-separate border-spacing-0 whitespace-nowrap text-[13px] text-foreground";
const TH_BASE = "h-8 border-b border-border bg-card px-2 text-[12px] font-semibold text-muted-foreground";
const TH = `${TH_BASE} text-left`;
const TH_R = `${TH_BASE} text-right`;
const TD = "h-[34px] border-b border-border px-2 py-1";
const TD_R = `${TD} text-right tabular-nums`;
const TR = "hover:bg-surface-2 [&:last-child>td]:border-b-0";
const CONTROL =
  "h-7 rounded-md border border-border bg-card px-2 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
const TEXT_BUTTON =
  "rounded-sm text-[13px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline dark:text-primary-hover";

function Btn({ primary, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex h-7 items-center justify-center rounded-md border px-2.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
        primary
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary-hover"
          : "border-border bg-card text-foreground hover:bg-surface-2",
        className,
      )}
    />
  );
}

/** A long list of names in one cell, cut to the column with the whole of it on hover. */
function Clipped({ text, width = "max-w-[14rem]" }: { text: string; width?: string }) {
  if (!text || text === "—") return <span className="text-muted-foreground">—</span>;
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
function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [year, mon, date] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !mon || !date) return iso;
  return new Date(year, mon - 1, date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function MonthPicker({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  // Payments are filed by the day they were made, so a month still to come has none.
  const atLatest = value >= currentMonth();
  return (
    <div className="inline-flex items-center gap-1 text-[13px]" role="group" aria-label="Month">
      <Btn aria-label="Previous month" onClick={() => onChange(shiftMonth(value, -1))}>
        ‹
      </Btn>
      <span className="min-w-[8.5rem] text-center font-semibold text-foreground" aria-live="polite">
        {monthLabel(value)}
      </span>
      <Btn aria-label="Next month" disabled={atLatest} onClick={() => onChange(shiftMonth(value, 1))}>
        ›
      </Btn>
    </div>
  );
}

// ── shared states ────────────────────────────────────────────────────────

function Loading() {
  return (
    <p role="status" className="text-[13px] text-muted-foreground">
      Loading…
    </p>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className={cn(BOX, "px-3 py-3 text-[13px]")}>
      <span className="font-semibold text-danger">This did not load.</span>{" "}
      <span className="text-muted-foreground">{formatApiErrorForToast(error)}</span>{" "}
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

function methodLabel(method: string): string {
  const key = method.trim();
  if (!key || key === "—") return "—";
  return METHOD_LABEL[key] ?? key;
}

function list(names: string[]): string {
  return names.length ? names.join(", ") : "—";
}

// ── overview ─────────────────────────────────────────────────────────────

function Figure({ label, value, debt = false }: { label: string; value: string; debt?: boolean }) {
  return (
    <div className="bg-card px-3 py-2">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-[15px] font-semibold tabular-nums", debt ? "text-danger" : "text-foreground")}>
        {value}
      </dd>
    </div>
  );
}

export function FinanceOverviewPanel({ month }: { month: string }) {
  const q = useFinanceSummary(month);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const short = monthLabel(month, "short");
  const methods = Object.entries(s.by_method).sort(([, a], [, b]) => b - a);

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">
        {s.freeze.enabled ? `Debt freeze: on — from day ${s.freeze.day} of each month` : "Debt freeze: off"}
      </p>

      {/* One row of figures; the 1px gap over the border colour draws the hairlines between them. */}
      <dl className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
        <Figure label="Total debt" value={formatUzs(s.total_debt)} debt={s.total_debt > 0} />
        <Figure label="Debtors" value={String(s.debtors)} />
        <Figure label="Frozen for debt" value={String(s.frozen)} />
        <Figure label="Exempt from freeze" value={String(s.exempt)} />
        <Figure label={`Paid in ${short}`} value={formatUzs(s.paid)} />
        <Figure label={`Refunded in ${short}`} value={formatUzs(s.refunded)} />
      </dl>
      <p className="text-[12px] text-muted-foreground">
        Debt, debtors and freezes are as of the latest lc-up sync. Payments and refunds are for {monthLabel(month)}.
      </p>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <section aria-label="By group" className={cn(BOX, "min-w-0 flex-1")}>
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
                      <td className={cn(TD, "text-muted-foreground")}>
                        <Clipped text={list(g.teachers)} />
                      </td>
                      <td className={TD_R}>{formatUzs(g.monthly_cost)}</td>
                      <td className={TD_R}>{g.students}</td>
                      <td className={TD_R}>{g.debtors}</td>
                      <td className={cn(TD_R, g.debt > 0 && "text-danger")}>{formatUzs(g.debt)}</td>
                      <td className={TD_R}>{formatUzs(g.income)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-3 py-3 text-[13px] text-muted-foreground">
              No paired lc-up groups yet. They appear once a group is paired with a class.
            </p>
          )}
        </section>

        <section aria-label="Paid by method" className={cn(BOX, "shrink-0 xl:w-72")}>
          <h2 className={CAPTION}>Paid by method</h2>
          {methods.length ? (
            <table className={TABLE}>
              <caption className="sr-only">Paid by method, {monthLabel(month)}</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Method</th>
                  <th scope="col" className={TH_R}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {methods.map(([method, amount]) => (
                  <tr key={method} className={TR}>
                    <td className={TD}>{methodLabel(method)}</td>
                    <td className={TD_R}>{formatUzs(amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-3 py-3 text-[13px] text-muted-foreground">No payments in {monthLabel(month)}.</p>
          )}
          {s.other ? (
            <p className="border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
              Other entries this month: {formatUzs(s.other)}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

// ── debtors ──────────────────────────────────────────────────────────────

const COLUMNS = 7;

function DebtorRow({ debtor }: { debtor: Debtor }) {
  const setExempt = useSetExempt();
  const [confirming, setConfirming] = useState(false);
  const busy = setExempt.isPending;

  const status = [
    debtor.frozen ? "Frozen" : null,
    debtor.exempt ? "Exempt" : null,
    debtor.user ? null : "No account",
    debtor.in_group ? null : "Not in a group",
  ].filter((s): s is string => s !== null);

  const exempt = () =>
    setExempt.mutate({ linkId: debtor.link_id, exempt: true }, { onSuccess: () => setConfirming(false) });

  return (
    <Fragment>
      <tr className={TR}>
        <td className={TD}>
          <span className="font-medium">{debtor.name}</span>
          {debtor.user ? <span className="text-muted-foreground"> @{debtor.user.username}</span> : null}
        </td>
        <td className={cn(TD, "text-muted-foreground")}>
          <Clipped text={list(debtor.groups)} />
        </td>
        <td className={cn(TD, "text-muted-foreground")}>
          <Clipped text={list(debtor.teachers)} width="max-w-[11rem]" />
        </td>
        <td className={cn(TD_R, "font-semibold text-danger")}>{formatUzs(debtor.debt)}</td>
        <td className={TD}>{day(debtor.last_payment_on)}</td>
        <td className={cn(TD, !status.length && "text-muted-foreground")}>{status.length ? status.join(" · ") : "—"}</td>
        <td className={cn(TD, "text-right")}>
          {debtor.exempt ? (
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
      {confirming && !debtor.exempt ? (
        <tr>
          <td colSpan={COLUMNS} className="whitespace-normal border-b border-border bg-surface-2 px-2 py-2">
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
          <td colSpan={COLUMNS} role="alert" className="whitespace-normal border-b border-border px-2 py-1.5 text-[12px] text-danger">
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
      <div className="flex min-h-10 items-center gap-2 border-b border-border px-3 py-1.5">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Filter</h2>
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
          <section key={facet.title} className="border-b border-border px-3 py-2 last:border-b-0">
            <h3 className="mb-1 text-[12px] font-semibold text-foreground">By {facet.title}</h3>
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
                        "flex w-full items-baseline justify-between gap-2 rounded-sm px-1.5 py-0.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        on ? "font-semibold text-foreground" : "text-primary dark:text-primary-hover",
                      )}
                    >
                      <span className="min-w-0 truncate">{item.label}</span>
                      {item.count !== undefined ? (
                        <span className="shrink-0 font-normal tabular-nums text-muted-foreground">{item.count}</span>
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
      <p className="text-[13px] text-muted-foreground">
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
          <label htmlFor={checkboxId} className="inline-flex cursor-pointer items-center gap-1.5 text-foreground">
            <input
              id={checkboxId}
              type="checkbox"
              checked={onlyInGroup}
              onChange={(e) => setOnlyInGroup(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer accent-primary"
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

        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          {rows.length} {rows.length === 1 ? "student" : "students"} ·{" "}
          <span className="font-semibold tabular-nums text-foreground">{formatUzs(total)}</span> owed
        </p>

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
          <p className={cn(BOX, "px-3 py-3 text-[13px] text-muted-foreground")}>No debtor matches these filters.</p>
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
      {label} <span className="font-semibold tabular-nums text-foreground">{formatUzs(amount)}</span>
    </span>
  );
}

export function PaymentsPanel({ month }: { month: string }) {
  const q = useMonthPayments(month);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) {
    return (
      <p className="text-[13px] text-muted-foreground">
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
                <td className={cn(TD, "text-muted-foreground")}>
                  <Clipped text={p.group || "—"} />
                </td>
                <td className={TD}>{methodLabel(p.method)}</td>
                <td className={TD}>{KIND_LABEL[p.kind] ?? "Other"}</td>
                <td className={TD_R}>{formatUzs(signed(p))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[13px] text-muted-foreground">
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
