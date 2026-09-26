"use client";

/**
 * Grading, on one screen.
 *
 * The owner asked for manual grading back, working, and easy to get to. Four surfaces had it
 * between them and none of them had all of it: a cross-class queue that never showed the work,
 * a homework hub two clicks deep that did, a classroom tab that showed only status and grade,
 * and a matrix of numbers. 292 pieces were waiting in production and two people had hand-graded
 * 32 in a month.
 *
 * So: the queue on the left — class, then homework, then the students waiting, longest first —
 * and the work itself on the right, the uploaded pdf or jpg drawn in the page. Grade, save, and
 * the next student who is waiting arrives without going back to any list; when a homework runs
 * out, the next homework opens by itself. ⌘↵ saves and moves on — or sends the work back, when
 * that is the box the cursor is in — and ⌘→ skips from outside the boxes.
 *
 * Nothing new was written on the server: the queue is the dashboard's own `teacher/today/`
 * payload, the work is the submissions list the homework hub already read, and the grade and
 * return endpoints are called unchanged, with the `expected_revision` they handed us.
 *
 * Every block has its four states, and a request that failed says so — a failed load is never
 * drawn as "nothing to grade", which is the lie that would leave real work unmarked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPen, CornerDownLeft, RotateCcw, SkipForward } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Field, Pill, Skeleton, TeacherPage } from "../ui";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { studentLabel, type GradingSubmission } from "./gradingQueueModel";
import { SubmittedWork } from "./SubmittedWork";
import { useGradingScreen, type Selection } from "./useGradingScreen";

/** How long this piece has been waiting, in the words the dashboard's card uses. */
function waitedFor(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const hours = (Date.now() - then) / 3_600_000;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  if (hours < 48) return "yesterday";
  if (hours < 24 * 7) return `${Math.floor(hours / 24)} days ago`;
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const INPUT_STYLE = {
  width: "100%", padding: "10px 12px", borderRadius: 12, fontSize: 14, fontFamily: "inherit",
  border: "1px solid var(--dz-border)", background: "var(--dz-card)", color: "var(--dz-ink)",
} as const;

/** The send-back note's id. The ⌘↵ handler reads it to tell "send back" from "save". */
const RETURN_NOTE_ID = "grading-return-note";

const KBD_STYLE = {
  padding: "1px 6px", borderRadius: 6, background: "var(--dz-neutral-soft)",
  fontSize: 12, fontWeight: 700, color: "var(--dz-ink)",
} as const;

/** A score is optional — feedback alone is a review — but a written one must be one the server takes. */
function scoreProblem(raw: string): string | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Give a number, or leave the score blank to send feedback only.";
  if (n < 0 || n > 100) return "Scores run from 0 to 100.";
  return null;
}

export function TeacherGradingScreen({ initial }: { initial: Selection }) {
  const s = useGradingScreen(initial);
  const { assertCriticalAuth, criticalAuthReady } = useAuthCriticalGate();

  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  /** A colleague's review that arrived on top of words this teacher had already started. */
  const [otherReview, setOtherReview] = useState<{ score: string; feedback: string } | null>(null);

  const currentId = s.current?.id ?? null;
  const currentRevision = s.current?.revision ?? null;

  // Read inside the effect below without making it a dependency: the effect must run when the
  // WORK changes, never on a keystroke.
  const typed = useRef({ score: "", feedback: "" });
  useEffect(() => { typed.current = { score, feedback }; }, [score, feedback]);
  /** What was put in the boxes when this piece of work was loaded — the line between clean and dirty. */
  const loaded = useRef<{ id: number | null; score: string; feedback: string }>({ id: null, score: "", feedback: "" });

  // The fields belong to the piece of work on screen, and reload when the teacher moves on.
  //
  // They also re-run when the work changes underneath them, which is what a 409 does: the
  // refetch brings back the colleague's grade. Overwriting the boxes with it would throw away
  // the sentence this teacher was in the middle of writing and say nothing about it — the exact
  // typing-destroyed failure this screen already has one fix for. So while the boxes are dirty
  // the teacher's own words stay, and the colleague's are drawn beside them to be read.
  useEffect(() => {
    const review = s.current?.review ?? null;
    const incoming = {
      score: review?.grade != null ? String(review.grade) : "",
      feedback: typeof review?.feedback === "string" ? review.feedback : "",
    };
    const sameWork = currentId != null && loaded.current.id === currentId;
    const dirty =
      sameWork &&
      (typed.current.score !== loaded.current.score || typed.current.feedback !== loaded.current.feedback);

    if (dirty) {
      setOtherReview(incoming);
      return;
    }
    setScore(incoming.score);
    setFeedback(incoming.feedback);
    setReturnNote("");
    setFieldError(null);
    setOtherReview(null);
    loaded.current = { id: currentId, ...incoming };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, currentRevision]);

  // Pulled out of `s` so the handlers below — and the window-level shortcuts that close over
  // them — are rebound when the action changes, not on every keystroke in the feedback box.
  const { saveAndNext, returnForRevision, skip, current } = s;

  const save = useCallback(async () => {
    if (!current) return;
    const problem = scoreProblem(score);
    setFieldError(problem);
    if (problem) return;
    if (!assertCriticalAuth()) return;
    await saveAndNext({ grade: score, feedback });
  }, [current, saveAndNext, score, feedback, assertCriticalAuth]);

  const sendBack = useCallback(async () => {
    if (!current) return;
    if (!assertCriticalAuth()) return;
    await returnForRevision(returnNote);
  }, [current, returnForRevision, returnNote, assertCriticalAuth]);

  // ⌘↵ / Ctrl+↵ commits the box the teacher is in: the send-back note sends the work back, and
  // everywhere else it saves the grade and moves on. Bound on the window so it works from inside
  // the feedback box, which is where the teacher's hands are — that is the whole point of having
  // it — but it has to READ where the hands are, or the gesture the page advertises beside the
  // note box would mark the work instead and discard the note.
  //
  // ⌘→ / Ctrl+→ skips, and only when the cursor is NOT in a box: in a textarea that chord is the
  // system's own "caret to end of line", and taking it would jump the teacher to the next student
  // and reset the fields, losing half-written feedback with nothing saved.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const inABox = tag === "TEXTAREA" || tag === "INPUT" || target?.isContentEditable === true;
      if (e.key === "Enter") {
        e.preventDefault();
        if (target?.id === RETURN_NOTE_ID) void sendBack();
        else void save();
      } else if (e.key === "ArrowRight") {
        if (inABox) return;
        e.preventDefault();
        skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, sendBack, skip]);

  const subtitle = s.queueFailed
    ? undefined
    : s.totalWaiting > 0
      ? `${s.totalWaiting} turned in and waiting to be checked`
      : undefined;

  return (
    <TeacherPage
      title="Grading"
      subtitle={subtitle}
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dz-mute)", fontWeight: 600 }}>
          <span style={KBD_STYLE}>⌘↵</span> save &amp; next
          <span style={KBD_STYLE}>⌘→</span> skip, outside the boxes
        </div>
      }
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 300px", minWidth: 0, maxWidth: 400 }}>
          <QueuePane screen={s} />
        </div>
        <div style={{ flex: "3 1 440px", minWidth: 0 }}>
          <WorkPane
            screen={s}
            score={score}
            feedback={feedback}
            returnNote={returnNote}
            fieldError={fieldError}
            otherReview={otherReview}
            onScore={setScore}
            onFeedback={setFeedback}
            onReturnNote={setReturnNote}
            onSave={save}
            onSendBack={sendBack}
            canAct={criticalAuthReady}
          />
        </div>
      </div>
    </TeacherPage>
  );
}

type Screen = ReturnType<typeof useGradingScreen>;

function QueuePane({ screen }: { screen: Screen }) {
  const { selection } = screen;

  return (
    <Card title="Waiting for you" subtitle="Longest waiting first" padded={false}>
      <div style={{ padding: "6px 18px 18px" }}>
        {screen.queueLoading ? (
          <Skeleton height={48} count={4} />
        ) : screen.queueFailed ? (
          <ErrorState
            title="The queue didn't load"
            // The server's reason first when it gave one: a 403 names the class the teacher
            // may not grade in, and a teacher told only "no grade was lost" has no idea why
            // their queue is empty or who to ask.
            detail={screen.queueReason ?? "No grade was lost — this is only the page failing to read what is waiting."}
            onRetry={screen.retryQueue}
          />
        ) : screen.queue.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            hint="Work your students turn in by hand appears here, the class with most waiting first."
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {screen.queue.map((klass) => (
              <li key={klass.classroomId} style={{ borderTop: "1px solid var(--dz-border)", paddingTop: 12, marginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 800, color: "var(--dz-ink)" }}>
                    {klass.name}
                  </span>
                  <Pill tone="warning">{klass.waiting}</Pill>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                  {klass.assignments.map((asg) => {
                    const open =
                      selection.classId === klass.classroomId && selection.assignmentId === asg.assignmentId;
                    // The queue sends at most twelve students per homework while `waiting` stays
                    // the true total, so a pill reading 47 can sit above five names. Say how many
                    // are not listed — opening the homework reads them all, uncapped.
                    const hidden = Math.max(0, asg.waiting - asg.students.length);
                    return (
                      <div key={asg.assignmentId}>
                        <button
                          type="button"
                          onClick={() => screen.openHomework(klass.classroomId, asg.assignmentId)}
                          aria-expanded={open}
                          style={{
                            display: "flex", width: "100%", alignItems: "baseline", gap: 8, textAlign: "left",
                            padding: "8px 10px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                            border: open ? "1px solid var(--dz-indigo)" : "1px solid transparent",
                            background: open ? "var(--dz-indigo-soft)" : "transparent",
                          }}
                        >
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: "var(--dz-ink)" }}>
                            {asg.title}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--dz-mute)" }}>
                            {asg.waiting} to check
                          </span>
                        </button>

                        {open ? (
                          <OpenHomeworkStudents screen={screen} />
                        ) : (
                          <ul style={{ listStyle: "none", margin: "2px 0 0", padding: "0 0 0 10px" }}>
                            {asg.students.map((student) => (
                              <li key={student.id}>
                                <button
                                  type="button"
                                  onClick={() => screen.openHomework(klass.classroomId, asg.assignmentId, student.id)}
                                  style={studentButtonStyle(false)}
                                >
                                  <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{student.name}</span>
                                  <span style={{ fontSize: 11, color: "var(--dz-mute)", fontWeight: 600 }}>
                                    {waitedFor(student.submittedAt)}
                                  </span>
                                </button>
                              </li>
                            ))}
                            {hidden > 0 && (
                              <li>
                                <button
                                  type="button"
                                  onClick={() => screen.openHomework(klass.classroomId, asg.assignmentId)}
                                  style={{
                                    ...studentButtonStyle(false),
                                    color: "var(--dz-indigo)", fontWeight: 700,
                                  }}
                                >
                                  +{hidden} more waiting — open to see them all
                                </button>
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function studentButtonStyle(active: boolean) {
  return {
    display: "flex", width: "100%", alignItems: "baseline", gap: 8, textAlign: "left" as const,
    padding: "6px 10px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
    fontSize: 13, fontWeight: active ? 800 : 600,
    color: active ? "var(--dz-indigo)" : "var(--dz-ink)",
    background: active ? "var(--dz-indigo-soft)" : "transparent",
    border: "1px solid transparent",
  };
}

/**
 * The open homework's students, read from the submissions themselves rather than from the
 * queue — the queue sends at most twelve per homework, and the class with 134 waiting must be
 * workable past the twelfth.
 */
function OpenHomeworkStudents({ screen }: { screen: Screen }) {
  if (screen.workLoading) {
    return (
      <div style={{ padding: "6px 10px" }}>
        <Skeleton height={26} count={3} />
      </div>
    );
  }
  if (screen.workFailed) {
    return (
      <div style={{ padding: "6px 0 2px" }}>
        <ErrorState title="This homework didn't open" detail={null} onRetry={screen.retryWork} />
      </div>
    );
  }
  if (screen.waiting.length === 0) {
    return (
      <p style={{ padding: "6px 10px", margin: 0, fontSize: 12, color: "var(--dz-mute)" }}>
        Everything turned in here has been checked.
      </p>
    );
  }
  return (
    <ul style={{ listStyle: "none", margin: "2px 0 0", padding: "0 0 0 10px" }}>
      {screen.waiting.map((sub) => {
        const id = sub.student?.id;
        const active = id != null && id === screen.selection.studentId;
        return (
          <li key={sub.id}>
            <button
              type="button"
              onClick={() => id != null && screen.openStudent(id)}
              style={studentButtonStyle(active)}
              aria-current={active ? "true" : undefined}
            >
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{studentLabel(sub.student)}</span>
              <span style={{ fontSize: 11, color: "var(--dz-mute)", fontWeight: 600 }}>{waitedFor(sub.submitted_at)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function WorkPane({
  screen, score, feedback, returnNote, fieldError, otherReview,
  onScore, onFeedback, onReturnNote, onSave, onSendBack, canAct,
}: {
  screen: Screen;
  score: string;
  feedback: string;
  returnNote: string;
  fieldError: string | null;
  otherReview: { score: string; feedback: string } | null;
  onScore: (v: string) => void;
  onFeedback: (v: string) => void;
  onReturnNote: (v: string) => void;
  onSave: () => void;
  onSendBack: () => void;
  canAct: boolean;
}) {
  const current: GradingSubmission | null = screen.current;
  const heading = useMemo(() => {
    if (!current) return screen.homeworkTitle || "Grading";
    return studentLabel(current.student);
  }, [current, screen.homeworkTitle]);

  const where = [screen.className, screen.homeworkTitle].filter(Boolean).join(" · ");

  // The queue is how a piece of work is reached, so a queue that failed leaves this side with
  // nothing to draw — and it must say that, not "nothing to grade".
  if (screen.queueFailed && !current) {
    return (
      <Card title="The work">
        <ErrorState
          title="The queue didn't load, so there is nothing to open"
          detail={screen.queueReason ?? "No grade was lost. Try the queue again."}
          onRetry={screen.retryQueue}
        />
      </Card>
    );
  }

  if (screen.queueLoading || screen.workLoading) {
    return (
      <Card title="The work">
        <Skeleton height={28} />
        <div style={{ height: 14 }} />
        <Skeleton height={320} />
      </Card>
    );
  }

  if (screen.workFailed) {
    return (
      <Card title={screen.homeworkTitle || "The work"} subtitle={screen.className || undefined}>
        <ErrorState
          title="This homework's work didn't load"
          detail={screen.workReason ?? "Nothing was lost — the page could not read what was turned in."}
          onRetry={screen.retryWork}
        />
      </Card>
    );
  }

  if (!current) {
    return (
      <Card title={screen.homeworkTitle || "The work"} subtitle={screen.className || undefined}>
        <EmptyState
          title={screen.queue.length === 0 ? "Nothing waiting to be checked" : "Pick a student from the queue"}
          hint={
            screen.queue.length === 0
              ? "When students turn work in by hand, it arrives here."
              : "Their work, their grade and your feedback open here."
          }
        />
      </Card>
    );
  }

  const waitedLabel = waitedFor(current.submitted_at);
  const reviewed = (current.status ?? "").toUpperCase() === "REVIEWED";

  return (
    <Card
      title={heading}
      subtitle={where || undefined}
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {reviewed ? <Pill tone="success">Already graded</Pill> : <Pill tone="warning">Waiting</Pill>}
          {waitedLabel ? <Pill tone="neutral">Turned in {waitedLabel}</Pill> : null}
        </div>
      }
    >
      {screen.note && (
        <div
          role={screen.note.tone === "success" ? "status" : "alert"}
          style={{
            marginBottom: 16, padding: "12px 14px", borderRadius: 14, fontSize: 13, fontWeight: 700,
            background:
              screen.note.tone === "success" ? "var(--dz-success-soft)"
                : screen.note.tone === "warning" ? "var(--dz-amber-soft)" : "var(--dz-danger-soft)",
            color:
              screen.note.tone === "success" ? "var(--dz-success)"
                : screen.note.tone === "warning" ? "var(--dz-amber)" : "var(--dz-danger)",
          }}
        >
          {screen.note.text}
        </div>
      )}

      {otherReview && (
        <div
          style={{
            marginBottom: 16, padding: "12px 14px", borderRadius: 14,
            border: "1px solid var(--dz-border)", background: "var(--dz-neutral-soft)",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--dz-ink)" }}>
            What the other teacher saved
          </div>
          <p style={{ fontSize: 12, color: "var(--dz-mute)", margin: "4px 0 8px" }}>
            Your own score and feedback are still in the boxes below — nothing you wrote was replaced.
            Read theirs, then save yours or leave it.
          </p>
          <div style={{ fontSize: 13, color: "var(--dz-ink)", fontWeight: 600 }}>
            Score: {otherReview.score || "none"}
          </div>
          {otherReview.feedback && (
            <p style={{ fontSize: 13, color: "var(--dz-ink)", margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
              {otherReview.feedback}
            </p>
          )}
        </div>
      )}

      <SubmittedWork submission={current} />

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--dz-border)" }}>
        <Field label="Score" htmlFor="grading-score" hint="0–100. Leave it blank to send feedback only." error={fieldError}>
          <input
            id="grading-score"
            inputMode="decimal"
            value={score}
            onChange={(e) => onScore(e.target.value)}
            placeholder="e.g. 85"
            style={{ ...INPUT_STYLE, maxWidth: 160 }}
          />
        </Field>

        <Field label="Feedback" htmlFor="grading-feedback" hint="What went well, and the one thing to work on next.">
          <textarea
            id="grading-feedback"
            value={feedback}
            onChange={(e) => onFeedback(e.target.value)}
            rows={4}
            style={{ ...INPUT_STYLE, resize: "vertical" }}
          />
        </Field>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <Button onClick={onSave} busy={screen.saving} disabled={!canAct}>
            <ClipboardPen size={15} aria-hidden />
            Save &amp; next
          </Button>
          <Button variant="ghost" onClick={screen.skip} disabled={screen.saving}>
            <SkipForward size={15} aria-hidden />
            Skip for now
          </Button>
          <span style={{ fontSize: 12, color: "var(--dz-mute)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <CornerDownLeft size={13} aria-hidden />
            <span style={KBD_STYLE}>⌘↵</span> save &amp; next · <span style={KBD_STYLE}>⌘→</span> skip, when the cursor
            is not in a box
          </span>
        </div>

        <div style={{ padding: "14px 16px", borderRadius: 16, background: "var(--dz-neutral-soft)" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--dz-ink)" }}>Send back for another go</div>
          <p style={{ fontSize: 12, color: "var(--dz-mute)", margin: "4px 0 10px" }}>
            The student can fix it and turn it in again. Your note is what they see first.
          </p>
          <textarea
            id={RETURN_NOTE_ID}
            value={returnNote}
            onChange={(e) => onReturnNote(e.target.value)}
            rows={2}
            placeholder="What to redo, in a sentence"
            style={{ ...INPUT_STYLE, resize: "vertical" }}
            aria-label="Note to the student"
          />
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 10 }}>
            <Button variant="ghost" onClick={onSendBack} disabled={screen.saving || !canAct}>
              <RotateCcw size={15} aria-hidden />
              Send back
            </Button>
            <span style={{ fontSize: 12, color: "var(--dz-mute)", fontWeight: 600 }}>
              <span style={KBD_STYLE}>⌘↵</span> from this box sends it back
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
