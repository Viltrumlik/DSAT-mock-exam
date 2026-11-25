"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";

import { RollNumber } from "@/features/console/RollNumber";
import { toast } from "@/features/console/toast";
import { Badge, CourseTag, DemoBadge, Menu, balanceVerdict, signedAmount, type MenuItem } from "@/features/console/ui";
import { FacetSelect, FilterText, QuickChips, facetCount, type QuickChip } from "@/features/ops/changelist/BoardFields";
import { withListFilters } from "@/features/ops/changelist/backLink";
import type { ChangeListAction, ChangeListColumn, ChangeListFilter } from "@/features/ops/changelist/ChangeList";
import {
  PEOPLE_FILTER_KEYS,
  usePeople,
  type StudentGroupCell,
  type StudentRow,
} from "@/features/ops/changelist/peopleApi";
import { useChangeListParams, type ChangeListPatch } from "@/features/ops/changelist/useChangeListParams";
import { formatPhone } from "@/features/ops/people/format";
import { P } from "@/features/ops/permissions";
import { useCan } from "@/features/ops/useCan";
import { PeopleList } from "@/features/ops/users/PeopleList";
import { statusLabel } from "@/features/ops/users/peopleColumns";
import { courseOf, groupLabel, groupLevel } from "./format";
import { QuickCard } from "./QuickCard";

/**
 * /ops/students in lc-up's shape (canvas board "Students", owner 22 Nov 2026): the title with the total and rows per
 * page; the chips All / Owe money / Demo / Frozen / No group; a filter card; the ruled table — #, the student, the
 * phone, each group as a course tag with its room, the signed balance, the teachers, a ⋮ menu; the bulk bar. A group
 * chip opens the student's quick card. Everything is the people list's own data (users/views_people.py).
 */

const KEYS = PEOPLE_FILTER_KEYS.students;

/** "Bekzod Toshmatov" → its last word, for a group named without lc-up's teacher. */
function surname(teacher: StudentGroupCell["teacher"]): string {
  if (!teacher) return "";
  return teacher.last_name || teacher.name.split(" ").slice(-1)[0] || "";
}

/** The facets in force, in words: `Teacher “Vali Aliyev”`. */
function inForce(filters: ChangeListFilter[] | undefined, active: Record<string, string>, q: string): string[] {
  const out = q ? [`the search “${q}”`] : [];
  for (const [key, value] of Object.entries(active)) {
    if (key === "show" && value === "all") continue;
    const f = filters?.find((x) => x.key === key);
    const label = f?.options.find((o) => o.value === value)?.label ?? value;
    // A chip is named by itself ("“Frozen”"); a field by its name and value.
    const name = key === "show" ? "" : (f?.label ?? (key === "phone" ? "Phone" : key === "parent_phone" ? "Parent phone" : key));
    out.push(`${name} “${label}”`.trim());
  }
  if (out[0]) out[0] = out[0].charAt(0).toUpperCase() + out[0].slice(1);
  return out;
}

export function StudentsList() {
  // useSearchParams needs a Suspense boundary above it, or the production build's prerender fails.
  return (
    <Suspense fallback={null}>
      <StudentsListInner />
    </Suspense>
  );
}

function StudentsListInner() {
  const can = useCan();
  const money = can(P.viewMoney);
  const sms = can(P.sendSms);
  const router = useRouter();
  const { params, queryString, hrefFor, update } = useChangeListParams(KEYS);
  // The same query PeopleList draws from (same key): the chips and selects read its facets, no second request.
  const query = usePeople("students", params);
  const filters = query.data?.filters;
  const facet = (key: string) => filters?.find((f) => f.key === key);
  const [quick, setQuick] = useState<{ row: StudentRow; group: StudentGroupCell } | null>(null);

  const active = params.filters;
  const show = active.show && active.show !== "all" ? active.show : null;
  const narrowed = Boolean(params.q) || Object.keys(active).some((k) => !(k === "show" && active[k] === "all"));
  const pick = (key: string) => (value: string | null) => update({ [key]: value });

  const clear = () => {
    const before: ChangeListPatch = { q: params.q || null, ...active };
    const patch: ChangeListPatch = Object.fromEntries([...KEYS, "q"].map((k) => [k, null]));
    update(patch);
    toast.show({ icon: "filter", message: "Cleared the filters", undo: () => update(before) });
  };

  const chip = (value: string | null, label: string, dot?: string): QuickChip => ({
    key: value ?? "all",
    label,
    count: facetCount(filters, "show", value ?? "all"),
    on: show === value,
    href: hrefFor({ show: value }),
    onPick: () => update({ show: value }),
    dot,
  });
  const chips: QuickChip[] = [
    chip(null, "All"),
    // Who owes is money: the chip is `view_money`'s, as the balance is.
    ...(money ? [chip("owes", "Owe money", "var(--ms-critical)")] : []),
    chip("trial", "Demo", "var(--ms-attention)"),
    chip("frozen", "Frozen", "var(--ms-frozen)"),
    chip("nogroup", "No group", "var(--ms-neutral)"),
  ];

  const fields = (
    <>
      <FilterText value={params.q} placeholder="Name" icon="search" onCommit={(q) => update({ q })} />
      <FilterText value={active.phone ?? ""} placeholder="Phone" icon="phone" inputMode="tel" onCommit={pick("phone")} />
      <FilterText value={active.parent_phone ?? ""} placeholder="Parent phone" inputMode="tel" onCommit={pick("parent_phone")} />
      <FacetSelect filter={facet("group")} label="Group" selected={active.group ?? null} onPick={pick("group")} />
      <FacetSelect filter={facet("course")} label="Course" selected={active.course ?? null} onPick={pick("course")} />
      <FacetSelect filter={facet("teacher")} label="Teacher" selected={active.teacher ?? null} onPick={pick("teacher")} />
    </>
  );

  // The list's other filters (before the board): kept, after the board's own.
  const moreKeys = ["status", "lcup", "debt", "dupes", "signin"];
  const moreFields = (
    <>
      <FacetSelect filter={facet("status")} label="Account" anyLabel="Any account" selected={active.status ?? null} onPick={pick("status")} />
      <FacetSelect filter={facet("lcup")} label="lc-up" anyLabel="Linked or not" selected={active.lcup ?? null} onPick={pick("lcup")} />
      {money ? (
        <FacetSelect
          filter={facet("debt")}
          label="Balance"
          anyLabel="Any balance"
          selected={active.debt ?? null}
          onPick={pick("debt")}
          // Balances are numbers, never words (owner, 22 Nov 2026).
          optionLabel={(v, l) => (v === "owes" ? "Below 0" : v === "clear" ? "0 or above" : l)}
        />
      ) : null}
      <FacetSelect filter={facet("dupes")} label="Duplicates" anyLabel="Any name" selected={active.dupes ?? null} onPick={pick("dupes")} />
      <FacetSelect filter={facet("signin")} label="Signed in" anyLabel="Signed in or not" selected={active.signin ?? null} onPick={pick("signin")} />
    </>
  );

  const columns: ChangeListColumn<StudentRow>[] = [
    {
      key: "name",
      label: "Student",
      sortKey: "name",
      className: "max-w-[16rem]",
      render: (r) => r.name || r.username || `User ${r.id}`,
      renderLinked: (r, link) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{link(r.name || r.username || `User ${r.id}`)}</span>
            {r.is_demo_only ? <DemoBadge className="shrink-0" /> : null}
          </span>
          {/* lc-up's second line: whom to call (owner, 22 Nov 2026: "Ha, chiqsin"). */}
          {r.parent_phone ? (
            <span data-parent-phone className="mt-[3px] truncate text-[13px] text-ms-fg-3 tabular-nums">
              Parent {formatPhone(r.parent_phone)}
            </span>
          ) : null}
          {r.is_frozen ? <span className="truncate text-[13px] text-ms-frozen-fg">{statusLabel(r.status, true)}</span> : null}
        </span>
      ),
    },
    {
      key: "phone",
      label: "Phone",
      render: (r) => (r.phone ? <span className="tabular-nums">{formatPhone(r.phone)}</span> : <span className="text-ms-fg-3">—</span>),
    },
    {
      key: "groups",
      label: "Groups",
      interactive: true,
      render: (r) =>
        r.groups.length === 0 ? (
          <span className="text-ms-fg-3">No group</span>
        ) : (
          <span className="flex flex-col items-start gap-1">
            {r.groups.map((g) => (
              // Wraps between the tag and the room before the table outgrows its card.
              <span key={g.id} className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  title="Open the quick card"
                  onClick={() => setQuick({ row: r, group: g })}
                  className="ms-press max-w-full rounded-ms-badge focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ms-primary"
                >
                  <CourseTag level={groupLevel(g.level, g.name)}>{groupLabel(g.name, g.subject, surname(g.teacher))}</CourseTag>
                </button>
                {g.seat_status === "trial" ? <DemoBadge /> : null}
                {g.seat_status === "frozen" ? <Badge tone="frozen">Frozen</Badge> : null}
                {g.room ? <span className="text-[13px] text-ms-fg-3">Room {g.room}</span> : null}
              </span>
            ))}
          </span>
        ),
    },
    ...(money
      ? [
          {
            key: "balance",
            label: "Balance, so’m",
            // Most owed first (lc-up's balance is negative for a debt), and back.
            sortKeys: { desc: "debt" },
            className: "text-right",
            verdict: (r: StudentRow) => balanceVerdict(r.lcup.balance),
            render: (r: StudentRow) =>
              r.lcup.balance === null ? (
                <span className="text-ms-fg-3">—</span>
              ) : (
                <RollNumber value={signedAmount(r.lcup.balance)} className="font-semibold tabular-nums" />
              ),
          } satisfies ChangeListColumn<StudentRow>,
        ]
      : []),
    {
      key: "teachers",
      label: "Teachers",
      render: (r) => {
        const lines = [
          ...new Map(
            r.groups
              .filter((g) => g.teacher)
              .map((g) => {
                const course = courseOf(g.level, g.name, g.subject);
                return [`${g.teacher!.id}:${course}`, { name: g.teacher!.name, course }] as const;
              }),
          ).values(),
        ];
        if (!lines.length) return <span className="text-ms-fg-3">—</span>;
        return (
          <span className="flex flex-col gap-0.5">
            {lines.map((t) => (
              // The course drops under the name, never mid-word, when the table runs out of room.
              <span key={`${t.name}:${t.course}`} className="whitespace-normal">
                <span className="whitespace-nowrap">{t.name}</span>{" "}
                {t.course ? <span className="inline-block whitespace-nowrap text-[13px] text-ms-fg-3">{t.course}</span> : null}
              </span>
            ))}
          </span>
        );
      },
    },
    {
      key: "actions",
      label: "Actions",
      hideLabel: true,
      interactive: true,
      className: "w-px",
      render: (r) => {
        const items: MenuItem[] = [
          { label: "Open student page", icon: "user", href: withListFilters(`/ops/students/${r.id}`, queryString) },
          ...(sms ? [{ label: "Send SMS", icon: "msg" as const, href: `/ops/sms/campaigns/new?student=${r.id}` }] : []),
          ...r.groups.map((g) => ({ label: `Open ${groupLabel(g.name, g.subject, surname(g.teacher))}`, icon: "layers" as const, href: `/ops/classrooms/${g.id}` })),
        ];
        return <Menu label={`Actions for ${r.name || r.username}`} items={items} />;
      },
    },
  ];

  // The SMS composer opens with the ticked students (`?student=` for one, `?students=` for several).
  const extraActions: ChangeListAction[] = sms
    ? [
        {
          key: "sms",
          label: "Send SMS to the selected students",
          short: "Send SMS",
          icon: "msg",
          run: (ids) => {
            router.push(`/ops/sms/campaigns/new?${ids.length === 1 ? `student=${ids[0]}` : `students=${ids.join(",")}`}`);
            return false;
          },
        },
      ]
    : [];

  const on = inForce(filters, active, params.q);
  return (
    <>
      <PeopleList
        section="students"
        title="Students"
        noun={{ singular: "student", plural: "students" }}
        columns={columns}
        bulk={["freeze", "unfreeze", "delete"]}
        extraActions={extraActions}
        board={{
          chips: <QuickChips label="Show" chips={chips} />,
          filters: fields,
          moreFilters: moreFields,
          moreActive: moreKeys.filter((k) => active[k]).length,
          narrowed,
          onClear: clear,
          numbered: true,
          minWidthClass: "min-w-[1040px]",
          errorTitle: "Could not load students.",
          emptyTitle: narrowed ? "No students match these filters" : "No students yet",
          emptyDetail: on.length
            ? `${on.length > 1 ? `${on.slice(0, -1).join(", ")} and ${on.at(-1)}` : on[0]} ${on.length === 1 ? "is" : "are"} on. Remove one of them, or clear them all.`
            : undefined,
        }}
      />
      {quick ? <QuickCard student={quick.row} group={quick.group} showMoney={money} onClose={() => setQuick(null)} /> : null}
    </>
  );
}
