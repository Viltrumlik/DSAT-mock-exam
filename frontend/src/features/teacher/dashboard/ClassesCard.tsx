"use client";

/**
 * "Your classes" — every class the teacher takes, the one whose lesson is coming first.
 *
 * The owner's requirement, in their words: the group that has a lesson stands first, before
 * and during that lesson, and once it is over the next group takes its place. The server
 * decides that order (it holds the clock); this renders it, and shows each class's day, time
 * and room so a teacher can read their week off this one screen.
 *
 * The row links to the classroom. The "not turned in" expander sits OUTSIDE that link: a
 * disclosure nested inside a link is neither clickable nor valid.
 */

import Link from "next/link";
import { Clock, DoorOpen, Users } from "lucide-react";
import { Card, EmptyState, ErrorState, Pill, Skeleton } from "../ui";
import type { ClassState, TeacherClass } from "../useTeacherToday";

const STATE_PILL: Record<ClassState, { label: string; tone: "success" | "info" | "neutral" }> = {
  now: { label: "In the lesson now", tone: "success" },
  upcoming: { label: "Next", tone: "info" },
  done: { label: "Lesson finished", tone: "neutral" },
  // Replaced below: a class can be unscheduled for either of two reasons, and the teacher can
  // fix whichever one it is — so the pill says which rather than shrugging.
  off: { label: "Not scheduled", tone: "neutral" },
};

/** Why this class has no next lesson: no day chosen, or a time nobody can read. */
function offReason(hasDays: boolean): string {
  return hasDays ? "No lesson time set" : "No lesson day set";
}

/** "Today 18:00" for today, "Tue 18:00" for a later day, nothing when there is no schedule. */
function whenLabel(iso: string | null, todayIso: string): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = at.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const sameDay = iso.slice(0, 10) === todayIso;
  return sameDay ? `Today ${time}` : `${at.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
}

export function ClassesCard({ classes, todayIso, nextLessonDate, loading, failed, onRetry }: {
  classes: TeacherClass[];
  todayIso: string;
  nextLessonDate: string | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <Card title="Your classes" subtitle="The lesson that is coming, first" icon={<Clock size={20} aria-hidden />} padded={false}>
      <div style={{ padding: "6px 24px 18px" }}>
        {loading ? (
          <Skeleton height={62} count={3} />
        ) : failed ? (
          <ErrorState
            title="Your classes didn't load"
            detail="Your classes and their homework are unchanged — this is only the page failing to read them."
            onRetry={onRetry}
          />
        ) : classes.length === 0 ? (
          <EmptyState
            title="No classes yet"
            hint={nextLessonDate ? undefined : "When a class is assigned to you, its lessons appear here."}
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {classes.map((c) => <ClassRow key={c.classroomId} klass={c} todayIso={todayIso} />)}
          </ul>
        )}
      </div>
    </Card>
  );
}

function ClassRow({ klass, todayIso }: { klass: TeacherClass; todayIso: string }) {
  const hw = klass.homework;
  const total = hw ? hw.turnedIn + hw.missing : 0;
  const pill = STATE_PILL[klass.state];
  const when = whenLabel(klass.nextLessonAt, todayIso);
  const schedule = [klass.lessonDaysLabel, klass.lessonTime].filter(Boolean).join(" · ");

  return (
    <li style={{ borderTop: "1px solid var(--dz-border)", padding: "12px 0" }}>
      <Link
        href={`/teacher/classrooms/${klass.classroomId}`}
        style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", textDecoration: "none" }}
      >
        <span
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 12,
            background: klass.state === "now" ? "var(--dz-success-soft)" : "var(--dz-indigo-soft)",
            color: klass.state === "now" ? "var(--dz-success)" : "var(--dz-indigo)",
            fontSize: 14, fontWeight: 800, whiteSpace: "nowrap",
          }}
        >
          <Clock size={14} aria-hidden />
          {klass.lessonTime ?? "Time not set"}
        </span>

        {/* 160px of basis: on a phone the row holds the time and the name, and the pills wrap. */}
        <span style={{ minWidth: 0, flex: "1 1 160px" }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 800, color: "var(--dz-ink)" }}>{klass.name}</span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "var(--dz-mute)", fontWeight: 600, marginTop: 2 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Users size={12} aria-hidden />{klass.studentCount} students
            </span>
            {klass.room && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <DoorOpen size={12} aria-hidden />Room {klass.room}
              </span>
            )}
            {schedule && <span>{schedule}</span>}
          </span>
        </span>

        <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Not while the lesson is running: "In the lesson now" already says when it is, and
              the start time is on the left of the same row. */}
          {when && klass.state === "upcoming" && (
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--dz-mute)", whiteSpace: "nowrap" }}>{when}</span>
          )}
          <Pill tone={pill.tone}>
            {klass.state === "off" ? offReason(Boolean(klass.lessonDaysLabel)) : pill.label}
          </Pill>
          {hw ? (
            <Pill tone={hw.missing === 0 ? "success" : "warning"}>{hw.turnedIn}/{total} turned in</Pill>
          ) : klass.state === "now" || klass.state === "upcoming" ? null : null}
        </span>
      </Link>

      {hw && hw.missing > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--dz-indigo)" }}>
            {hw.missing} not turned in
          </summary>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {hw.missingStudents.map((s) => (
              <span
                key={s.id}
                style={{
                  padding: "4px 10px", borderRadius: 999, background: "var(--dz-neutral-soft)",
                  fontSize: 13, fontWeight: 600, color: "var(--dz-ink)",
                }}
              >
                {s.name}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "var(--dz-mute)", marginTop: 8 }}>{hw.title}</div>
        </details>
      )}
    </li>
  );
}
