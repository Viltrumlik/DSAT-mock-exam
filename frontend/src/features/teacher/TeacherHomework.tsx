"use client";

/**
 * /teacher/homework — which homework needs me?
 *
 * Nineteen pages in this panel link here, so this is a junction rather than a dashboard: a
 * teacher arrives with one question and leaves for the class where the work is. The owner asked
 * for it rewritten and simpler, and the shape follows from that question.
 *
 * ONE ORDERED LIST, not a grid of cards. The grid was alphabetical inside whatever the server
 * returned, so finding the homework that needed a teacher meant reading every card; a list that
 * puts it first answers the question by existing. `urgency()` below is the whole ranking, in
 * four bands, and each band is a fact the model states rather than a score invented from it.
 *
 * WHAT WENT: the two figures that sat above the grid as cards. They counted rows that are now
 * the first rows of the list, and a card restating a number the list already carries is what the
 * owner asked to be taken out. Both counts stayed as READABLE NUMBERS, in the subtitle — "how
 * many did the class find challenging?" has to be answerable without counting chips down a
 * column, and merging them into one figure took that away.
 *
 * WHAT STAYED. The Show filter, because ordering is not filtering: the ranking lifts the work
 * that needs a teacher to the top, but it cannot take the rest off the page, and a teacher who
 * wants to read only what is running on its own had no way left to ask. It is defined on the
 * ranking's own bands rather than on the `effectiveness` chip — see `needsTeacher` — so the top
 * row of All can never disappear under "Needs attention", which is what an `effectiveness`-only
 * test would have done to homework that is past due with work still missing.
 *
 * All five chips stayed as well: `effectiveness`'s three cases through the exhaustive map below,
 * and the two independent flags beside them. Replacing chips with one better-worded verdict is
 * how this codebase most recently made a state unreachable, so every one of them still renders
 * on the row it belongs to. The completion bar stayed too — in a list whose denominators differ
 * (10/24 against 15/17) the fraction is the fact and the length is the only thing that can be
 * scanned down a column — and it keeps its warning tone under half.
 *
 * WHAT THIS PAGE CANNOT SEE, and therefore never says. `AssignmentRecord` carries what came back
 * and what it averaged, never what has been MARKED. Homework whose manual share is still
 * unmarked is invisible here, so no line may claim a teacher is owed nothing: the subtitle
 * states the two things the model does know and stops. An earlier draft printed "nothing is
 * waiting on you" from this model — a sentence at its most confident exactly when the marking
 * queue is fullest (manual grading on, every upload in, no deadline gone), on the one page in
 * the panel that is the door into a classroom's Grading section.
 *
 * WHERE A ROW GOES. It used to go to /teacher/grading, the panel-wide screen. The manual mark is
 * entered inside a classroom's Grading section, so a row now opens that class ON this homework:
 * `?tab=grading&assignment=<id>`, the link `features/classroom/pages/Gradebook.tsx` already
 * answers. The row is a real anchor rather than a table row with a click handler, which is what
 * gives cmd-click, middle-click, the keyboard and a destination in the status bar for free.
 *
 * The model is `useTeacherAnalytics`, shared with /teacher/analytics, and every figure on it is
 * taken over ALL of the teacher's classes. That is why a partial load is an error here rather
 * than a shorter list — see the hook — and why the failure branch is checked before the empty
 * one: "No assignments yet" told a teacher their classes had done nothing when all that happened
 * was a 500.
 */

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Card, EmptyState, ErrorState, Pill, Skeleton, TeacherPage, TONE_INK, type Tone,
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

/** Any band below this is homework a teacher is holding up; the rest is running on its own. */
const RUNNING_FINE = 3;

/**
 * How much this homework needs a teacher — lower is sooner. Four bands, each one a fact the
 * model states, never a weighting of them:
 *
 * 0. The deadline has gone and work is still missing. Nothing else on the page is owed harder.
 * 1. Under half of it came back, and the deadline has not gone yet — still catchable.
 * 2. It came back and the class scored below its own practice average. This one needs teaching
 *    rather than chasing, which is why it sits under the two that need chasing.
 * 3. Nothing is outstanding.
 *
 * Note what band 0 excludes: homework that is past due with everyone's work in owes the teacher
 * nothing, so it keeps the "Past due" flag on its row and drops out of the top of the list.
 *
 * "Needs a teacher" here means turn-in and scores, the two things the model holds. Whether the
 * manual share has been marked is not in it — see the note at the top of the file.
 */
function urgency(a: AssignmentRecord): number {
  if (a.isOverdue && a.submitted < a.total) return 0;
  if (a.effectiveness === "low-completion") return 1;
  if (a.effectiveness === "challenging") return 2;
  return RUNNING_FINE;
}

/**
 * The Show filter, on the ranking's bands rather than on the `effectiveness` chip. A healthy
 * class average on homework that is past due with work still missing is band 0: it leads the
 * list, and filtering on the chip alone would have hidden it behind "Needs attention" — the
 * ordering and the filter have to agree about what needs a teacher or the filter lies.
 */
function needsTeacher(a: AssignmentRecord): boolean {
  return urgency(a) < RUNNING_FINE;
}

function matches(a: AssignmentRecord, filter: Filter): boolean {
  if (filter === "all") return true;
  return filter === "attention" ? needsTeacher(a) : !needsTeacher(a);
}

/**
 * Soonest deadline first, which reads the same way in both halves of the list: among work that
 * is past due the oldest debt leads, and among work that is not the nearest deadline does.
 * Homework with no deadline cannot be ranked by one at all, so it goes last rather than to
 * either end of the clock.
 */
function byDue(a: AssignmentRecord, b: AssignmentRecord): number {
  if (a.createdMs === b.createdMs) return 0;
  if (a.createdMs == null) return 1;
  if (b.createdMs == null) return -1;
  return a.createdMs - b.createdMs;
}

/**
 * `createdMs` holds the DUE date in spite of its name — `useTeacherAnalytics` fills it from the
 * assignment's `due_at`. The field belongs to a model two pages share, so it keeps the name it
 * has and the correction lives in one place: here, and in `byDue` above.
 */
function dueLabel(ms: number | null): string {
  if (ms == null) return "No due date";
  // The same format the hook prints dates in, so a deadline reads the same on both pages.
  return `Due ${new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/**
 * The class's own Grading section, opened on this homework — where the manual mark is entered.
 *
 * `id` is 0 when the server's completion row carried no `assignment_id` (see the hook). The
 * classroom already refuses a 0 and falls back to the section's own list, but the link is sent
 * without the parameter rather than carrying a number that means nothing.
 */
function gradingHref(a: AssignmentRecord): string {
  const base = `/teacher/classrooms/${a.classId}?tab=grading`;
  return a.id > 0 ? `${base}&assignment=${a.id}` : base;
}

/** A count of nothing reads as a word, so the sentence stays a sentence at zero. */
const count = (n: number) => (n === 0 ? "none" : String(n));

export function TeacherHomework({ previewModel }: { previewModel?: TeacherAnalyticsModel }) {
  const { status, model, error, retry } = useTeacherAnalytics(previewModel);
  const [classId, setClassId] = useState<number | "all">("all");
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(() => {
    if (!model) return [];
    return model.assignments
      .filter((a) => (classId === "all" || a.classId === classId) && matches(a, filter))
      // `localeCompare` last so two rows that need a teacher equally do not swap places between
      // renders — the list is read top-down and a shuffling row is read twice.
      .sort((a, b) => urgency(a) - urgency(b) || byDue(a, b) || a.title.localeCompare(b.title));
  }, [model, classId, filter]);

  if (status === "booting") {
    return (
      <TeacherPage title="Homework">
        <Card padded={false}>
          <div
            // The region says it is working. Without it a page mid-load is indistinguishable
            // from a page with nothing on it — to a screen reader, and to the shared
            // load-failure suite, which watches this marker to know the page has not settled.
            aria-busy="true"
            // Row-shaped, in the list they will fill, so nothing jumps when the model lands.
            style={{ padding: "14px 16px" }}
          >
            <Skeleton height={44} radius={10} count={8} />
          </div>
        </Card>
      </TeacherPage>
    );
  }

  if (status === "unauthenticated") {
    return (
      <TeacherPage title="Homework">
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

  // Over every class, not over the filtered list: the sentence says "across N classes", and the
  // controls are right below it for anyone who wants one class or one band.
  const total = model.assignments.length;
  // The two counts the cards used to carry, in the words their hints used. A row under half
  // turned in is counted there and nowhere else even when its average is also low — `effectiveness`
  // is one case per assignment, and these are the same two numbers the cards showed.
  const lowCompletion = model.assignments.filter((a) => a.effectiveness === "low-completion").length;
  const challenging = model.assignments.filter((a) => a.effectiveness === "challenging").length;

  const scope =
    `${total} ${total === 1 ? "assignment" : "assignments"} across ` +
    `${model.classCount} ${model.classCount === 1 ? "class" : "classes"}`;

  return (
    <TeacherPage
      title="Homework"
      // Only what the model knows. Nothing here counts what is waiting to be marked, so nothing
      // here says a teacher is owed nothing either.
      subtitle={
        total === 0
          ? `${scope}.`
          : `${scope} · ${count(lowCompletion)} under half turned in, ${count(challenging)} below the class average.`
      }
    >
      {/* Filters over nothing are noise, and the state below says what to do instead. */}
      {total > 0 && (
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
      )}

      {total === 0 ? (
        // A teacher with classes and no homework yet. The "empty" status above is about having no
        // CLASSES, so it never catches this one — and without this branch they landed in the
        // filter's state, which tells them to try chips the page has not drawn.
        <Card><EmptyState title="No assignments yet" hint="Assignment health appears here once you assign work." /></Card>
      ) : rows.length === 0 ? (
        // Past this point a filter is what emptied the list, so the hint names the control that
        // did it — and only controls that are on the page: a narrowed class means the chips are
        // drawn, and the Show control is drawn whenever there is anything to show.
        <Card><EmptyState {...filteredEmpty(filter, classId !== "all")} /></Card>
      ) : (
        <Card padded={false}>
          <ul
            // The ranking is the page's answer, so a screen reader is told the list is ordered
            // rather than left to assume the server's order leaked through.
            aria-label="Assignments, the ones needing you first"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {rows.map((a, i) => (
              <AssignmentRow key={`${a.classId}-${a.id}-${a.title}`} assignment={a} first={i === 0} />
            ))}
          </ul>
        </Card>
      )}
    </TeacherPage>
  );
}

/** What emptied the list, said back to the teacher as the control that will undo it. */
function filteredEmpty(filter: Filter, classNarrowed: boolean): { title: string; hint: string } {
  if (filter === "all") {
    // Nothing else can have emptied it: the page has assignments, and this teacher is looking
    // at one class.
    return { title: "No assignments in this class yet", hint: "Choose another class, or All classes." };
  }
  return {
    title: "No assignments match",
    hint: classNarrowed ? "Switch Show back to All, or choose another class." : "Switch Show back to All.",
  };
}

/**
 * One homework, in two lines: what it is and how it is going, then which class, when it is due
 * and how much came back. The whole row is the anchor into that class's Grading section.
 */
function AssignmentRow({ assignment: a, first }: { assignment: AssignmentRecord; first: boolean }) {
  const eff = EFFECTIVENESS[a.effectiveness];
  const short = a.completionPct < 50;
  return (
    // The separator belongs between rows, not above the first one, where it would draw a line
    // across the top of the card.
    <li style={{ borderTop: first ? undefined : "1px solid var(--dz-border)" }}>
      <Link
        href={gradingHref(a)}
        className="ds-ring"
        style={{ display: "block", padding: "13px 18px", textDecoration: "none", color: "inherit" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <p style={{ margin: 0, flex: "1 1 200px", minWidth: 0, fontSize: 14, fontWeight: 800, color: "var(--dz-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {a.title}
          </p>
          {/* The health case, then the two facts that are true or absent — never a third chip
              saying "not an assessment" or "on time". The flags sit beside the health chip
              because neither one is a verdict on it. */}
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
            <Pill tone={eff.tone}>{eff.label}</Pill>
            {a.isAssessment && <Pill>Assessment</Pill>}
            {a.isOverdue && <Pill tone="warning">Past due</Pill>}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginTop: 7 }}>
          <span style={{ flex: "1 1 170px", minWidth: 0, fontSize: 12, color: "var(--dz-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {a.className} · {dueLabel(a.createdMs)}
          </span>

          {/* The bar is not decoration over a number it repeats. The fraction beside it is the
              fact — the bar cannot give "10 of 24" — and the length is the share, which is the
              only part that can be scanned down a column where every denominator differs. Its
              colour is the tone's, so the warning under half is the token's amber in both
              themes rather than one alpha that reads as nothing on white. */}
          <span style={{ display: "flex", alignItems: "center", gap: 9, flex: "0 0 auto", width: 190 }}>
            <span aria-hidden style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--dz-neutral-soft)", overflow: "hidden" }}>
              <span
                style={{
                  display: "block", height: "100%", borderRadius: 999,
                  // The server's percentage, clamped: a bar wider than its track would paint
                  // over the text beside it.
                  width: `${Math.min(100, Math.max(0, a.completionPct))}%`,
                  background: TONE_INK[short ? "warning" : "info"],
                }}
              />
            </span>
            <span className="ds-num" style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", color: short ? TONE_INK.warning : "var(--dz-mute)" }}>
              {a.submitted}/{a.total} turned in
            </span>
          </span>

          <span style={{ flex: "0 0 auto", width: 92, textAlign: "right", fontSize: 12, whiteSpace: "nowrap" }}>
            <span style={{ color: "var(--dz-faint)", fontWeight: 700 }}>Avg </span>
            {/* Nothing marked yet is an em dash, never a zero — a 0 here reads as a class that
                answered everything wrong. */}
            <span className="ds-num" style={{ fontWeight: 800, color: a.groupMean == null ? "var(--dz-faint)" : "var(--dz-ink)" }}>
              {a.groupMean ?? "—"}
            </span>
          </span>
        </div>
      </Link>
    </li>
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
