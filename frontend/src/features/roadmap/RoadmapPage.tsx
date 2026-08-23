"use client";

/**
 * Student Roadmap — a per-subject level ladder.
 *
 * Every level the subject actually offers is visible (English starts at Junior — it has no
 * Foundation course, and no Foundation rung is sent for it); only the student's OWN
 * level is unlocked (its lessons link to real released homework, with completion state).
 * Other levels are read-only outlines. Sourced entirely from GET /api/classes/roadmap/,
 * whose payload already decides what is openable — the greying here is cosmetic, the
 * server never emits an openable id for a locked lesson.
 *
 * Styling follows the live student pages' `.dzboard` token idiom (see ClassesHome), not
 * the components/ui Tailwind system, so it sits next to Classes/Assessments unchanged.
 */

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Route,
  Lock,
  CheckCircle2,
  Circle,
  PlayCircle,
  Trophy,
  ChevronDown,
  Calculator,
  BookOpen,
  GraduationCap,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import { useRoadmap } from "./hooks";
import type { RoadmapLesson, RoadmapLevel, RoadmapTrack } from "./types";

// Theme-aware green (light/dark values live on the .dzboard scope in globals.css) — a
// single hardcoded green can't clear AA contrast on both the near-white and near-black card.
const COMPLETED_GREEN = "var(--dz-success)";

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RoadmapPage() {
  // isPending (status), NOT isLoading (isPending && isFetching): react-query v5 defaults to
  // networkMode "online", so an offline mount pauses the fetch → isLoading is false while
  // there is still no data. Gating on isPending keeps that from falling through to the empty
  // state and telling an enrolled student they have no classes.
  const { data, isPending, isError, refetch } = useRoadmap();
  const tracks = useMemo(() => data?.tracks ?? [], [data]);

  const [subject, setSubject] = useState<string | null>(null);
  const activeSubject = subject ?? tracks[0]?.subject ?? null;
  const track = tracks.find((t) => t.subject === activeSubject) ?? tracks[0] ?? null;

  return (
    <div className="dzboard" style={{ maxWidth: 1040, width: "100%", margin: "0 auto" }}>
      <div className="dz-content">
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 20, flexWrap: "wrap", marginBottom: 20 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ margin: 0, fontSize: 38, lineHeight: 1.05, fontWeight: 800, letterSpacing: "-.03em", color: "var(--dz-ink)" }}>
              Roadmap
            </h1>
            <p style={{ margin: "8px 0 0", fontSize: 15, fontWeight: 500, color: "var(--dz-mute)", maxWidth: 560, lineHeight: 1.5 }}>
              See every level of your course. Your level is unlocked — the rest is your path ahead.
            </p>
          </div>
        </div>

        {/* Subject switcher (only when the student studies more than one subject) */}
        {!isPending && !isError && tracks.length > 1 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
            {tracks.map((t) => {
              const active = t.subject === activeSubject;
              const Icon = t.subject === "math" ? Calculator : BookOpen;
              return (
                <button
                  key={t.subject}
                  type="button"
                  onClick={() => setSubject(t.subject)}
                  className="dz-pill"
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    border: active ? "1px solid var(--dz-indigo)" : "1px solid var(--dz-border)",
                    background: active ? "var(--dz-indigo-soft)" : "var(--dz-panel)",
                    color: active ? "var(--dz-indigo)" : "var(--dz-mute)",
                  }}
                >
                  <Icon size={16} /> {t.subject_label}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Body */}
        {isPending ? (
          <RoadmapLoading />
        ) : isError ? (
          <RoadmapError onRetry={() => refetch()} />
        ) : !track ? (
          <RoadmapEmpty />
        ) : (
          <TrackView track={track} />
        )}
      </div>
    </div>
  );
}

function TrackView({ track }: { track: RoadmapTrack }) {
  return (
    <div>
      {/* Own-level banner */}
      {track.own_level_label ? (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 18, padding: "12px 16px",
            borderRadius: 14, border: "1px solid var(--dz-indigo)", background: "var(--dz-indigo-soft)",
          }}
        >
          <Route size={18} style={{ color: "var(--dz-indigo)" }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--dz-indigo)" }}>
            You are on the {track.own_level_label} level.
          </span>
        </div>
      ) : (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 18, padding: "12px 16px",
            borderRadius: 14, border: "1px solid var(--dz-amber)", background: "var(--dz-amber-soft)",
          }}
        >
          <AlertTriangle size={18} style={{ color: "var(--dz-amber)" }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--dz-amber)" }}>
            Your level for this subject isn&apos;t set yet — ask your teacher.
          </span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {track.levels.map((lvl) => (
          <LevelSection key={lvl.level} level={lvl} ownClassroomId={track.own_classroom_id} />
        ))}
      </div>
    </div>
  );
}

type Status = { label: string; fg: string; bg: string; border: string; Icon: React.ElementType };

// Every rung the payload carries is a level the subject genuinely teaches (English simply
// has no Foundation rung), so there is no "not offered" state to render here — the ladder
// only ever holds real steps on the student's path.
function levelStatus(level: RoadmapLevel): Status {
  if (level.is_own_level)
    return { label: "Your level", fg: "#fff", bg: "var(--dz-indigo)", border: "var(--dz-indigo)", Icon: Route };
  if (!level.journal_published)
    return { label: "Coming soon", fg: "var(--dz-amber)", bg: "var(--dz-amber-soft)", border: "var(--dz-amber)", Icon: Circle };
  return { label: "Locked", fg: "var(--dz-mute)", bg: "var(--dz-panel)", border: "var(--dz-border)", Icon: Lock };
}

function LevelSection({ level, ownClassroomId }: { level: RoadmapLevel; ownClassroomId: number | null }) {
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const open = openOverride ?? level.is_own_level; // own level expanded by default
  const st = levelStatus(level);
  const canToggle = level.lessons.length > 0;
  const bodyId = useId();

  return (
    <div
      className="dz-card"
      style={{
        border: level.is_own_level ? "1.5px solid var(--dz-indigo)" : "1px solid var(--dz-border)",
        borderRadius: 18,
        background: "var(--dz-card)",
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => canToggle && setOpenOverride(!open)}
        aria-expanded={canToggle ? open : undefined}
        aria-controls={canToggle ? bodyId : undefined}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "16px 18px",
          border: "none", background: "transparent", cursor: canToggle ? "pointer" : "default",
          textAlign: "left", fontFamily: "inherit",
        }}
      >
        <div
          style={{
            width: 44, height: 44, borderRadius: 13, flexShrink: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            background: level.is_own_level ? "var(--dz-indigo)" : "var(--dz-indigo-soft)",
            color: level.is_own_level ? "#fff" : "var(--dz-indigo)",
          }}
        >
          <st.Icon size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>
            {level.level_label}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dz-mute)", marginTop: 3 }}>
            {level.journal_published
              ? `${level.lesson_count} ${level.lesson_count === 1 ? "lesson" : "lessons"}`
              : "Being prepared"}
          </div>
        </div>
        <span
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 999,
            fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap",
            color: st.fg, background: st.bg, border: `1px solid ${st.border}`,
          }}
        >
          {st.label}
        </span>
        {canToggle ? (
          <ChevronDown
            size={20}
            style={{ color: "var(--dz-mute)", transition: "transform .2s", transform: open ? "rotate(180deg)" : "none", flexShrink: 0 }}
          />
        ) : null}
      </button>

      {/* Body */}
      {open ? (
        <div id={bodyId} style={{ borderTop: "1px solid var(--dz-border)", padding: "6px 10px 12px" }}>
          {level.lessons.length === 0 ? (
            <div style={{ padding: "18px 12px", fontSize: 14, fontWeight: 500, color: "var(--dz-mute)" }}>
              {/* The only way a rung reaches this branch now is an unpublished journal. */}
              Lessons for this level are being prepared.
            </div>
          ) : level.is_own_level ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {level.lessons.map((les) => (
                <OwnLessonRow key={les.lesson_number} lesson={les} ownClassroomId={ownClassroomId} />
              ))}
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 12px 10px",
                  fontSize: 12.5, fontWeight: 700, color: "var(--dz-faint)",
                }}
              >
                <Lock size={13} /> Reach this level to unlock these lessons.
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {level.lessons.map((les) => (
                  <LockedLessonRow key={les.lesson_number} lesson={les} />
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ownState(lesson: RoadmapLesson): Status {
  if (lesson.is_midterm)
    return { label: "Milestone", fg: "var(--dz-amber)", bg: "var(--dz-amber-soft)", border: "var(--dz-amber)", Icon: Trophy };
  if (lesson.state === "completed")
    return { label: "Completed", fg: COMPLETED_GREEN, bg: "transparent", border: "transparent", Icon: CheckCircle2 };
  if (lesson.state === "available")
    return { label: "Open", fg: "var(--dz-indigo)", bg: "transparent", border: "transparent", Icon: PlayCircle };
  return { label: "Upcoming", fg: "var(--dz-mute)", bg: "transparent", border: "transparent", Icon: Circle };
}

function OwnLessonRow({ lesson, ownClassroomId }: { lesson: RoadmapLesson; ownClassroomId: number | null }) {
  const router = useRouter();
  const st = ownState(lesson);
  const openable = !!(lesson.assignment_id && ownClassroomId);
  const go = () => {
    if (openable) router.push(`/classes/${ownClassroomId}/assignments/${lesson.assignment_id}`);
  };
  const date = fmtDate(lesson.scheduled_for);

  return (
    <div
      onClick={openable ? go : undefined}
      role={openable ? "button" : undefined}
      tabIndex={openable ? 0 : undefined}
      onKeyDown={openable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } } : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 13, padding: "12px 12px", borderRadius: 12,
        cursor: openable ? "pointer" : "default",
      }}
      className={openable ? "dz-lessonrow" : undefined}
    >
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: st.fg }}>
        <st.Icon size={22} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--dz-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={{ color: "var(--dz-faint)", fontWeight: 800, marginRight: 8 }}>{lesson.lesson_number}</span>
          {lesson.title}
        </div>
        {date ? (
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dz-mute)", marginTop: 2 }}>{date}</div>
        ) : null}
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: st.fg, whiteSpace: "nowrap" }}>{st.label}</span>
      {openable ? <ArrowRight size={16} style={{ color: "var(--dz-mute)", flexShrink: 0 }} /> : null}
    </div>
  );
}

function LockedLessonRow({ lesson }: { lesson: RoadmapLesson }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 12px", opacity: 0.7 }}>
      <div style={{ flexShrink: 0, color: "var(--dz-faint)", display: "flex", alignItems: "center" }}>
        {lesson.is_midterm ? <Trophy size={20} /> : <Circle size={18} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--dz-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={{ color: "var(--dz-faint)", fontWeight: 800, marginRight: 8 }}>{lesson.lesson_number}</span>
          {lesson.title}
        </div>
      </div>
      {lesson.is_midterm ? (
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--dz-faint)", whiteSpace: "nowrap" }}>Midterm</span>
      ) : null}
    </div>
  );
}

/* ── States (loading / error / empty — the four-branch rule) ─────────────── */

function RoadmapLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="dz-skel" style={{ height: 76, borderRadius: 18 }} />
      ))}
    </div>
  );
}

function RoadmapError({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ border: "1.5px solid var(--dz-error-border)", borderRadius: 22, padding: "64px 40px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", background: "var(--dz-error-bg)" }}>
      <div style={{ width: 88, height: 88, borderRadius: 26, background: "var(--dz-error-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dz-error)", marginBottom: 22 }}>
        <AlertTriangle size={40} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>Couldn&apos;t load your roadmap</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--dz-mute)", marginTop: 8, maxWidth: 440, lineHeight: 1.5 }}>
        Something went wrong on our end. Check your connection and try again.
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="dz-joinbtn2"
        style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 26, padding: "13px 22px", borderRadius: 13, border: "none", background: "var(--dz-indigo)", fontFamily: "inherit", fontSize: 15, fontWeight: 700, color: "#fff", cursor: "pointer" }}
      >
        <RefreshCw size={18} /> Try again
      </button>
    </div>
  );
}

function RoadmapEmpty() {
  const router = useRouter();
  return (
    <div style={{ border: "1.5px dashed var(--dz-border)", borderRadius: 22, padding: "64px 40px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", background: "var(--dz-card)" }}>
      <div style={{ width: 88, height: 88, borderRadius: 26, background: "var(--dz-indigo-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dz-indigo)", marginBottom: 22 }}>
        <GraduationCap size={40} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)" }}>No roadmap yet</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--dz-mute)", marginTop: 8, maxWidth: 420, lineHeight: 1.5 }}>
        Join a class to see your learning path across every level.
      </div>
      <button
        type="button"
        onClick={() => router.push("/classes")}
        className="dz-joinbtn2"
        style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 26, padding: "13px 22px", borderRadius: 13, border: "none", background: "var(--dz-indigo)", fontFamily: "inherit", fontSize: 15, fontWeight: 700, color: "#fff", cursor: "pointer" }}
      >
        Go to Classes <ArrowRight size={18} />
      </button>
    </div>
  );
}
