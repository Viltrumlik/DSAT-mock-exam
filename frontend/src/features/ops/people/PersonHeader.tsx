"use client";

import type { ReactNode } from "react";

import { ROLE_LABELS } from "@/lib/roles";
import { formatDate, formatLastSeen } from "@/features/ops/users/peopleColumns";
import { Avatar, Badge, Button, HeaderCard, Menu, groupDigits, type GlanceFact } from "@/features/console/ui";
import type { Tone as VerdictTone } from "@/features/console/ui";
import type { Tone } from "./Fieldset";
import { formatPhone } from "./format";
import type { PersonCore } from "./personApi";

/**
 * Who this is, at the top of every tab (design handoff v0.3, DataDisplay · Header card; PR 10a): the photo
 * (owner, 2026-10-15: "studentning ma'lumotlari yonida doim rasmi ham ko'rinib turishi kerak"), the name, how
 * to reach them, what they are and what state the account is in — then the glance facts, which answer the
 * desk's two questions first ("Did he come today?", "Does he owe?"), a notice that explains a frozen account
 * in words, and the tab row at the card's foot. The everyday actions are buttons; the rare and destructive
 * ones sit behind ⋯.
 */

/** Roles that may be given a one-time password here (users.views_people_detail.ONE_TIME_PASSWORD_ROLES). */
export const ONE_TIME_PASSWORD_ROLES = new Set(["student", "public_student", "teacher", "support_teacher"]);

/**
 * Green from 85 %, amber from 60 %, red below — the same reading for attendance and homework. Red is kept for
 * a real problem: with amber starting at 70 a 64 % attendance and 2 of 3 homeworks turned the whole glance red,
 * and red that is everywhere stops being read.
 */
export function rateTone(rate: number | null | undefined): Tone {
  if (rate == null) return "neutral";
  if (rate >= 85) return "success";
  if (rate >= 60) return "warning";
  return "danger";
}

/** The same reading in the console's verdict words. */
export function rateVerdict(rate: number | null | undefined): VerdictTone | undefined {
  if (rate == null) return undefined;
  return rate >= 85 ? "positive" : rate >= 60 ? "attention" : "critical";
}

const MARK: Record<string, { word: string; tone: VerdictTone }> = {
  PRESENT: { word: "Came", tone: "positive" },
  LATE: { word: "Late", tone: "attention" },
  ABSENT: { word: "Absent", tone: "critical" },
  EXCUSED: { word: "Excused", tone: "neutral" },
};

/** "Did he come today?" — the first class meeting today, and how many more. */
export function todayFact(person: PersonCore): GlanceFact {
  const today = person.glance?.today ?? [];
  if (!today.length) return { label: "Today", value: "No lesson", sub: person.groups.length ? "none of their classes meets today" : "in no class" };
  const first = today[0];
  const mark = first.status ? MARK[first.status] : null;
  const where = [first.class_name, first.lesson_time ? `lesson ${first.lesson_time}` : ""].filter(Boolean).join(" · ");
  return {
    label: "Today",
    value: mark ? mark.word : "Not marked yet",
    tone: mark?.tone,
    sub: today.length > 1 ? `${where} · +${today.length - 1} more` : where,
  };
}

/** "Does he owe?" — lc-up's balance: a debt in so'm, or paid up. */
export function moneyFact(person: PersonCore): GlanceFact {
  if (!person.lcup) return { label: "Balance", value: "—", sub: "Not linked to lc-up" };
  const balance = person.lcup.balance;
  if (balance !== null && balance < 0) {
    return { label: "Owes", value: groupDigits(String(Math.round(-balance))), unit: "so'm", tone: "critical", sub: person.lcup.exempt ? "lc-up balance · never frozen for debt" : "lc-up balance" };
  }
  return { label: "Balance", value: balance === null ? "—" : "Paid up", tone: balance === null ? undefined : "positive", sub: "lc-up balance" };
}

function facts(person: PersonCore): GlanceFact[] {
  const seen: GlanceFact = { label: "Last seen", value: formatLastSeen(person.last_seen), sub: `Joined ${formatDate(person.date_joined)}` };
  const g = person.glance;
  if (person.staff) {
    const w = person.staff.workload;
    return [
      { label: "Classes", value: w.classes },
      { label: "Students", value: w.students },
      { label: "To review", value: w.to_review, tone: w.to_review > 0 ? "attention" : "positive", sub: w.to_review > 0 ? "submissions waiting" : "all reviewed" },
      seen,
    ];
  }
  if (person.section === "public") {
    return [
      { label: "Mock exams", value: g?.mocks_taken ?? 0, sub: "completed" },
      { label: "Last mock", value: g?.last_mock_total != null ? g.last_mock_total.toLocaleString("en-US") : "—", sub: g?.last_mock_total ? "total score" : "none yet" },
      person.lcup ? moneyFact(person) : { label: "Joined", value: formatDate(person.date_joined) },
      { ...seen, sub: person.lcup ? seen.sub : undefined },
    ];
  }
  const rate = g?.attendance_rate ?? null;
  return [
    todayFact(person),
    moneyFact(person),
    {
      label: "Attendance",
      value: rate == null ? "—" : `${Math.round(rate)} %`,
      tone: rateVerdict(rate),
      sub: rate == null ? "nothing marked yet" : `in ${person.groups.length} class${person.groups.length === 1 ? "" : "es"}`,
    },
    seen,
  ];
}

function notice(person: PersonCore) {
  if (person.frozen_reason === "debt") {
    return {
      tone: "frozen" as const,
      icon: "ms-freeze" as const,
      title: "Frozen for debt.",
      body: "They can still come to lessons but can’t open homework or mocks. The freeze lifts when lc-up records the payment.",
    };
  }
  if (person.is_frozen) {
    return { tone: "frozen" as const, icon: "ms-freeze" as const, title: "Frozen by an admin.", body: "Their access stays closed until an admin unfreezes the account." };
  }
  return undefined;
}

function badges(person: PersonCore): ReactNode {
  const otp = person.one_time_password;
  const role =
    person.section === "students" ? "Student" : person.section === "public" ? "Public user" : (ROLE_LABELS[person.role as keyof typeof ROLE_LABELS] ?? person.role);
  return (
    <>
      <Badge tone={person.section === "public" ? "info" : "neutral"} icon="user">{role}</Badge>
      {person.frozen_reason === "debt" ? (
        <Badge tone="frozen" icon="snow">Frozen for debt</Badge>
      ) : person.is_frozen ? (
        <Badge tone="frozen" icon="snow">Frozen by an admin</Badge>
      ) : (
        <Badge tone="positive" dot>Active</Badge>
      )}
      {person.lcup ? <Badge tone="line" icon="link">lc-up linked</Badge> : null}
      {otp ? (
        <Badge tone={otp.locked ? "critical" : "attention"} icon="key">
          {otp.locked ? "One-time password locked" : `One-time password · until ${formatDate(otp.expires_at)}`}
        </Badge>
      ) : null}
      {person.last_seen ? null : <Badge tone="neutral">Never signed in</Badge>}
    </>
  );
}

function meta(person: PersonCore): ReactNode[] {
  const out: ReactNode[] = [];
  if (person.username) out.push(`@${person.username}`);
  if (person.phone) out.push(formatPhone(person.phone));
  if (person.email) {
    const [user, ...domain] = person.email.split("@");
    // A break allowed before the "@" only, so a phone splits "name" from "@domain".
    out.push(
      <span className="break-words">
        {user}
        <wbr />
        {domain.length ? `@${domain.join("@")}` : ""}
      </span>,
    );
  }
  if (person.parent?.name || person.parent?.phone) {
    out.push(`Parent: ${[person.parent.name, person.parent.phone ? formatPhone(person.parent.phone) : ""].filter(Boolean).join(" · ")}`);
  }
  return out;
}

export function PersonHeader({
  person,
  busy,
  mayChange,
  onToggleFreeze,
  onOneTimePassword,
  onRevoke,
  onDelete,
  children,
}: {
  person: PersonCore;
  busy: boolean;
  /** Whether the viewer may change this account (`mayChangeAccount`): without it the actions are not offered. */
  mayChange: boolean;
  onToggleFreeze: () => void;
  onOneTimePassword: () => void;
  onRevoke: () => void;
  onDelete: () => void;
  /** The tab row, at the card's foot. */
  children?: ReactNode;
}) {
  const canOtp = ONE_TIME_PASSWORD_ROLES.has(person.role);
  return (
    <HeaderCard
      avatar={<Avatar name={person.name || person.username} src={person.avatar_url} size="lg" frozen={person.is_frozen} />}
      title={person.name || person.username}
      badges={badges(person)}
      meta={meta(person)}
      actions={
        !mayChange ? undefined : (
          <>
            {canOtp ? (
              <Button icon="key" disabled={busy || !person.phone} title={person.phone ? undefined : "Add a phone number first"} onClick={onOneTimePassword}>
                One-time password
              </Button>
            ) : null}
            <Button variant={person.is_frozen ? "primary" : "secondary"} icon="snow" disabled={busy} onClick={onToggleFreeze}>
              {person.is_frozen ? "Unfreeze" : "Freeze"}
            </Button>
            <Menu
              label="More actions"
              disabled={busy}
              items={[
                { label: "Log out everywhere", icon: "logout", onSelect: onRevoke },
                { label: "Delete account", icon: "trash", danger: true, onSelect: onDelete },
              ]}
            />
          </>
        )
      }
      facts={facts(person)}
      notice={notice(person)}
    >
      {children}
    </HeaderCard>
  );
}
