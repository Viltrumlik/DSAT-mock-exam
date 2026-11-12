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
import { Fieldset, Pill, Row } from "./Fieldset";
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
  yes ? <Pill tone="positive">{good}</Pill> : <Pill tone="attention">{bad}</Pill>;

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
              <Pill>{staff.lcup_teacher.name}</Pill>
            ) : (
              <Pill tone="line">Not linked</Pill>
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
                    <Pill key={g.id}>
                      {g.name}
                    </Pill>
                  ))}
                </span>
              ) : (
                <Pill tone="attention">Not in any class</Pill>
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
        {person.email ? yesNo(person.email_verified, "Verified", "Not verified") : <span className="text-ms-fg-3">None</span>}
      </Row>
      <Row label="Telegram" icon={Send}>
        {person.telegram_linked ? <Pill tone="positive">Linked</Pill> : <Pill tone="line">Not linked</Pill>}
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
                <span className="block text-xs font-normal text-ms-fg-3">set by the student</span>
              </Row>
            </>
          ) : null}
        </>
      )}
    </Fieldset>
  );
}
