"use client";

import Link from "next/link";
import { Briefcase, Link2, School } from "lucide-react";
import { Badge } from "@/components/ui";
import { Fieldset, LINK_CLASS, Row, Table, Td, WIDE_ONLY } from "../Fieldset";
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
    <Fieldset title="Classes" icon={School} description="Classes they teach, or help in as a support teacher">
      <div>
        <Row label="lc-up teacher" icon={Link2}>
          {lcupTeacherText(staff.lcup_teacher)}
        </Row>
        <Row label="Workload" icon={Briefcase}>
          {[plural(w.classes, "class", "classes"), plural(w.students, "student", "students"), `${w.to_review.toLocaleString("en-US")} to review`].join(" · ")}
        </Row>
      </div>
      <div className="mt-5">
        {staff.classes.length === 0 ? (
          <p className="rounded-lg bg-surface-2 px-4 py-3 text-muted-foreground">No classes.</p>
        ) : (
          <Table head={["Class", "As", "Students", { label: "lc-up", className: WIDE_ONLY }]}>
            {staff.classes.map((c) => (
              <tr key={`${c.id}-${c.as}`}>
                <Td className="max-w-[9rem] truncate sm:max-w-[14rem]">
                  <Link href={`/ops/classrooms/${c.id}`} prefetch={false} className={LINK_CLASS}>
                    {c.name}
                  </Link>
                </Td>
                <Td>{c.as === "ta" ? <Badge variant="accent">TA</Badge> : <Badge variant="primary">Teacher</Badge>}</Td>
                <Td className="font-semibold tabular-nums">{c.students}</Td>
                <Td className={WIDE_ONLY}>
                  {c.lcup_managed ? <Badge variant="info">Synced</Badge> : <span className="text-muted-foreground">—</span>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </Fieldset>
  );
}
