"use client";

/**
 * Student Roadmap — the course as a path you walk, one illustrated level at a time.
 *
 * Built 1:1 from the approved mockup (`mastersat-roadmap-v9.html`), the same way the student
 * dashboard was: a scoped `.rmap` block in globals.css holds the palette, the 3-D button
 * shadows and the animations so none of it leaks into the rest of the app.
 *
 * It replaces a vertical list of level cards. The data behind it is unchanged — the same
 * `GET /api/classes/roadmap/` payload, the same rule that only the student's OWN level is
 * openable — but a list answered "what is in this course" while a student mostly wants to
 * know "where am I, and what is next". A path answers that without being read.
 *
 * **Level state is derived here, not sent.** The server says which level `is_own_level` and
 * whether each level's journal is published; everything below that rung is done, everything
 * above it is locked, and a level with no published journal is coming soon. Deriving it in one
 * function keeps the banner, the veil and the circles from ever disagreeing.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  CircleDot,
  Clock,
  Check,
  GraduationCap,
  Lock,
  RefreshCw,
} from "lucide-react";

import { useRoadmap } from "./hooks";
import { RoadmapStage } from "./RoadmapStage";
import { sceneKeyFor } from "./scenes";
import type { RoadmapLevel, RoadmapTrack } from "./types";

type LevelState = "done" | "current" | "locked" | "coming_soon";

/**
 * Where this rung sits relative to the student.
 *
 * `ownIndex < 0` means the track never names an own level — a student between classes, or one
 * whose classroom has no level set. Everything then reads as `coming_soon` rather than
 * `locked`: nothing is being withheld from them, the ladder simply has no "you are here" yet,
 * and a wall of padlocks would say the wrong thing.
 */
function levelStateFor(level: RoadmapLevel, index: number, ownIndex: number): LevelState {
  if (!level.journal_published) return "coming_soon";
  if (ownIndex < 0) return "coming_soon";
  if (index < ownIndex) return "done";
  if (index === ownIndex) return "current";
  return "locked";
}

function Pill({ state }: { state: LevelState }) {
  if (state === "coming_soon") {
    return (
      <span className="rm-pill">
        <Clock size={14} strokeWidth={2.4} aria-hidden /> Coming soon
      </span>
    );
  }
  if (state === "locked") {
    return (
      <span className="rm-pill">
        <Lock size={14} strokeWidth={2.4} aria-hidden /> Locked
      </span>
    );
  }
  if (state === "done") {
    return (
      <span className="rm-pill">
        <Check size={14} strokeWidth={2.8} aria-hidden /> Completed
      </span>
    );
  }
  return (
    <span className="rm-pill">
      <CircleDot size={14} strokeWidth={2.4} aria-hidden /> Your level
    </span>
  );
}

function LevelSection({
  track,
  level,
  index,
  ownIndex,
}: {
  track: RoadmapTrack;
  level: RoadmapLevel;
  index: number;
  ownIndex: number;
}) {
  const state = levelStateFor(level, index, ownIndex);
  // Open the student's own level, closed elsewhere — the page is very tall and opening all of
  // them would bury the one rung they came to see.
  const [open, setOpen] = useState(state === "current");
  const sceneKey = sceneKeyFor(track.subject, level.level);

  const done = level.lessons.filter((l) => l.state === "completed").length;
  const subtitle = level.lessons.length
    ? state === "current"
      ? `${done} of ${level.lessons.length} lessons done`
      : `${level.lessons.length} lessons`
    : "Lessons are being prepared";

  return (
    <section className="rm-lv" data-state={state} data-open={open}>
      <button
        type="button"
        className="rm-banner"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          <b>{level.level_label}</b>
          <span className="rm-sub">{subtitle}</span>
        </span>
        <Pill state={state} />
        <span className="rm-chev">
          <ChevronDown size={22} strokeWidth={2.6} aria-hidden />
        </span>
      </button>

      {open ? (
        <RoadmapStage
          level={level}
          sceneKey={sceneKey}
          levelLocked={state === "locked"}
          ownClassroomId={track.own_classroom_id}
        />
      ) : null}
    </section>
  );
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

  const ownIndex = track ? track.levels.findIndex((l) => l.is_own_level) : -1;

  // Land the student on their own level rather than at the top of a very long page. Once per
  // subject, and never fighting a scroll they have already started — `jumped` makes the jump
  // a one-shot, so React re-rendering the list cannot yank the page back.
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    if (!track || isPending) return;
    if (jumped.current === track.subject) return;
    jumped.current = track.subject;
    const id = window.setTimeout(() => {
      document
        .querySelector('.rmap .rm-node[data-state="current"]')
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 300);
    return () => window.clearTimeout(id);
  }, [track, isPending]);

  return (
    <div className="rmap" style={{ maxWidth: 720, width: "100%", margin: "0 auto", padding: "4px 0 80px" }}>
      <header className="rm-head" style={{ marginBottom: 16 }}>
        <h1>Roadmap</h1>
        <p>Your path, step by step. Finish a level to open the next one.</p>
      </header>

      {!isPending && !isError && tracks.length > 1 ? (
        <div className="rm-subjects" role="tablist" aria-label="Subject">
          {tracks.map((t) => (
            <button
              key={t.subject}
              type="button"
              role="tab"
              className="rm-subject"
              aria-selected={t.subject === activeSubject}
              onClick={() => setSubject(t.subject)}
            >
              {t.subject_label}
            </button>
          ))}
        </div>
      ) : null}

      {isPending ? (
        <RoadmapLoading />
      ) : isError ? (
        <RoadmapError onRetry={() => void refetch()} />
      ) : !track || track.levels.length === 0 ? (
        <RoadmapEmpty />
      ) : (
        <div>
          {track.levels.map((level, i) => (
            <LevelSection
              key={`${track.subject}-${level.level}`}
              track={track}
              level={level}
              index={i}
              ownIndex={ownIndex}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RoadmapLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="dz-skel" style={{ height: 76, borderRadius: 20 }} />
      ))}
    </div>
  );
}

function RoadmapError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      style={{
        border: "1.5px solid var(--rm-line)", borderRadius: 22, padding: "64px 40px",
        textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center",
        background: "var(--rm-surface)",
      }}
    >
      <div
        style={{
          width: 88, height: 88, borderRadius: 26, background: "rgba(220,38,38,.1)",
          display: "flex", alignItems: "center", justifyContent: "center", color: "#dc2626",
          marginBottom: 22,
        }}
      >
        <AlertTriangle size={40} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--rm-ink)" }}>
        Couldn&apos;t load your roadmap
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--rm-ink-2)", marginTop: 8, maxWidth: 440, lineHeight: 1.5 }}>
        Something went wrong on our end. Check your connection and try again.
      </div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          display: "flex", alignItems: "center", gap: 9, marginTop: 26, padding: "13px 22px",
          borderRadius: 15, border: "none", background: "var(--rm-brand)",
          boxShadow: "0 5px 0 var(--rm-brand-d)", fontFamily: "var(--rm-font-round)",
          fontSize: 15, fontWeight: 800, color: "#fff", cursor: "pointer",
        }}
      >
        <RefreshCw size={18} /> Try again
      </button>
    </div>
  );
}

function RoadmapEmpty() {
  const router = useRouter();
  return (
    <div
      style={{
        border: "1.5px dashed var(--rm-line)", borderRadius: 22, padding: "64px 40px",
        textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center",
        background: "var(--rm-stage)",
      }}
    >
      <div
        style={{
          width: 88, height: 88, borderRadius: 26, background: "rgba(37,99,235,.12)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--rm-brand)", marginBottom: 22,
        }}
      >
        <GraduationCap size={40} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--rm-ink)" }}>No roadmap yet</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--rm-ink-2)", marginTop: 8, maxWidth: 420, lineHeight: 1.5 }}>
        Join a class to see your learning path across every level.
      </div>
      <button
        type="button"
        onClick={() => router.push("/classes")}
        style={{
          display: "flex", alignItems: "center", gap: 9, marginTop: 26, padding: "13px 22px",
          borderRadius: 15, border: "none", background: "var(--rm-brand)",
          boxShadow: "0 5px 0 var(--rm-brand-d)", fontFamily: "var(--rm-font-round)",
          fontSize: 15, fontWeight: 800, color: "#fff", cursor: "pointer",
        }}
      >
        Go to Classes <ArrowRight size={18} />
      </button>
    </div>
  );
}

export default RoadmapPage;
