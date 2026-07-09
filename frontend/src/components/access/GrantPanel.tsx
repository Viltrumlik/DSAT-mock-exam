"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, BookMarked, Check, Loader2, School, Sparkles, Users,
} from "lucide-react";
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
import { accClass, Avatar, Pill } from "./accessUi";

// Resource-centric only: access is always granted through a resource, to students
// or to a whole classroom. (Subject-only and module-choice assignment were removed.)
type Mode = "resource_students" | "resource_classroom";
type StepKey = "recipients" | "tests" | "confirm";

const MODES: { key: Mode; label: string; icon: React.ElementType; hint: string }[] = [
  { key: "resource_students", label: "Tests → students", icon: BookMarked, hint: "Grant one or many tests to one or many students." },
  { key: "resource_classroom", label: "Tests → classroom", icon: School, hint: "Grant one or many tests to every enrolled student (transactional)." },
];

const SCOPES: { key: SubjectScope; label: string }[] = [
  { key: "math", label: "Math" },
  { key: "reading", label: "Reading" },
  { key: "both", label: "Both" },
];

const STEP_LABELS: Record<StepKey, string> = {
  recipients: "Recipients",
  tests: "Tests",
  confirm: "Confirm",
};

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
    if (s === "tests") return resources.length > 0;
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

  // ── Success screen ──────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className={cn(accClass.card, "relative overflow-hidden p-8 text-center", accClass.rise)}>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
          <Check className="h-7 w-7" strokeWidth={3} />
        </div>
        <h2 className={cn(accClass.serif, "mt-4 text-2xl font-extrabold")}>Access granted</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          <span className="font-bold text-foreground">{result.created}</span> created,{" "}
          {result.skipped} already had access ({result.requested} requested).
        </p>
        <button type="button" onClick={reset} className={cn(accClass.primaryBtn, "mx-auto mt-6")}>
          Grant more access
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stepper */}
      {steps.length > 1 && <Stepper steps={steps} current={stepIdx} />}

      <div className={cn(accClass.card, "p-6", accClass.rise)} key={step}>
        {/* ── Step: Recipients ─────────────────────────────────────────────── */}
        {step === "recipients" && (
          <div className="space-y-5">
            {!locked && (
              <div className="grid gap-3 sm:grid-cols-2">
                {MODES.map((m) => {
                  const active = mode === m.key;
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => { setMode(m.key); setError(null); }}
                      className={cn(
                        "flex flex-col gap-1.5 p-4 text-left",
                        active ? accClass.selectableOn : accClass.selectable,
                      )}
                    >
                      <span className="flex items-center gap-2 text-[15px] font-bold text-foreground">
                        <Icon className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")} />
                        {m.label}
                      </span>
                      <span className="text-xs text-muted-foreground">{m.hint}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {mode === "resource_classroom" ? (
              <div>
                <p className={cn(accClass.eyebrow, "mb-2")}><School className="h-3.5 w-3.5" /> Classroom</p>
                <select
                  value={classroomId}
                  onChange={(e) => setClassroomId(e.target.value ? Number(e.target.value) : "")}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground outline-none transition-shadow focus:ring-2 focus:ring-[color:var(--primary)]/25"
                >
                  <option value="">Select a classroom…</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.subject ? ` · ${c.subject}` : ""}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <p className={cn(accClass.eyebrow, "mb-2")}><Users className="h-3.5 w-3.5" /> Students</p>
                <StudentMultiSelect value={userIds} onChange={setUserIds} onRowsChange={setStudentRows} />
              </div>
            )}
          </div>
        )}

        {/* ── Step: Tests ──────────────────────────────────────────────────── */}
        {step === "tests" && (
          <ResourcePicker value={resources} onChange={setResources} />
        )}

        {/* ── Step: Confirm ────────────────────────────────────────────────── */}
        {step === "confirm" && (
          <div className="space-y-5">
            <div>
              <h2 className={cn(accClass.serif, "text-2xl font-extrabold")}>Review this grant</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Confirm the details below. {mode === "resource_students" ? "Students" : "The classroom"} are notified immediately.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              {/* Recipients */}
              <div>
                <p className={cn(accClass.eyebrow, "mb-2")}>
                  Recipients{recipientCount !== undefined ? ` · ${recipientCount}` : ""}
                </p>
                <div className="space-y-2">
                  {lockUserIds ? (
                    <div className={cn(accClass.card, "px-3.5 py-3 text-sm font-bold text-foreground")}>
                      {lockUserIds.length} selected student{lockUserIds.length === 1 ? "" : "s"}
                    </div>
                  ) : mode === "resource_classroom" ? (
                    <div className={cn(accClass.card, "flex items-center gap-3 px-3.5 py-3")}>
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><School className="h-5 w-5" /></span>
                      <span className="text-sm font-bold text-foreground">{chosenClassroom?.name ?? "Classroom"}</span>
                    </div>
                  ) : studentRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recipients selected.</p>
                  ) : (
                    studentRows.map((u) => (
                      <div key={u.id} className={cn(accClass.card, "flex items-center gap-3 px-3.5 py-2.5")}>
                        <Avatar name={studentLabel(u)} seed={u.id} size={32} />
                        <span className="truncate text-sm font-bold text-foreground">{studentLabel(u)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Tests */}
              <div>
                <p className={cn(accClass.eyebrow, "mb-2")}>Tests · {resources.length}</p>
                <div className="space-y-2">
                  {resources.map((r) => (
                    <div key={`${r.resource_type}:${r.resource_id}`} className={cn(accClass.card, "flex items-center gap-3 px-3.5 py-2.5")}>
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><BookMarked className="h-4 w-4" /></span>
                      <span className="truncate text-sm font-bold text-foreground">{r.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {showScope && (
              <div>
                <p className={cn(accClass.eyebrow, "mb-2")}>Sections</p>
                <div className="flex gap-2">
                  {SCOPES.map((s) => (
                    <Pill key={s.key} active={subjectScope === s.key} onClick={() => setSubjectScope(s.key)}>
                      {s.label}
                    </Pill>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Math grants only the Math section, Reading only the Reading &amp; Writing section.
                </p>
              </div>
            )}

            <div className="grid items-end gap-4 sm:grid-cols-2">
              <div>
                <p className={cn(accClass.eyebrow, "mb-2")}>Expires at (optional)</p>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-[color:var(--primary)]/25"
                />
                <p className="mt-1 text-xs text-muted-foreground">Leave empty for permanent access.</p>
              </div>
              <div className="rounded-xl border border-[var(--acc-chip-border)] bg-[var(--acc-card-sel)] p-4 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Sparkles className="h-4 w-4 text-primary" />
                  {mode === "resource_classroom"
                    ? <><span className="font-extrabold">{chosenClassroom?.name ?? "The classroom"}</span> will get <span className="font-extrabold">{resources.length}</span> test(s)</>
                    : <><span className="font-extrabold">{recipientCount}</span> student{recipientCount === 1 ? "" : "s"} will get <span className="font-extrabold">{resources.length}</span> test(s)</>}
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  with {expiresAt ? "temporary" : <span className="font-semibold text-foreground">permanent</span>} access
                  {expiresAt ? ` until ${new Date(expiresAt).toLocaleDateString()}` : ""}.
                </p>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>
            )}
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between">
        {stepIdx > 0 ? (
          <button type="button" onClick={goBack} className={accClass.ghostBtn}>
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        ) : <span />}
        <div className="flex items-center gap-4">
          {step === "recipients" && mode === "resource_students" && (
            <span className="text-sm font-semibold text-muted-foreground">
              <span className="text-foreground">{userIds.length}</span> selected
            </span>
          )}
          {step === "tests" && (
            <span className="text-sm font-semibold text-muted-foreground">
              <span className="text-foreground">{resources.length}</span> selected
            </span>
          )}
          <button
            type="button"
            onClick={goNext}
            disabled={!stepValid(step)}
            className={accClass.primaryBtn}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isLast ? "Grant access" : step === "recipients" ? "Continue to tests" : "Review grant"}
            {!isLast && <ArrowRight className="h-4 w-4" />}
            {isLast && !submitting && <Check className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stepper ───────────────────────────────────────────────────────────────────
function Stepper({ steps, current }: { steps: StepKey[]; current: number }) {
  return (
    <div className={cn(accClass.card, "flex items-center gap-3 px-5 py-4")}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={s} className="flex flex-1 items-center gap-3 last:flex-none">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors",
                  done ? "bg-primary text-white" : active ? "bg-primary text-white" : "bg-surface-2 text-muted-foreground",
                )}
              >
                {done ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
              </span>
              <div className="hidden sm:block">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Step {i + 1}</p>
                <p className={cn("text-sm font-bold", active || done ? "text-foreground" : "text-muted-foreground")}>
                  {STEP_LABELS[s]}
                </p>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full origin-left rounded-full bg-primary transition-transform duration-500"
                  style={{ transform: `scaleX(${done ? 1 : 0})` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
