"use client";

/**
 * /teacher/gradebook — one class's homework against the students who were given it, in the
 * panel's own look.
 *
 * The teachers named checking results as one of their four main jobs, and this is the screen
 * where they do it, so nothing it could do was dropped on the way over: the class switcher,
 * the three figures, the spread of the class's averages, the matrix with its running average
 * and its trend, and the key that says what a colour and a glyph mean.
 *
 * Three things it draws itself rather than taking from the kit, and why:
 *
 * · The matrix. `DataTable` is a list of fixed columns; this is a matrix whose columns are
 *   whatever homework the class was given, and whose first column has to stay put while the
 *   rest scroll sideways — twelve homework, an average and a trend leave a phone no choice.
 *   Everything else about it is DataTable's: hairline rows, a sticky head, 40px rows, and
 *   cells that keep their line so the table scrolls rather than breaking a name into a column
 *   of single words.
 * · The three figures, which have carried an icon since this page was written and which the
 *   kit's `Stat` has no room for.
 * · The class switcher, which is the `Segmented` control pastpapers also keeps to itself.
 *   Neither is in the kit yet; a third page that wants one should move it there.
 *
 * A load that failed is never drawn as data. The matrix says what did not load and offers the
 * retry; the figures above it read `—` rather than 0, because a gradebook nobody could read
 * must not tell a teacher that their class turned nothing in.
 */

import { AlertTriangle, ArrowDownRight, ArrowUpRight, Gauge, Users } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Avatar } from "@/components/ui";
import { BarRows, Card, EmptyState, ErrorState, Pill, Skeleton, TeacherPage, TONE_INK, TONE_WASH, type BarRow, type Tone } from "./ui";
import { useGradebook, type Cell, type ClassOption, type GradebookModel } from "./useGradebook";

/**
 * What a cell is worth, in the kit's tones. The thresholds are the ones the key at the foot of
 * the page spells out, and they stay positive or neutral: a grade under 60 is amber and reads
 * "needs attention", never the red this product keeps for something that actually went wrong.
 *
 * Work that was turned in but not yet graded and work that was graded without a number are
 * both quiet here on purpose — neither is a mark, and `cellText` is what tells them apart.
 */
function cellTone(c: Cell): Tone {
  if (c.status === "missing") return "neutral";
  if (c.status === "submitted") return "info";
  const g = c.grade;
  if (g == null) return "neutral";
  if (g >= 80) return "success";
  if (g >= 60) return "info";
  return "warning";
}
function cellText(c: Cell): string {
  if (c.status === "missing") return "–";
  if (c.grade != null) return String(c.grade);
  return "•";
}
// A trend in whole points, like the Avg column. Grades have two decimals, but the float difference of two doesn't
// (83.33 − 76.67 is 6.659999999999997), so the move goes back to hundredths before it is rounded: left as it is,
// that noise decides a move ending in a half. Its size is what's rounded, so a fall prints like the same rise.
function trendPoints(delta: number): number {
  return Math.round(Math.round(Math.abs(delta) * 100) / 100);
}
// A trend reads as a fall only when the points it prints fell: a dip that prints as 0 is no change.
function trendFalls(delta: number): boolean {
  return delta < 0 && trendPoints(delta) > 0;
}

export function TeacherGradebook({ preview }: { preview?: { classes: ClassOption[]; model: GradebookModel } }) {
  const { status, classes, selectedClassId, setSelectedClassId, loading, model, classListError, retryClassList, matrixError, retryMatrix } = useGradebook(preview);

  if (status === "booting") {
    return (
      <TeacherPage title="Gradebook">
        <Card><Skeleton height={44} count={6} radius={12} /></Card>
      </TeacherPage>
    );
  }
  if (status === "unauthenticated") {
    return (
      <TeacherPage title="Gradebook">
        <Card><EmptyState title="Sign in with a teacher account" /></Card>
      </TeacherPage>
    );
  }
  if (status === "error") {
    return (
      <TeacherPage title="Gradebook">
        <Card>
          <ErrorState
            title="Couldn’t load your classes"
            detail={classListError?.detail ?? "Your classes and their grades are unchanged — only this page failed to load."}
            onRetry={retryClassList}
          />
        </Card>
      </TeacherPage>
    );
  }
  if (status === "empty") {
    return (
      <TeacherPage title="Gradebook">
        <Card>
          <EmptyState title="No classes yet" hint="Your gradebook appears once you have a class with assignments." />
        </Card>
      </TeacherPage>
    );
  }

  const selectedName = classes.find((c) => c.id === selectedClassId)?.name ?? "this class";
  const bands: BarRow[] = (model?.distribution ?? []).map((d) => ({ label: d.band, segments: [{ value: d.count, tone: "info" }] }));

  return (
    // No subtitle: the key at the foot of the page says what the colours mean, and a line up
    // here saying that they mean something was only a longer way of pointing at it.
    <TeacherPage title="Gradebook">
      {classes.length > 1 ? (
        <ClassSwitcher classes={classes} selectedClassId={selectedClassId} onSelect={setSelectedClassId} />
      ) : null}

      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(232px, 1fr))", alignItems: "start" }}>
        <Figure icon={<Gauge size={20} aria-hidden />} label="Class average" value={model?.classAverage != null ? `${model.classAverage}%` : null} />
        <Figure icon={<Users size={20} aria-hidden />} label="Students" value={model?.students.length ?? null} />
        {/* "Not turned in", never "Missing": the wire status stays `missing`, the teacher reads the
            growth-oriented words. */}
        <Figure
          icon={<AlertTriangle size={20} aria-hidden />}
          label="Not turned in"
          value={model?.missingCount ?? null}
          tone={model && model.missingCount > 0 ? "warning" : "info"}
        />
        <Card>
          <h3 style={{ fontSize: 13, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)", margin: "0 0 14px" }}>
            How is the class distributed?
          </h3>
          {!model ? (
            // With no gradebook loaded there is nothing to say about grades, least of all that
            // there are none. The em dash is this page's word for "not known".
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--dz-faint)" }}>—</div>
          ) : model.distribution.every((d) => d.count === 0) ? (
            <EmptyState title="No graded work yet" />
          ) : (
            <BarRows rows={bands} />
          )}
        </Card>
      </div>

      <Card>
        {loading ? (
          <Skeleton height={40} count={6} radius={12} />
        ) : matrixError ? (
          // Before the empty branch, always: a class whose gradebook answered a 500 has not
          // stopped having students in it.
          <ErrorState
            title={`Couldn’t load the gradebook for ${selectedName}`}
            detail={matrixError.detail ?? "Grades and submissions are unchanged — only this view failed to load."}
            onRetry={retryMatrix}
          />
        ) : !model || model.students.length === 0 ? (
          <EmptyState title="No students yet" hint="Students appear here once they join this class." />
        ) : (
          <Matrix model={model} forClass={selectedName} />
        )}
      </Card>

      <Legend />
    </TeacherPage>
  );
}

/**
 * One figure with its icon.
 *
 * `null` reads as an em dash, never as a zero: every one of these three is taken over the whole
 * class, so when the class did not load the honest answer is that the number is not known.
 */
function Figure({ icon, label, value, tone = "info" }: {
  icon: ReactNode; label: string; value: number | string | null; tone?: Tone;
}) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span
          style={{
            width: 44, height: 44, borderRadius: 14, flexShrink: 0,
            background: TONE_WASH[tone], color: TONE_INK[tone],
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {icon}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.02em", lineHeight: 1.1, color: value === null ? "var(--dz-faint)" : "var(--dz-ink)" }}>
            {value === null ? "—" : value}
          </div>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--dz-faint)", margin: "5px 0 0" }}>
            {label}
          </p>
        </div>
      </div>
    </Card>
  );
}

/** Which class the page is showing. A teacher with one class is not asked to choose it. */
function ClassSwitcher({ classes, selectedClassId, onSelect }: {
  classes: ClassOption[]; selectedClassId: number | null; onSelect: (id: number) => void;
}) {
  return (
    <div role="group" aria-label="Classes" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {classes.map((c) => {
        const active = c.id === selectedClassId;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(c.id)}
            style={{
              padding: "8px 15px", borderRadius: 12, cursor: "pointer",
              fontFamily: "inherit", fontSize: 13, fontWeight: 700,
              background: active ? "var(--dz-indigo)" : "var(--dz-card)",
              color: active ? "#fff" : "var(--dz-mute)",
              border: `1px solid ${active ? "var(--dz-indigo)" : "var(--dz-border)"}`,
            }}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

/** DataTable's head, kept here because the student column has to stick to the left as well. */
const HEAD: CSSProperties = {
  position: "sticky", top: 0, zIndex: 1,
  padding: "0 12px 8px", background: "var(--dz-card)", textAlign: "left",
  fontSize: 12, fontWeight: 700, letterSpacing: ".04em",
  textTransform: "uppercase", color: "var(--dz-faint)", whiteSpace: "nowrap",
};
/** A cell keeps its line; the table scrolls instead. Same reason as the kit's DataTable. */
const CELL: CSSProperties = { height: 40, padding: "0 12px", verticalAlign: "middle", whiteSpace: "nowrap", borderTop: "1px solid var(--dz-border)" };
/**
 * The student column rides over the homework as it scrolls, so a teacher three columns deep
 * still knows whose row they are reading. It needs an opaque background of its own: what
 * scrolls beneath it would otherwise show straight through.
 */
const STUCK: CSSProperties = { position: "sticky", left: 0, background: "var(--dz-card)" };

function Matrix({ model, forClass }: { model: GradebookModel; forClass: string }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table aria-label={`Grades for ${forClass}`} style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, color: "var(--dz-ink)" }}>
        <thead>
          <tr>
            <th scope="col" style={{ ...HEAD, ...STUCK, zIndex: 2 }}>Student</th>
            {model.assignments.map((a) => (
              <th key={a.id} scope="col" title={a.title} style={{ ...HEAD, textAlign: "center", textTransform: "none", letterSpacing: 0 }}>
                <span style={{ display: "block", maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</span>
              </th>
            ))}
            <th scope="col" style={{ ...HEAD, textAlign: "center" }}>Avg</th>
            <th scope="col" style={{ ...HEAD, textAlign: "center" }}>Trend</th>
          </tr>
        </thead>
        <tbody>
          {model.students.map((s) => (
            <tr key={s.id}>
              <th scope="row" style={{ ...CELL, ...STUCK, zIndex: 1, textAlign: "left", fontWeight: 700 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 9, maxWidth: 210 }}>
                  <Avatar src={s.avatarUrl} name={s.name} size={24} />
                  <span className="truncate">{s.name}</span>
                  <MissingBadge count={s.missing} />
                </span>
              </th>
              {s.cells.map((c) => (
                <td key={c.assignmentId} style={{ ...CELL, padding: "0 6px", textAlign: "center" }}>
                  <CellChip cell={c} />
                </td>
              ))}
              <td style={{ ...CELL, textAlign: "center" }}>
                <Pill tone={s.average == null ? "neutral" : s.average < 60 ? "warning" : "success"}>
                  {s.average != null ? `${s.average}%` : "—"}
                </Pill>
              </td>
              <td style={{ ...CELL, textAlign: "center" }}>
                <Trend delta={s.trendDelta} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One piece of homework for one student. Fixed width on purpose: a row of these has to read
 * as a grid across twelve columns, and a chip that grew with its number would make every
 * column a different width.
 */
function CellChip({ cell }: { cell: Cell }) {
  const tone = cellTone(cell);
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        height: 28, minWidth: 36, padding: "0 6px", borderRadius: 9,
        background: TONE_WASH[tone], color: TONE_INK[tone], fontSize: 12, fontWeight: 800,
      }}
    >
      {cellText(cell)}
    </span>
  );
}

function MissingBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    /* A `title` on an element that has text is read as a description, not a name, so a
       screen reader would still announce "3 exclamation". The glyph is hidden from the
       tree and the sr-only span carries the name; the title stays for mouse users. */
    <span
      title={`${count} not turned in`}
      style={{
        borderRadius: 6, padding: "1px 6px", flexShrink: 0,
        background: TONE_WASH.warning, color: TONE_INK.warning, fontSize: 10, fontWeight: 800,
      }}
    >
      <span aria-hidden="true">{count}!</span>
      <span className="sr-only">{count} not turned in</span>
    </span>
  );
}

/** How far this student moved, in whole points, since the oldest homework they were graded on. */
function Trend({ delta }: { delta: number | null }) {
  if (delta == null) return <span style={{ color: "var(--dz-faint)" }}>—</span>;
  const falls = trendFalls(delta);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 13, fontWeight: 800, color: TONE_INK[falls ? "warning" : "success"] }}>
      {falls ? <ArrowDownRight size={14} aria-hidden /> : <ArrowUpRight size={14} aria-hidden />}
      {trendPoints(delta)}
    </span>
  );
}

/** What a colour and a glyph mean, under the matrix that uses them. */
function Legend() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", fontSize: 12, color: "var(--dz-mute)" }}>
      <Key tone="success">Strong 80+</Key>
      <Key tone="info">On track 60–79</Key>
      <Key tone="warning">Needs attention &lt;60</Key>
      <span><Glyph>–</Glyph> not turned in</span>
      <span><Glyph>•</Glyph> awaiting grade</span>
    </div>
  );
}
function Key({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: TONE_INK[tone] }} />
      {children}
    </span>
  );
}
function Glyph({ children }: { children: ReactNode }) {
  return <strong style={{ color: "var(--dz-ink)" }}>{children}</strong>;
}
