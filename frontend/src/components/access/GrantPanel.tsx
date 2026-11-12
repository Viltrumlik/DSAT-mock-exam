"use client";

import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { LibraryError } from "@/features/builderLibrary/sectionParts";
import { Button, Segmented } from "@/features/console/ui";
import { CONTROL, FIELD_LABEL, HINT } from "@/features/questionsAdmin/questionLook";
import {
  accessApi,
  SUBJECT_SCOPED_TYPES,
  type BulkResult,
  type SubjectScope,
} from "@/lib/accessApi";
import { classesApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { StudentMultiSelect, type StudentRow } from "./StudentMultiSelect";
import { ResourcePicker, type SelectedResource } from "./ResourcePicker";
import { AccessAvatar, CARD, EYEBROW, LINE } from "./accessConsole";

// Resource-centric only: access is always granted through a resource, to students
// or to a whole classroom. (Subject-only and module-choice assignment were removed.)
type Mode = "resource_students" | "resource_classroom";
type StepKey = "recipients" | "tests" | "confirm";

const MODES: { key: Mode; label: string; icon: IconName; hint: string }[] = [
  { key: "resource_students", label: "Tests → students", icon: "bookmark", hint: "Grant one or many tests to one or many students." },
  { key: "resource_classroom", label: "Tests → classroom", icon: "cap", hint: "Grant one or many tests to every enrolled student (transactional)." },
];

const SCOPES: { value: SubjectScope; label: string }[] = [
  { value: "math", label: "Math" },
  { value: "reading", label: "Reading" },
  { value: "both", label: "Both" },
];

const STEP_LABELS: Record<StepKey, string> = {
  recipients: "Recipients",
  tests: "Tests",
  confirm: "Confirm",
};

// A mode card: a pickable row drawn as a card, its words stacked.
const MODE_CARD = "ms-transition ms-press flex flex-col gap-1.5 rounded-ms-card border p-4 text-left";
const MODE_OFF = "border-ms-border bg-ms-card hover:border-ms-border-strong hover:bg-ms-surface";
const MODE_ON = "border-ms-primary bg-ms-primary-soft";

/** The recipients bar on the Tests step: a quiet band above the picker. */
const BAND = "rounded-ms-ctl border border-ms-line bg-ms-surface px-4 py-3";
/** A recipient as a small chip in that band. */
const RECIPIENT_CHIP =
  "inline-flex h-7 items-center gap-1.5 rounded-full border border-ms-border bg-ms-card pl-1 pr-2 text-[13px] font-medium leading-none text-ms-fg";

// `StudentMultiSelect` (shared with the teacher's midterm screens) still draws with the student app's tokens
// (bg-card, border-border, text-foreground…) and the old access tint. Point those, here only, at the console's —
// in dark mode its rows were the student app's navy cards inside a console page.
const STUDENT_PICKER_TINT = {
  "--acc-card-sel": "var(--ms-primary-soft)",
  "--color-card": "var(--ms-card)",
  "--color-border": "var(--ms-border)",
  "--color-foreground": "var(--ms-fg)",
  "--color-muted-foreground": "var(--ms-fg-3)",
  "--primary": "var(--ms-primary)",
} as CSSProperties;

type ClassroomRow = { id: number; name: string; subject?: string };

function studentLabel(u: StudentRow): string {
  const name = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
  return name || u.email || u.username || `User #${u.id}`;
}

export function GrantPanel({
  onSuccess,
  lockResource,
  lockUserIds,
}: {
  onSuccess?: () => void;
  /** Pre-scope to one resource (By-resource → Add users): hides the tests step. */
  lockResource?: SelectedResource;
  /** Pre-scope to fixed students (By-user → Grant access): hides the recipients step. */
  lockUserIds?: number[];
}) {
  const uid = useId();
  const classroomFieldId = `${uid}-classroom`;
  const expiresFieldId = `${uid}-expires`;
  const locked = Boolean(lockResource) || Boolean(lockUserIds);
  const [mode, setMode] = useState<Mode>("resource_students");
  const [userIds, setUserIds] = useState<number[]>(lockUserIds ?? []);
  const [studentRows, setStudentRows] = useState<StudentRow[]>([]);
  const [resources, setResources] = useState<SelectedResource[]>(lockResource ? [lockResource] : []);
  const [subjectScope, setSubjectScope] = useState<SubjectScope>("both");
  const [classroomId, setClassroomId] = useState<number | "">("");
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);

  // Steps adapt to what's already locked in embedded (By-user / By-resource) use.
  const steps: StepKey[] = useMemo(
    () => [
      ...(lockUserIds ? [] : (["recipients"] as StepKey[])),
      ...(lockResource ? [] : (["tests"] as StepKey[])),
      "confirm" as StepKey,
    ],
    [lockUserIds, lockResource],
  );
  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const isLast = stepIdx >= steps.length - 1;

  const showScope = resources.some((r) => SUBJECT_SCOPED_TYPES.has(r.resource_type));
  const chosenClassroom = classrooms.find((c) => c.id === classroomId) ?? null;

  useEffect(() => {
    (async () => {
      try {
        const data = await classesApi.list();
        setClassrooms((data.items as ClassroomRow[]) ?? []);
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  const reset = () => {
    if (!lockUserIds) { setUserIds([]); setStudentRows([]); }
    if (!lockResource) setResources([]);
    setSubjectScope("both");
    setClassroomId("");
    setExpiresAt("");
    setResult(null);
    setError(null);
    setStepIdx(0);
  };

  const recipientCount = mode === "resource_classroom" ? undefined : (lockUserIds?.length ?? userIds.length);

  const stepValid = (s: StepKey): boolean => {
    if (s === "recipients") {
      return mode === "resource_classroom" ? classroomId !== "" : userIds.length > 0;
    }
    if (s === "tests") {
      // Recipients can now be emptied here (chip ✕), so re-validate them — never advance
      // to Confirm with zero recipients.
      const hasRecipients = mode === "resource_classroom" ? classroomId !== "" : (lockUserIds?.length ?? userIds.length) > 0;
      return resources.length > 0 && hasRecipients;
    }
    return canSubmit; // confirm
  };

  const canSubmit = (() => {
    if (submitting || resources.length === 0) return false;
    if (mode === "resource_students") return (lockUserIds?.length ?? userIds.length) > 0;
    return classroomId !== "";
  })();

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    const expires_at = expiresAt ? new Date(expiresAt).toISOString() : null;
    const items = resources.map((r) => ({
      resource_type: r.resource_type,
      resource_id: r.resource_id,
      subject_scope: SUBJECT_SCOPED_TYPES.has(r.resource_type) ? subjectScope : undefined,
    }));
    try {
      let res: BulkResult;
      if (mode === "resource_students") {
        res = await accessApi.grantResources({ user_ids: userIds, resources: items, expires_at });
      } else {
        res = await accessApi.grantClassroomResources({
          classroom_id: Number(classroomId),
          resources: items,
          expires_at,
        });
      }
      setResult(res);
      onSuccess?.();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not grant access.");
    } finally {
      setSubmitting(false);
    }
  };

  const goNext = () => {
    if (!stepValid(step)) return;
    if (isLast) void submit();
    else setStepIdx((i) => i + 1);
  };
  const goBack = () => setStepIdx((i) => Math.max(0, i - 1));

  // Deselect a recipient from the compact bar shown on the Tests step.
  const removeStudent = (id: number) => {
    setUserIds((ids) => ids.filter((x) => x !== id));
    setStudentRows((rows) => rows.filter((r) => r.id !== id));
  };

  // ── Success screen ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className={cn(CARD, "animate-ms-card-in flex flex-col items-center p-8 text-center")}>
        <span className="grid size-14 place-items-center rounded-full bg-ms-positive-soft text-ms-positive-fg">
          <Icon name="check" size="xl" />
        </span>
        <h2 className="mt-4 text-[20px] font-bold leading-7 text-ms-fg">Access granted</h2>
        <p className="mt-1.5 text-[14px] text-ms-fg-2">
          <span className="font-semibold text-ms-fg">{result.created}</span> created,{" "}
          {result.skipped} already had access ({result.requested} requested).
        </p>
        <Button variant="primary" onClick={reset} className="mt-6">
          Grant more access
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Stepper */}
      {steps.length > 1 && <Stepper steps={steps} current={stepIdx} />}

      <div className={cn(CARD, "animate-ms-fade-in p-5 sm:p-6")} key={step}>
        {/* ── Step: Recipients ─────────────────────────────────────────────── */}
        {step === "recipients" && (
          <div className="flex flex-col gap-5">
            {!locked && (
              <div className="grid gap-3 sm:grid-cols-2">
                {MODES.map((m) => {
                  const active = mode === m.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => { setMode(m.key); setError(null); }}
                      className={cn(MODE_CARD, active ? MODE_ON : MODE_OFF)}
                    >
                      <span className="flex items-center gap-2 text-[15px] font-semibold text-ms-fg">
                        <span className={active ? "text-ms-primary-text" : "text-ms-fg-3"}>
                          <Icon name={m.icon} />
                        </span>
                        {m.label}
                      </span>
                      <span className="text-[13px] text-ms-fg-3">{m.hint}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {mode === "resource_classroom" ? (
              <div>
                <label htmlFor={classroomFieldId} className={cn(FIELD_LABEL, "flex items-center gap-1.5")}>
                  <Icon name="cap" size="sm" className="text-ms-fg-3" /> Classroom
                </label>
                <select
                  id={classroomFieldId}
                  value={classroomId}
                  onChange={(e) => setClassroomId(e.target.value ? Number(e.target.value) : "")}
                  className={CONTROL}
                >
                  <option value="">Select a classroom…</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.subject ? ` · ${c.subject}` : ""}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={STUDENT_PICKER_TINT}>
                <p className={cn(FIELD_LABEL, "flex items-center gap-1.5")}>
                  <Icon name="users" size="sm" className="text-ms-fg-3" /> Students
                </p>
                <StudentMultiSelect value={userIds} onChange={setUserIds} onRowsChange={setStudentRows} />
              </div>
            )}
          </div>
        )}

        {/* ── Step: Tests ──────────────────────────────────────────────────── */}
        {step === "tests" && (
          <div className="flex flex-col gap-4">
            {/* Keep the chosen recipients in view (compact) while picking tests. */}
            <SelectedRecipientsBar
              mode={mode}
              studentRows={studentRows}
              userCount={lockUserIds?.length ?? userIds.length}
              chosenClassroom={chosenClassroom}
              onRemove={lockUserIds ? undefined : removeStudent}
            />
            <ResourcePicker value={resources} onChange={setResources} />
          </div>
        )}

        {/* ── Step: Confirm ────────────────────────────────────────────────── */}
        {step === "confirm" && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-[20px] font-bold leading-7 text-ms-fg">Review this grant</h2>
              <p className="mt-1 text-[14px] text-ms-fg-2">
                Confirm the details below. {mode === "resource_students" ? "Students" : "The classroom"} are notified immediately.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              {/* Recipients */}
              <div className="min-w-0">
                <p className={cn(EYEBROW, "mb-2")}>
                  Recipients{recipientCount !== undefined ? ` · ${recipientCount}` : ""}
                </p>
                <div className="flex flex-col gap-2">
                  {lockUserIds ? (
                    <div className={cn(LINE, "py-3 text-[14px] font-semibold text-ms-fg")}>
                      {lockUserIds.length} selected student{lockUserIds.length === 1 ? "" : "s"}
                    </div>
                  ) : mode === "resource_classroom" ? (
                    <div className={LINE}>
                      <span className="grid size-10 shrink-0 place-items-center rounded-ms-ctl bg-ms-primary-soft text-ms-primary-text"><Icon name="cap" /></span>
                      <span className="truncate text-[14px] font-semibold text-ms-fg">{chosenClassroom?.name ?? "Classroom"}</span>
                    </div>
                  ) : studentRows.length === 0 ? (
                    <p className="text-[14px] text-ms-fg-3">No recipients selected.</p>
                  ) : (
                    studentRows.map((u) => (
                      <div key={u.id} className={LINE}>
                        <AccessAvatar name={studentLabel(u)} seed={u.id} size="sm" src={u.profile_image_url} />
                        <span className="truncate text-[14px] font-semibold text-ms-fg">{studentLabel(u)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Tests */}
              <div className="min-w-0">
                <p className={cn(EYEBROW, "mb-2")}>Tests · {resources.length}</p>
                <div className="flex flex-col gap-2">
                  {resources.map((r) => (
                    <div key={`${r.resource_type}:${r.resource_id}`} className={LINE}>
                      <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-ms-primary-soft text-ms-primary-text"><Icon name="bookmark" size="sm" /></span>
                      <span className="truncate text-[14px] font-semibold text-ms-fg">{r.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {showScope && (
              <div>
                <p className={cn(EYEBROW, "mb-2")}>Sections</p>
                <Segmented<SubjectScope> label="Sections" options={SCOPES} value={subjectScope} onChange={setSubjectScope} />
                <p className={HINT}>
                  Math grants only the Math section, Reading only the Reading &amp; Writing section.
                </p>
              </div>
            )}

            <div className="grid items-end gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor={expiresFieldId} className={FIELD_LABEL}>Expires at (optional)</label>
                <input
                  id={expiresFieldId}
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className={CONTROL}
                />
                <p className={HINT}>Leave empty for permanent access.</p>
              </div>
              <div className="rounded-ms-ctl border border-ms-primary-soft-2 bg-ms-primary-soft p-4 text-[14px]">
                <p className="flex flex-wrap items-center gap-1.5 font-medium text-ms-fg">
                  <span className="text-ms-primary-text"><Icon name="info" size="sm" /></span>
                  {mode === "resource_classroom"
                    ? <><span className="font-bold">{chosenClassroom?.name ?? "The classroom"}</span> will get <span className="font-bold">{resources.length}</span> test(s)</>
                    : <><span className="font-bold">{recipientCount}</span> student{recipientCount === 1 ? "" : "s"} will get <span className="font-bold">{resources.length}</span> test(s)</>}
                </p>
                <p className="mt-0.5 text-ms-fg-2">
                  with {expiresAt ? "temporary" : <span className="font-semibold text-ms-fg">permanent</span>} access
                  {expiresAt ? ` until ${new Date(expiresAt).toLocaleDateString()}` : ""}.
                </p>
              </div>
            </div>

            {error && <LibraryError>{error}</LibraryError>}
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {stepIdx > 0 ? (
          <Button variant="secondary" icon="left" onClick={goBack}>
            Back
          </Button>
        ) : <span />}
        <div className="flex flex-wrap items-center justify-end gap-4">
          {step === "recipients" && mode === "resource_students" && (
            <span className="text-[14px] font-medium text-ms-fg-3">
              <span className="font-semibold text-ms-fg">{userIds.length}</span> selected
            </span>
          )}
          {step === "tests" && (
            <span className="text-[14px] font-medium text-ms-fg-3">
              <span className="font-semibold text-ms-fg">{resources.length}</span> selected
            </span>
          )}
          <Button
            variant="primary"
            onClick={goNext}
            disabled={!stepValid(step)}
            state={submitting ? "busy" : "idle"}
            busyLabel="Grant access"
          >
            {isLast ? "Grant access" : step === "recipients" ? "Continue to tests" : "Review grant"}
            <Icon name={isLast ? "check" : "arrow"} />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Selected-recipients bar (shown atop the Tests step) ─────────────────────────
// Keeps the students (or classroom) chosen in step 1 visible — as small chips — so the
// admin never loses sight of who they are granting to while choosing the tests.
function SelectedRecipientsBar({
  mode,
  studentRows,
  userCount,
  chosenClassroom,
  onRemove,
}: {
  mode: Mode;
  studentRows: StudentRow[];
  userCount: number;
  chosenClassroom: ClassroomRow | null;
  onRemove?: (id: number) => void;
}) {
  if (mode === "resource_classroom") {
    if (!chosenClassroom) return null;
    return (
      <div className={BAND}>
        <p className={cn(EYEBROW, "mb-2")}><Icon name="cap" size="sm" /> Recipient</p>
        <span className={cn(RECIPIENT_CHIP, "pl-1.5 pr-3")}>
          <span className="grid size-5 place-items-center rounded-[6px] bg-ms-primary-soft text-ms-primary-text"><Icon name="cap" size="sm" className="size-3" /></span>
          <span className="max-w-[220px] truncate">{chosenClassroom.name}</span>
        </span>
      </div>
    );
  }
  // Embedded By-user flow: rows aren't loaded, so just show the count.
  if (studentRows.length === 0) {
    if (userCount <= 0) return null;
    return (
      <div className={BAND}>
        <p className={cn(EYEBROW, "mb-1.5")}><Icon name="users" size="sm" /> Recipients</p>
        <span className="text-[14px] font-semibold text-ms-fg">{userCount} student{userCount === 1 ? "" : "s"} selected</span>
      </div>
    );
  }
  return (
    <div className={BAND}>
      <p className={cn(EYEBROW, "mb-2")}>
        <Icon name="users" size="sm" /> {studentRows.length} recipient{studentRows.length === 1 ? "" : "s"} selected
      </p>
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
        {studentRows.map((u) => (
          <span key={u.id} className={RECIPIENT_CHIP}>
            <AccessAvatar name={studentLabel(u)} seed={u.id} size="xs" src={u.profile_image_url} />
            <span className="max-w-[130px] truncate">{studentLabel(u)}</span>
            {onRemove && (
              <button
                type="button"
                aria-label={`Remove ${studentLabel(u)}`}
                onClick={() => onRemove(u.id)}
                className="ms-press -my-1 -mr-1 grid size-6 place-items-center rounded-full text-ms-fg-3 hover:bg-ms-surface-2 hover:text-ms-fg"
              >
                <Icon name="x" size="sm" className="size-3" />
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Stepper ───────────────────────────────────────────────────────────────────
function Stepper({ steps, current }: { steps: StepKey[]; current: number }) {
  return (
    <ol className={cn(CARD, "flex items-center gap-3 px-5 py-4")}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} aria-current={active ? "step" : undefined} className="flex flex-1 items-center gap-3 last:flex-none">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full text-[14px] font-semibold transition-colors",
                  done || active ? "bg-ms-primary text-white" : "bg-ms-surface-2 text-ms-fg-3",
                )}
              >
                {done ? <Icon name="check" size="sm" /> : i + 1}
              </span>
              <div className="hidden sm:block">
                <p className="text-[12px] font-medium text-ms-fg-3">Step {i + 1}</p>
                <p className={cn("text-[14px] font-semibold", active || done ? "text-ms-fg" : "text-ms-fg-3")}>
                  {STEP_LABELS[s]}
                </p>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-ms-border">
                <div
                  className="h-full origin-left rounded-full bg-ms-primary transition-transform duration-500"
                  style={{ transform: `scaleX(${done ? 1 : 0})` }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
