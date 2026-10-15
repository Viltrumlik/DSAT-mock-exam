"use client";

import type { ChangeListColumn } from "@/features/ops/changelist/ChangeList";
import type { StaffRow } from "@/features/ops/changelist/peopleApi";
import { ROLE_LABELS, type CanonicalRole } from "@/lib/roles";
import { PeopleList } from "@/features/ops/users/PeopleList";
import { joinedColumn, lastSeenColumn, nameColumn, statusColumn } from "@/features/ops/users/peopleColumns";

const SUBJECT_LABELS: Record<string, string> = { math: "Math", english: "English", both: "Both" };

/** Everyone who is not a learner: teachers, support teachers, test staff and admins. */
const COLUMNS: ChangeListColumn<StaffRow>[] = [
  nameColumn<StaffRow>(),
  {
    key: "role",
    label: "Role",
    render: (r) => ROLE_LABELS[r.role as CanonicalRole] ?? r.role,
  },
  {
    key: "subject",
    label: "Subject",
    render: (r) =>
      r.subject ? SUBJECT_LABELS[r.subject] ?? r.subject : <span className="text-muted-foreground">—</span>,
  },
  {
    key: "email",
    label: "Email",
    render: (r) => r.email || <span className="text-muted-foreground">—</span>,
  },
  statusColumn<StaffRow>(),
  joinedColumn<StaffRow>(),
  lastSeenColumn<StaffRow>(),
];

export default function OpsStaffPage() {
  return (
    <PeopleList
      section="staff"
      title="Staff"
      noun={{ singular: "staff member", plural: "staff" }}
      columns={COLUMNS}
      // No delete here: a staff account usually owns classrooms or question banks.
      bulk={["freeze", "unfreeze"]}
      searchPlaceholder="Search name, username, email or phone"
    />
  );
}
