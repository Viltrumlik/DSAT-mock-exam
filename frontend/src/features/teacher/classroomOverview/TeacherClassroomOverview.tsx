"use client";

import { useState, type ReactNode } from "react";
import {
  CalendarCheck, CalendarDays, ClipboardList, GraduationCap, Timer, Trophy, Users,
} from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Pill, Skeleton } from "../ui";
import { Rankings } from "@/features/classroom/pages/Rankings";
import { useLessonPlan } from "@/features/classroom/lessonsHooks";
import { useAttendanceSessions } from "@/features/classroom/attendanceHooks";
import { useGradebookOverview, useGradebookAssignment } from "@/features/classroom/gradebookHooks";
import type { ClassroomTabId } from "@/features/classroom/shell/tabs";
import type { ClassroomWithRole } from "@/features/classroom/types";
import type { RosterRow } from "@/features/classroom/gradebookApi";
import { useClassInterventions } from "./useClassInterventions";
import {
  attentionItems, comingMidterm, dayLabel, detailOf, dueNext, localDay,
  nextLesson, notTurnedIn, todayRegister, turnedIn, waitingToGrade,
} from "./overviewModel";

/**
 * What a teacher sees on opening one of their classrooms.
 *
 * It used to be the rankings board — a podium and a ranked list, the same page a student gets.
 * Ranking students is not what a teacher needs in the ten minutes before a lesson, so this
 * answers the other question instead: what needs me today. Who owes the homework due next,
 * what is waiting for my marking, whether today's register is done, what is coming.
 *
 * Every block ends in a way OUT of the overview — the tab that acts on it. Nothing here is a
 * final destination; the overview is a place to leave.
 *
 * MOUNTED FOR STAFF ONLY. `features/classroom/**` is shared with the student site, which mounts
 * the workspace with `consumer` and forces `my_role` to STUDENT before capabilities are derived.
 * ClassroomWorkspace picks between this and Rankings on `caps.isStaff` for exactly that reason —
 * never on the route, which is the same component tree on both hosts.
 */
export function TeacherClassroomOverview({
  classroom,
  onOpenTab,
}: {
  classroom: ClassroomWithRole;
  onOpenTab: (tab: ClassroomTabId) => void;
}) {
  const classId = Number(classroom.id);
  const today = localDay();

  const plan = useLessonPlan(classId);
  const register = useAttendanceSessions(classId);
  const gradebook = useGradebookOverview(classId);
  const attention = useClassInterventions(classId);

  const homework = dueNext(gradebook.data, today);
  // Names of who has not turned it in live on the per-homework grades, not on the summary —
  // so this second read only happens once the summary has named a homework.
  const grades = useGradebookAssignment(classId, homework?.id ?? null);

  const lesson = nextLesson(plan.data, today);
  const midterm = comingMidterm(plan.data, today);
  const reg = todayRegister(register.data?.sessions, today);
  // Explicit `=== false`: on a server that predates the field, `undefined` must read as "the
  // schedule is fine", not as "this class is broken".
  const scheduleUnusable = register.data?.schedule_is_usable === false;
  const waiting = waitingToGrade(gradebook.data);
  const needAttention = attentionItems(attention.data);

  return (
    // `.dzboard` is what carries the teacher kit's tokens and face. The classroom shell is not
    // inside it — it belongs to the older, quieter system — so the overview puts itself in scope.
    <div className="dzboard" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {/* ── Today's register ───────────────────────────────────────────── */}
        <Card
          title="Today's register"
          icon={<CalendarCheck size={19} aria-hidden />}
          spine={reg.state === "marked" || reg.state === "none" ? undefined : "warning"}
          actions={<Button variant="ghost" onClick={() => onOpenTab("attendance")}>Open attendance</Button>}
        >
          <BlockBody
            query={register}
            label="the register"
            // No register for today is no lesson today. Calm, not a job left undone.
            empty={reg.state === "none"}
            // …unless no register will EVER open. `schedule_is_usable` false means this class's
            // lesson days cannot be read at all (views_attendance.py:113), so "a register opens
            // by itself" is a promise the server cannot keep — the same case where Attendance
            // re-opens the manual add.
            emptyTitle={scheduleUnusable ? "No register opens on its own" : "No lesson today"}
            emptyHint={
              scheduleUnusable
                ? "This class has no readable lesson days, so nothing opens by itself. Add today's register from Attendance."
                : "A register opens by itself on each lesson day."
            }
          >
            {/* Two states, not three. The payload cannot tell a half-marked register from an
                untouched one — see `todayRegister` — so this says what it knows. */}
            <Pill tone={reg.state === "marked" ? "success" : "warning"}>
              {reg.state === "marked" ? "Marked and finalised" : "Not finalised yet"}
            </Pill>
            {reg.session && (
              <p style={{ fontSize: 13, color: "var(--dz-mute)", marginTop: 10 }}>
                {reg.session.title || "Today's lesson"}
              </p>
            )}
          </BlockBody>
        </Card>

        {/* ── The homework due next ──────────────────────────────────────── */}
        <Card
          title="Homework due next"
          icon={<ClipboardList size={19} aria-hidden />}
          actions={<Button variant="ghost" onClick={() => onOpenTab("assignments")}>Open the homework</Button>}
        >
          <BlockBody
            query={gradebook}
            label="the homework"
            empty={homework == null}
            emptyTitle="Nothing due at the next lesson"
            emptyHint="Homework you give from the lesson plan shows up here with its deadline."
          >
            {homework && (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.02em", color: "var(--dz-ink)" }}>
                    {turnedIn(homework.counts)}
                    <span style={{ fontSize: 18, color: "var(--dz-mute)" }}>{` / ${homework.counts.total}`}</span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dz-mute)" }}>turned in</span>
                </div>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--dz-ink)", marginTop: 8 }}>
                  {homework.title}
                </p>
                <p style={{ fontSize: 13, color: "var(--dz-mute)", marginTop: 2 }}>
                  {`Due ${dayLabel(homework.due_at, today)}`}
                </p>
                <NotTurnedIn grades={grades} total={homework.counts.missing} />
              </>
            )}
          </BlockBody>
        </Card>

        {/* ── Waiting for this teacher's marking ─────────────────────────── */}
        <Card
          title="Waiting to be graded"
          icon={<GraduationCap size={19} aria-hidden />}
          spine={waiting.length > 0 ? "warning" : undefined}
          actions={<Button variant="ghost" onClick={() => onOpenTab("grading")}>Open grading</Button>}
        >
          <BlockBody
            query={gradebook}
            label="the grading queue"
            empty={waiting.length === 0}
            emptyTitle="Nothing waiting"
            emptyHint="Work students turn in appears here until you have marked it."
          >
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {waiting.slice(0, 4).map((w) => (
                <li key={w.id} style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dz-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {w.title}
                  </span>
                  <Pill tone="warning">{`${w.waiting} to grade`}</Pill>
                </li>
              ))}
            </ul>
          </BlockBody>
        </Card>

        {/* ── The next lesson ────────────────────────────────────────────── */}
        <Card
          title="Next lesson"
          icon={<CalendarDays size={19} aria-hidden />}
          actions={<Button variant="ghost" onClick={() => onOpenTab("lessons")}>Open lessons</Button>}
        >
          <BlockBody
            query={plan}
            label="the lesson plan"
            empty={lesson == null}
            emptyTitle={plan.data?.bound === false ? "No lesson plan yet" : "No lesson scheduled"}
            emptyHint={
              plan.data?.reason === "no_level"
                ? "Ask an admin to set this class's level, and the plan follows."
                : plan.data?.reason === "no_published_journal"
                  ? "Ask an admin to publish a journal for this subject and level."
                  : "Dated lessons from the plan show up here."
            }
          >
            {lesson && (
              <>
                <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.02em", color: "var(--dz-ink)" }}>
                  {dayLabel(lesson.scheduled_for, today)}
                </div>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--dz-ink)", marginTop: 6 }}>
                  {`Lesson ${lesson.lesson_number} · ${lesson.title}`}
                </p>
                <div style={{ marginTop: 10 }}>
                  <Pill tone={lesson.is_ready ? "success" : "neutral"}>
                    {lesson.is_ready ? "Ready to teach" : "Not prepared yet"}
                  </Pill>
                </div>
              </>
            )}
          </BlockBody>
        </Card>

        {/* The midterm coming — a card only when there IS one, because most classes have none
            most of the time and an empty "no midterm" card is noise. The lesson plan's loading
            and failure are already told by the Next lesson card above, which reads the same
            query: saying it twice would read as two things having gone wrong. */}
        {midterm && (
          <Card
            title="Midterm coming"
            icon={<Timer size={19} aria-hidden />}
            spine="info"
            actions={<Button variant="ghost" onClick={() => onOpenTab("midterms")}>Open midterms</Button>}
          >
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.02em", color: "var(--dz-ink)" }}>
              {dayLabel(midterm.scheduled_for, today)}
            </div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--dz-ink)", marginTop: 6 }}>
              {midterm.midterm?.title || midterm.title}
            </p>
            <div style={{ marginTop: 10 }}>
              <Pill tone={midterm.midterm?.has_start_code ? "success" : "neutral"}>
                {midterm.midterm?.has_start_code ? "Start code ready" : "No start code yet"}
              </Pill>
            </div>
          </Card>
        )}

        {/* ── The students to speak to ───────────────────────────────────── */}
        <Card
          title="Students who need you"
          icon={<Users size={19} aria-hidden />}
          spine={needAttention.length > 0 ? "danger" : undefined}
          actions={<Button variant="ghost" onClick={() => onOpenTab("people")}>Open the class list</Button>}
        >
          <BlockBody
            query={attention}
            label="the class signals"
            empty={needAttention.length === 0}
            emptyTitle="Everyone is keeping up"
            emptyHint="Students fall onto this list when work goes unturned, activity stops, or an average drops."
          >
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {needAttention.map((s) => (
                <li key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--dz-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name}
                  </span>
                  <Pill tone={s.tone}>{s.reason}</Pill>
                </li>
              ))}
            </ul>
          </BlockBody>
        </Card>
      </div>

      {/* Rankings did not go away — recompute and the boards still matter, and the students see
          them. They are simply no longer the first and only thing a teacher is shown, so they
          sit at the bottom, closed, one press from being open. The board rendered here is the
          SAME component the students get, untouched. */}
      <RankingsBlock classroom={classroom} />
    </div>
  );
}

/**
 * The four states every block owes its reader, in one place: loading, a failure that says so and
 * offers the retry, nothing-to-show, and the data. A failed block never renders as an empty one —
 * that reading has repeatedly taught teachers in this product that a class has nothing waiting
 * when in fact the server said no.
 *
 * It is per block, so one failed request leaves the rest of the overview standing.
 */
function BlockBody({
  query, label, empty, emptyTitle, emptyHint, children,
}: {
  query: { isLoading: boolean; isError: boolean; error?: unknown; refetch: () => unknown };
  label: string;
  empty: boolean;
  emptyTitle: string;
  emptyHint?: string;
  children: ReactNode;
}) {
  if (query.isLoading) return <Skeleton height={14} count={3} />;
  if (query.isError) {
    return (
      <ErrorState
        title={`We couldn't load ${label}`}
        detail={detailOf(query.error)}
        onRetry={() => query.refetch()}
      />
    );
  }
  if (empty) return <EmptyState title={emptyTitle} hint={emptyHint} />;
  return <>{children}</>;
}

/**
 * Who has not turned the homework in, by name. Its own small state because it is its own
 * request: the summary knows HOW MANY, only the per-homework grades know WHO, and a teacher can
 * still act on the count when the names do not arrive.
 */
function NotTurnedIn({
  grades, total,
}: {
  grades: { isLoading: boolean; isError: boolean; data?: { roster?: RosterRow[] } | undefined; refetch: () => unknown };
  total: number;
}) {
  if (total <= 0) {
    return <p style={{ fontSize: 13, fontWeight: 700, color: "var(--dz-success)", marginTop: 12 }}>Everyone turned it in.</p>;
  }
  if (grades.isLoading) return <div style={{ marginTop: 12 }}><Skeleton height={12} width="70%" /></div>;
  if (grades.isError) {
    return (
      <p style={{ fontSize: 13, color: "var(--dz-mute)", marginTop: 12 }}>
        {`${total} not turned in — `}
        <button
          type="button"
          onClick={() => grades.refetch()}
          style={{ font: "inherit", fontWeight: 700, color: "var(--dz-indigo)", background: "none", border: 0, padding: 0, cursor: "pointer" }}
        >
          the names didn&apos;t load, try again
        </button>
      </p>
    );
  }
  const missing = notTurnedIn(grades.data?.roster);
  const shown = missing.slice(0, 3).map((r) => r.name);
  const rest = missing.length - shown.length;
  return (
    <p style={{ fontSize: 13, color: "var(--dz-mute)", marginTop: 12 }}>
      <span style={{ fontWeight: 700, color: "var(--dz-ink)" }}>Not turned in: </span>
      {shown.length === 0 ? `${total} students` : shown.join(", ")}
      {rest > 0 ? ` +${rest} more` : ""}
    </p>
  );
}

/**
 * The board, closed. Opening it renders the shared Rankings page exactly as it always was.
 *
 * The card is titled "The XP board" and not "Class rankings" because Rankings.tsx:76 renders
 * its own `<h2>Class rankings</h2>` — the same words twice, one h2 inside another, the moment
 * the card is opened.
 */
function RankingsBlock({ classroom }: { classroom: ClassroomWithRole }) {
  const [open, setOpen] = useState(false);
  return (
    <Card
      title="The XP board"
      subtitle="The rankings your students see, and the recompute button."
      icon={<Trophy size={19} aria-hidden />}
      actions={<Button variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? "Hide rankings" : "Show rankings"}</Button>}
    >
      {/* Back to the document face. This card sits inside `.dzboard`, which sets the teacher
          kit's Plus Jakarta on everything under it — and Rankings is the students' own page,
          which would otherwise render in one typeface here and another on the student site. */}
      {open ? (
        <div style={{ fontFamily: "var(--font-sans)" }}>
          <Rankings classroom={classroom} />
        </div>
      ) : null}
    </Card>
  );
}
