"use client";

import { Fragment, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatUzs } from "./financeApi";
import { ENTER_LABEL, EntryForm, SeatPriceForm, VoidForm } from "./LedgerEntryForm";
import {
  BOX,
  Btn,
  CAPTION,
  CONTROL,
  Figure,
  LoadError,
  Loading,
  TABLE,
  TD,
  TD_R,
  TEXT_BUTTON,
  TH,
  TH_R,
  TR,
  day,
  methodLabel,
  monthLabel,
} from "./FinancePanels";
import type { EnterableKind, LedgerComparison, LedgerEntry, LedgerProblem, LedgerScope, LedgerSeat } from "./billingApi";
import { useLedgerAccount, useLedgerAccounts, useLedgerSummary } from "./billingHooks";

/**
 * The Ledger tab of /ops/finance: the centre's own ledger beside lc-up, and how the two compare. Nothing anyone
 * else sees depends on it until the cutover, and until then it is read-only: `LedgerEntryForm` appears only
 * when the server says money is entered here.
 *
 * "Every balance matches" is said only by a comparison that really ran: a failed read, no comparison yet and
 * a comparison the sync could not support each say so in their own words.
 */

type View = "differences" | LedgerScope;

const VIEWS: { value: View; label: string }[] = [
  { value: "differences", label: "Differences" },
  { value: "current", label: "Current students" },
  { value: "former", label: "Former students" },
];

const SEAT_STATE: Record<string, string> = { active: "Active", trial: "Trial", frozen: "Frozen", left: "Left" };

function money(amount: number) {
  return <span className={amount < 0 ? "text-ms-critical-fg" : undefined}>{formatUzs(amount)}</span>;
}

function moment(iso: string | null): string {
  if (!iso) return "not yet";
  const time = new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${day(iso)}, ${time}`;
}

function Problems({ problems }: { problems: LedgerProblem[] }) {
  if (!problems.length) return null;
  return (
    <section aria-label="Recent problems" className={BOX}>
      <h2 className={CAPTION}>Recent problems</h2>
      <ul className="divide-y divide-ms-line text-[13px]">
        {problems.map((problem) => (
          <li key={`${problem.at}-${problem.kind}`} className="px-3 py-2">
            <span className="text-ms-fg-3">{moment(problem.at)}</span>
            {[...problem.errors, ...problem.alerts].map((line) => (
              <p key={line} className="text-ms-critical-fg">{line}</p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Differences({ comparison, onOpen }: { comparison: LedgerComparison | null; onOpen: (id: number) => void }) {
  if (!comparison) {
    return <p className="text-[13px] text-ms-fg-3">No comparison yet. The first one runs at 23:40.</p>;
  }
  if (!comparison.ok) {
    return (
      <div role="alert" className={cn(BOX, "px-3 py-3 text-[13px] text-ms-critical-fg")}>
        {comparison.alerts.join(" ") || "This comparison did not run."}
      </div>
    );
  }
  if (!comparison.rows.length) {
    return <p className="text-[13px] text-ms-fg">Every balance matches lc-up.</p>;
  }
  return (
    <section aria-label="Differences" className={BOX}>
      <h2 className={CAPTION}>Differences on {day(comparison.day)}</h2>
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <caption className="sr-only">Students whose ledger balance differs from lc-up</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Student</th>
              <th scope="col" className={TH_R}>Ledger</th>
              <th scope="col" className={TH_R}>lc-up</th>
              <th scope="col" className={TH_R}>Difference</th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={`${row.account_id ?? "none"}-${row.name}`} className={TR}>
                <td className={TD}>
                  {row.account_id === null ? (
                    <>
                      {row.name} <span className="text-[12px] text-ms-fg-3">Not in the ledger</span>
                    </>
                  ) : (
                    <button type="button" className={TEXT_BUTTON} onClick={() => onOpen(row.account_id as number)}>
                      {row.name}
                    </button>
                  )}
                </td>
                <td className={TD_R}>{money(row.ours)}</td>
                <td className={TD_R}>{money(row.lcup)}</td>
                <td className={TD_R}>{formatUzs(row.diff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Students({ scope, onOpen }: { scope: LedgerScope; onOpen: (id: number) => void }) {
  const q = useLedgerAccounts(scope);
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return q.data ?? [];
    return (q.data ?? []).filter((row) => row.name.toLowerCase().includes(needle) || row.phone.includes(needle));
  }, [q.data, search]);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) return <p className="text-[13px] text-ms-fg-3">Nobody here.</p>;
  return (
    <div className="space-y-2">
      <input
        type="search"
        aria-label="Find a student by name or phone"
        placeholder="Name or phone"
        className={cn(CONTROL, "w-64 max-w-full")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <section aria-label="Students" className={BOX}>
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <caption className="sr-only">Students and their ledger balance, most owed first</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Student</th>
                <th scope="col" className={TH}>Phone</th>
                <th scope="col" className={TH_R}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} className={TR}>
                  <td className={TD}>
                    <button type="button" className={TEXT_BUTTON} onClick={() => onOpen(row.id)}>
                      {row.name}
                    </button>
                  </td>
                  <td className={TD}>{row.phone || "—"}</td>
                  <td className={TD_R}>{money(row.balance)}</td>
                </tr>
              ))}
              {shown.length ? null : (
                <tr>
                  <td colSpan={3} className={cn(TD, "text-ms-fg-3")}>Nobody matches.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function entryDetails(entry: LedgerEntry): string {
  const parts = [
    entry.month ? monthLabel(entry.month, "short") : "",
    entry.method ? methodLabel(entry.method) : "",
    entry.note,
    entry.by,
  ];
  return parts.filter(Boolean).join(" · ");
}

function priceWord(price: number | null): string {
  if (price === null) return "group price";
  return price === 0 ? "grant" : formatUzs(price);
}

function seatPrice(seat: LedgerSeat): string {
  if (seat.personal_price === null || seat.personal_price === undefined) return `${formatUzs(seat.price)} a month`;
  const group = `(group ${formatUzs(seat.price)})`;
  return seat.personal_price === 0
    ? `Grant, nothing charged ${group}`
    : `${formatUzs(seat.personal_price)} a month, personal ${group}`;
}

function voidedText(entry: LedgerEntry): string {
  return `Voided${entry.voided_by ? ` by ${entry.voided_by}` : ""}: ${entry.void_reason}`;
}

const ENTERABLE: EnterableKind[] = ["payment", "refund", "adjust"];

function AccountView({ id, onBack }: { id: number; onBack: () => void }) {
  const q = useLedgerAccount(id);
  const [entering, setEntering] = useState<EnterableKind | null>(null);
  const [voiding, setVoiding] = useState<number | null>(null);
  const [pricing, setPricing] = useState<number | null>(null);
  const back =<Btn onClick={onBack}>Back to the ledger</Btn>;
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) {
    return (
      <div className="space-y-3">
        {back}
        <LoadError error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const account = q.data;
  return (
    <div className="space-y-3">
      {back}
      <header>
        <h2 className="text-[15px] font-semibold text-ms-fg">{account.name}</h2>
        <p className="text-[13px] text-ms-fg-3">
          {account.phone || "No phone"} · Balance {money(account.balance)}
        </p>
        {account.seats.map((seat) => (
          <div key={seat.id} className="text-[13px] text-ms-fg-3">
            <p>
              {seat.group_name} · {SEAT_STATE[seat.state] ?? seat.state} · {seatPrice(seat)}{" "}
              {pricing === seat.id ? null : (
                <button type="button" className={TEXT_BUTTON} onClick={() => setPricing(seat.id)}>
                  Personal price
                </button>
              )}
            </p>
            {pricing === seat.id ? <SeatPriceForm seat={seat} onClose={() => setPricing(null)} /> : null}
            {seat.price_changes?.map((change) => (
              <p key={change.at} className="text-[12px]">
                {moment(change.at)} · {change.by || "—"} · {priceWord(change.old_price)} → {priceWord(change.new_price)} · {change.reason}
              </p>
            ))}
          </div>
        ))}
      </header>
      {account.payments_open ? (
        entering ? (
          <EntryForm accountId={account.id} balance={account.balance} kind={entering} onClose={() => setEntering(null)} />
        ) : (
          <div role="group" aria-label="Enter money" className="flex flex-wrap gap-1">
            {ENTERABLE.map((kind) => (
              <Btn key={kind} onClick={() => setEntering(kind)}>{ENTER_LABEL[kind]}</Btn>
            ))}
          </div>
        )
      ) : null}
      <section aria-label="Rows" className={BOX}>
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <caption className="sr-only">Every movement of money, oldest first</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Date</th>
                <th scope="col" className={TH}>What</th>
                <th scope="col" className={TH_R}>Amount</th>
                <th scope="col" className={TH_R}>Balance after</th>
                <th scope="col" className={TH}>Details</th>
              </tr>
            </thead>
            <tbody>
              {account.rows.map((entry) => (
                <Fragment key={entry.id}>
                  <tr className={TR}>
                    <td className={TD}>{day(entry.day)}</td>
                    <td className={TD}>{entry.label}</td>
                    <td className={TD_R}>
                      {entry.voided_at ? (
                        <span className="text-ms-fg-3 line-through">{formatUzs(entry.amount)}</span>
                      ) : (
                        money(entry.amount)
                      )}
                    </td>
                    <td className={TD_R}>{money(entry.running)}</td>
                    <td className={cn(TD, "text-ms-fg-3")}>
                      {entry.voided_at ? voidedText(entry) : entryDetails(entry) || "—"}
                      {account.payments_open && entry.can_void && voiding !== entry.id ? (
                        <>
                          {" "}
                          <button type="button" className={TEXT_BUTTON} onClick={() => setVoiding(entry.id)}>
                            Void
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                  {voiding === entry.id ? (
                    <tr>
                      <td colSpan={5} className={TD}>
                        <VoidForm entryId={entry.id} onClose={() => setVoiding(null)} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function LedgerPanel() {
  const q = useLedgerSummary();
  const [accountId, setAccountId] = useState<number | null>(null);
  const [view, setView] = useState<View>("differences");
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  const summary = q.data;
  if (!summary.opened_at) {
    return <p className="text-[13px] text-ms-fg-3">The ledger is not open yet.</p>;
  }
  if (accountId !== null) return <AccountView id={accountId} onBack={() => setAccountId(null)} />;
  const counts = summary.comparison?.ok ? summary.comparison.counts : null;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ms-fg-3">
        The ledger runs beside lc-up and changes nothing yet: payments are still entered in lc-up.{" "}
        {summary.enabled ? `Last followed lc-up: ${moment(summary.last_tick_at)}.` : "Following lc-up is switched off."}
      </p>
      {/* Seven figures leave a hole in two or four columns, so the last one takes the rest of its row. */}
      <dl
        className={cn(
          "grid grid-cols-2 gap-px overflow-hidden rounded-[16px] bg-ms-line sm:grid-cols-4 xl:grid-cols-7",
          counts && "[&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1",
        )}
      >
        <Figure label="Accounts" value={String(summary.accounts)} />
        <Figure label="Former students" value={String(summary.former)} />
        {counts ? (
          <>
            <Figure label="Matched" value={String(counts.matched ?? 0)} />
            <Figure label="Small differences" value={String(counts.small ?? 0)} />
            <Figure label="Big differences" value={String(counts.big ?? 0)} debt={(counts.big ?? 0) > 0} />
            <Figure label="lc-up balance unknown" value={String(counts.unknown ?? 0)} />
            <Figure label="Missing here" value={String(counts.missing ?? 0)} debt={(counts.missing ?? 0) > 0} />
          </>
        ) : null}
      </dl>
      {counts ? (
        <p className="text-[12px] text-ms-fg-3">
          Compared on {day(summary.comparison?.day)}. A small difference is up to 1,000 UZS, usually rounding.
        </p>
      ) : null}
      <Problems problems={summary.problems} />
      <div role="group" aria-label="Ledger view" className="flex flex-wrap gap-1">
        {VIEWS.map((item) => (
          <Btn key={item.value} primary={view === item.value} aria-pressed={view === item.value} onClick={() => setView(item.value)}>
            {item.label}
          </Btn>
        ))}
      </div>
      {view === "differences" ? <Differences comparison={summary.comparison} onOpen={setAccountId} /> : null}
      {view !== "differences" ? <Students key={view} scope={view} onOpen={setAccountId} /> : null}
    </div>
  );
}
