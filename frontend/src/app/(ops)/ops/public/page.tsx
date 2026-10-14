"use client";

import type { ChangeListColumn } from "@/features/ops/changelist/ChangeList";
import type { PublicRow } from "@/features/ops/changelist/peopleApi";
import { PeopleList } from "@/features/ops/users/PeopleList";
import { joinedColumn, lastSeenColumn, nameColumn, statusColumn } from "@/features/ops/users/peopleColumns";

/** Learners who signed up on the site and are not at the centre (role `public_student`). */
const COLUMNS: ChangeListColumn<PublicRow>[] = [
  nameColumn<PublicRow>(),
  {
    key: "email",
    label: "Email",
    render: (r) =>
      r.email ? (
        <>
          {r.email}
          {r.email_verified ? (
            <span className="ml-1 text-muted-foreground" title="Email verified" aria-label="verified">
              ✓
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "phone",
    label: "Phone",
    render: (r) => (r.phone ? <span className="tabular-nums">{r.phone}</span> : <span className="text-muted-foreground">—</span>),
  },
  statusColumn<PublicRow>(),
  joinedColumn<PublicRow>(),
  lastSeenColumn<PublicRow>(),
];

export default function OpsPublicUsersPage() {
  return (
    <PeopleList
      section="public"
      title="Public users"
      noun={{ singular: "public user", plural: "public users" }}
      columns={COLUMNS}
      bulk={["freeze", "unfreeze", "delete"]}
      searchPlaceholder="Search name, username, email or phone"
    />
  );
}
