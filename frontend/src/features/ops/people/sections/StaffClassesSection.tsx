"use client";

import Link from "next/link";
import { Fieldset, LINK_CLASS, Row, Table, Td } from "../Fieldset";
import type { PersonStaff } from "../personApi";

/** A staff member's classes — taught, or helped in as a TA — and what is waiting on them. */

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function lcupTeacherText(link: PersonStaff["lcup_teacher"]): string {
  if (!link) return "Not linked";
  const status = link.status === "confirmed" || link.status === "auto" ? "linked" : link.status.replace(/_/g, " ");
  return [link.name, status].filter(Boolean).join(" · ");
}

export function StaffClassesSection({ staff }: { staff: PersonStaff }) {
  const w = staff.workload;
  return (
    <Fieldset title="Classes">
      <div>
        <Row label="lc-up teacher">{lcupTeacherText(staff.lcup_teacher)}</Row>
        <Row label="Workload">
          {[plural(w.classes, "class", "classes"), plural(w.students, "student", "students"), `${w.to_review.toLocaleString("en-US")} to review`].join(" · ")}
        </Row>
      </div>
      <div className="mt-3">
        {staff.classes.length === 0 ? (
          <p className="text-muted-foreground">No classes.</p>
        ) : (
          <Table head={["Class", "As", "Students", "lc-up"]}>
            {staff.classes.map((c) => (
              <tr key={`${c.id}-${c.as}`}>
                <Td className="max-w-[14rem] truncate">
                  <Link href={`/ops/classrooms/${c.id}`} prefetch={false} className={LINK_CLASS}>
                    {c.name}
                  </Link>
                </Td>
                <Td>{c.as === "ta" ? "TA" : "Teacher"}</Td>
                <Td className="tabular-nums">{c.students}</Td>
                <Td className="text-muted-foreground">{c.lcup_managed ? "Yes" : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </Fieldset>
  );
}
