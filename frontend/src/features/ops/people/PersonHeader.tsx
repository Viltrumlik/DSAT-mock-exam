"use client";

import {
  AtSign,
  BookCheck,
  CalendarCheck,
  ClipboardList,
  Clock,
  GraduationCap,
  KeyRound,
  Mail,
  MoreHorizontal,
  Phone,
  School,
  Snowflake,
  Sun,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import { Avatar, Badge, DropdownMenu, DropdownMenuItem } from "@/components/ui";
import { formatUzs } from "@/features/finance/financeApi";
import { ROLE_LABELS } from "@/lib/roles";
import { formatDate, formatLastSeen } from "@/features/ops/users/peopleColumns";
import { StatTile, type Tone } from "./Fieldset";
import { formatPhone } from "./format";
import type { PersonCore } from "./personApi";

/**
 * Who this is, at the top of every tab: the photo (owner, 2026-10-15: "studentning ma'lumotlari
 * yonida doim rasmi ham ko'rinib turishi kerak"), the name, how to reach them, what they are and
 * what state the account is in — each state in its own colour — and the figures the tabs below
 * hold, said once. The actions sit on the right: the everyday ones as buttons, the rare and
 * destructive ones behind "More".
 */

/** Roles that may be given a one-time password here (users.views_people_detail.ONE_TIME_PASSWORD_ROLES). */
export const ONE_TIME_PASSWORD_ROLES = new Set(["student", "public_student", "teacher", "support_teacher"]);

/** Green from 85 %, amber from 70 %, red below — the same reading for attendance and homework. */
export function rateTone(rate: number | null | undefined): Tone {
  if (rate == null) return "neutral";
  if (rate >= 85) return "success";
  if (rate >= 70) return "warning";
  return "danger";
}

const ACTION =
  "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground shadow-sm hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

function RoleBadge({ person }: { person: PersonCore }) {
  if (person.section === "students") return <Badge variant="primary">Student</Badge>;
  if (person.section === "public") return <Badge variant="info">Public user</Badge>;
  return <Badge variant="accent">{ROLE_LABELS[person.role as keyof typeof ROLE_LABELS] ?? person.role}</Badge>;
}

function StatusBadge({ person }: { person: PersonCore }) {
  if (person.frozen_reason === "debt") {
    return (
      <Badge variant="warning" dot>
        Frozen — unpaid
      </Badge>
    );
  }
  if (person.is_frozen) {
    return (
      <Badge variant="danger" dot>
        Frozen by admin
      </Badge>
    );
  }
  return (
    <Badge variant="success" dot>
      Active
    </Badge>
  );
}

function Glance({ person }: { person: PersonCore }) {
  const g = person.glance;
  if (person.staff) {
    const w = person.staff.workload;
    return (
      <>
        <StatTile label="Classes" value={w.classes} icon={School} tone="primary" />
        <StatTile label="Students" value={w.students} icon={Users} tone="primary" />
        <StatTile
          label="To review"
          value={w.to_review}
          icon={ClipboardList}
          tone={w.to_review > 0 ? "warning" : "success"}
          sub={w.to_review > 0 ? "submissions waiting" : "all reviewed"}
        />
        <StatTile label="Last seen" value={formatLastSeen(person.last_seen)} icon={Clock} sub={`Joined ${formatDate(person.date_joined)}`} />
      </>
    );
  }
  const balance = person.lcup?.balance ?? null;
  const balanceTile = !person.lcup ? (
    <StatTile label="Balance" value="—" icon={Wallet} sub="Not linked to lc-up" />
  ) : balance !== null && balance < 0 ? (
    <StatTile label="Owes" value={formatUzs(-balance)} icon={Wallet} tone="danger" sub="lc-up balance" />
  ) : (
    <StatTile label="Balance" value={balance === null ? "—" : "Paid up"} icon={Wallet} tone="success" sub="lc-up balance" />
  );

  if (person.section === "public") {
    return (
      <>
        <StatTile label="Mock exams" value={g?.mocks_taken ?? 0} icon={Trophy} tone="primary" sub="completed" />
        <StatTile
          label="Last mock"
          value={g?.last_mock_total ?? "—"}
          icon={GraduationCap}
          tone={g?.last_mock_total ? "primary" : "neutral"}
          sub={g?.last_mock_total ? "total score" : "none yet"}
        />
        {person.lcup ? balanceTile : <StatTile label="Joined" value={formatDate(person.date_joined)} icon={CalendarCheck} />}
        <StatTile label="Last seen" value={formatLastSeen(person.last_seen)} icon={Clock} />
      </>
    );
  }

  const rate = g?.attendance_rate ?? null;
  const hw = g?.homework ?? null;
  const hwRate = hw ? Math.round((100 * hw.completed) / hw.total) : null;
  return (
    <>
      {balanceTile}
      <StatTile
        label="Attendance"
        value={rate == null ? "—" : `${Math.round(rate)}%`}
        icon={CalendarCheck}
        tone={rateTone(rate)}
        sub={rate == null ? "nothing marked yet" : `in ${person.groups.length} class${person.groups.length === 1 ? "" : "es"}`}
      />
      <StatTile
        label="Homework"
        value={hw ? `${hw.completed} / ${hw.total}` : "—"}
        icon={BookCheck}
        tone={rateTone(hwRate)}
        sub={hw ? `${hwRate}% handed in` : "none set yet"}
      />
      <StatTile label="Last seen" value={formatLastSeen(person.last_seen)} icon={Clock} sub={`Joined ${formatDate(person.date_joined)}`} />
    </>
  );
}

export function PersonHeader({
  person,
  busy,
  onToggleFreeze,
  onOneTimePassword,
  onRevoke,
  onDelete,
}: {
  person: PersonCore;
  busy: boolean;
  onToggleFreeze: () => void;
  onOneTimePassword: () => void;
  onRevoke: () => void;
  onDelete: () => void;
}) {
  const otp = person.one_time_password;
  const canOtp = ONE_TIME_PASSWORD_ROLES.has(person.role);

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4 sm:gap-5">
          <Avatar
            src={person.avatar_url}
            name={person.name}
            size={72}
            className="ring-4 ring-primary-soft"
          />
          <div className="min-w-0 space-y-2.5">
            <div>
              <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">{person.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {person.username ? (
                  <span className="inline-flex items-center gap-1.5">
                    <AtSign aria-hidden className="h-3.5 w-3.5" />
                    {person.username}
                  </span>
                ) : null}
                {person.phone ? (
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <Phone aria-hidden className="h-3.5 w-3.5" />
                    {formatPhone(person.phone)}
                  </span>
                ) : null}
                {person.email ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Mail aria-hidden className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{person.email}</span>
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <RoleBadge person={person} />
              <StatusBadge person={person} />
              {person.lcup ? <Badge variant="neutral">lc-up linked</Badge> : null}
              {otp ? (
                <Badge variant={otp.locked ? "danger" : "warning"}>
                  {otp.locked
                    ? "One-time password locked"
                    : `One-time password · until ${formatDate(otp.expires_at)}`}
                </Badge>
              ) : null}
              {person.last_seen ? null : <Badge variant="outline">Never signed in</Badge>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canOtp ? (
            <button
              type="button"
              disabled={busy || !person.phone}
              title={person.phone ? undefined : "Add a phone number first"}
              onClick={onOneTimePassword}
              className={ACTION}
            >
              <KeyRound aria-hidden className="h-4 w-4 text-primary" />
              One-time password
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={onToggleFreeze} className={ACTION}>
            {person.is_frozen ? (
              <Sun aria-hidden className="h-4 w-4 text-success" />
            ) : (
              <Snowflake aria-hidden className="h-4 w-4 text-info-foreground" />
            )}
            {person.is_frozen ? "Unfreeze" : "Freeze"}
          </button>
          <DropdownMenu
            trigger={
              <button type="button" aria-label="More actions" disabled={busy} className={`${ACTION} px-2.5`}>
                <MoreHorizontal aria-hidden className="h-4 w-4" />
              </button>
            }
          >
            <DropdownMenuItem onClick={onRevoke}>Log out everywhere</DropdownMenuItem>
            <DropdownMenuItem destructive onClick={onDelete}>
              Delete account
            </DropdownMenuItem>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-border bg-surface-2/40 p-4 sm:p-5 lg:grid-cols-4">
        <Glance person={person} />
      </div>
    </div>
  );
}
