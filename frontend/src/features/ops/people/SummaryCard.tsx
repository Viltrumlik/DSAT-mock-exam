"use client";

import {
  BookOpen,
  Fingerprint,
  GraduationCap,
  Link2,
  Mail,
  Send,
  Target,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui";
import { Fieldset, Row } from "./Fieldset";
import { formatDay } from "./format";
import type { PersonCore } from "./personApi";

/**
 * The Overview's read-only side: the account's facts with an icon each, and the ones that carry a
 * verdict in colour (an unverified email, a missing Telegram). The balance and the day they joined
 * are in the header's figures right above, so they are not said twice. Nothing here is fetched: it
 * is the page's own payload.
 */

/** As the form's Subject select says it, so the two halves of the Overview agree. */
const SUBJECT_LABEL: Record<string, string> = { math: "Mathematics", english: "English", both: "Both" };

/** "EN 650 · Math 700 · Total 1350" — only the parts the student has set. */
function targetsText(sat: PersonCore["sat"]): string {
  const parts = [
    sat.target_english != null ? `EN ${sat.target_english}` : null,
    sat.target_math != null ? `Math ${sat.target_math}` : null,
    sat.target_score != null ? `Total ${sat.target_score}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function hasSatGoal(sat: PersonCore["sat"]): boolean {
  return [sat.exam_date, sat.target_score, sat.target_english, sat.target_math].some((v) => v != null);
}

const yesNo = (yes: boolean, good: string, bad: string) =>
  yes ? <Badge variant="success">{good}</Badge> : <Badge variant="warning">{bad}</Badge>;

export function SummaryCard({ person }: { person: PersonCore }) {
  const staff = person.staff;
  const student = person.section === "students";
  return (
    <Fieldset title="Summary" icon={Fingerprint} tone="accent" description="The account at a glance">
      {staff ? (
        <>
          <Row label="Subject" icon={BookOpen}>
            {SUBJECT_LABEL[person.subject] ?? (person.subject || "—")}
          </Row>
          <Row label="Classes" icon={Users}>
            {staff.workload.classes} · {staff.workload.students} student{staff.workload.students === 1 ? "" : "s"}
          </Row>
          <Row label="lc-up teacher" icon={Link2}>
            {staff.lcup_teacher ? (
              <Badge variant="neutral">{staff.lcup_teacher.name}</Badge>
            ) : (
              <Badge variant="outline">Not linked</Badge>
            )}
          </Row>
        </>
      ) : (
        <>
          {student ? (
            <Row label="Groups" icon={Users}>
              {person.groups.length > 0 ? (
                <span className="inline-flex flex-wrap justify-end gap-1">
                  {person.groups.map((g) => (
                    <Badge key={g.id} variant="primary">
                      {g.name}
                    </Badge>
                  ))}
                </span>
              ) : (
                <Badge variant="warning">Not in any class</Badge>
              )}
            </Row>
          ) : person.past_groups.length > 0 ? (
            <Row label="Earlier groups" icon={Users}>
              {person.past_groups.map((g) => g.name).join(", ")}
            </Row>
          ) : null}
        </>
      )}

      <Row label="Email" icon={Mail}>
        {person.email ? yesNo(person.email_verified, "Verified", "Not verified") : <span className="text-muted-foreground">None</span>}
      </Row>
      <Row label="Telegram" icon={Send}>
        {person.telegram_linked ? <Badge variant="success">Linked</Badge> : <Badge variant="outline">Not linked</Badge>}
      </Row>

      {/* A centre student always shows these; a public user only what is there — a "No" and two
          dashes say nothing about someone who never studied here. */}
      {staff ? null : (
        <>
          {student || person.lcup_created ? (
            <Row label="Created by lc-up" icon={Link2}>
              {person.lcup_created ? "Yes" : "No"}
            </Row>
          ) : null}
          {student || hasSatGoal(person.sat) ? (
            <>
              <Row label="SAT exam date" icon={GraduationCap}>
                {formatDay(person.sat.exam_date)}
              </Row>
              <Row label="Targets" icon={Target}>
                {targetsText(person.sat)}
                <span className="block text-xs font-normal text-muted-foreground">set by the student</span>
              </Row>
            </>
          ) : null}
        </>
      )}
    </Fieldset>
  );
}
