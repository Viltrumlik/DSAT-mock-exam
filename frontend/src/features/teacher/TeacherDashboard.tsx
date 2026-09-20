"use client";

/**
 * The teacher's first screen, rebuilt on the teacher kit.
 *
 * Both teachers who answered the 2026-09-14 letter, asked what they want on opening, named the
 * same two things: today's lessons with their times, and who has not uploaded homework. The
 * page that stood here showed neither — it showed class averages, completion percentages and
 * two charts, none of which either teacher mentioned, and it fanned out two requests per class
 * to build them. The owner's decision on 2026-09-20 was to remove those, not demote them.
 *
 * Every block loads, fails and empties on its own: one failed request costs the reader that
 * block, never the page, and a block that failed says so rather than rendering as "nothing".
 */

import Link from "next/link";
import { AlertTriangle, CalendarDays, ClipboardPen, Clock, Table2, Timer, UserCheck } from "lucide-react";
import {
  Button, Card, DataTable, EmptyState, ErrorState, Pill, Skeleton, TeacherPage, type Column,
} from "./ui";
import {
  useTeacherToday, type TeacherToday, type TodayLesson, type UpcomingMidterm, type WaitingRow,
} from "./useTeacherToday";
import { useTeacherAttention, type AttentionRow } from "./useTeacherAttention";

export type TeacherDashboardPreview = { today: TeacherToday; attention: AttentionRow[] };

function dayLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function TeacherDashboard({ preview }: { preview?: TeacherDashboardPreview }) {
  const today = useTeacherToday(!preview);
  const data = preview?.today ?? today.data;
  const attention = useTeacherAttention(preview?.attention);

  // A teacher with no classes at all is not a teacher with four empty blocks. Say the one true
  // thing once — and only from a zero the class list actually returned, never from a list that
  // failed or has not arrived, which is the difference between "you have none" and "we could
  // not read them".
  const noClasses = attention.status === "ready" && attention.classCount === 0;

  if (noClasses) {
    return (
      <TeacherPage title="Today">
        <Card>
          <EmptyState
            title="No classes yet"
            hint="When a class is assigned to you, its lessons, the homework due at them and the midterms coming appear here."
          />
        </Card>
      </TeacherPage>
    );
  }

  return (
    <TeacherPage
      title="Today"
      subtitle={data?.date ? dayLabel(data.date) : undefined}
      actions={
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/teacher/grading"><Button variant="ghost"><ClipboardPen size={15} aria-hidden />Grade</Button></Link>
          <Link href="/teacher/gradebook"><Button variant="ghost"><Table2 size={15} aria-hidden />Gradebook</Button></Link>
        </div>
      }
    >
      <Card title="Your lessons" subtitle="In the order they run" icon={<CalendarDays size={20} aria-hidden />} padded={false}>
        <div style={{ padding: "6px 24px 18px" }}>
          {!preview && today.isPending ? (
            <Skeleton height={54} count={3} />
          ) : !preview && today.isError ? (
            <ErrorState
              title="Today's lessons didn't load"
              detail="Your classes and their homework are unchanged — this is only the page failing to read them."
              onRetry={() => void today.refetch()}
            />
          ) : (data?.lessons.length ?? 0) === 0 ? (
            <EmptyState
              title="No lesson today"
              hint={data?.nextLessonDate ? `Your next lesson is ${dayLabel(data.nextLessonDate)}.` : undefined}
            />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {data!.lessons.map((l) => <LessonRow key={l.classroomId} lesson={l} />)}
            </ul>
          )}
        </div>
      </Card>

      <Card title="Waiting to be checked" subtitle="Turned in, not yet graded" icon={<ClipboardPen size={20} aria-hidden />}>
        {!preview && today.isPending ? (
          <Skeleton height={40} count={2} />
        ) : !preview && today.isError ? (
          <ErrorState title="This didn't load" onRetry={() => void today.refetch()} />
        ) : (
          <DataTable<WaitingRow>
            label="Work waiting to be checked, by class"
            rows={data?.waitingToCheck ?? []}
            rowKey={(r) => r.classroomId}
            columns={WAITING_COLUMNS}
            empty={<EmptyState title="Nothing waiting" hint="Work your students turn in shows up here." />}
          />
        )}
      </Card>

      <Card title="Midterms coming" subtitle="The next two weeks" icon={<Timer size={20} aria-hidden />}>
        {!preview && today.isPending ? (
          <Skeleton height={40} count={2} />
        ) : !preview && today.isError ? (
          <ErrorState title="This didn't load" onRetry={() => void today.refetch()} />
        ) : (
          <DataTable<UpcomingMidterm>
            label="Midterms scheduled in the next two weeks"
            rows={data?.upcomingMidterms ?? []}
            rowKey={(m) => `${m.midtermId}-${m.classroomId}`}
            columns={MIDTERM_COLUMNS}
            empty={<EmptyState title="No midterm scheduled" hint="Midterms you schedule for your classes appear here." />}
          />
        )}
      </Card>

      <Card title="Students needing support" subtitle="Low averages and work not turned in" icon={<AlertTriangle size={20} aria-hidden />}>
        {attention.status === "loading" ? (
          <Skeleton height={54} count={2} />
        ) : attention.status === "error" ? (
          <ErrorState
            title="This didn't load"
            detail={attention.detail ?? "Your students are unchanged — only this block failed to read them."}
            onRetry={attention.retry}
          />
        ) : attention.rows.length === 0 ? (
          <EmptyState title="Everyone is on track" hint="Nobody is behind on work or below the score line right now." />
        ) : (
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {attention.rows.map((s) => (
              <Link
                key={s.id}
                href="/teacher/students"
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                  border: "1px solid var(--dz-border)", borderRadius: 14, textDecoration: "none",
                }}
              >
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--dz-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name}
                  </span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--dz-mute)" }}>{s.reason}</span>
                </span>
                <Pill tone={s.tone}>{s.tone === "danger" ? "Score" : "Homework"}</Pill>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </TeacherPage>
  );
}

/* ── Today's lessons ─────────────────────────────────────────────────────── */

function LessonRow({ lesson }: { lesson: TodayLesson }) {
  const hw = lesson.homework;
  const total = hw ? hw.turnedIn + hw.missing : 0;
  return (
    <li style={{ borderTop: "1px solid var(--dz-border)", padding: "12px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 12,
            background: "var(--dz-indigo-soft)", color: "var(--dz-indigo)", fontSize: 14, fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          <Clock size={14} aria-hidden />
          {lesson.lessonTime ?? "Time not set"}
        </span>
        {/* 160px of basis, not `flex: 1`: on a phone the row has room for the time chip and the
            name but not the pill too, and a name allowed to shrink to nothing broke "Math Junior 3"
            over three lines. With a floor, the pill wraps to its own line instead. */}
        <span style={{ minWidth: 0, flex: "1 1 160px" }}>
          <Link
            href={`/teacher/classrooms/${lesson.classroomId}`}
            style={{ fontSize: 15, fontWeight: 800, color: "var(--dz-ink)", textDecoration: "none" }}
          >
            {lesson.name}
          </Link>
          <span style={{ display: "block", fontSize: 12, color: "var(--dz-mute)", fontWeight: 600 }}>
            {[lesson.subject, `${lesson.studentCount} students`].filter(Boolean).join(" · ")}
          </span>
        </span>
        {hw ? (
          <Pill tone={hw.missing === 0 ? "success" : "warning"}>
            <UserCheck size={13} aria-hidden />
            {hw.turnedIn}/{total} turned in
          </Pill>
        ) : (
          <Pill tone="neutral">No homework due</Pill>
        )}
      </div>

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

/* ── Tables ──────────────────────────────────────────────────────────────── */

const WAITING_COLUMNS: Column<WaitingRow>[] = [
  {
    key: "class",
    header: "Class",
    render: (r) => (
      <Link href={`/teacher/classrooms/${r.classroomId}?tab=grading`} style={{ fontWeight: 700, color: "var(--dz-ink)", textDecoration: "none" }}>
        {r.name}
      </Link>
    ),
  },
  { key: "count", header: "Waiting", align: "right", width: 110, render: (r) => r.count },
];

const MIDTERM_COLUMNS: Column<UpcomingMidterm>[] = [
  { key: "title", header: "Midterm", render: (m) => <span style={{ fontWeight: 700 }}>{m.title}</span> },
  {
    key: "class",
    header: "Class",
    render: (m) => (
      <Link href={`/teacher/classrooms/${m.classroomId}?tab=midterms`} style={{ color: "var(--dz-indigo)", textDecoration: "none", fontWeight: 600 }}>
        {m.className}
      </Link>
    ),
  },
  { key: "date", header: "Date", render: (m) => dayLabel(m.startsAt) },
  {
    key: "pass",
    header: "Pass mark",
    align: "right",
    width: 120,
    render: (m) => (m.passMark == null ? <span style={{ color: "var(--dz-faint)" }}>Not graded</span> : m.passMark),
  },
];
