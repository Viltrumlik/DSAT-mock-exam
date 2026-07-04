"use client";

/**
 * /assessments — Student assessment workspace, rebuilt as a 3-column board
 * (To-do / In progress / Completed) to match the MasterSAT Assessments mockup.
 * Uses the shared `.dzboard` design scope. Data: GET /api/classes/my-assignments/.
 * Growth-oriented framing — no punishing "Overdue"/red labels (see memory).
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen, Calculator, Clock, Calendar, CheckCircle2,
  PlayCircle, RefreshCw, AlertTriangle, Hourglass, Loader2,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { classesApi } from "@/lib/api";
import type { Assignment } from "@/lib/criticalApiContract";
import {
  deriveAssignmentLifecycleState, formatAssignmentDue,
} from "@/lib/assignmentLifecycle";
import { useStartAttempt } from "@/features/assessments/hooks";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";

type AssessmentSet = { id: number; subject: string; category: string; title: string; description: string };
type AssessmentHomework = { homework_id: number; set?: AssessmentSet | null };
type AssignmentWithStatus = Assignment & {
  assessment_homework?: AssessmentHomework | null;
  workflow_status?: string | null;
  attempt_id?: number | null;
};
type Entry = {
  assignment: AssignmentWithStatus;
  classroomId: number;
  classroomName: string;
  subject?: string;
  resumeHref?: string;
};

type State = "IN_PROGRESS" | "SUBMITTED" | "COMPLETED" | "OVERDUE" | "DUE_SOON" | "NOT_STARTED";

function deriveState(e: Entry): State {
  const ws = e.assignment.workflow_status;
  if (ws === "graded" || ws === "completed") return "COMPLETED";
  if (ws === "submitted") return "SUBMITTED";
  if (ws === "in_progress") return "IN_PROGRESS";
  const t = deriveAssignmentLifecycleState(e.assignment);
  if (t === "OVERDUE") return "OVERDUE";
  if (t === "DUE_SOON") return "DUE_SOON";
  return "NOT_STARTED";
}

type ColKey = "todo" | "progress" | "done";
function colOf(s: State): ColKey {
  if (s === "IN_PROGRESS") return "progress";
  if (s === "COMPLETED" || s === "SUBMITTED") return "done";
  return "todo";
}

const COLUMNS: { key: ColKey; name: string; dot: string; emptyHint: string }[] = [
  { key: "todo", name: "To-do", dot: "var(--dz-indigo)", emptyHint: "New work from your teachers shows up here." },
  { key: "progress", name: "In progress", dot: "var(--dz-amber)", emptyHint: "Anything you've started appears here." },
  { key: "done", name: "Completed", dot: "#16a34a", emptyHint: "Finished work lands here." },
];

function subjectMeta(subject?: string): { label: string; isMath: boolean } {
  if (subject === "MATH") return { label: "Math", isMath: true };
  if (subject === "READING_WRITING" || subject === "ENGLISH") return { label: "R&W", isMath: false };
  return { label: subject || "General", isMath: false };
}

function Board() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Start (or resume) the assessment directly from the card — no intermediate
  // launcher page. The backend reuses an in-progress attempt or creates a fresh one.
  const start = useStartAttempt();
  const [startingId, setStartingId] = useState<number | null>(null);
  const beginAssessment = async (assignmentId: number) => {
    if (startingId != null) return;
    setStartingId(assignmentId);
    try {
      const att = await start.mutateAsync({ assignment_id: assignmentId });
      router.push(`/assessments/attempt/${att.id}`);
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
      setStartingId(null);
    }
  };

  const load = async () => {
    setLoading(true); setError(false); setEntries([]);
    try {
      const { items } = await classesApi.myAssignments();
      const collected: Entry[] = [];
      for (const a of items) {
        const rich = a as AssignmentWithStatus & { classroom_id?: number; classroom_name?: string };
        if (!rich.assessment_homework) continue;
        const classroomId = rich.classroom_id ?? 0;
        const classroomName = rich.classroom_name ?? `Class #${classroomId}`;
        const resumeHref = rich.workflow_status === "in_progress" && rich.attempt_id
          ? `/assessments/attempt/${rich.attempt_id}` : undefined;
        collected.push({ assignment: rich, classroomId, classroomName, subject: rich.assessment_homework?.set?.subject, resumeHref });
      }
      setEntries(collected);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const byCol = useMemo(() => {
    const m: Record<ColKey, Entry[]> = { todo: [], progress: [], done: [] };
    for (const e of entries) m[colOf(deriveState(e))].push(e);
    return m;
  }, [entries]);

  return (
    <div className="dzboard" style={{ maxWidth: 1280, width: "100%", margin: "0 auto" }}>
      <div className="dz-content">
        <div style={{ display: "flex", alignItems: "flex-end", gap: 24, flexWrap: "wrap", marginBottom: 22 }}>
          <h1 style={{ flex: 1, minWidth: 280, margin: 0, fontSize: 38, lineHeight: 1.05, fontWeight: 800, letterSpacing: "-.03em", color: "var(--dz-ink)" }}>
            My assessments
          </h1>
          <button type="button" onClick={() => void load()} className="dz-secbtn"
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 16px", borderRadius: 12, border: "1px solid var(--dz-border)", background: "var(--dz-panel)", color: "var(--dz-mute)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        {error ? (
          <AssessError onRetry={() => void load()} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }} className="dz-board">
            {COLUMNS.map((col) => (
              <div key={col.key} style={{ background: "var(--dz-card)", border: "1px solid var(--dz-border)", borderRadius: 18, padding: 16, minHeight: 300 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 6px 16px" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: col.dot }} />
                  <span style={{ fontSize: 15, fontWeight: 800, color: "var(--dz-ink)" }}>{col.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "var(--dz-faint)", background: "var(--dz-panel)", padding: "2px 9px", borderRadius: 8 }}>
                    {loading ? "·" : byCol[col.key].length}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {loading ? (
                    Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="dz-skel" style={{ height: 132, borderRadius: 16 }} />
                    ))
                  ) : byCol[col.key].length === 0 ? (
                    <div style={{ border: "1.5px dashed var(--dz-border)", borderRadius: 13, padding: "26px 16px", textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--dz-mute)" }}>Nothing here</div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--dz-faint)", marginTop: 3 }}>{col.emptyHint}</div>
                    </div>
                  ) : (
                    byCol[col.key].map((e) => (
                      <AssessCard
                        key={`${e.classroomId}-${e.assignment.id}`}
                        entry={e}
                        onGo={(href) => router.push(href)}
                        onStart={beginAssessment}
                        starting={startingId === e.assignment.id}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssessCard({ entry, onGo, onStart, starting }: { entry: Entry; onGo: (href: string) => void; onStart: (assignmentId: number) => void; starting: boolean }) {
  const state = deriveState(entry);
  const set = entry.assignment.assessment_homework?.set;
  const title = entry.assignment.title ?? set?.title ?? "Assignment";
  const subj = subjectMeta(set?.subject ?? entry.subject);
  const category = set?.category;
  const aid = entry.assignment.id;
  const dueRel = formatAssignmentDue(entry.assignment.due_at);
  const col = colOf(state);

  const accent = subj.isMath ? "#0d9488" : "var(--dz-indigo)";
  const accentSoft = subj.isMath ? "rgba(13,148,136,.12)" : "var(--dz-indigo-soft)";

  return (
    <div className="dz-statecard" style={{ background: "var(--dz-panel)", border: "1px solid var(--dz-border)", borderRadius: 16, padding: 16, cursor: "default" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: accentSoft, color: accent, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          {subj.isMath ? <Calculator size={16} /> : <BookOpen size={16} />}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, color: accent, background: accentSoft, padding: "3px 9px", borderRadius: 8 }}>
          {subj.label}
        </span>
        <div style={{ flex: 1 }} />
        {col === "done" ? <span style={{ color: "#16a34a", display: "flex" }}><CheckCircle2 size={20} /></span> : null}
        {col === "progress" ? (
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 9, color: "var(--dz-amber)", background: "color-mix(in srgb, var(--dz-amber) 15%, transparent)" }}>
            <Hourglass size={15} />
          </span>
        ) : null}
      </div>

      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--dz-ink)", lineHeight: 1.3, marginBottom: 8 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--dz-mute)", marginBottom: 12 }}>
        <BookOpen size={13} /> {entry.classroomName}
      </div>

      {col === "todo" ? (
        <>
          {entry.assignment.due_at ? (
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: "var(--dz-amber)", border: "1px solid color-mix(in srgb, var(--dz-amber) 35%, transparent)", background: "color-mix(in srgb, var(--dz-amber) 12%, transparent)", padding: "4px 10px", borderRadius: 8 }}>
                <Calendar size={13} /> {state === "OVERDUE" ? `Catch up · ${dueRel}` : `Due ${dueRel}`}
              </span>
            </div>
          ) : null}
          {category ? (
            <div style={{ display: "flex", gap: 7, marginBottom: 14, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--dz-mute)", background: "var(--dz-card)", padding: "4px 10px", borderRadius: 7 }}>{category}</span>
            </div>
          ) : null}
        </>
      ) : null}

      {col === "progress" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--dz-mute)", marginBottom: 14 }}>
          <Clock size={13} /> Continue where you left off
        </div>
      ) : null}

      {col === "done" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: state === "SUBMITTED" ? "var(--dz-mute)" : "#16a34a", marginBottom: 14 }}>
          <CheckCircle2 size={13} /> {state === "SUBMITTED" ? "Submitted — grading in progress" : "Completed & graded"}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        {col === "todo" ? (
          <ActionBtn
            primary
            disabled={starting}
            icon={starting ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}
            label={starting ? "Starting…" : "Start"}
            onClick={() => onStart(aid)}
          />
        ) : col === "progress" ? (
          <ActionBtn amber icon={<PlayCircle size={15} />} label="Resume" onClick={() => (entry.resumeHref ? onGo(entry.resumeHref) : onStart(aid))} />
        ) : (
          // Completed: just Review — retry now lives inside the review (result) page.
          <ActionBtn icon={<CheckCircle2 size={15} />} label={state === "SUBMITTED" ? "View" : "Review"} onClick={() => onGo(`/assessments/result/${aid}`)} />
        )}
      </div>
    </div>
  );
}

function ActionBtn({ label, icon, onClick, primary, amber, ghost, disabled }: {
  label: string; icon: React.ReactNode; onClick: () => void; primary?: boolean; amber?: boolean; ghost?: boolean; disabled?: boolean;
}) {
  const bg = primary ? "var(--dz-indigo)" : amber ? "var(--dz-amber)" : ghost ? "transparent" : "var(--dz-card)";
  const color = primary || amber ? "#fff" : "var(--dz-ink)";
  const border = ghost ? "1px solid var(--dz-border)" : "none";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="dz-actionbtn"
      style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 12px", borderRadius: 11, border, background: bg, color, fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.7 : 1 }}>
      {icon} {label}
    </button>
  );
}

function AssessError({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ border: "1.5px solid var(--dz-error-border)", borderRadius: 22, padding: "64px 40px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", background: "var(--dz-error-bg)" }}>
      <div style={{ width: 88, height: 88, borderRadius: 26, background: "var(--dz-error-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dz-error)", marginBottom: 22 }}>
        <AlertTriangle size={40} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>Couldn&apos;t load your assessments</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--dz-mute)", marginTop: 8, maxWidth: 440, lineHeight: 1.5 }}>
        Something went wrong on our end. Check your connection and try again.
      </div>
      <button type="button" onClick={onRetry} className="dz-joinbtn2"
        style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 26, padding: "13px 22px", borderRadius: 13, border: "none", background: "var(--dz-indigo)", fontFamily: "inherit", fontSize: 15, fontWeight: 700, color: "#fff", cursor: "pointer" }}>
        <RefreshCw size={18} /> Try again
      </button>
    </div>
  );
}

export default function AssessmentsPage() {
  return <AuthGuard><Board /></AuthGuard>;
}
