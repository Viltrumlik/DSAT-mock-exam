"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { formatApiErrorForToast } from "@/lib/apiError";
import { Icon } from "@/components/ui/Icon";
import {
  Checkbox,
  CourseTag,
  EmptyState,
  Pagination,
  SearchField,
  Tabs,
  balanceVerdict,
  buttonClass,
  courseLevelOf,
  signedAmount,
  useTabParam,
  verdictText,
} from "@/features/console/ui";
import { AddSeatDialog } from "@/features/ops/classrooms/sections/SeatDialogs";
import { formatPhone } from "@/features/ops/people/format";
import { P } from "@/features/ops/permissions";
import { useCan } from "@/features/ops/useCan";
import {
  archiveKeys,
  useArchiveGroups,
  useArchiveStudents,
  type ArchiveFilter,
  type ArchiveTotals,
  type GroupQuery,
  type LeftStudentRow,
  type StudentQuery,
} from "./archiveApi";

/**
 * /ops/archive (lc-up structure canvas, Archive board, owner 22 Nov 2026): lc-up's Arxiv — the students who left a
 * group, and the groups that were archived. Read-only; a student comes back through the group's own Add.
 *
 * What lc-up's archive has and we do not keep is left out rather than made up: the reason a student left (nothing
 * records one), the balance on the day they left (only today's is kept — the column says "now"), archived staff,
 * deleted payments and expenses.
 */

type ArchiveTab = "students" | "groups";
const TABS: readonly ArchiveTab[] = ["students", "groups"];
const PAGE_SIZES = [25, 50, 100] as const;
const SOM = "so’m";

const CARD = "relative rounded-ms-card border border-ms-border bg-ms-card";
const CONTROL =
  "ms-transition h-(--ms-h-ctl) w-full rounded-ms-ctl border border-ms-border-input bg-ms-card px-3 text-[15px] text-ms-fg outline-none focus:border-ms-primary focus:shadow-[0_0_0_3px_var(--ms-primary-soft-2)]";
const TH = "px-3 text-left first:pl-4 last:pr-4";
const TD = "px-3 py-1.5 first:pl-4 last:pr-4";

/** "2026-11-13" → "13 Nov 2026". Parsed by hand: `new Date("2026-11-13")` is UTC midnight. */
export function dayText(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [year, mon, date] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !mon || !date) return iso;
  return new Date(year, mon - 1, date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function GroupLink({ id, name, level }: { id: number; name: string; level: string }) {
  return (
    <Link href={`/ops/classrooms/${id}`} prefetch={false} className="inline-flex max-w-full rounded-ms-badge focus-visible:outline-2 focus-visible:outline-ms-ring">
      <CourseTag level={courseLevelOf(level, name)} size="sm" title={name} className="max-w-[16rem]">
        {name}
      </CourseTag>
    </Link>
  );
}

function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-4 py-3 text-[14px]">
      <Icon name="alert" className="shrink-0 text-ms-critical-fg" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-ms-critical-fg">Could not load the archive.</span>{" "}
        <span className="text-ms-fg-2">Nothing was lost; try again in a moment. {formatApiErrorForToast(error)}</span>
      </span>
      <button type="button" onClick={onRetry} className={buttonClass({ variant: "secondary", size: "sm" })}>
        <Icon name="refresh" size="sm" />
        Retry
      </button>
    </div>
  );
}

function Loading() {
  return (
    <div role="status" aria-busy className="flex flex-col gap-3">
      <span className="sr-only">Loading…</span>
      <div className="h-64 animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
    </div>
  );
}

function FilterSelect({ filter, label, value, onChange }: { filter?: ArchiveFilter; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={cn(CONTROL, "sm:w-52")}>
      <option value="">{`All ${label.toLowerCase()}s`}</option>
      {(filter?.options ?? []).map((o) => (
        <option key={o.value} value={o.value}>
          {`${o.label} (${o.count})`}
        </option>
      ))}
    </select>
  );
}

/** Either tab's answer carries both tab counts; they go up to the tab row when they change. */
function useTotals(totals: ArchiveTotals | undefined, onTotals: (t: ArchiveTotals) => void) {
  const students = totals?.students;
  const groups = totals?.groups;
  useEffect(() => {
    if (students !== undefined && groups !== undefined) onTotals({ students, groups });
  }, [students, groups, onTotals]);
}

// ── students ─────────────────────────────────────────────────────────────

function StudentsTab({ onTotals }: { onTotals: (t: ArchiveTotals) => void }) {
  const can = useCan();
  const client = useQueryClient();
  const [query, setQuery] = useState<StudentQuery>({ q: "", classroom: "", teacher: "", owing: false, page: 1, pageSize: 50 });
  const [returning, setReturning] = useState<LeftStudentRow | null>(null);
  const q = useArchiveStudents(query);
  const data = q.data;
  useTotals(data?.totals, onTotals);
  const set = (patch: Partial<StudentQuery>) => setQuery((cur) => ({ ...cur, page: 1, ...patch }));
  const filter = (key: string) => data?.filters.find((f) => f.key === key);
  const money = Boolean(data?.money);
  const mayReturn = Boolean(data?.seats_open) && can(P.enroll);
  const filtered = Boolean(query.q.trim() || query.classroom || query.teacher || query.owing);

  return (
    <div className="flex flex-col gap-4">
      <div role="search" aria-label="Filter the students who left" className={cn(CARD, "flex flex-col gap-2 p-4 sm:flex-row sm:flex-wrap sm:items-center")}>
        <SearchField value={query.q} placeholder="Name or phone" onSearch={(text) => set({ q: text })} className="sm:max-w-sm sm:flex-1" />
        <FilterSelect label="Group" filter={filter("classroom")} value={query.classroom} onChange={(v) => set({ classroom: v })} />
        <FilterSelect label="Teacher" filter={filter("teacher")} value={query.teacher} onChange={(v) => set({ teacher: v })} />
        {money ? (
          <label className="flex min-h-10 cursor-pointer items-center gap-2.5 px-1 text-[14px] text-ms-fg">
            <Checkbox label="Owes money now" checked={query.owing} onChange={() => set({ owing: !query.owing })} />
            <span aria-hidden="true">Owes money now</span>
          </label>
        ) : null}
      </div>

      {q.isLoading ? (
        <Loading />
      ) : q.error || !data ? (
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} />
      ) : data.results.length === 0 ? (
        <div className={CARD}>
          {filtered ? (
            <EmptyState title="Nobody matches these filters" detail="Clear a filter to see more students." />
          ) : (
            <EmptyState icon="archive" title="Nobody has left a group" detail="A student appears here once their seat in a group ends." />
          )}
        </div>
      ) : (
        <div className={CARD}>
          <div className="overflow-x-auto">
            <table className={cn("w-full whitespace-nowrap text-ms-fg", money || mayReturn ? "min-w-[920px]" : "min-w-[760px]")}>
              <caption className="sr-only">Students who left a group, newest first</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Student</th>
                  <th scope="col" className={TH}>Left</th>
                  <th scope="col" className={TH}>In the group from</th>
                  <th scope="col" className={TH}>Date left</th>
                  {money ? (
                    <th scope="col" className={cn(TH, "text-right")} title="The lc-up balance today: the balance on the day they left is not kept.">
                      Balance now, {SOM}
                    </th>
                  ) : null}
                  {mayReturn ? (
                    <th scope="col" className={cn(TH, "w-0")}>
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {data.results.map((row) => {
                  const verdict = money ? balanceVerdict(row.balance) : undefined;
                  return (
                    <tr key={row.id}>
                      <td className={TD}>
                        <Link href={`/ops/${row.student.section}/${row.student.id}`} prefetch={false} className="font-semibold text-ms-fg hover:text-ms-primary-text hover:underline">
                          {row.student.name}
                        </Link>
                        {row.student.phone ? <div className="text-[13px] tabular-nums text-ms-fg-3">{formatPhone(row.student.phone)}</div> : null}
                      </td>
                      <td className={TD}>
                        <GroupLink id={row.group.id} name={row.group.name} level={row.group.level} />
                        {row.group.teacher ? <div className="text-[13px] text-ms-fg-3">{row.group.teacher}</div> : null}
                      </td>
                      <td className={cn(TD, "tabular-nums")}>{dayText(row.started_on)}</td>
                      <td className={TD}>
                        <div className="tabular-nums">{dayText(row.left_on)}</div>
                        {row.removed_by ? <div className="text-[13px] text-ms-fg-3">by {row.removed_by}</div> : null}
                      </td>
                      {money ? (
                        <td className={cn(TD, "text-right font-semibold tabular-nums", verdictText(verdict))} data-verdict={verdict}>
                          {row.balance === null || row.balance === undefined ? <span className="font-normal text-ms-fg-3">—</span> : signedAmount(row.balance)}
                        </td>
                      ) : null}
                      {mayReturn ? (
                        <td className={TD}>
                          {row.group.is_active ? (
                            <button type="button" onClick={() => setReturning(row)} className={buttonClass({ variant: "ghost", size: "sm" })} aria-label={`Return ${row.student.name} to ${row.group.name}`}>
                              <Icon name="undo" size="sm" />
                              Return
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data.page}
            pages={data.pages}
            count={data.count}
            pageSize={data.page_size}
            pageSizes={PAGE_SIZES}
            noun={{ singular: "student", plural: "students" }}
            hrefFor={(p) => `?page=${p}`}
            onPage={(p) => setQuery((cur) => ({ ...cur, page: p }))}
            onPageSize={(size) => set({ pageSize: size })}
          />
        </div>
      )}

      {returning ? (
        <AddSeatDialog
          roomId={returning.group.id}
          student={{ id: returning.student.id, name: returning.student.name }}
          onClose={() => setReturning(null)}
          onDone={() => {
            setReturning(null);
            void client.invalidateQueries({ queryKey: archiveKeys.all });
          }}
        />
      ) : null}
    </div>
  );
}

// ── groups ───────────────────────────────────────────────────────────────

function GroupsTab({ onTotals }: { onTotals: (t: ArchiveTotals) => void }) {
  const [query, setQuery] = useState<GroupQuery>({ q: "", page: 1, pageSize: 50 });
  const q = useArchiveGroups(query);
  const data = q.data;
  useTotals(data?.totals, onTotals);

  return (
    <div className="flex flex-col gap-4">
      <div role="search" aria-label="Filter the archived groups" className={cn(CARD, "p-4")}>
        <SearchField value={query.q} placeholder="Group or teacher" onSearch={(text) => setQuery((cur) => ({ ...cur, q: text, page: 1 }))} className="sm:max-w-sm" />
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error || !data ? (
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} />
      ) : data.results.length === 0 ? (
        <div className={CARD}>
          {query.q.trim() ? (
            <EmptyState title="No archived group matches" detail="Try another name." />
          ) : (
            <EmptyState icon="archive" title="No archived groups" detail="A group appears here once it is archived." />
          )}
        </div>
      ) : (
        <div className={CARD}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] whitespace-nowrap text-ms-fg">
              <caption className="sr-only">Archived groups, the most recently archived first</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Group</th>
                  <th scope="col" className={TH}>Teacher</th>
                  <th scope="col" className={TH}>Started</th>
                  <th scope="col" className={TH}>Opened here</th>
                  <th scope="col" className={TH}>Archived</th>
                  <th scope="col" className={cn(TH, "text-right")}>Students who left</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((g) => (
                  <tr key={g.id}>
                    <td className={TD}>
                      <GroupLink id={g.id} name={g.name} level={g.level} />
                    </td>
                    <td className={cn(TD, "text-ms-fg-2")}>{g.teacher || <span className="text-ms-fg-3">—</span>}</td>
                    <td className={cn(TD, "tabular-nums")}>{dayText(g.start_date)}</td>
                    <td className={cn(TD, "tabular-nums")}>{dayText(g.created_at)}</td>
                    <td className={cn(TD, "tabular-nums")}>
                      {g.archived_on ? (
                        dayText(g.archived_on)
                      ) : (
                        <span className="text-ms-fg-3" title="Archived by hand: the day was not kept.">
                          —
                        </span>
                      )}
                    </td>
                    <td className={cn(TD, "text-right tabular-nums")}>{g.left}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data.page}
            pages={data.pages}
            count={data.count}
            pageSize={data.page_size}
            pageSizes={PAGE_SIZES}
            noun={{ singular: "group", plural: "groups" }}
            hrefFor={(p) => `?tab=groups&page=${p}`}
            onPage={(p) => setQuery((cur) => ({ ...cur, page: p }))}
            onPageSize={(size) => setQuery((cur) => ({ ...cur, pageSize: size, page: 1 }))}
          />
        </div>
      )}
    </div>
  );
}

// ── the page ─────────────────────────────────────────────────────────────

const LABEL: Record<ArchiveTab, string> = { students: "Students", groups: "Groups" };

export function ArchivePage() {
  const [tab, setTab] = useTabParam(TABS, "students");
  const [totals, setTotals] = useState<ArchiveTotals | null>(null);
  return (
    <div className="flex flex-col gap-5">
      <header className="animate-ms-fade-in flex flex-wrap items-center gap-3">
        <h1 className="text-ms-title text-ms-fg">Archive</h1>
      </header>
      <Tabs<ArchiveTab>
        label="Archive sections"
        idPrefix="archive"
        value={tab}
        onChange={setTab}
        tree
        tabs={TABS.map((id) => ({ id, label: LABEL[id], count: totals ? totals[id] : undefined }))}
      />
      <div role="tabpanel" id={`archive-${tab}-panel`} aria-labelledby={`archive-${tab}`} className="min-w-0 pt-2">
        {tab === "students" ? <StudentsTab onTotals={setTotals} /> : <GroupsTab onTotals={setTotals} />}
      </div>
    </div>
  );
}
