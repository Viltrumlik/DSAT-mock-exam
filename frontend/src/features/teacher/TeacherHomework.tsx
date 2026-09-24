"use client";

/**
 * /teacher/homework — every assignment the teacher has given, with how much of it came back.
 *
 * Nineteen pages in this panel link here, more than to anything else, and the teachers the owner
 * surveyed named "assignment and classwork" among the three things they touch every day. So this
 * is a restyle and nothing else: the same two figures at the top, the same class filter, the same
 * All / Needs attention / Healthy filter, the same card per assignment carrying the same five
 * chips, the same completion, the same submitted count, the same group mean, and the same door
 * into grading. What changed is the frame around them.
 *
 * The five chips are worth naming, because replacing a chip with a differently-worded one is how
 * this codebase most recently lost a state: `effectiveness` still renders exactly its three cases
 * (Low completion / Challenging / Healthy) through the map below, which the type keeps exhaustive,
 * and the two independent flags still render theirs (Assessment, Past due) beside it. Nothing is
 * folded into a verdict.
 *
 * The model is `useTeacherAnalytics`, shared with /teacher/analytics and /teacher/students, and
 * every figure on it is taken over ALL of the teacher's classes. That is why a partial load is an
 * error here rather than a shorter list — see the hook — and why the failure branch is checked
 * before the empty one: "No assignments yet" told a teacher their classes had done nothing when
 * all that happened was a 500.
 */

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, TrendingDown } from "lucide-react";
import {
  BarRows, Card, EmptyState, ErrorState, Pill, Skeleton, Stat, TeacherPage,
  TONE_INK, TONE_WASH, type Tone,
} from "./ui";
import { useTeacherAnalytics, type AssignmentRecord, type TeacherAnalyticsModel } from "./useTeacherAnalytics";

type Filter = "all" | "attention" | "healthy";

/**
 * One chip per `effectiveness` case, and the `Record` is what keeps it that way: a fourth case
 * added to the hook fails to compile here rather than quietly rendering nothing.
 */
const EFFECTIVENESS: Record<AssignmentRecord["effectiveness"], { label: string; tone: Tone }> = {
  "low-completion": { label: "Low completion", tone: "warning" },
  challenging: { label: "Challenging", tone: "info" },
  healthy: { label: "Healthy", tone: "success" },
};

export function TeacherHomework({ previewModel }: { previewModel?: TeacherAnalyticsModel }) {
  const { status, model, error, retry } = useTeacherAnalytics(previewModel);
  const [classId, setClassId] = useState<number | "all">("all");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    if (!model) return [];
    return model.assignments.filter((a) =>
      (classId === "all" || a.classId === classId) &&
      (filter === "all" || (filter === "attention" ? a.effectiveness !== "healthy" : a.effectiveness === "healthy")),
    );
  }, [model, classId, filter]);

  if (status === "booting") {
    return (
      <TeacherPage title="Homework">
        <div
          // The region says it is working. Without it a page mid-load is indistinguishable from a
          // page with nothing on it — to a screen reader, and to the tests that watch for the
          // moment a page has settled. (`features/teacher/ui`'s placeholder is `aria-hidden`
          // scaffolding with no class of its own, so there is nothing else to watch for; the
          // students page marks its own load the same way.)
          aria-busy="true"
          // Card-shaped, in the grid they will fill, so nothing jumps when the model lands.
          style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(268px, 1fr))" }}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={168} radius={24} />)}
        </div>
      </TeacherPage>
    );
  }

  if (status === "unauthenticated") {
    return (
      <TeacherPage title="Homework">
        {/* The old card said "Homework" above this line. The page's own title says it — that is
            exactly the writing the owner asked to be taken out. */}
        <Card><EmptyState title="Sign in with a teacher account" /></Card>
      </TeacherPage>
    );
  }

  // Before the empty branch, always. A failure that renders as "No assignments yet" tells a
  // teacher their classes did nothing.
  if (status === "error") {
    return (
      <TeacherPage title="Homework">
        <ErrorState
          title="Couldn’t load your assignments"
          detail={error?.detail ?? "Your assignments and their submissions are unchanged — only this page failed to load."}
          onRetry={retry}
        />
      </TeacherPage>
    );
  }

  if (status === "empty" || !model) {
    return (
      <TeacherPage title="Homework">
        <Card><EmptyState title="No assignments yet" hint="Assignment health appears here once you assign work." /></Card>
      </TeacherPage>
    );
  }

  const lowCompletion = model.assignments.filter((a) => a.effectiveness === "low-completion").length;
  const challenging = model.assignments.filter((a) => a.effectiveness === "challenging").length;
  const total = model.assignments.length;

  return (
    <TeacherPage
      title="Homework"
      // A count a teacher cannot read anywhere else on the page, so it stays under the title.
      subtitle={`${total} ${total === 1 ? "assignment" : "assignments"} across ${model.classCount} ${model.classCount === 1 ? "class" : "classes"}.`}
    >
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <Insight
          icon={<TrendingDown size={20} aria-hidden />}
          label="Low completion"
          value={lowCompletion}
          hint="Below 50% turned in"
          tone={lowCompletion > 0 ? "warning" : "success"}
        />
        <Insight
          icon={<AlertTriangle size={20} aria-hidden />}
          label="Challenging"
          value={challenging}
          hint="Group mean below class average"
          tone={challenging > 0 ? "info" : "success"}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        {/* One class is no choice, so the chips only appear when there is something to choose
            between — as before. */}
        {model.classes.length > 1 && (
          <ChipGroup label="Class">
            <Chip active={classId === "all"} onClick={() => setClassId("all")}>All classes</Chip>
            {model.classes.map((c) => (
              <Chip key={c.id} active={classId === c.id} onClick={() => setClassId(c.id)}>{c.name}</Chip>
            ))}
          </ChipGroup>
        )}
        <Segmented
          label="Show"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={[{ v: "all", l: "All" }, { v: "attention", l: "Needs attention" }, { v: "healthy", l: "Healthy" }]}
        />
      </div>

      {filtered.length === 0 ? (
        // Only the filters can empty this list: the branch above already caught a teacher with
        // no assignments at all, and it says something else.
        <Card><EmptyState title="No assignments match" hint="Try a different filter." /></Card>
      ) : (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(268px, 1fr))" }}>
          {filtered.map((a) => (
            <AssignmentCard key={`${a.classId}-${a.id}`} assignment={a} />
          ))}
        </div>
      )}
    </TeacherPage>
  );
}

/** One of the two figures over the whole panel: a count, what it counts, and what it means. */
function Insight({ icon, label, value, hint, tone }: {
  icon: ReactNode; label: string; value: number; hint: string; tone: Tone;
}) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span
          style={{
            width: 44, height: 44, borderRadius: 14, flexShrink: 0,
            // Both halves come from the tone, so the tint is the token's — a solid-ish wash in
            // light, a brighter one on the dark card. A single alpha cannot serve both.
            background: TONE_WASH[tone], color: TONE_INK[tone],
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {icon}
        </span>
        <Stat label={label} value={value} tone={tone} hint={hint} />
      </div>
    </Card>
  );
}

/**
 * One assignment. The whole card is the link into grading, as it was — a real anchor rather than
 * a click handler, so cmd-click and middle-click open a second one and the keyboard reaches it.
 */
function AssignmentCard({ assignment: a }: { assignment: AssignmentRecord }) {
  const eff = EFFECTIVENESS[a.effectiveness];
  return (
    <Link
      href="/teacher/grading"
      className="ds-ring"
      style={{ display: "block", borderRadius: 24, textDecoration: "none", color: "inherit" }}
    >
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--dz-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.title}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--dz-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.className}
              </p>
            </div>
            <Pill tone={eff.tone}>{eff.label}</Pill>
          </div>

          {/* Two facts about the assignment that are true or absent — never a third chip saying
              "not an assessment" or "on time". They sit apart from the health chip above because
              neither one is a verdict on it. */}
          {(a.isAssessment || a.isOverdue) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {a.isAssessment && <Pill>Assessment</Pill>}
              {a.isOverdue && <Pill tone="warning">Past due</Pill>}
            </div>
          )}

          {/* The bar is not decoration over a number it repeats: the note carries the count AND
              the share, and the length is what lets a teacher find the short one across a grid of
              a dozen cards without reading twelve percentages. `max={100}` because each bar is
              read against the whole class, not against the neighbouring card. */}
          <BarRows
            max={100}
            rows={[{
              label: "Turned in",
              note: `${a.submitted}/${a.total} · ${a.completionPct}%`,
              segments: [{ value: a.completionPct, tone: a.completionPct < 50 ? "warning" : "info" }],
            }]}
          />

          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--dz-border)", paddingTop: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--dz-faint)" }}>
              Avg score
            </span>
            {/* Nothing graded yet is an em dash, never a zero — a 0 here reads as a class that
                answered everything wrong. */}
            <span style={{ fontSize: 14, fontWeight: 800, color: a.groupMean == null ? "var(--dz-faint)" : "var(--dz-ink)" }}>
              {a.groupMean ?? "—"}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

/** The class filter. A chip row rather than a segmented control: a teacher may have a dozen. */
function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--dz-faint)" }}>
        {label}
      </span>
      <div role="group" aria-label={label} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      // The chip is a toggle, and without this a screen reader announces every class in the row
      // identically whichever one is showing.
      aria-pressed={active}
      onClick={onClick}
      style={{
        padding: "6px 12px", borderRadius: 999, cursor: "pointer",
        fontFamily: "inherit", fontSize: 13, fontWeight: 700,
        background: active ? "var(--dz-indigo-soft)" : "transparent",
        color: active ? "var(--dz-indigo)" : "var(--dz-mute)",
        border: `1px solid ${active ? "transparent" : "var(--dz-border)"}`,
      }}
    >
      {children}
    </button>
  );
}

/**
 * The kit still has no segmented control; Past papers and Assessments each keep a local copy for
 * the same reason, and this is the third. The copy stays deliberately identical to theirs so that
 * lifting it into `features/teacher/ui` is a delete in three files rather than a merge of three
 * drifted versions — which is the whole argument for doing it now.
 */
function Segmented({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--dz-faint)" }}>
        {label}
      </span>
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
                padding: "6px 12px", borderRadius: 9, border: "none", cursor: "pointer",
                fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                background: active ? "var(--dz-indigo)" : "transparent",
                color: active ? "#fff" : "var(--dz-mute)",
              }}
            >
              {o.l}
            </button>
          );
        })}
      </div>
    </div>
  );
}
