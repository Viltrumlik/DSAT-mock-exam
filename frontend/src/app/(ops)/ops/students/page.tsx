"use client";

import type { ChangeListColumn } from "@/features/ops/changelist/ChangeList";
import type { StudentRow } from "@/features/ops/changelist/peopleApi";
import { formatUzs } from "@/features/finance/financeApi";
import { PeopleList } from "@/features/ops/users/PeopleList";
import {
  joinedColumn,
  lastSeenColumn,
  nameColumn,
  statusColumn,
  Truncated,
} from "@/features/ops/users/peopleColumns";

/** The learning centre's students (role `student`): groups, the lc-up link and what they owe. */
const COLUMNS: ChangeListColumn<StudentRow>[] = [
  nameColumn<StudentRow>(),
  {
    key: "groups",
    label: "Groups",
    render: (r) => (
      <Truncated text={r.groups.map((g) => g.name).join(", ")} className="max-w-[8rem] min-[1440px]:max-w-[11rem]" />
    ),
  },
  {
    key: "lcup",
    label: "lc-up",
    // Below 1440px the column gives way so "Last seen" fits; the "By lc-up" filter still says it.
    className: "hidden min-[1440px]:table-cell",
    render: (r) =>
      r.lcup.linked ? (
        <span title="Linked to lc-up" aria-label="Linked">
          ✓
        </span>
      ) : (
        <span className="text-muted-foreground" aria-label="Not linked">
          —
        </span>
      ),
  },
  {
    key: "debt",
    label: "Debt",
    // Most owed first; lc-up's balance is negative for a debt, so the server's `debt` is ascending.
    sortKeys: { desc: "debt" },
    className: "text-right",
    render: (r) =>
      r.lcup.balance !== null && r.lcup.balance < 0 ? (
        <span className="tabular-nums text-danger">{formatUzs(-r.lcup.balance)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  statusColumn<StudentRow>(),
  joinedColumn<StudentRow>(),
  lastSeenColumn<StudentRow>(),
];

export default function OpsStudentsPage() {
  return (
    <PeopleList
      section="students"
      title="Students"
      noun={{ singular: "student", plural: "students" }}
      columns={COLUMNS}
      bulk={["freeze", "unfreeze", "delete"]}
      searchPlaceholder="Search name, username, email or phone"
    />
  );
}
