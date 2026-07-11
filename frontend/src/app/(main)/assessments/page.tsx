"use client";

/**
 * /assessments — Student assessment workspace, a 3-column board
 * (To-do / In progress / Completed) matched 1:1 to the MasterSAT Assessments mockup.
 * Uses the shared `.dzboard` design scope. Data: GET /api/classes/my-assignments/.
 *
 * Card variants:
 *  - To-do      → question count · ~time, due chip, category tags, Start
 *  - In progress→ Progress N/M + bar, "Last opened …", Continue
 *  - Completed  → big score % + "N / M correct" + green bar, "Review N missed",
 *                 Review (outlined) + retry icon
 *
 * Growth-oriented framing — no "Overdue"/"Failed" wording (see memory); a past
 * deadline reads as "Catch up · <day>".
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen, Calculator, Clock, Calendar, CheckCircle2,
  PlayCircle, RefreshCw, AlertTriangle, Hourglass, Loader2, Flag, Search,
} from "lucide-react";
import AuthGuard from "@/components/AuthGuard";
import { classesApi } from "@/lib/api";
import type { Assignment } from "@/lib/criticalApiContract";
import { useStartAttempt } from "@/features/assessments/hooks";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";

// ─── Types ──────────────────────────────────────────────────────────────────

type AssessmentSet = { id: number; subject: string; category: string; title: string; description: string };
type AssessmentProgress = {
  state: string;
  workflow_status?: string | null;
  attempt_id?: number | null;
  graded?: boolean;
  percent?: number;
  correct_count?: number;
  total_questions?: number;
  missed_count?: number;
  answered_count?: number;
  last_activity_at?: string | null;
};
type AssessmentHomework = { homework_id: number; set?: AssessmentSet | null; progress?: AssessmentProgress | null };
type AssignmentWithStatus = Assignment & {
  assessment_homeworks?: AssessmentHomework[] | null;
  assessment_homework?: AssessmentHomework | null;
  workflow_status?: string | null;
  item_count?: number | null;
};
// One card per ASSESSMENT (a homework can bundle several) — keyed by homework_id.
type Entry = {
  assignment: AssignmentWithStatus;
  hw: AssessmentHomework;
  classroomId: number;
  classroomName: string;
  subject?: string;
};

type State = "IN_PROGRESS" | "SUBMITTED" | "COMPLETED" | "NOT_STARTED";

function deriveState(e: Entry): State {
  const ws = e.hw.progress?.workflow_status;
  if (ws === "graded" || ws === "completed") return "COMPLETED";
  if (ws === "submitted") return "SUBMITTED";
  if (ws === "in_progress") return "IN_PROGRESS";
  return "NOT_STARTED";
}

type ColKey = "todo" | "progress" | "done";
function colOf(s: State): ColKey {
  if (s === "IN_PROGRESS") return "progress";
  if (s === "COMPLETED" || s === "SUBMITTED") return "done";
  return "todo";
}

const COLUMNS: { key: ColKey; name: string; dot: string; emptyHint: string }[] = [
  { key: "todo", name: "To do", dot: "var(--dz-indigo)", emptyHint: "New work from your teachers shows up here." },
  { key: "progress", name: "In progress", dot: "var(--dz-amber)", emptyHint: "Anything you've started appears here." },
  { key: "done", name: "Completed", dot: "#16a34a", emptyHint: "Finished work lands here." },
];

// Math → blue, English/R&W → purple (matches the MasterSAT Assessments mockup).
// Subjects arrive in either platform form (MATH / READING_WRITING) or domain
// form (math / english), so normalise case before matching.
function subjectStyle(subject?: string): { label: string; isMath: boolean; accent: string; soft: string } {
  const s = (subject || "").toUpperCase();
  if (s === "MATH") return { label: "Math", isMath: true, accent: "var(--dz-indigo)", soft: "var(--dz-indigo-soft)" };
  if (s === "ENGLISH" || s === "READING_WRITING" || s === "READING" || s === "RW")
    return { label: "English", isMath: false, accent: "#6d4ec7", soft: "rgba(109,78,199,.14)" };
  const label = subject ? subject.charAt(0).toUpperCase() + subject.slice(1) : "General";
  return { label, isMath: false, accent: "var(--dz-indigo)", soft: "var(--dz-indigo-soft)" };
}

/** "Due Fri" / "Due Jul 12"; a past deadline reads "Catch up · <day>" (never "overdue"). */
function dueLabel(iso?: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const overdue = d.getTime() < Date.now();
  const days = Math.abs(Math.round((d.getTime() - Date.now()) / 86_400_000));
  const label =
    days <= 6
      ? d.toLocaleDateString("en-US", { weekday: "short" })
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { text: overdue ? `Catch up · ${label}` : `Due ${label}`, overdue };
}

/** Relative "…ago" for the in-progress "Last opened" line. */
function timeAgo(iso?: string | null): string {
  if (!iso) return "recently";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recently";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000), h = Math.floor(diff / 3_600_000), day = Math.floor(diff / 86_400_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** SAT-style estimate ≈ 1.25 min / question. */
function estMinutes(q: number): number {
  return Math.max(1, Math.round(q * 1.25));
}

/** Lowercased searchable text for one card (title, class, subject, category). */
function entryHaystack(e: Entry): string {
  const set = e.hw.set;
  return [
    set?.title ?? e.assignment.title ?? "",
    e.classroomName,
    subjectStyle(e.subject).label,
    set?.category ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function Board() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");

  // Start (or resume) the assessment directly from the card — no intermediate
  // launcher page. The backend reuses an in-progress attempt or creates a fresh one.
  const start = useStartAttempt();
  const [startingId, setStartingId] = useState<number | null>(null);
  // Start (or resume) a specific assessment by its homework id.
  const beginAssessment = async (homeworkId: number) => {
    if (startingId != null) return;
    setStartingId(homeworkId);
    try {
      const att = await start.mutateAsync({ homework_id: homeworkId });
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
        // A homework can bundle several assessments — one card per assessment.
        const hws = rich.assessment_homeworks
          ?? (rich.assessment_homework ? [rich.assessment_homework] : []);
        if (!hws.length) continue;
        const classroomId = rich.classroom_id ?? 0;
        const classroomName = rich.classroom_name ?? `Class #${classroomId}`;
        for (const hw of hws) {
          collected.push({ assignment: rich, hw, classroomId, classroomName, subject: hw.set?.subject });
        }
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
    const q = query.trim().toLowerCase();
    for (const e of entries) {
      if (q && !entryHaystack(e).includes(q)) continue;
      m[colOf(deriveState(e))].push(e);
    }
    return m;
  }, [entries, query]);
  const matchCount = byCol.todo.length + byCol.progress.length + byCol.done.length;

  return (
    <div className="dzboard" style={{ maxWidth: 1280, width: "100%", margin: "0 auto" }}>
      <div className="dz-content">
        <div style={{ display: "flex", alignItems: "flex-end", gap: 24, flexWrap: "wrap", marginBottom: 22 }}>
          <h1 style={{ flex: 1, minWidth: 280, margin: 0, fontSize: 38, lineHeight: 1.05, fontWeight: 800, letterSpacing: "-.03em", color: "var(--dz-ink)" }}>
            My assessments
          </h1>
          <div className="dz-headin" style={{ position: "relative", width: "100%", maxWidth: 340 }}>
            <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--dz-faint)", display: "flex", pointerEvents: "none" }}>
              <Search size={17} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search assessments…"
              aria-label="Search assessments"
              style={{ width: "100%", border: "1px solid var(--dz-border)", background: "var(--dz-panel)", borderRadius: 12, padding: "11px 14px 11px 44px", fontFamily: "inherit", fontSize: 14, fontWeight: 600, color: "var(--dz-ink)", outline: "none" }}
            />
          </div>
        </div>

        {!loading && !error && query.trim() && matchCount === 0 ? (
          <div style={{ marginBottom: 18, border: "1.5px dashed var(--dz-border)", borderRadius: 13, padding: "22px 16px", textAlign: "center", color: "var(--dz-mute)", fontSize: 14, fontWeight: 600 }}>
            No assessments match “{query.trim()}”.
          </div>
        ) : null}

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
                      <div key={i} className="dz-skel" style={{ height: 150, borderRadius: 14 }} />
                    ))
                  ) : byCol[col.key].length === 0 ? (
                    <div style={{ border: "1.5px dashed var(--dz-border)", borderRadius: 13, padding: "26px 16px", textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--dz-mute)" }}>Nothing here</div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--dz-faint)", marginTop: 3 }}>{col.emptyHint}</div>
                    </div>
                  ) : (
                    byCol[col.key].map((e) => (
                      <AssessCard
                        key={`${e.classroomId}-${e.assignment.id}-${e.hw.homework_id}`}
                        entry={e}
                        onGo={(href) => router.push(href)}
                        onStart={beginAssessment}
                        starting={startingId === e.hw.homework_id}
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

function AssessCard({ entry, onGo, onStart, starting }: { entry: Entry; onGo: (href: string) => void; onStart: (homeworkId: number) => void; starting: boolean }) {
  const state = deriveState(entry);
  const a = entry.assignment;
  const hw = entry.hw;
  const set = hw.set;
  const prog = hw.progress ?? null;
  // Prefer the assessment's own title; fall back to the homework title.
  const title = set?.title ?? a.title ?? "Assignment";
  const subj = subjectStyle(set?.subject ?? entry.subject);
  const category = set?.category;
  const aid = a.id;
  const hwId = hw.homework_id;
  const col = colOf(state);
  const accent = subj.accent;
  const soft = subj.soft;

  // Category → tags (a set carries one category; split on comma/slash if authored that way).
  const tags = (category ? category.split(/[,/·]/).map((t) => t.trim()).filter(Boolean) : []).slice(0, 3);
  const qCount = prog?.total_questions ?? 0;
  const resumeHref = prog?.attempt_id ? `/assessments/attempt/${prog.attempt_id}` : undefined;

  return (
    <div className="dz-statecard" style={{ background: "var(--dz-panel)", border: "1px solid var(--dz-border)", borderTop: `3px solid ${accent}`, borderRadius: 14, padding: 16, cursor: "default" }}>
      {/* Header: icon tile + solid subject badge + status glyph */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, background: soft, color: accent, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          {subj.isMath ? <Calculator size={18} /> : <BookOpen size={18} />}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, color: "#fff", background: accent, padding: "4px 10px", borderRadius: 8 }}>
          {subj.isMath ? <Calculator size={12} /> : <BookOpen size={12} />} {subj.label}
        </span>
        <div style={{ flex: 1 }} />
        {col === "done" ? (
          <span style={{ color: "#16a34a", display: "flex" }}><CheckCircle2 size={20} /></span>
        ) : col === "progress" ? (
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 9, color: "var(--dz-amber)", background: "color-mix(in srgb, var(--dz-amber) 15%, transparent)" }}>
            <Hourglass size={15} />
          </span>
        ) : null}
      </div>

      {/* Title + class · subject subtitle */}
      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--dz-ink)", lineHeight: 1.3, marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--dz-mute)", marginBottom: 12 }}>
        <BookOpen size={13} /> {entry.classroomName} · {subj.label}
      </div>

      {col === "todo" ? <TodoBody qCount={qCount} due={a.due_at} tags={tags} /> : null}
      {col === "progress" ? <ProgressBody prog={prog} qCount={qCount} /> : null}
      {col === "done" ? <DoneBody state={state} prog={prog} /> : null}

      {/* Actions */}
      {col === "todo" ? (
        <ActionBtn
          primary
          disabled={starting}
          icon={starting ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}
          label={starting ? "Starting…" : "Start"}
          onClick={() => onStart(hwId)}
        />
      ) : col === "progress" ? (
        <ActionBtn amber icon={<PlayCircle size={15} />} label="Continue" onClick={() => (resumeHref ? onGo(resumeHref) : onStart(hwId))} />
      ) : (
        // Completed: just Review — retry lives inside the result/review page.
        <ActionBtn outline icon={<CheckCircle2 size={15} />} label={state === "SUBMITTED" ? "View" : "Review"} onClick={() => onGo(`/assessments/result/${aid}?homework=${hwId}`)} />
      )}
    </div>
  );
}

// ─── Card bodies ────────────────────────────────────────────────────────────

function TodoBody({ qCount, due, tags }: { qCount: number; due?: string | null; tags: string[] }) {
  const dl = dueLabel(due);
  return (
    <>
      {qCount > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--dz-mute)", marginBottom: dl || tags.length ? 12 : 14 }}>
          <Clock size={13} /> {qCount} questions · ~{estMinutes(qCount)} min
        </div>
      ) : null}
      {dl ? (
        <div style={{ marginBottom: tags.length ? 12 : 14 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: "#dc2626", background: "color-mix(in srgb, #dc2626 12%, transparent)", border: "1px solid color-mix(in srgb, #dc2626 30%, transparent)", padding: "4px 10px", borderRadius: 8 }}>
            <Calendar size={13} /> {dl.text}
          </span>
        </div>
      ) : null}
      {tags.length ? (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
          {tags.map((t) => (
            <span key={t} style={{ fontSize: 11, fontWeight: 700, color: "var(--dz-mute)", background: "var(--dz-card)", padding: "4px 10px", borderRadius: 7 }}>{t}</span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function ProgressBody({ prog, qCount }: { prog: AssessmentProgress | null; qCount: number }) {
  const total = prog?.total_questions || qCount || 0;
  const answered = prog?.answered_count ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--dz-mute)" }}>Progress</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--dz-ink)" }}>{answered} / {total}</span>
      </div>
      <Bar pct={pct} fill="var(--dz-amber)" />
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--dz-mute)", margin: "12px 0 14px" }}>
        <Clock size={13} /> Last opened {timeAgo(prog?.last_activity_at)}
      </div>
    </>
  );
}

function DoneBody({ state, prog }: { state: State; prog: AssessmentProgress | null }) {
  // Submitted but not yet graded — no score to show.
  if (state === "SUBMITTED" || !prog?.graded) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--dz-mute)", marginBottom: 14 }}>
        <Clock size={13} /> Submitted — grading in progress
      </div>
    );
  }
  const percent = prog.percent ?? 0;
  const correct = prog.correct_count ?? 0;
  const total = prog.total_questions ?? 0;
  const missed = prog.missed_count ?? Math.max(total - correct, 0);
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1, color: "var(--dz-ink)" }}>{percent}%</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--dz-mute)", paddingBottom: 2 }}>{correct} / {total} correct</span>
      </div>
      <Bar pct={percent} fill="#16a34a" />
      {missed > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, color: "var(--dz-indigo)", margin: "12px 0 14px" }}>
          <Flag size={13} /> Review {missed} missed
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800, color: "#16a34a", margin: "12px 0 14px" }}>
          <CheckCircle2 size={13} /> Perfect score
        </div>
      )}
    </>
  );
}

function Bar({ pct, fill }: { pct: number; fill: string }) {
  return (
    <div style={{ height: 8, borderRadius: 6, background: "var(--dz-card)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: fill, borderRadius: 6, transition: "width .3s ease" }} />
    </div>
  );
}

function ActionBtn({ label, icon, onClick, primary, amber, outline, disabled }: {
  label: string; icon: React.ReactNode; onClick: () => void; primary?: boolean; amber?: boolean; outline?: boolean; disabled?: boolean;
}) {
  const bg = primary ? "var(--dz-indigo)" : amber ? "var(--dz-amber)" : "transparent";
  const color = primary || amber ? "#fff" : "var(--dz-indigo)";
  const border = outline ? "1.5px solid var(--dz-indigo)" : "none";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="dz-actionbtn"
      style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "11px 14px", borderRadius: 11, border, background: bg, color, fontFamily: "inherit", fontSize: 14, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.7 : 1 }}>
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
