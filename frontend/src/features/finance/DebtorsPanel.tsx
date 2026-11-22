"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/Icon";
import {
  Badge,
  ChipCount,
  ConfirmDialog,
  EmptyState,
  Menu,
  Pagination,
  StatTile,
  buttonClass,
  chipClass,
  signedAmount,
  type MenuItem,
} from "@/features/console/ui";
import { formatPhone } from "@/features/ops/people/format";
import { NEW_CAMPAIGN_PATH } from "@/features/ops/sms/smsTabs";
import { P } from "@/features/ops/permissions";
import { useCan } from "@/features/ops/useCan";
import type { Debtor, DebtorGroup } from "./financeApi";
import { useDebtors, useSetExempt } from "./financeHooks";
import { BOX, CONTROL, GroupTag, LoadError, Loading, SOM, TABLE, TD, TD_R, TH, TH_R, TR, day, som } from "./FinancePanels";

/**
 * Finance › Debtors (lc-up structure canvas, Debtors and PhoneDebtors boards, owner 22 Nov 2026): every lc-up
 * student who owes, one row per STUDENT (never per family), the biggest debt first — students in no group too.
 *
 * What the board draws and we keep: who, their phone and a parent's (the parent's only for `view_people`), the
 * group as a course tag, the balance as a signed number, the last payment, the freeze. What the board draws and we
 * do not keep — a call's outcome, a promised date, a note, tags, a lesson day, a payment day, a room, the day a debt
 * began — is left out rather than made up. The list arrives whole, so it is filtered and paged in the browser.
 */

type Status = "" | "in_group" | "no_group" | "frozen" | "exempt" | "no_account";

const STATUS_LABEL: Record<Exclude<Status, "">, string> = {
  in_group: "In a group",
  no_group: "No group",
  frozen: "Frozen for debt",
  exempt: "Exempt from freeze",
  no_account: "No account",
};

/** The chips over the table: every status a debtor can be in, each with how many are. */
const CHIPS: Exclude<Status, "">[] = ["no_group", "frozen", "exempt", "no_account"];

const PAGE_SIZES = [50, 100, 150] as const;

type Filters = { name: string; phone: string; group: string; teacher: string; status: Status };
const NO_FILTERS: Filters = { name: "", phone: "", group: "", teacher: "", status: "" };

const digits = (s: string) => s.replace(/\D/g, "");

function hasStatus(d: Debtor, status: Status): boolean {
  switch (status) {
    case "":
      return true;
    case "in_group":
      return d.in_group;
    case "no_group":
      return !d.in_group;
    case "frozen":
      return d.frozen;
    case "exempt":
      return d.exempt;
    case "no_account":
      return !d.user;
  }
}

/** Whether a debtor passes the filters; `skipStatus` is how a status chip counts its choice against the rest. */
export function passes(d: Debtor, f: Filters, skipStatus = false): boolean {
  if (!skipStatus && !hasStatus(d, f.status)) return false;
  if (f.group && !d.groups.includes(f.group)) return false;
  if (f.teacher && !d.teachers.includes(f.teacher)) return false;
  const name = f.name.trim().toLowerCase();
  if (name) {
    const haystack = [d.name, d.user?.name ?? "", d.user?.username ?? ""].join(" ").toLowerCase();
    if (!haystack.includes(name)) return false;
  }
  const phone = digits(f.phone);
  if (phone && !digits(`${d.phone ?? ""} ${d.parent_phone ?? ""}`).includes(phone)) return false;
  return true;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** The groups as the table shows them: the server's rows when it sends them, else the names alone. */
function groupsOf(d: Debtor): DebtorGroup[] {
  return d.group_rows?.length ? d.group_rows : d.groups.map((name) => ({ name, level: "", classroom_id: null }));
}

function personHref(d: Debtor): string | null {
  return d.user ? `/ops/${d.user.section || "students"}/${d.user.id}` : null;
}

/** The number to call: the student's own, else a parent's. */
function callNumber(d: Debtor): string {
  return (d.phone || d.parent_phone || "").trim();
}

/** "SMS this list": the composer's Debtors audience — every student who owes — reviewed there before anything goes. */
export function SmsDebtorsLink() {
  const can = useCan();
  // The composer is `send_sms`'s; offering it to someone the server would refuse helps nobody.
  if (!can(P.sendSms)) return null;
  return (
    <Link
      href={`${NEW_CAMPAIGN_PATH}?audience=debtors`}
      title="Every student who owes. The composer shows who gets it, the text and the cost before anything is sent."
      className={buttonClass({ variant: "secondary", size: "sm" })}
    >
      <Icon name="msg" size="sm" />
      SMS this list
    </Link>
  );
}

function StatusBadges({ d, dash = true }: { d: Debtor; dash?: boolean }) {
  const badges = [
    d.frozen ? (
      <Badge key="frozen" tone="frozen" icon="snow">
        Frozen
      </Badge>
    ) : null,
    d.exempt ? (
      <Badge key="exempt" tone="info">
        Exempt
      </Badge>
    ) : null,
    d.user ? null : (
      <Badge key="account" tone="line">
        No account
      </Badge>
    ),
  ].filter(Boolean);
  if (!badges.length) return dash ? <span className="text-ms-fg-3">—</span> : null;
  return <span className="inline-flex flex-wrap gap-1">{badges}</span>;
}

function Groups({ d }: { d: Debtor }) {
  const rows = groupsOf(d);
  if (!rows.length) return <Badge tone="line">No group</Badge>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {rows.map((g) =>
        g.classroom_id ? (
          <Link key={g.name} href={`/ops/classrooms/${g.classroom_id}`} prefetch={false} className="rounded-ms-badge focus-visible:outline-2 focus-visible:outline-ms-ring">
            <GroupTag name={g.name} level={g.level} />
          </Link>
        ) : (
          <GroupTag key={g.name} name={g.name} level={g.level} />
        ),
      )}
    </span>
  );
}

/** What a row's ⋮ offers: the student's page, an SMS to them, the freeze exemption — each only to who may. */
function rowMenu(d: Debtor, can: (...codes: string[]) => boolean, onExempt: () => void, onUnexempt: () => void): MenuItem[] {
  const items: MenuItem[] = [];
  const href = personHref(d);
  if (href) items.push({ label: "Open student page", icon: "users", href });
  if (d.user && can(P.sendSms)) items.push({ label: "SMS…", icon: "msg", href: `${NEW_CAMPAIGN_PATH}?student=${d.user.id}` });
  if (can(P.debtFreeze)) {
    if (items.length) items.push("separator");
    items.push(
      d.exempt
        ? { label: "Remove exemption", icon: "snow", onSelect: onUnexempt }
        : { label: "Exempt from freeze", icon: "snow", onSelect: onExempt },
    );
  }
  return items;
}

function CallLink({ d, wide = false }: { d: Debtor; wide?: boolean }) {
  const number = callNumber(d);
  if (!number) return null;
  return (
    <a
      href={`tel:${digits(number) ? `+${digits(number)}` : number}`}
      aria-label={`Call ${d.name}`}
      className={buttonClass({ variant: "secondary", size: "sm", className: wide ? "min-w-[84px]" : undefined })}
    >
      <Icon name="phone" size="sm" />
      Call
    </a>
  );
}

export function DebtorsPanel() {
  const q = useDebtors();
  const can = useCan();
  const setExempt = useSetExempt();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(150);
  const [exempting, setExempting] = useState<Debtor | null>(null);

  const all = useMemo(() => [...(q.data ?? [])].sort((a, b) => b.debt - a.debt), [q.data]);
  const groups = useMemo(() => uniqueSorted(all.flatMap((d) => d.groups)), [all]);
  const teachers = useMemo(() => uniqueSorted(all.flatMap((d) => d.teachers)), [all]);
  const rows = useMemo(() => all.filter((d) => passes(d, filters)), [all, filters]);
  const beforeStatus = useMemo(() => all.filter((d) => passes(d, filters, true)), [all, filters]);

  const set = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <LoadError what="Could not load the debtors." error={q.error} onRetry={() => void q.refetch()} />;
  if (!all.length) {
    return (
      <div className={BOX}>
        <EmptyState icon="ok" title="Nobody owes money" detail="Every student's lc-up balance is zero or above. A student appears here when theirs goes below zero." />
      </div>
    );
  }

  const owed = all.reduce((sum, d) => sum + d.debt, 0);
  const noGroup = all.filter((d) => !d.in_group).length;
  const frozen = all.filter((d) => d.frozen).length;
  const exempt = all.filter((d) => d.exempt).length;
  const shownTotal = rows.reduce((sum, d) => sum + d.debt, 0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const at = Math.min(page, pages);
  const shown = rows.slice((at - 1) * pageSize, at * pageSize);
  const anyFilter = Object.values(filters).some(Boolean);

  const unexempt = (d: Debtor) => setExempt.mutate({ linkId: d.link_id, exempt: false });

  return (
    <div className="flex flex-col gap-7">
      {/* A phone says it in one line (PhoneDebtors board); the tiles need the width. */}
      <p className="text-[15px] font-semibold tabular-nums text-ms-fg md:hidden">
        {all.length} {all.length === 1 ? "student" : "students"} · {som(owed)}
      </p>
      <section aria-label="Debt at a glance" className="hidden grid-cols-2 gap-3 md:grid lg:grid-cols-3">
        <StatTile
          label="Students who owe"
          value={all.length}
          tone="critical"
          sub={noGroup ? `${noGroup} of them in no group` : "all of them in a group"}
        />
        <StatTile label="Owed in total" value={signedAmount(owed)} unit={SOM} delay={30} />
        <StatTile
          label="Frozen for debt"
          value={frozen}
          tone={frozen ? "frozen" : undefined}
          sub={exempt ? `${exempt} exempt from the freeze` : undefined}
          delay={60}
        />
      </section>

      <div className="flex flex-col gap-3">
        <form
          role="search"
          aria-label="Filter the debtors"
          onSubmit={(e) => e.preventDefault()}
          className={cn(BOX, "hidden gap-2 p-4 md:grid md:grid-cols-3 xl:grid-cols-6")}
        >
          <input
            type="search"
            aria-label="Name"
            placeholder="Name"
            value={filters.name}
            onChange={(e) => set({ name: e.target.value })}
            className={CONTROL}
          />
          <input
            type="search"
            inputMode="tel"
            aria-label="Phone"
            placeholder="Phone"
            value={filters.phone}
            onChange={(e) => set({ phone: e.target.value })}
            className={CONTROL}
          />
          <select aria-label="Group" value={filters.group} onChange={(e) => set({ group: e.target.value })} className={CONTROL}>
            <option value="">All groups</option>
            {groups.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select aria-label="Teacher" value={filters.teacher} onChange={(e) => set({ teacher: e.target.value })} className={CONTROL}>
            <option value="">All teachers</option>
            {teachers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select aria-label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value as Status })} className={CONTROL}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as Exclude<Status, "">[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <button type="button" disabled={!anyFilter} onClick={() => set(NO_FILTERS)} className={buttonClass({ variant: "ghost", size: "sm", className: "h-9" })}>
            Clear filters
          </button>
        </form>

        {/* On a phone the search alone; the other filters are the chips (PhoneDebtors board). */}
        <input
          type="search"
          aria-label="Search debtors by name"
          placeholder="Search by name"
          value={filters.name}
          onChange={(e) => set({ name: e.target.value })}
          className={cn(CONTROL, "h-10 w-full md:hidden")}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Status" className="flex min-w-0 gap-2 overflow-x-auto [scrollbar-width:none]">
            <button type="button" aria-pressed={filters.status === ""} onClick={() => set({ status: "" })} className={chipClass(filters.status === "")}>
              All <ChipCount n={beforeStatus.length} on={filters.status === ""} />
            </button>
            {CHIPS.map((s) => {
              const n = beforeStatus.filter((d) => hasStatus(d, s)).length;
              const on = filters.status === s;
              return (
                <button key={s} type="button" aria-pressed={on} onClick={() => set({ status: on ? "" : s })} className={chipClass(on, n === 0)}>
                  {STATUS_LABEL[s]} <ChipCount n={n} on={on} />
                </button>
              );
            })}
          </div>
          <p className="ml-auto text-[14px] font-semibold tabular-nums text-ms-fg" aria-live="polite">
            Total: {som(shownTotal)} · {rows.length} {rows.length === 1 ? "student" : "students"}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className={BOX}>
          <EmptyState
            title="No debtor matches these filters"
            detail="Clear a filter to see more students."
            action={
              <button type="button" onClick={() => set(NO_FILTERS)} className={buttonClass({ variant: "secondary", size: "sm" })}>
                Clear filters
              </button>
            }
          />
        </div>
      ) : (
        <>
          {/* Phone (PhoneDebtors board): a card per student; the table needs the width. */}
          <ul aria-label="Students who owe" className="flex flex-col gap-2 md:hidden">
            {shown.map((d) => (
              <DebtorCard key={d.link_id} d={d} menu={rowMenu(d, can, () => setExempting(d), () => unexempt(d))} busy={setExempt.isPending} />
            ))}
          </ul>

          <div className={cn(BOX, "hidden md:block")}>
            <div className="overflow-x-auto">
              <table className={cn(TABLE, "min-w-[1040px]")}>
                <caption className="sr-only">Students who owe money, the biggest debt first</caption>
                <thead>
                  <tr>
                    <th scope="col" className={cn(TH_R, "w-0")}>#</th>
                    <th scope="col" className={TH}>Student</th>
                    <th scope="col" className={TH}>Phone</th>
                    <th scope="col" className={TH}>Group</th>
                    <th scope="col" className={TH}>Teacher</th>
                    <th scope="col" className={TH_R}>Balance, {SOM}</th>
                    <th scope="col" className={TH}>Last payment</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={cn(TH, "w-0")}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d, i) => {
                    const href = personHref(d);
                    const menu = rowMenu(d, can, () => setExempting(d), () => unexempt(d));
                    return (
                      <tr key={d.link_id} className={TR}>
                        <td className={cn(TD_R, "text-ms-fg-3")}>{(at - 1) * pageSize + i + 1}</td>
                        <td className={TD}>
                          {href ? (
                            <Link href={href} prefetch={false} className="font-semibold text-ms-fg hover:text-ms-primary-text hover:underline">
                              {d.name}
                            </Link>
                          ) : (
                            <span className="font-semibold">{d.name}</span>
                          )}
                          {d.parent_phone ? <div className="text-[13px] tabular-nums text-ms-fg-3">Parent {formatPhone(d.parent_phone)}</div> : null}
                        </td>
                        <td className={cn(TD, "tabular-nums")}>{d.phone ? formatPhone(d.phone) : <span className="text-ms-fg-3">—</span>}</td>
                        <td className={TD}>
                          <Groups d={d} />
                        </td>
                        <td className={cn(TD, "text-ms-fg-2")}>
                          {d.teachers.length ? (
                            <span title={d.teachers.join(", ")} className="block max-w-[11rem] truncate">
                              {d.teachers.join(", ")}
                            </span>
                          ) : (
                            <span className="text-ms-fg-3">—</span>
                          )}
                        </td>
                        <td className={cn(TD_R, "font-semibold text-ms-critical-fg")} data-verdict="critical">
                          {signedAmount(-d.debt)}
                        </td>
                        <td className={cn(TD, "tabular-nums")}>{day(d.last_payment_on)}</td>
                        <td className={TD}>
                          <StatusBadges d={d} />
                        </td>
                        <td className={TD}>
                          <span className="flex items-center justify-end gap-1">
                            <CallLink d={d} />
                            {menu.length ? <Menu label={`More for ${d.name}`} items={menu} disabled={setExempt.isPending} /> : null}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={at}
              pages={pages}
              count={rows.length}
              pageSize={pageSize}
              pageSizes={PAGE_SIZES}
              noun={{ singular: "student · biggest debt first", plural: "students · biggest debt first" }}
              hrefFor={(p) => `?tab=debtors&page=${p}`}
              onPage={setPage}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>

          {/* The phone list pages too, by the same numbers. */}
          {pages > 1 ? (
            <div className="flex items-center justify-between gap-2 md:hidden">
              <button type="button" disabled={at <= 1} onClick={() => setPage(at - 1)} className={buttonClass({ variant: "secondary", size: "sm" })}>
                Previous
              </button>
              <span className="text-[14px] tabular-nums text-ms-fg-2">
                {at} of {pages}
              </span>
              <button type="button" disabled={at >= pages} onClick={() => setPage(at + 1)} className={buttonClass({ variant: "secondary", size: "sm" })}>
                Next
              </button>
            </div>
          ) : null}
        </>
      )}

      {setExempt.error && !exempting ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-4 py-3 text-[14px]">
          <Icon name="alert" className="shrink-0 text-ms-critical-fg" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-ms-critical-fg">The exemption did not change.</span>{" "}
            <span className="text-ms-fg-2">{formatApiErrorForToast(setExempt.error)}</span>
          </span>
          <button type="button" onClick={() => setExempt.reset()} className={buttonClass({ variant: "ghost", size: "sm" })}>
            Dismiss
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={exempting !== null}
        onClose={() => {
          setExempting(null);
          // The dialog said what went wrong; it is not said again under the list.
          setExempt.reset();
        }}
        title={exempting ? `Exempt ${exempting.name} from the debt freeze?` : "Exempt from the debt freeze?"}
        icon="snow"
        tone="frozen"
        confirmLabel="Yes, exempt"
        onConfirm={async () => {
          if (!exempting) return;
          try {
            await setExempt.mutateAsync({ linkId: exempting.link_id, exempt: true });
          } catch (e) {
            throw new Error(formatApiErrorForToast(e));
          }
        }}
      >
        <p>
          Their account will not be frozen for an unpaid month while the exemption stands — for example, a student on a
          grant.{exempting?.frozen ? " They are frozen now and will be unfrozen right away." : ""} The debt itself stays in lc-up.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/** One debtor on a phone (PhoneDebtors board): who and the group, the balance, Call and the row's ⋮. */
function DebtorCard({ d, menu, busy }: { d: Debtor; menu: MenuItem[]; busy: boolean }) {
  const href = personHref(d);
  const group = groupsOf(d);
  return (
    <li className={cn(BOX, "flex flex-col gap-2 px-3.5 py-3")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {href ? (
            <Link href={href} prefetch={false} className="block truncate font-semibold text-ms-fg hover:underline">
              {d.name}
            </Link>
          ) : (
            <span className="block truncate font-semibold">{d.name}</span>
          )}
          <span className="block truncate text-[13px] text-ms-fg-3">
            {group.length ? group.map((g) => g.name).join(", ") : "No group"}
          </span>
        </div>
        <div className="shrink-0 text-right">
          <span className="block text-[16px] font-bold tabular-nums text-ms-critical-fg">{signedAmount(-d.debt)}</span>
          <span className="block text-[12px] text-ms-fg-3">{SOM}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadges d={d} dash={false} />
        <span className="flex-1" />
        <CallLink d={d} wide />
        {menu.length ? <Menu label={`More for ${d.name}`} items={menu} disabled={busy} /> : null}
      </div>
    </li>
  );
}
