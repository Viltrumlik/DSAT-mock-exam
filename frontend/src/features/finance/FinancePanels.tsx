"use client";

import { Fragment, useId, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Receipt, Wallet } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Input,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import type { BadgeVariant } from "@/components/ui/Badge";
import { formatApiErrorForToast } from "@/lib/apiError";
import { formatUzs, type Debtor, type MonthPayment } from "./financeApi";
import { useDebtors, useFinanceSummary, useMonthPayments, useSetExempt } from "./financeHooks";

/**
 * The three panels of /ops/finance — money as lc-up keeps it. Balances (and so debt, debtors,
 * freezes) are as of the latest sync; payments belong to the month picked above the panel.
 *
 * A failed read renders an error with a retry, never the empty state: "nobody owes anything"
 * and "the debtor list did not load" must not look the same on a page about money.
 */

const CARD = "rounded-xl border border-border bg-card p-4";

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
    <div className="flex items-center gap-2" role="group" aria-label="Month">
      <Button size="sm" variant="secondary" aria-label="Previous month" onClick={() => onChange(shiftMonth(value, -1))}>
        <ChevronLeft aria-hidden />
      </Button>
      <span className="min-w-[8.5rem] text-center text-sm font-semibold text-foreground" aria-live="polite">
        {monthLabel(value)}
      </span>
      <Button
        size="sm"
        variant="secondary"
        aria-label="Next month"
        disabled={atLatest}
        onClick={() => onChange(shiftMonth(value, 1))}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );
}

// ── shared states ────────────────────────────────────────────────────────

function Loading() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="h-4 w-4" />
      <span>Loading…</span>
    </div>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Alert tone="danger" title="This did not load">
      <div className="flex flex-wrap items-center gap-3">
        <span>{formatApiErrorForToast(error)}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Alert>
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

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className={CARD}>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
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
    <div className="space-y-4">
      <p className="text-sm text-foreground">
        {s.freeze.enabled ? `Debt freeze: on — from day ${s.freeze.day} of each month` : "Debt freeze: off"}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Tile label="Total debt" value={formatUzs(s.total_debt)} />
        <Tile label="Debtors" value={String(s.debtors)} />
        <Tile label="Frozen for debt" value={String(s.frozen)} />
        <Tile label="Exempt from freeze" value={String(s.exempt)} />
        <Tile label={`Paid in ${short}`} value={formatUzs(s.paid)} />
        <Tile label={`Refunded in ${short}`} value={formatUzs(s.refunded)} />
      </div>
      <p className="text-xs text-muted-foreground">
        Debt, debtors and freezes are as of the latest lc-up sync. Payments and refunds are for {monthLabel(month)}.
      </p>

      <div className={CARD}>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Paid by method</h3>
        {methods.length ? (
          <ul className="space-y-1 text-sm">
            {methods.map(([method, amount]) => (
              <li key={method} className="flex justify-between gap-4">
                <span className="text-foreground">{methodLabel(method)}</span>
                <span className="font-semibold text-foreground">{formatUzs(amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No payments in {monthLabel(month)}.</p>
        )}
        {s.other ? (
          <p className="mt-2 text-xs text-muted-foreground">Other entries this month: {formatUzs(s.other)}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">By group</h3>
        {s.by_group.length ? (
          <Table>
            <caption className="sr-only">Money by group, {monthLabel(month)}</caption>
            <TableHead>
              <TableRow>
                <TableHeaderCell scope="col">Group</TableHeaderCell>
                <TableHeaderCell scope="col">Teacher(s)</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Monthly price</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Students</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Debtors</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Debt</TableHeaderCell>
                <TableHeaderCell scope="col" className="text-right">Income ({short})</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {s.by_group.map((g) => (
                <TableRow key={g.group}>
                  <TableCell className="font-semibold">{g.group}</TableCell>
                  <TableCell className="text-muted-foreground">{list(g.teachers)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{formatUzs(g.monthly_cost)}</TableCell>
                  <TableCell className="text-right">{g.students}</TableCell>
                  <TableCell className="text-right">{g.debtors}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{formatUzs(g.debt)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">{formatUzs(g.income)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No paired lc-up groups yet. They appear once a group is paired with a class.</p>
        )}
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

  const badges: { label: string; variant: BadgeVariant }[] = [];
  if (debtor.frozen) badges.push({ label: "Frozen", variant: "danger" });
  if (debtor.exempt) badges.push({ label: "Exempt", variant: "info" });
  if (!debtor.user) badges.push({ label: "No account", variant: "neutral" });
  if (!debtor.in_group) badges.push({ label: "Not in a group", variant: "outline" });

  const exempt = () =>
    setExempt.mutate({ linkId: debtor.link_id, exempt: true }, { onSuccess: () => setConfirming(false) });

  return (
    <Fragment>
      <TableRow>
        <TableCell>
          <span className="font-semibold">{debtor.name}</span>
          {debtor.user ? (
            <span className="block text-xs text-muted-foreground">@{debtor.user.username}</span>
          ) : null}
        </TableCell>
        <TableCell className="text-muted-foreground">{list(debtor.groups)}</TableCell>
        <TableCell className="text-muted-foreground">{list(debtor.teachers)}</TableCell>
        <TableCell className="whitespace-nowrap text-right font-semibold">{formatUzs(debtor.debt)}</TableCell>
        <TableCell className="whitespace-nowrap">{day(debtor.last_payment_on)}</TableCell>
        <TableCell>
          {badges.length ? (
            <div className="flex flex-wrap gap-1">
              {badges.map((b) => (
                <Badge key={b.label} variant={b.variant}>
                  {b.label}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-right">
          {debtor.exempt ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy}
              aria-label={`Remove exemption for ${debtor.name}`}
              onClick={() => setExempt.mutate({ linkId: debtor.link_id, exempt: false })}
            >
              Remove exemption
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || confirming}
              aria-label={`Exempt ${debtor.name} from freeze`}
              onClick={() => setConfirming(true)}
            >
              Exempt from freeze
            </Button>
          )}
        </TableCell>
      </TableRow>
      {confirming && !debtor.exempt ? (
        <TableRow className="bg-surface-2">
          <TableCell colSpan={COLUMNS}>
            <p className="text-sm text-foreground">
              Exempt {debtor.name} from the debt freeze? Their account will not be frozen for an unpaid month while
              the exemption stands — for example, a student on a grant.
              {debtor.frozen ? " They are frozen now and will be unfrozen right away." : ""} The debt itself stays in
              lc-up.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" loading={busy} onClick={exempt}>
                Yes, exempt
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
      {setExempt.error ? (
        <TableRow>
          <TableCell colSpan={COLUMNS}>
            <Alert tone="danger">{formatApiErrorForToast(setExempt.error)}</Alert>
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
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
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((d) => {
      if (onlyInGroup && !d.in_group) return false;
      if (group && !d.groups.includes(group)) return false;
      if (teacher && !d.teachers.includes(teacher)) return false;
      if (needle) {
        const haystack = [d.name, d.user?.name ?? "", d.user?.username ?? ""].join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [all, search, group, teacher, onlyInGroup]);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!all.length) {
    return (
      <EmptyState
        compact
        icon={Wallet}
        title="Nobody owes money right now"
        description="A student appears here when their lc-up balance goes below zero."
      />
    );
  }

  const total = rows.reduce((sum, d) => sum + d.debt, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Input
            inputSize="sm"
            type="search"
            aria-label="Search by name"
            placeholder="Search by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-56">
          <Select selectSize="sm" aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All groups</option>
            {groups.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-48">
          <Select selectSize="sm" aria-label="Teacher" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
            <option value="">All teachers</option>
            {teachers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
        <Checkbox
          id={checkboxId}
          label="Only students in a group"
          checked={onlyInGroup}
          onChange={(e) => setOnlyInGroup(e.target.checked)}
        />
      </div>

      <p className="text-sm text-foreground" aria-live="polite">
        {rows.length} {rows.length === 1 ? "student" : "students"} ·{" "}
        <span className="font-semibold">{formatUzs(total)}</span> owed
      </p>

      {rows.length ? (
        <Table>
          <caption className="sr-only">Students who owe money</caption>
          <TableHead>
            <TableRow>
              <TableHeaderCell scope="col">Student</TableHeaderCell>
              <TableHeaderCell scope="col">Group(s)</TableHeaderCell>
              <TableHeaderCell scope="col">Teacher(s)</TableHeaderCell>
              <TableHeaderCell scope="col" className="text-right">Debt</TableHeaderCell>
              <TableHeaderCell scope="col">Last payment</TableHeaderCell>
              <TableHeaderCell scope="col">Status</TableHeaderCell>
              <TableHeaderCell scope="col" className="text-right">
                <span className="sr-only">Action</span>
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((debtor) => (
              <DebtorRow key={debtor.link_id} debtor={debtor} />
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">No debtor matches these filters.</p>
      )}
    </div>
  );
}

// ── payments ─────────────────────────────────────────────────────────────

const KIND: Record<string, { label: string; variant: BadgeVariant }> = {
  payment: { label: "Payment", variant: "success" },
  refund: { label: "Refund", variant: "warning" },
};
const OTHER_KIND = { label: "Other", variant: "neutral" as BadgeVariant };

/** A refund is money going back out, so it is shown — and counted — below zero. */
function signed(p: MonthPayment): number {
  // `|| 0` so an empty refund reads "0 UZS", not "-0 UZS" (-0 formats with its sign).
  return p.kind === "refund" ? -Math.abs(p.amount) || 0 : p.amount;
}

export function PaymentsPanel({ month }: { month: string }) {
  const q = useMonthPayments(month);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) {
    return (
      <EmptyState
        compact
        icon={Receipt}
        title={`No payments in ${monthLabel(month)}`}
        description="Payments appear here once lc-up records them and the next sync brings them in."
      />
    );
  }

  const rows = [...q.data].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const paid = rows.filter((p) => p.kind === "payment").reduce((sum, p) => sum + p.amount, 0);
  const refunded = rows.filter((p) => p.kind === "refund").reduce((sum, p) => sum + Math.abs(p.amount), 0);
  const other = rows.filter((p) => p.kind !== "payment" && p.kind !== "refund").reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-4">
      <div className={`${CARD} flex flex-wrap gap-x-6 gap-y-2 text-sm`}>
        <span className="text-muted-foreground">
          Payments <span className="font-semibold text-foreground">{formatUzs(paid)}</span>
        </span>
        <span className="text-muted-foreground">
          Refunds <span className="font-semibold text-foreground">{formatUzs(-refunded || 0)}</span>
        </span>
        <span className="text-muted-foreground">
          Net <span className="font-semibold text-foreground">{formatUzs(paid - refunded)}</span>
        </span>
        {other ? (
          <span className="text-muted-foreground">
            Other <span className="font-semibold text-foreground">{formatUzs(other)}</span>
          </span>
        ) : null}
      </div>

      <Table>
        <caption className="sr-only">Payments in {monthLabel(month)}</caption>
        <TableHead>
          <TableRow>
            <TableHeaderCell scope="col">Date</TableHeaderCell>
            <TableHeaderCell scope="col">Student</TableHeaderCell>
            <TableHeaderCell scope="col">Group</TableHeaderCell>
            <TableHeaderCell scope="col">Method</TableHeaderCell>
            <TableHeaderCell scope="col">Type</TableHeaderCell>
            <TableHeaderCell scope="col" className="text-right">Amount</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((p) => {
            const kind = KIND[p.kind] ?? OTHER_KIND;
            return (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap">{day(p.date)}</TableCell>
                <TableCell>{p.student || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{p.group || "—"}</TableCell>
                <TableCell>{methodLabel(p.method)}</TableCell>
                <TableCell>
                  <Badge variant={kind.variant}>{kind.label}</Badge>
                </TableCell>
                <TableCell
                  className={`whitespace-nowrap text-right font-semibold ${p.kind === "refund" ? "text-danger" : ""}`}
                >
                  {formatUzs(signed(p))}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
