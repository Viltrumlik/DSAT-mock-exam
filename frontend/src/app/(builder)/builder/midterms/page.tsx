"use client";

/**
 * /builder/midterms — Midterms hub (Questions console — Learning system)
 *
 * Midterms are pedagogical infrastructure — classroom-assigned, teacher-managed,
 * curriculum-driven exams with due dates and grading semantics.
 *
 * Domain: Assessment/Learning system (see DOMAIN_ARCHITECTURE.md § System 1)
 * NOT: SAT simulation. NOT: timed benchmark exams.
 *
 * Technical note: midterms use the MockExam model with kind=MIDTERM. They share
 * the exam attempt infrastructure but have entirely different educational workflows
 * and UX semantics from MOCK_SAT exams.
 *
 * In the console's look (design handoff v0.3, PR 18): the Builder's subject → level drill-down (shared with
 * Assessments), a card per midterm with its versions and modules, and console dialogs for New / Edit and Results.
 * Every word, rule and call is the page's own.
 */

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";

import { Icon, type IconName } from "@/components/ui/Icon";
import { examsAdminApi } from "@/features/examsAdmin/api";
import { BucketCard, ChipGroup, Crumb, CrumbSep, LevelBar, SubjectSquare } from "@/features/builderLibrary/drillDown";
import { LibraryError, LibraryHeader } from "@/features/builderLibrary/sectionParts";
import { Badge, Button, Dialog, EmptyState, StatTile, inputShell, type BadgeTone } from "@/features/console/ui";
import { CONTROL, FIELD_LABEL, HINT } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

type AdminModule = {
  id: number;
  module_order: number | null;
  time_limit_minutes: number | null;
};

type AdminTestSection = {
  id: number;
  subject: string;
  modules: AdminModule[];
};

type AdminMidterm = {
  id: number;
  title: string;
  practice_date: string | null;
  is_active: boolean;
  is_published: boolean;
  published_at: string | null;
  kind: "MIDTERM";
  midterm_subject: string | null;
  midterm_scoring_scale: "SCALE_100" | "SCALE_800";
  midterm_module_count: number;
  midterm_module1_minutes: number;
  midterm_module2_minutes: number;
  midterm_two_module_runtime: boolean;
  midterm_target_question_count: number;
  midterm_module_question_limit: number;
  midterm_level: string | null;
  midterm_period: string | null;
  midterm_type: string | null;
  midterm_pass_mark: number | null;
  midterm_retake_of: number | null;
  tests: AdminTestSection[];
  publish_ready: boolean;
  publish_block_reason: string;
};

type MidtermForm = {
  title: string;
  practice_date: string;
  midterm_subject: "READING_WRITING" | "MATH";
  midterm_scoring_scale: "SCALE_100" | "SCALE_800";
  midterm_module_count: "1" | "2";
  midterm_module1_minutes: string;
  midterm_module2_minutes: string;
  midterm_target_question_count: string;
  midterm_module_question_limit: string;
  midterm_level: string;
  midterm_period: string;
  midterm_type: string;
  /** Blank = the scale default (50 / 500). Always on the midterm's own scale. */
  midterm_pass_mark: string;
  /** Blank = none. Only meaningful when midterm_type === "RETAKE". */
  midterm_retake_of: string;
};

const DEFAULT_FORM: MidtermForm = {
  title: "",
  practice_date: "",
  midterm_subject: "READING_WRITING",
  midterm_scoring_scale: "SCALE_100",
  midterm_module_count: "1",
  midterm_module1_minutes: "60",
  midterm_module2_minutes: "60",
  midterm_target_question_count: "44",
  midterm_module_question_limit: "30",
  midterm_level: "",
  midterm_period: "",
  midterm_type: "MIDTERM",
  midterm_pass_mark: "",
  midterm_retake_of: "",
};

// Pass mark is expressed on the midterm's own scale — SCALE_800 floors at 200 because
// a blank paper already scores 200 there, so it can never be a 0-based percentage.
const PASS_MARK_SCALE: Record<string, { min: number; max: number; placeholder: string }> = {
  SCALE_100: { min: 0, max: 100, placeholder: "50" },
  SCALE_800: { min: 200, max: 800, placeholder: "500" },
};

// Midterm taxonomy option sets (mirror backend MockExam midterm_* choices).
const MIDTERM_LEVEL_LABELS: Record<string, string> = {
  foundation: "Foundation", junior: "Junior", middle: "Middle", senior: "Senior",
};
function levelOptionsForSubject(subject: string): { v: string; l: string }[] {
  const codes = subject === "MATH" ? ["foundation", "junior", "middle", "senior"] : ["junior", "middle", "senior"];
  return [{ v: "", l: "Any level" }, ...codes.map((c) => ({ v: c, l: MIDTERM_LEVEL_LABELS[c] }))];
}
const PERIOD_OPTIONS: { v: string; l: string }[] = [
  { v: "", l: "Any period" },
  { v: "FIRST_MONTH", l: "First month" },
  { v: "SECOND_MONTH", l: "Second month" },
  { v: "THIRD_MONTH", l: "Third month" },
];
const TYPE_OPTIONS: { v: string; l: string }[] = [
  { v: "PRE_MIDTERM", l: "Pre-midterm" },
  { v: "MIDTERM", l: "Midterm" },
  { v: "RETAKE", l: "Retake midterm" },
];
const PERIOD_LABELS: Record<string, string> = {
  FIRST_MONTH: "First month", SECOND_MONTH: "Second month", THIRD_MONTH: "Third month",
};
const TYPE_LABELS: Record<string, string> = {
  PRE_MIDTERM: "Pre-midterm", MIDTERM: "Midterm", RETAKE: "Retake",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

function subjectLabel(s: string | null | undefined): string {
  if (s === "READING_WRITING") return "English";
  if (s === "MATH") return "Math";
  return s ?? "—";
}

// The two subjects the drill-down browses (English == the READING_WRITING platform subject).
const MIDTERM_SUBJECTS: { code: "READING_WRITING" | "MATH"; label: string }[] = [
  { code: "READING_WRITING", label: "English" },
  { code: "MATH", label: "Math" },
];
// Real level codes for a subject (Foundation is Math-only), without the "Any level" entry.
function levelCodesForSubject(subject: string): string[] {
  return subject === "MATH" ? ["foundation", "junior", "middle", "senior"] : ["junior", "middle", "senior"];
}
// Sentinel for the "Untagged / Any level" bucket (legacy midterms with a blank level).
const UNTAGGED_LEVEL = "__untagged__";

function parseError(e: unknown): string {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (!data) return "An error occurred.";
  if (typeof data === "string") return data;
  if (typeof data === "object" && data !== null) {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === "string") return d.detail;
    const parts = Object.entries(d)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : String(v)}`)
      .join(" ");
    return parts || "An error occurred.";
  }
  return "An error occurred.";
}

/** A field fixed by the bucket the midterm is created in: shown, not editable. */
const LOCKED = inputShell({ readOnly: true, className: "w-full text-ms-fg-2" });

/** One field: its label above, the control, and an optional line of help under it. */
function Field({ id, label, hint, children }: { id?: string; label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      {id ? (
        <label htmlFor={id} className={FIELD_LABEL}>
          {label}
        </label>
      ) : (
        <p className={FIELD_LABEL}>{label}</p>
      )}
      {children}
      {hint ? <p className={HINT}>{hint}</p> : null}
    </div>
  );
}

// ─── Midterm modal ────────────────────────────────────────────────────────────

function MidtermModal({
  open,
  heading,
  initial,
  saving,
  error,
  retakeCandidates,
  lockSubjectLevel = false,
  onSubmit,
  onClose,
}: {
  open: boolean;
  heading: string;
  initial: MidtermForm;
  saving: boolean;
  error: string | null;
  /** Published midterms this one may be a retake of — already subject-filtered. */
  retakeCandidates: AdminMidterm[];
  /** When creating from a subject→level context, subject+level are fixed to that bucket. */
  lockSubjectLevel?: boolean;
  onSubmit: (f: MidtermForm) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [form, setForm] = useState<MidtermForm>(initial);

  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  const set =
    (k: keyof MidtermForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  const twoModules = form.midterm_module_count === "2";
  // A pre-midterm is a diagnostic, never pass/fail graded — it has no pass mark.
  const graded = form.midterm_type !== "PRE_MIDTERM";
  const isRetake = form.midterm_type === "RETAKE";
  const passMarkScale = PASS_MARK_SCALE[form.midterm_scoring_scale] ?? PASS_MARK_SCALE.SCALE_100;
  const subjectCandidates = retakeCandidates.filter(
    (m) => (m.midterm_subject ?? "READING_WRITING") === form.midterm_subject,
  );

  return (
    <Dialog open={open} onClose={onClose} labelledBy={`${id}-title`} width={560} locked={saving}>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-[22px] pb-2 pt-[22px]">
          <h2 id={`${id}-title`} className="text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">
            {heading}
          </h2>
          <Button variant="ghost" size="sm" icon="x" aria-label="Close" tooltip={false} onClick={onClose} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[22px] pb-4 pt-2">
          {error ? <LibraryError>{error}</LibraryError> : null}

          {/* Title */}
          <Field
            id={`${id}-name`}
            label={
              <>
                Title <span className="text-ms-critical-fg">*</span>
              </>
            }
          >
            <input
              id={`${id}-name`}
              data-autofocus
              value={form.title}
              onChange={set("title")}
              required
              placeholder="e.g. Algebra Midterm — Spring 2025"
              className={CONTROL}
            />
          </Field>

          {/* Date + Subject */}
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${id}-date`} label="Date">
              <input id={`${id}-date`} type="date" value={form.practice_date} onChange={set("practice_date")} className={CONTROL} />
            </Field>
            <Field id={lockSubjectLevel ? undefined : `${id}-subject`} label="Subject">
              {lockSubjectLevel ? (
                <div className={LOCKED}>{subjectLabel(form.midterm_subject)}</div>
              ) : (
                <select
                  id={`${id}-subject`}
                  value={form.midterm_subject}
                  onChange={(e) => {
                    const subj = e.target.value as "READING_WRITING" | "MATH";
                    // Foundation is Math-only — drop it when switching to R&W. The retake
                    // parent is subject-scoped too, so a cross-subject one must go as well.
                    setForm((p) => ({
                      ...p,
                      midterm_subject: subj,
                      midterm_level: subj !== "MATH" && p.midterm_level === "foundation" ? "" : p.midterm_level,
                      midterm_retake_of: "",
                    }));
                  }}
                  className={CONTROL}
                >
                  <option value="READING_WRITING">English</option>
                  <option value="MATH">Math</option>
                </select>
              )}
            </Field>
          </div>

          {/* Taxonomy — level (by subject) · type · period. Used for filtering. */}
          <div className="grid grid-cols-3 gap-3">
            <Field id={lockSubjectLevel ? undefined : `${id}-level`} label="Level">
              {lockSubjectLevel ? (
                <div className={LOCKED}>
                  {form.midterm_level ? MIDTERM_LEVEL_LABELS[form.midterm_level] ?? form.midterm_level : "Any level"}
                </div>
              ) : (
                <select id={`${id}-level`} value={form.midterm_level} onChange={set("midterm_level")} className={CONTROL}>
                  {levelOptionsForSubject(form.midterm_subject).map((o) => (
                    <option key={o.v} value={o.v}>{o.l}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field id={`${id}-type`} label="Type">
              <select id={`${id}-type`} value={form.midterm_type} onChange={set("midterm_type")} className={CONTROL}>
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-period`} label="Period">
              <select id={`${id}-period`} value={form.midterm_period} onChange={set("midterm_period")} className={CONTROL}>
                {PERIOD_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Scoring scale — controls how the final result is reported and how
              the question console frames per-question scoring. */}
          <Field
            id={`${id}-scale`}
            label="Scoring system"
            hint={
              form.midterm_scoring_scale === "SCALE_800"
                ? "Final score maps onto the SAT 200–800 curve. Give each question a point weight in the question console."
                : "Final score is a clean 0–100 percentage. Every question counts equally."
            }
          >
            <select id={`${id}-scale`} value={form.midterm_scoring_scale} onChange={set("midterm_scoring_scale")} className={CONTROL}>
              <option value="SCALE_100">100-point (percentage)</option>
              <option value="SCALE_800">800-point (SAT scaled)</option>
            </select>
          </Field>

          {/* Pass mark — graded types only, labelled with the scale's own range. */}
          {graded && (
            <Field
              id={`${id}-pass`}
              label={`Pass mark (${passMarkScale.min}–${passMarkScale.max})`}
              hint={
                <>
                  Score a student must reach to pass, on this midterm&rsquo;s own scale. Leave blank for the default (
                  {passMarkScale.placeholder}).
                </>
              }
            >
              <input
                id={`${id}-pass`}
                type="number"
                min={passMarkScale.min}
                max={passMarkScale.max}
                value={form.midterm_pass_mark}
                onChange={set("midterm_pass_mark")}
                placeholder={passMarkScale.placeholder}
                className={CONTROL}
              />
            </Field>
          )}

          {/* Retake parent — the failing cohort of this midterm is who gets access. */}
          {isRetake && (
            <Field
              id={`${id}-retake`}
              label="Retake of"
              hint={
                subjectCandidates.length === 0
                  ? "No published midterms in this subject yet — publish one first."
                  : "Students who did not clear the selected midterm get this retake — that includes anyone who was ABSENT from it. Students who passed are never granted it."
              }
            >
              <select id={`${id}-retake`} value={form.midterm_retake_of} onChange={set("midterm_retake_of")} className={CONTROL}>
                <option value="">— No parent midterm —</option>
                {subjectCandidates.map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.title || `Midterm #${m.id}`}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* Module count + timing */}
          <Field id={`${id}-modules`} label="Modules">
            <select id={`${id}-modules`} value={form.midterm_module_count} onChange={set("midterm_module_count")} className={CONTROL}>
              <option value="1">1 module (single-part)</option>
              <option value="2">2 modules (standard)</option>
            </select>
          </Field>

          <div className={cn("grid gap-3", twoModules ? "grid-cols-2" : "grid-cols-1")}>
            <Field id={`${id}-m1`} label="Module 1 — minutes">
              <input
                id={`${id}-m1`}
                type="number"
                min={5}
                max={600}
                value={form.midterm_module1_minutes}
                onChange={set("midterm_module1_minutes")}
                className={CONTROL}
              />
            </Field>
            {twoModules && (
              <Field id={`${id}-m2`} label="Module 2 — minutes">
                <input
                  id={`${id}-m2`}
                  type="number"
                  min={5}
                  max={600}
                  value={form.midterm_module2_minutes}
                  onChange={set("midterm_module2_minutes")}
                  className={CONTROL}
                />
              </Field>
            )}
          </div>

          {twoModules && (
            <p className="rounded-ms-ctl border border-ms-info-line bg-ms-info-soft px-3.5 py-2.5 text-[13px] leading-[19px] text-ms-fg-2">
              <span className="font-semibold text-ms-fg">Two sequential timed modules.</span>{" "}
              Module&nbsp;1 runs on its own timer and auto-submits when it expires, then
              Module&nbsp;2 runs on its own timer — like the real Digital SAT. Students get{" "}
              <span className="font-semibold text-ms-fg">
                {(Number(form.midterm_module1_minutes) || 0) + (Number(form.midterm_module2_minutes) || 0)} minutes
              </span>{" "}
              in total. Choose “1 module” above if you want one continuous section instead.
            </p>
          )}

          {/* Target question count */}
          <Field
            id={`${id}-target`}
            label="Target question count"
            hint="Total questions across all modules. Used for grading and score calculation."
          >
            <input
              id={`${id}-target`}
              type="number"
              min={1}
              max={200}
              value={form.midterm_target_question_count}
              onChange={set("midterm_target_question_count")}
              className={CONTROL}
            />
          </Field>

          {/* Per-module question limit (hard cap enforced in the question console) */}
          <Field id={`${id}-limit`} label="Questions per module (limit)" hint="Maximum questions you can add to each module. Default 30.">
            <input
              id={`${id}-limit`}
              type="number"
              min={1}
              max={200}
              value={form.midterm_module_question_limit}
              onChange={set("midterm_module_question_limit")}
              className={CONTROL}
            />
          </Field>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-ms-border bg-ms-surface px-5 py-3.5">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="check" state={saving ? "busy" : "idle"} busyLabel="Saving…" disabled={saving || !form.title.trim()}>
            Save midterm
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Midterm card ─────────────────────────────────────────────────────────────

const VERSION_LETTERS = ["A", "B", "C", "D"];

/** One fact under the title: its icon and its words. */
function Fact({ icon, tone, children }: { icon: IconName; tone?: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name={icon} size="sm" className={cn("size-3.5", tone ?? "text-ms-fg-3")} />
      {children}
    </span>
  );
}

function MidtermRow({
  exam,
  delay,
  onEdit,
  onDelete,
  onPublish,
  onUnpublish,
  onResults,
  onAddVersion,
  onRemoveVersion,
  versionBusy,
  publishing,
}: {
  exam: AdminMidterm;
  delay: number;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onResults: () => void;
  onAddVersion: () => void;
  onRemoveVersion: (testId: number) => void;
  versionBusy: boolean;
  publishing: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const totalModules = exam.tests.reduce((acc, t) => acc + (t.modules?.length ?? 0), 0);
  const math = exam.midterm_subject === "MATH";

  const statusLabel = exam.is_published ? "Published" : exam.publish_ready ? "Ready" : "Draft";
  const statusTone: BadgeTone = exam.is_published ? "positive" : exam.publish_ready ? "attention" : "line";

  return (
    <article
      data-midterm={exam.id}
      style={{ animationDelay: `${delay}ms` }}
      className="animate-ms-card-in rounded-ms-card bg-ms-card p-5 shadow-ms-1"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Info block */}
        <div className="min-w-0 flex-1 basis-[20rem]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words text-[17px] font-bold leading-6 text-ms-fg">
              {exam.title || `Midterm #${exam.id}`}
            </h3>
            <Badge tone={statusTone} dot={exam.is_published}>
              {statusLabel}
            </Badge>
            {exam.midterm_type && exam.midterm_type !== "MIDTERM" ? (
              <Badge tone="info">{TYPE_LABELS[exam.midterm_type] ?? exam.midterm_type}</Badge>
            ) : null}
            {exam.midterm_level ? <Badge tone="line">{MIDTERM_LEVEL_LABELS[exam.midterm_level] ?? exam.midterm_level}</Badge> : null}
            {exam.midterm_period ? <Badge tone="line">{PERIOD_LABELS[exam.midterm_period] ?? exam.midterm_period}</Badge> : null}
          </div>

          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ms-fg-2">
            <Fact icon={math ? "sigma" : "book"} tone={math ? "text-ms-math-fg" : "text-ms-rw-fg"}>
              {subjectLabel(exam.midterm_subject)}
            </Fact>
            {exam.practice_date && <Fact icon="cal">{formatDate(exam.practice_date)}</Fact>}
            <Fact icon="clock">
              {exam.midterm_module_count === 1
                ? `${exam.midterm_module1_minutes} min`
                : `${exam.midterm_module1_minutes} + ${exam.midterm_module2_minutes} min`}
            </Fact>
            <Fact icon="file">{exam.midterm_target_question_count} target questions</Fact>
            {/* Pass mark — only meaningful once the midterm is pass/fail graded. */}
            {exam.midterm_pass_mark != null && exam.midterm_type !== "PRE_MIDTERM" && (
              <Fact icon="ok">Pass at {exam.midterm_pass_mark}</Fact>
            )}
            {totalModules > 0 && (
              <Fact icon="ok" tone="text-ms-positive-fg">
                {totalModules} module{totalModules !== 1 ? "s" : ""} created
              </Fact>
            )}
          </p>
        </div>

        {/* Actions — they wrap on a narrow card instead of running past its edge. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {exam.is_published ? (
            <Button variant="secondary" size="sm" icon="eye" state={publishing ? "busy" : "idle"} disabled={publishing} onClick={onUnpublish}>
              Unpublish
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              icon="eye"
              state={publishing ? "busy" : "idle"}
              disabled={!exam.publish_ready || publishing}
              title={!exam.publish_ready ? exam.publish_block_reason : undefined}
              onClick={onPublish}
            >
              Publish
            </Button>
          )}
          <Button variant="secondary" size="sm" icon="file" onClick={onResults}>
            Results
          </Button>
          <Button variant="secondary" size="sm" icon="pencil" onClick={onEdit}>
            Edit
          </Button>
          {confirmDelete ? (
            <span className="animate-ms-fade-in flex items-center gap-1.5">
              <Button variant="danger" size="sm" onClick={onDelete}>
                Confirm delete
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button variant="secondary" size="sm" icon="trash" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Publish block */}
      {!exam.is_published && !exam.publish_ready && exam.publish_block_reason && (
        <p className="mt-3 flex items-start gap-2 rounded-[12px] bg-ms-attention-soft px-3 py-2 text-[13px] leading-[18px] text-ms-attention-fg">
          <Icon name="warn" size="sm" className="mt-px size-3.5 shrink-0" />
          {exam.publish_block_reason}
        </p>
      )}

      {/*
        Versions → each is a parallel paper with its own questions and its own answer key
        (max 4). How many you author decides what the seating plan can separate, so say so
        here: authoring a second form is not a draft or a backup, it changes what half the
        class sits.
      */}
      <p className="mt-4 text-[13px] leading-[19px] text-ms-fg-2">
        {exam.tests.length < 2 ? (
          <>One version — everyone sits the same paper. Add a second to let the seating plan give desk partners different questions.</>
        ) : exam.tests.length < 4 ? (
          <>{exam.tests.length} versions — enough to separate desk partners and the rows in front and behind. Four also separates diagonals.</>
        ) : (
          <>Four versions — the seating plan can separate every direction: partner, aisle, front, behind and diagonal.</>
        )}
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {exam.tests.map((test, vIdx) => {
          const modules = test.modules ?? [];
          return (
            <section key={test.id} aria-label={`Version ${VERSION_LETTERS[vIdx] ?? vIdx + 1}`} className="rounded-[14px] bg-ms-surface p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ms-fg">
                  <Icon name="layers" size="sm" className="size-3.5 text-ms-primary-text" />
                  Version {VERSION_LETTERS[vIdx] ?? vIdx + 1}
                </span>
                {exam.tests.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    disabled={versionBusy}
                    onClick={() => onRemoveVersion(test.id)}
                    className="-my-1"
                  >
                    Remove
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {modules.length === 0 ? (
                  <p className="rounded-[12px] border border-dashed border-ms-border-strong px-3 py-2 text-[13px] italic text-ms-fg-3">No modules yet.</p>
                ) : (
                  modules.map((mod) => (
                    <Link
                      key={mod.id}
                      href={`/builder/midterms/${exam.id}/${test.id}/${mod.id}`}
                      className="group ms-transition ms-press flex min-h-10 items-center gap-2.5 rounded-[12px] bg-ms-card px-3 py-2 text-[14px] text-ms-fg shadow-ms-1 hover:bg-ms-primary-soft"
                    >
                      <Icon name="ms-module" size="sm" className={math ? "text-ms-math-fg" : "text-ms-rw-fg"} />
                      <span className="min-w-0 flex-1 font-medium">
                        {mod.module_order != null ? `Module ${mod.module_order}` : `Module #${mod.id}`}
                        {/*
                          A midterm's module time comes from the EXAM's own settings, not from
                          the authored Module row — that field still holds the SAT default (32)
                          it was created with and the runtime never reads it. Showing it made
                          this card contradict its own header ("40 + 40 min" above, "32 min"
                          here) with neither number explaining the other.
                        */}
                        {(() => {
                          const served =
                            mod.module_order === 2
                              ? exam.midterm_module_count >= 2
                                ? exam.midterm_module2_minutes
                                : null
                              : exam.midterm_module1_minutes;
                          return served != null ? (
                            <span className="ml-2 font-normal text-ms-fg-3">{served} min</span>
                          ) : (
                            <span className="ml-2 font-normal text-ms-attention-fg">not used — midterm is 1 module</span>
                          );
                        })()}
                      </span>
                      <span className="shrink-0 text-[13px] font-semibold text-ms-primary-text group-hover:underline">Edit questions →</span>
                    </Link>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
      {exam.tests.length < 4 && (
        <button
          type="button"
          onClick={onAddVersion}
          disabled={versionBusy}
          className="ms-transition ms-press mt-3 inline-flex h-9 items-center gap-1.5 rounded-[12px] border border-dashed border-ms-primary/40 bg-ms-primary-soft px-3 text-[13px] font-semibold text-ms-primary-text hover:border-ms-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="plus" size="sm" className="size-3.5" /> Add version{exam.tests.length > 0 ? ` (${exam.tests.length}/4)` : ""}
        </button>
      )}
    </article>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuilderMidtermsPage() {
  const [midterms, setMidterms] = useState<AdminMidterm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingMidterm, setEditingMidterm] = useState<AdminMidterm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [resultsExam, setResultsExam] = useState<AdminMidterm | null>(null);
  // Drill-down navigation: pick a subject (English/Math), then a level, then the midterms
  // in that bucket. "Add midterm" is only possible once both are chosen, and a new midterm
  // inherits the current subject+level. Legacy midterms with a blank level live under an
  // "Untagged" level bucket.
  const [selectedSubject, setSelectedSubject] = useState<"READING_WRITING" | "MATH" | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  // In-pane secondary filters — by monthly period and midterm type.
  const [filterPeriod, setFilterPeriod] = useState("ALL");
  const [filterType, setFilterType] = useState("ALL");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await examsAdminApi.getMockExams();
      const all = (raw as unknown as AdminMidterm[]).filter((e) => e.kind === "MIDTERM");
      setMidterms(all);
    } catch (e) {
      setError(parseError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // New midterm inherits the subject+level of the bucket the admin is standing in.
  const openCreate = () => {
    if (!selectedSubject || !selectedLevel) return; // gated: pick subject → level first
    setEditingMidterm(null);
    setSaveError(null);
    setModalOpen(true);
  };

  const openEdit = (m: AdminMidterm) => {
    setEditingMidterm(m);
    setSaveError(null);
    setModalOpen(true);
  };

  const handleSave = async (form: MidtermForm) => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        title: form.title.trim(),
        practice_date: form.practice_date || null,
        kind: "MIDTERM",
        midterm_subject: form.midterm_subject,
        midterm_scoring_scale: form.midterm_scoring_scale,
        midterm_module_count: Number(form.midterm_module_count),
        midterm_module1_minutes: Number(form.midterm_module1_minutes),
        midterm_module2_minutes: Number(form.midterm_module2_minutes),
        // Only meaningful with 2 modules; the backend also gates on module_count >= 2.
        // ALWAYS derived from the module count — picking "2 modules" IS the decision to
        // run two timed modules. This used to be a separate checkbox that defaulted to
        // OFF, so a midterm authored as 40+40 quietly served all 54 questions inside 40
        // minutes: the shape of a real incident. There is no legitimate "2 modules but
        // run them as one section" — that is what "1 module" means.
        midterm_two_module_runtime: form.midterm_module_count === "2",
        midterm_target_question_count: Number(form.midterm_target_question_count),
        midterm_module_question_limit: Number(form.midterm_module_question_limit),
        midterm_level: form.midterm_level,
        midterm_period: form.midterm_period,
        midterm_type: form.midterm_type,
        // Blank clears back to the scale default; a pre-midterm is never graded.
        midterm_pass_mark:
          form.midterm_type === "PRE_MIDTERM" || form.midterm_pass_mark.trim() === ""
            ? null
            : Number(form.midterm_pass_mark),
        midterm_retake_of:
          form.midterm_type === "RETAKE" && form.midterm_retake_of
            ? Number(form.midterm_retake_of)
            : null,
      };
      if (editingMidterm) {
        await examsAdminApi.updateMockExam(editingMidterm.id, payload);
      } else {
        await examsAdminApi.createMockExam(payload);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setSaveError(parseError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await examsAdminApi.deleteMockExam(id);
      await load();
    } catch (e) {
      setError(parseError(e));
    }
  };

  const [versionBusyId, setVersionBusyId] = useState<number | null>(null);
  const handleAddVersion = async (examId: number) => {
    setVersionBusyId(examId);
    try {
      await examsAdminApi.addMidtermVersion(examId);
      await load();
    } catch (e) {
      setError(parseError(e));
    } finally {
      setVersionBusyId(null);
    }
  };
  const handleRemoveVersion = async (examId: number, testId: number) => {
    setVersionBusyId(examId);
    try {
      await examsAdminApi.removeMidtermVersion(examId, testId);
      await load();
    } catch (e) {
      setError(parseError(e));
    } finally {
      setVersionBusyId(null);
    }
  };

  const handlePublish = async (id: number) => {
    setPublishingId(id);
    try {
      await examsAdminApi.publishMockExam(id);
      await load();
    } catch (e) {
      setError(parseError(e));
    } finally {
      setPublishingId(null);
    }
  };

  const handleUnpublish = async (id: number) => {
    setPublishingId(id);
    try {
      await examsAdminApi.unpublishMockExam(id);
      await load();
    } catch (e) {
      setError(parseError(e));
    } finally {
      setPublishingId(null);
    }
  };

  const modalInitial: MidtermForm = editingMidterm
    ? {
        title: editingMidterm.title ?? "",
        practice_date: editingMidterm.practice_date ?? "",
        midterm_subject: (editingMidterm.midterm_subject as "READING_WRITING" | "MATH") ?? "READING_WRITING",
        midterm_scoring_scale: (editingMidterm.midterm_scoring_scale as "SCALE_100" | "SCALE_800") ?? "SCALE_100",
        midterm_module_count: String(editingMidterm.midterm_module_count) as "1" | "2",
        midterm_module1_minutes: String(editingMidterm.midterm_module1_minutes ?? 60),
        midterm_module2_minutes: String(editingMidterm.midterm_module2_minutes ?? 60),
        midterm_target_question_count: String(editingMidterm.midterm_target_question_count ?? 44),
        midterm_module_question_limit: String(editingMidterm.midterm_module_question_limit ?? 30),
        midterm_level: editingMidterm.midterm_level ?? "",
        midterm_period: editingMidterm.midterm_period ?? "",
        midterm_type: editingMidterm.midterm_type ?? "MIDTERM",
        midterm_pass_mark:
          editingMidterm.midterm_pass_mark != null ? String(editingMidterm.midterm_pass_mark) : "",
        midterm_retake_of:
          editingMidterm.midterm_retake_of != null ? String(editingMidterm.midterm_retake_of) : "",
      }
    : {
        // Create: seed subject+level from the current drill-down context (locked in the modal).
        ...DEFAULT_FORM,
        midterm_subject: selectedSubject ?? "READING_WRITING",
        midterm_level: selectedLevel && selectedLevel !== UNTAGGED_LEVEL ? selectedLevel : "",
      };

  // A retake's parent must be a published midterm; itself and other retakes are excluded
  // so a chain of retakes can never form. Pre-midterms are excluded too: they are never
  // pass/fail graded, so a retake parented to one is unsittable for every student.
  // Subject filtering happens inside the modal, where the (editable) subject field lives.
  const retakeCandidates = midterms.filter(
    (m) =>
      m.is_published &&
      m.id !== editingMidterm?.id &&
      (m.midterm_type ?? "MIDTERM") === "MIDTERM",
  );

  const published = midterms.filter((m) => m.is_published).length;
  const drafts = midterms.filter((m) => !m.is_published).length;

  // Drill-down slices + counts.
  const subjectOf = (m: AdminMidterm) => (m.midterm_subject ?? "READING_WRITING");
  const countForSubject = (code: string) => midterms.filter((m) => subjectOf(m) === code).length;
  const subjectMidterms = selectedSubject ? midterms.filter((m) => subjectOf(m) === selectedSubject) : [];
  const countForLevel = (lvl: string) =>
    subjectMidterms.filter((m) => (lvl === UNTAGGED_LEVEL ? !(m.midterm_level || "") : (m.midterm_level || "") === lvl)).length;
  const hasUntagged = subjectMidterms.some((m) => !(m.midterm_level || ""));
  // The midterms of the level bucket, before the type / period chips (their counts).
  const levelMidterms = subjectMidterms.filter((m) => {
    const lvl = m.midterm_level || "";
    if (selectedLevel === UNTAGGED_LEVEL) return lvl === "";
    return !selectedLevel || lvl === selectedLevel;
  });
  const filteredMidterms = levelMidterms.filter((m) => {
    if (filterPeriod !== "ALL" && (m.midterm_period || "") !== filterPeriod) return false;
    if (filterType !== "ALL" && (m.midterm_type || "MIDTERM") !== filterType) return false;
    return true;
  });
  const selectedLevelLabel =
    selectedLevel === UNTAGGED_LEVEL ? "Untagged" : selectedLevel ? MIDTERM_LEVEL_LABELS[selectedLevel] ?? selectedLevel : "";
  const canCreate = Boolean(selectedSubject && selectedLevel);
  const filtered = filterType !== "ALL" || filterPeriod !== "ALL";
  const resetFilters = () => {
    setFilterType("ALL");
    setFilterPeriod("ALL");
  };

  const newMidtermButton = (
    <Button variant="primary" icon="plus" onClick={openCreate}>
      New midterm
    </Button>
  );

  return (
    <div className="flex flex-col gap-5">
      <LibraryHeader
        eyebrow="Learning System"
        title="Midterms"
        description="Teacher-assigned, classroom-scoped midterm exams. Each midterm is subject-specific, timed per-module, and graded by the instructor. Students access them through their classroom, not the SAT simulation interface."
        actions={
          <>
            <Button variant="secondary" icon="refresh" state={loading ? "busy" : "idle"} disabled={loading} onClick={() => void load()}>
              Refresh
            </Button>
            {canCreate && newMidtermButton}
          </>
        }
      />

      {/* Breadcrumb — subject → level drill-down */}
      <nav aria-label="Subject and level" className="animate-ms-fade-in flex flex-wrap items-center gap-1 text-[14px]">
        <Crumb
          current={!selectedSubject}
          onClick={() => {
            setSelectedSubject(null);
            setSelectedLevel(null);
            resetFilters();
          }}
        >
          All subjects
        </Crumb>
        {selectedSubject && (
          <>
            <CrumbSep />
            <Crumb
              current={!selectedLevel}
              onClick={() => {
                setSelectedLevel(null);
                resetFilters();
              }}
            >
              {subjectLabel(selectedSubject)}
            </Crumb>
          </>
        )}
        {selectedSubject && selectedLevel && (
          <>
            <CrumbSep />
            <Crumb current>{selectedLevelLabel}</Crumb>
          </>
        )}
      </nav>

      {/* Stats */}
      {!loading && midterms.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Midterms" value={midterms.length} icon="ms-midterm" />
          <StatTile label="Published" value={published} tone="positive" icon="eye" delay={40} />
          <StatTile label="Drafts" value={drafts} icon="pencil" delay={80} />
        </div>
      )}

      {/* In-pane secondary filters — type + period (level & subject are the drill-down) */}
      {!loading && canCreate && levelMidterms.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <ChipGroup
            label="Type"
            value={filterType}
            onChange={setFilterType}
            options={[
              { v: "ALL", l: "All types", n: levelMidterms.length },
              ...TYPE_OPTIONS.map((o) => ({ v: o.v, l: o.l, n: levelMidterms.filter((m) => (m.midterm_type || "MIDTERM") === o.v).length })),
            ]}
          />
          <ChipGroup
            label="Period"
            value={filterPeriod}
            onChange={setFilterPeriod}
            options={[
              { v: "ALL", l: "All periods", n: levelMidterms.length },
              ...PERIOD_OPTIONS.filter((o) => o.v !== "").map((o) => ({ v: o.v, l: o.l, n: levelMidterms.filter((m) => (m.midterm_period || "") === o.v).length })),
            ]}
          />
          {filtered && (
            <Button variant="ghost" size="sm" icon="x" onClick={resetFilters}>
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Domain clarification note */}
      <p className="flex items-start gap-2 rounded-ms-ctl bg-ms-surface px-3.5 py-2.5 text-[13px] leading-[19px] text-ms-fg-2">
        <Icon name="info" size="sm" className="mt-px size-3.5 shrink-0 text-ms-fg-3" />
        <span>
          <strong className="font-semibold text-ms-fg">Note:</strong> Midterms are classroom pedagogy tools — not SAT
          simulations. Use them for semester exams, unit tests, and curriculum assessments. For SAT-style timed mocks, go
          to{" "}
          <Link href="/builder/full-mocks" className="font-semibold text-ms-primary-text hover:underline">
            Builder → Full mocks
          </Link>
          .
        </span>
      </p>

      {/* Error */}
      {error ? <LibraryError>{error}</LibraryError> : null}

      {/* Content — drill-down: subject → level → midterms */}
      {loading ? (
        <div aria-busy="true" aria-label="Loading" className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-[100px] animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
          ))}
        </div>
      ) : selectedSubject === null ? (
        /* Step 1 — choose a subject */
        <div className="grid gap-4 sm:grid-cols-2">
          {MIDTERM_SUBJECTS.map((s, i) => {
            const n = countForSubject(s.code);
            return (
              <BucketCard
                key={s.code}
                big
                delay={i * 40}
                lead={<SubjectSquare math={s.code === "MATH"} />}
                title={s.label}
                sub={`${n} midterm${n !== 1 ? "s" : ""}`}
                onClick={() => {
                  setSelectedSubject(s.code);
                  setSelectedLevel(null);
                }}
              />
            );
          })}
        </div>
      ) : selectedLevel === null ? (
        /* Step 2 — choose a level within the subject */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {levelCodesForSubject(selectedSubject).map((code, i) => {
            const n = countForLevel(code);
            return (
              <BucketCard
                key={code}
                delay={i * 40}
                lead={<LevelBar math={selectedSubject === "MATH"} />}
                title={MIDTERM_LEVEL_LABELS[code]}
                sub={`${n} midterm${n !== 1 ? "s" : ""}`}
                onClick={() => {
                  setSelectedLevel(code);
                  resetFilters();
                }}
              />
            );
          })}
          {hasUntagged && (
            <BucketCard
              dashed
              delay={levelCodesForSubject(selectedSubject).length * 40}
              title="Untagged"
              sub={`${countForLevel(UNTAGGED_LEVEL)} without a level`}
              onClick={() => {
                setSelectedLevel(UNTAGGED_LEVEL);
                resetFilters();
              }}
            />
          )}
        </div>
      ) : filteredMidterms.length === 0 ? (
        /* Step 3 — empty bucket */
        <div className="rounded-ms-card bg-ms-card p-4 shadow-ms-1">
          <EmptyState
            icon="ms-midterm"
            title={filtered ? "No midterms match these filters" : `No ${subjectLabel(selectedSubject)} · ${selectedLevelLabel} midterms yet`}
            detail={filtered ? "Try a different type or period." : "Create a midterm in this level, configure its structure, then author its questions."}
            action={canCreate && !filtered ? newMidtermButton : undefined}
          />
        </div>
      ) : (
        /* Step 3 — the midterms in this subject+level */
        <div className="flex flex-col gap-4">
          {filteredMidterms.map((m, i) => (
            <MidtermRow
              key={m.id}
              exam={m}
              delay={Math.min(i, 6) * 40}
              onEdit={() => openEdit(m)}
              onDelete={() => void handleDelete(m.id)}
              onPublish={() => void handlePublish(m.id)}
              onUnpublish={() => void handleUnpublish(m.id)}
              onResults={() => setResultsExam(m)}
              onAddVersion={() => void handleAddVersion(m.id)}
              onRemoveVersion={(testId) => void handleRemoveVersion(m.id, testId)}
              versionBusy={versionBusyId === m.id}
              publishing={publishingId === m.id}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      <MidtermModal
        open={modalOpen}
        heading={editingMidterm ? "Edit midterm" : "New midterm"}
        initial={modalInitial}
        saving={saving}
        error={saveError}
        retakeCandidates={retakeCandidates}
        lockSubjectLevel={!editingMidterm}
        onSubmit={(f) => void handleSave(f)}
        onClose={() => setModalOpen(false)}
      />

      <MidtermResultsModal exam={resultsExam} onClose={() => setResultsExam(null)} />
    </div>
  );
}

// ── Teacher-only midterm results ──────────────────────────────────────────
// Per-student score plus the exact questions each student missed. This is the
// breakdown students never see (they only get their final score).
type MidtermResultRow = {
  attempt_id: number;
  student_id: number | null;
  student_username: string;
  student_name: string;
  score: number | null;
  max_score: number;
  total_questions: number;
  correct_count: number;
  wrong_count: number;
  wrong_questions: {
    question_id: number;
    module_order: number;
    prompt: string;
    student_answer: unknown;
    correct_answers: unknown;
  }[];
  completed_at: string | null;
};

function MidtermResultsModal({ exam, onClose }: { exam: AdminMidterm | null; onClose: () => void }) {
  const titleId = useId();
  // The exam stays drawn while the dialog leaves.
  const [shown, setShown] = useState<AdminMidterm | null>(exam);
  if (exam && exam !== shown) setShown(exam);

  return (
    <Dialog open={Boolean(exam)} onClose={onClose} labelledBy={titleId} width={760}>
      {shown ? <ResultsBody key={shown.id} exam={shown} titleId={titleId} onClose={onClose} /> : null}
    </Dialog>
  );
}

function ResultsBody({ exam, titleId, onClose }: { exam: AdminMidterm; titleId: string; onClose: () => void }) {
  const [rows, setRows] = useState<MidtermResultRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    examsAdminApi
      .getMidtermResults(exam.id)
      .then((data: { students?: MidtermResultRow[] }) => {
        if (!cancelled) setRows(data.students ?? []);
      })
      .catch((e) => {
        if (!cancelled) setErr(parseError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [exam.id]);

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ms-border px-[22px] py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">
            Results · {exam.title || `Midterm #${exam.id}`}
          </h2>
          <p className="text-[13px] text-ms-fg-3">Visible to teachers only</p>
        </div>
        <Button variant="ghost" size="sm" icon="x" aria-label="Close" tooltip={false} onClick={onClose} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-[22px]">
        {err ? <LibraryError>{err}</LibraryError> : null}
        {!rows && !err && (
          <div aria-busy="true" aria-label="Loading…" className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[58px] animate-ms-shimmer rounded-[12px] bg-ms-surface-2" />
            ))}
          </div>
        )}
        {rows && rows.length === 0 && <p className="text-[14px] text-ms-fg-2">No students have completed this midterm yet.</p>}
        {rows?.map((r) => {
          const open = expanded === r.attempt_id;
          return (
            <div key={r.attempt_id} className={cn("rounded-[14px] border", open ? "border-ms-primary/40 bg-ms-card" : "border-ms-border bg-ms-card")}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setExpanded((cur) => (cur === r.attempt_id ? null : r.attempt_id))}
                className="ms-transition flex w-full items-center justify-between gap-3 rounded-[14px] px-4 py-3 text-left hover:bg-ms-surface"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold text-ms-fg">{r.student_name || r.student_username}</span>
                  <span className="block text-[13px] text-ms-fg-2">
                    {r.correct_count}/{r.total_questions} correct · {r.wrong_count} wrong
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-right text-[18px] font-bold tabular-nums text-ms-fg">
                    {r.score}
                    <span className="text-[13px] font-semibold text-ms-fg-3"> / {r.max_score}</span>
                  </span>
                  <Icon name="down" size="sm" className={cn("text-ms-fg-3 transition-transform duration-200", open && "rotate-180")} />
                </span>
              </button>
              {open && (
                <div className="animate-ms-fade-in flex flex-col gap-2 border-t border-ms-line px-4 py-3">
                  {r.wrong_questions.length === 0 ? (
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ms-positive-fg">
                      <Icon name="ok" size="sm" className="size-3.5" />
                      Perfect — no wrong answers.
                    </p>
                  ) : (
                    r.wrong_questions.map((w) => (
                      <div key={w.question_id} className="rounded-[10px] bg-ms-surface px-3 py-2 text-[13px] leading-[19px]">
                        <p className="font-semibold text-ms-fg">
                          M{w.module_order} · {w.prompt || `Question #${w.question_id}`}
                        </p>
                        <p className="mt-0.5 text-ms-critical-fg">Answered: {String(w.student_answer ?? "—")}</p>
                        <p className="text-ms-positive-fg">
                          Correct: {Array.isArray(w.correct_answers) ? w.correct_answers.join(", ") : String(w.correct_answers ?? "—")}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
