"use client";

/**
 * /teacher/students — every student the teacher teaches, and what is known about each one.
 *
 * Teachers do not usually arrive here browsing. They arrive from the analytics page's own
 * prompts — "Check in with 3 at-risk students", "Re-engage 2 inactive students" — which means
 * they arrive already knowing WHO they came for. Two things answer that: the model hands the
 * list back with the at-risk students first, and each filter button carries the number of
 * students it would leave on screen, so those three are one press away rather than a scroll
 * through everyone.
 *
 * Read-only. A tile opens what is known about one student; nothing here changes a grade.
 */

import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Activity, ClipboardCheck, Clock, Gauge, ShieldAlert } from "lucide-react";
import {
  CARD_SURFACE, Card, Dialog, EmptyState, ErrorState, Pill, Skeleton, TeacherPage,
  TONE_INK, TONE_WASH, type Tone,
} from "./ui";
import { useTeacherAnalytics, type RiskLevel, type StudentRecord, type TeacherAnalyticsModel } from "./useTeacherAnalytics";

const RISK: Record<RiskLevel, { label: string; tone: Tone }> = {
  "at-risk": { label: "At risk", tone: "warning" },
  watch: { label: "Watch", tone: "info" },
  "on-track": { label: "On track", tone: "success" },
};

/** The same seven days the model's own "watch" rule uses, so the filter and the flag agree. */
function isActive(s: StudentRecord) { return s.inactiveDays == null || s.inactiveDays < 7; }

const OVERLINE: CSSProperties = {
  margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: ".04em",
  textTransform: "uppercase", color: "var(--dz-faint)",
};

/** A name that does not fit loses its end, not the line it sits on. */
const TRUNCATE: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

export function TeacherStudents({ previewModel }: { previewModel?: TeacherAnalyticsModel }) {
  const { status, model, error, retry } = useTeacherAnalytics(previewModel);
  const [classId, setClassId] = useState<number | "all">("all");
  const [risk, setRisk] = useState<RiskLevel | "all">("all");
  const [activity, setActivity] = useState<"all" | "active" | "inactive">("all");
  const [detail, setDetail] = useState<StudentRecord | null>(null);

  const byClass = useMemo(
    () => (model ? model.students.filter((s) => classId === "all" || s.classId === classId) : []),
    [model, classId],
  );
  const matchesRisk = (s: StudentRecord) => risk === "all" || s.riskLevel === risk;
  const matchesActivity = (s: StudentRecord) =>
    activity === "all" || (activity === "active" ? isActive(s) : !isActive(s));

  const filtered = byClass.filter((s) => matchesRisk(s) && matchesActivity(s));

  /**
   * What a filter button would leave on screen. Counted against the OTHER filters' result
   * rather than against the whole model: with one class open, "At risk 4" must not be counting
   * the two at-risk students of a class the teacher is not looking at, or the press that
   * follows it lands on a shorter list than the button promised.
   */
  const riskCount = (level: RiskLevel | "all") =>
    byClass.filter((s) => (level === "all" || s.riskLevel === level) && matchesActivity(s)).length;
  const activityCount = (which: "all" | "active" | "inactive") =>
    byClass.filter((s) => matchesRisk(s) && (which === "all" || (which === "active" ? isActive(s) : !isActive(s)))).length;

  const students = model?.students.length ?? 0;

  return (
    <TeacherPage
      title="Students"
      subtitle={status === "ready" && model ? `${students} ${students === 1 ? "student" : "students"} · ${model.atRiskCount} at risk` : undefined}
    >
      {status === "booting" ? (
        <div
          // The region says it is working. Without it a page mid-load is indistinguishable from
          // a page with nothing on it — to a screen reader, and to the tests that watch for the
          // moment this page has settled.
          aria-busy="true"
          style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={132} radius={24} />)}
        </div>
      ) : status === "unauthenticated" ? (
        <Card>
          <EmptyState title="Sign in with a teacher account" />
        </Card>
      ) : status === "error" ? (
        <Card>
          {/* Before the empty state, always. A class list that did not load is not a teacher
              with no students, and drawing it as one tells them their classes are gone. */}
          <ErrorState
            title="Couldn’t load your students"
            detail={error?.detail ?? "Your students and their work are unchanged — only this page failed to load."}
            onRetry={retry}
          />
        </Card>
      ) : status === "empty" || !model ? (
        <Card>
          <EmptyState title="No students yet" hint="Students appear here once you have classes with members." />
        </Card>
      ) : (
        <>
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              {/* One class is not a choice. The chips appear only when there is something to pick. */}
              {model.classes.length > 1 && (
                <div role="group" aria-label="Class" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <Chip active={classId === "all"} onClick={() => setClassId("all")}>All classes</Chip>
                  {model.classes.map((c) => (
                    <Chip key={c.id} active={classId === c.id} onClick={() => setClassId(c.id)}>{c.name}</Chip>
                  ))}
                </div>
              )}
              <Segmented
                label="Risk"
                value={risk}
                onChange={(v) => setRisk(v as RiskLevel | "all")}
                options={[
                  { v: "all", l: "All", n: riskCount("all") },
                  { v: "at-risk", l: "At risk", n: riskCount("at-risk") },
                  { v: "watch", l: "Watch", n: riskCount("watch") },
                  { v: "on-track", l: "On track", n: riskCount("on-track") },
                ]}
              />
              <Segmented
                label="Activity"
                value={activity}
                onChange={(v) => setActivity(v as "all" | "active" | "inactive")}
                options={[
                  { v: "all", l: "Any", n: activityCount("all") },
                  { v: "active", l: "Active", n: activityCount("active") },
                  { v: "inactive", l: "Inactive", n: activityCount("inactive") },
                ]}
              />
            </div>
          </Card>

          {filtered.length === 0 ? (
            <Card>
              <EmptyState title="No students match" hint="Try widening the filters." />
            </Card>
          ) : (
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
              {filtered.map((s) => (
                <StudentTile key={`${s.classId}-${s.id}`} student={s} onOpen={() => setDetail(s)} />
              ))}
            </div>
          )}
        </>
      )}

      <StudentDialog student={detail} onClose={() => setDetail(null)} />
    </TeacherPage>
  );
}

/** One student, and the three figures a teacher scans a class by. The whole tile opens them. */
function StudentTile({ student: s, onOpen }: { student: StudentRecord; onOpen: () => void }) {
  const risk = RISK[s.riskLevel];
  const active = isActive(s);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="dz-lift"
      style={{
        ...CARD_SURFACE,
        display: "flex", flexDirection: "column", gap: 14,
        padding: 16, textAlign: "left", cursor: "pointer",
        fontFamily: "inherit", color: "var(--dz-ink)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Initials name={s.name} size={40} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--dz-ink)", ...TRUNCATE }}>{s.name}</p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--dz-mute)", ...TRUNCATE }}>{s.className}</p>
        </div>
        <Pill tone={risk.tone}>
          {s.riskLevel !== "on-track" && (
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: TONE_INK[risk.tone] }} />
          )}
          {risk.label}
        </Pill>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <Mini label="Grade avg" value={s.reviewAvg != null ? `${s.reviewAvg}%` : "—"} />
        <Mini label="Completion" value={s.completionPct != null ? `${s.completionPct}%` : "—"} />
        {/* "Inactive 8d", the same words the model's own reason strings and the filter use.
            Three names for one fact is how a teacher ends up unsure they mean the same thing. */}
        <Mini
          label="Activity"
          value={active ? "Active" : `Inactive ${s.inactiveDays}d`}
          tone={active ? "success" : "warning"}
        />
      </div>
    </button>
  );
}

/**
 * Everything the model holds about one student. A dialog rather than the drawer this page used
 * to open: the kit has no drawer, and what is in here is a short read rather than a side panel
 * to work in. Nothing was dropped on the way across — the same five figures, the same reasons.
 *
 * Rendered only while a student is open, so the name is the dialog's own heading and is not
 * repeated inside it.
 */
function StudentDialog({ student, onClose }: { student: StudentRecord | null; onClose: () => void }) {
  if (!student) return null;
  const risk = RISK[student.riskLevel];
  const overdue = student.overdueCount;
  return (
    <Dialog open title={student.name} onClose={onClose} cancelLabel="Close">
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Initials name={student.name} size={44} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--dz-mute)", fontWeight: 600, ...TRUNCATE }}>
            {student.className}
          </span>
          <Pill tone={risk.tone}>{risk.label}</Pill>
        </div>

        {student.riskReasons.length > 0 && (
          <div style={{ background: TONE_WASH.warning, borderRadius: 14, padding: "10px 12px" }}>
            <p style={{ ...OVERLINE, color: TONE_INK.warning }}>Why flagged</p>
            <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 600, color: "var(--dz-ink)" }}>
              {student.riskReasons.join(" · ")}
            </p>
          </div>
        )}

        <div>
          <p style={OVERLINE}>Progress</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
            <Row icon={<Gauge size={16} aria-hidden />} label="Average grade" value={student.reviewAvg != null ? `${student.reviewAvg}%` : "No grades yet"} />
            <Row icon={<ClipboardCheck size={16} aria-hidden />} label="Assignment completion" value={student.completionPct != null ? `${student.completionPct}%` : "—"} bar={student.completionPct ?? undefined} />
            <Row icon={<Activity size={16} aria-hidden />} label="Practice average" value={student.practiceAverage != null ? String(student.practiceAverage) : "No practice yet"} />
            <Row icon={<Clock size={16} aria-hidden />} label="Activity" value={isActive(student) ? "Active this week" : `Inactive ${student.inactiveDays}d`} />
            {/* "Not turned in", never "Missing": what a student still owes is not a failing. */}
            <Row icon={<ShieldAlert size={16} aria-hidden />} label="Not turned in" value={overdue > 0 ? `${overdue} ${overdue === 1 ? "assignment" : "assignments"}` : "None"} />
          </div>
        </div>

        <div>
          <p style={OVERLINE}>Weak areas</p>
          {/* Left blank on purpose. Nothing in this payload is per-skill, and a strand guessed
              from an overall average would be a teacher's lesson plan built on arithmetic. */}
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--dz-mute)" }}>Per-skill data isn’t available yet.</p>
        </div>
      </div>
    </Dialog>
  );
}

/** A figure on a tile. `tone` is for the two that carry a verdict; the rest read in plain ink. */
function Mini({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return (
    <div style={{ background: "var(--dz-neutral-soft)", borderRadius: 12, padding: "7px 9px", minWidth: 0 }}>
      {/* No letter-spacing here, unlike every other overline: a third of a card is about
          seventy-five pixels, and "COMPLETION" spaced out is wider than that — it spilled over
          the cell beside it. `anywhere` is the backstop for a narrower card still. */}
      <p style={{ ...OVERLINE, fontSize: 10, letterSpacing: "normal", overflowWrap: "anywhere" }}>{label}</p>
      {/* Wraps rather than truncating, which is not the house default and is deliberate here.
          Two of these three hold "48%" and never reach the edge; the third holds "Inactive 12d",
          and at a third of a card's width the ellipsis ate it down to "Inactiv…" — losing both
          the number of days and, for a teacher skimming, the difference from "Active". A cell
          that cannot fit its own word on one line should use two. */}
      <p
        style={{
          margin: "2px 0 0", fontSize: 13, fontWeight: 700,
          color: tone ? TONE_INK[tone] : "var(--dz-ink)",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </p>
    </div>
  );
}

/** One labelled figure in the dialog, with the bar only where a percentage has a scale. */
function Row({ icon, label, value, bar }: { icon: ReactNode; label: string; value: string; bar?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        aria-hidden
        style={{
          width: 34, height: 34, borderRadius: 10, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--dz-neutral-soft)", color: "var(--dz-mute)",
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 12, color: "var(--dz-mute)" }}>{label}</p>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--dz-ink)" }}>{value}</p>
        {bar != null && (
          // Hidden from the reader who is listening: it is the number above it, drawn.
          <div aria-hidden style={{ height: 6, borderRadius: 999, background: "var(--dz-neutral-soft)", marginTop: 6, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(0, Math.min(100, bar))}%`, height: "100%", background: "var(--dz-indigo)" }} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The global kit's `Avatar`, minus the parts this page cannot use: a `StudentRecord` carries no
 * image, so what is left is the initials circle in the panel's own tokens. Hidden from screen
 * readers — the name it abbreviates is the next thing in the row.
 */
function Initials({ name, size }: { name: string; size: number }) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: 999, flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "var(--dz-indigo-soft)", color: "var(--dz-indigo)",
        fontSize: Math.max(11, Math.round(size * 0.36)), fontWeight: 700,
      }}
    >
      {letters}
    </span>
  );
}

/** One class, or all of them. A chip rather than a segment because the list is as long as the teacher's timetable. */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        padding: "6px 12px", borderRadius: 12, cursor: "pointer",
        fontFamily: "inherit", fontSize: 13, fontWeight: 700,
        border: `1px solid ${active ? "transparent" : "var(--dz-border)"}`,
        background: active ? "var(--dz-indigo-soft)" : "var(--dz-card)",
        color: active ? "var(--dz-indigo)" : "var(--dz-mute)",
      }}
    >
      {children}
    </button>
  );
}

/**
 * The second copy of this control in the panel — pastpapers/TeacherPastpapers.tsx has the first,
 * where its comment says it stays local "until a second page needs it". This is that page, and
 * the two belong in `features/teacher/ui` now; they are left apart only because the kit is not
 * this slice's to change. This one also carries each option's count, which is what makes the
 * students a teacher came here for reachable in one press.
 */
function Segmented({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string; n?: number }[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ ...OVERLINE, fontSize: 12 }}>{label}</span>
      <div role="group" aria-label={label} style={{ display: "flex", gap: 4, background: "var(--dz-neutral-soft)", borderRadius: 12, padding: 4 }}>
        {options.map((o) => {
          const active = o.v === value;
          return (
            <button
              key={o.v}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.v)}
              style={{
                display: "inline-flex", alignItems: "baseline", gap: 5,
                padding: "6px 12px", borderRadius: 9, border: "none", cursor: "pointer",
                fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                background: active ? "var(--dz-indigo)" : "transparent",
                color: active ? "#fff" : "var(--dz-mute)",
              }}
            >
              {o.l}
              {o.n != null && <span style={{ fontSize: 12, fontWeight: 700, opacity: active ? 0.75 : 0.65 }}>{o.n}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
