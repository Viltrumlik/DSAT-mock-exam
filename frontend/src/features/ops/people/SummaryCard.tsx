"use client";

import Link from "next/link";
import { formatUzs } from "@/features/finance/financeApi";
import { formatDate, formatLastSeen } from "@/features/ops/users/peopleColumns";
import { Fieldset, LINK_CLASS, Row } from "./Fieldset";
import { formatDay, LIST_LABEL, statusText } from "./format";
import type { PersonCore } from "./personApi";

/**
 * The Overview's read-only side: who this is at a glance, from the page's own payload (no part is
 * fetched for it). Same-name accounts head it — the duplicate accounts the owner keeps untangling.
 */

const SUBJECT_LABEL: Record<string, string> = { math: "Math", english: "English", both: "Both" };

/** "EN 650 · Math 700 · Total 1350" — only the parts the student has set. */
function targetsText(sat: PersonCore["sat"]): string {
  const parts = [
    sat.target_english != null ? `EN ${sat.target_english}` : null,
    sat.target_math != null ? `Math ${sat.target_math}` : null,
    sat.target_score != null ? `Total ${sat.target_score}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function SameName({ person }: { person: PersonCore }) {
  const n = person.duplicates.length;
  if (n === 0) return null;
  return (
    <div className="mb-2 border-b border-border pb-2" data-testid="same-name">
      <p className="text-foreground">
        Same name as {n} other account{n === 1 ? "" : "s"}
      </p>
      <ul className="mt-1 space-y-0.5">
        {person.duplicates.map((d) => (
          <li key={d.id} className="min-w-0 truncate">
            <Link href={`/ops/${d.section}/${d.id}`} prefetch={false} className={LINK_CLASS}>
              {d.name || d.username || `User ${d.id}`}
            </Link>
            <span className="text-muted-foreground">
              {" "}
              · {LIST_LABEL[d.section] ?? d.section}
              {d.groups.length > 0 ? ` · ${d.groups.join(", ")}` : ""} · last seen {formatLastSeen(d.last_seen)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SummaryCard({ person }: { person: PersonCore }) {
  const staff = person.staff;
  return (
    <Fieldset title="Summary">
      <SameName person={person} />
      <Row label="Status">{statusText(person)}</Row>

      {staff ? (
        <>
          <Row label="Subject">{SUBJECT_LABEL[person.subject] ?? (person.subject || "—")}</Row>
          <Row label="Classes">
            {staff.workload.classes} · {staff.workload.students} student{staff.workload.students === 1 ? "" : "s"}
          </Row>
          <Row label="To review">{staff.workload.to_review}</Row>
          <Row label="lc-up teacher">{staff.lcup_teacher ? staff.lcup_teacher.name : "Not linked"}</Row>
        </>
      ) : (
        <>
          {person.section === "students" ? (
            <Row label="Groups">
              {person.groups.length > 0 ? person.groups.map((g) => g.name).join(", ") : "Not in any class"}
            </Row>
          ) : person.past_groups.length > 0 ? (
            <Row label="Earlier groups">{person.past_groups.map((g) => g.name).join(", ")}</Row>
          ) : null}
          {person.lcup ? (
            <Row label="Balance">
              {person.lcup.balance === null ? (
                "—"
              ) : person.lcup.balance < 0 ? (
                <span className="tabular-nums text-danger">Owes {formatUzs(-person.lcup.balance)}</span>
              ) : (
                "Paid up"
              )}
            </Row>
          ) : null}
        </>
      )}

      <Row label="Last seen">{formatLastSeen(person.last_seen)}</Row>
      <Row label="Joined">{formatDate(person.date_joined)}</Row>
      <Row label="Email verified">{person.email_verified ? "Yes" : "No"}</Row>
      <Row label="Telegram">{person.telegram_linked ? "Linked" : "Not linked"}</Row>

      {staff ? null : (
        <>
          <Row label="Created by lc-up">{person.lcup_created ? "Yes" : "No"}</Row>
          <Row label="SAT exam date">{formatDay(person.sat.exam_date)}</Row>
          <Row label="Targets">
            {targetsText(person.sat)} <span className="text-xs text-muted-foreground">· set by the student</span>
          </Row>
        </>
      )}
    </Fieldset>
  );
}
