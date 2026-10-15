"use client";

import Link from "next/link";
import type { PeopleSection } from "@/features/ops/changelist/peopleApi";
import { formatLastSeen, statusLabel } from "@/features/ops/users/peopleColumns";
import { Fieldset, LINK_CLASS, Table, Td, WIDE_ONLY } from "../Fieldset";
import type { PersonDuplicate } from "../personApi";

/** Other learner accounts with the same first and last name. Nothing at all when there are none. */

export const LIST_LABEL: Record<PeopleSection, string> = { students: "Students", public: "Public users", staff: "Staff" };

export function DuplicatesSection({ duplicates }: { duplicates: PersonDuplicate[] }) {
  if (duplicates.length === 0) return null;
  return (
    <Fieldset title="Same-name accounts">
      <Table
        head={[
          "Name",
          { label: "Username", className: WIDE_ONLY },
          "List",
          { label: "Status", className: WIDE_ONLY },
          { label: "Groups", className: WIDE_ONLY },
          "Last seen",
        ]}
      >
        {duplicates.map((d) => (
          <tr key={d.id}>
            <Td className="max-w-[7rem] truncate sm:max-w-[14rem]">
              <Link href={`/ops/${d.section}/${d.id}`} prefetch={false} className={LINK_CLASS}>
                {d.name || d.username || `User ${d.id}`}
              </Link>
            </Td>
            <Td className={`${WIDE_ONLY} text-muted-foreground`}>{d.username || "—"}</Td>
            <Td>{LIST_LABEL[d.section] ?? d.section}</Td>
            <Td className={WIDE_ONLY}>{statusLabel(d.status)}</Td>
            <Td className={`${WIDE_ONLY} max-w-[14rem] truncate text-muted-foreground`}>{d.groups.join(", ") || "—"}</Td>
            <Td className="tabular-nums text-muted-foreground">{formatLastSeen(d.last_seen)}</Td>
          </tr>
        ))}
      </Table>
    </Fieldset>
  );
}
