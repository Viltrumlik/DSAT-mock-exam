"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { classesApi } from "@/lib/api";
import { normalizeApiError } from "@/lib/apiError";
import { getSubject } from "@/lib/permissions";
import { useAssignAssessmentHomework, useAssessmentSetsList } from "@/features/assessments/hooks";
import { MetadataPill } from "@/features/assessments/components/MetadataPill";
import { useToast } from "@/components/ToastProvider";

const INPUT =
  "ui-input w-full rounded-xl border border-border bg-surface-2/80 px-3 py-2 text-sm shadow-sm";

type ClassroomRow = { id: number; name?: string; subject?: string; my_role?: string; teacher?: any };

function normalizeClassroomSubject(raw: unknown): "math" | "english" | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "MATH") return "math";
  if (s === "ENGLISH") return "english";
  return null;
}

export default function AssignAssessmentContainer() {
  const assign = useAssignAssessmentHomework();
  const toast = useToast();

  const staffSubject = getSubject(); // optional, may be null for global staff
  const [classrooms, setClassrooms] = useState<ClassroomRow[] | null>(null);
  const [classroomLoading, setClassroomLoading] = useState(false);
  const [classroomError, setClassroomError] = useState<string | null>(null);

  const [classroomId, setClassroomId] = useState<number | null>(null);
  const classroom = useMemo(
    () => (classroomId && classrooms ? classrooms.find((c) => Number(c.id) === classroomId) ?? null : null),
    [classroomId, classrooms],
  );
  const classroomSubject = normalizeClassroomSubject(classroom?.subject);

  const [setId, setSetId] = useState<number | null>(null);
  const [existingAssessmentAssignmentId, setExistingAssessmentAssignmentId] = useState<number | null>(null);
  const [titleOverride, setTitleOverride] = useState("");
  const [instructions, setInstructions] = useState("");

  const { data: setsData, isLoading: setsLoading, error: setsError, refetch: refetchSets } =
    useAssessmentSetsList(classroomSubject ? { subject: classroomSubject } : staffSubject ? { subject: staffSubject } : undefined);
  const sets = Array.isArray(setsData) ? setsData : [];

  const selectedSet = useMemo(() => (setId ? sets.find((s) => Number(s.id) === setId) ?? null : null), [setId, sets]);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ assignment_id?: number; homework_id?: number } | null>(null);

  /** One idempotency key per in-flight assign (survives until success or terminal client error). */
  const assignIdempotencyRef = useRef<string | null>(null);

  useEffect(() => {
    assignIdempotencyRef.current = null;
  }, [classroomId, setId]);

  const loadClassrooms = async () => {
    setClassroomError(null);
    setClassroomLoading(true);
    try {
      const all = (await classesApi.list()).items as ClassroomRow[];
      setClassrooms(Array.isArray(all) ? all : []);
    } catch (e) {
      setClassroomError(normalizeApiError(e).message);
    } finally {
      setClassroomLoading(false);
    }
  };

  const loadAssignmentsForDuplicateGuard = async (cid: number, targetSetId: number | null) => {
    setExistingAssessmentAssignmentId(null);
    if (!cid || !targetSetId) return;
    try {
      const list = (await classesApi.listAssignments(cid)).items;
      const rows = Array.isArray(list) ? list : [];
      const hit = rows.find((a: any) => Number(a?.assessment_homework?.set?.id) === Number(targetSetId));
      if (hit?.id) {
        setExistingAssessmentAssignmentId(Number(hit.id));
      }
    } catch {
      // best-effort; backend still enforces or will accept
    }
  };

  const canAssign =
    Boolean(classroomId) &&
    Boolean(setId) &&
    // soft client-side gates only; backend authoritative
    (!classroomSubject || !selectedSet?.subject || selectedSet.subject === classroomSubject) &&
    !existingAssessmentAssignmentId;

  const assignNow = async () => {
    if (!classroomId || !setId) return;
    if (assign.isPending) return;
    setSubmitError(null);
    setSuccess(null);
    try {
      const payload = {
        classroom_id: classroomId,
        set_id: setId,
        title: titleOverride.trim() || undefined,
        instructions: instructions.trim() || undefined,
        // due_at is derived server-side (start of the class's next lesson).
      };
      const idempotencyKey =
        assignIdempotencyRef.current ??
        (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      assignIdempotencyRef.current = idempotencyKey;
      const res = await assign.mutateAsync({ payload: payload as any, idempotencyKey });
      assignIdempotencyRef.current = null;
      const assignment_id = Number((res as any)?.assignment_id || (res as any)?.assignment?.id || 0) || undefined;
      const homework_id = Number((res as any)?.id || 0) || undefined;
      setSuccess({ assignment_id, homework_id });
      toast.push({ tone: "success", message: "Assessment assigned." });
    } catch (e) {
      const ax = normalizeApiError(e);
      const maybeRace =
        ax.status === 409 ||
        ax.status === 400 ||
        /unique|already exists|duplicate|constraint/i.test(String(ax.message || ""));
      if (maybeRace && classroomId && setId) {
        await loadAssignmentsForDuplicateGuard(classroomId, setId);
      }
      const hint = maybeRace
        ? " This can happen if the request ran twice or another admin assigned at the same time. Refresh duplicate check above or retry once."
        : "";
      setSubmitError(`${ax.message}${hint}`);
      toast.push({ tone: "error", message: ax.message });
      // Allow a fresh idempotency key on the next attempt for validation-style 400s; keep for 5xx/429 so retry reuses.
      if (ax.status >= 400 && ax.status < 500 && ax.status !== 409 && ax.status !== 429) {
        assignIdempotencyRef.current = null;
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary">Admin</p>
            <p className="mt-1 text-xl font-extrabold tracking-tight text-foreground">Assign assessment</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Flow: classroom → set → preview → assign. Backend enforces permissions and subject scope.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadClassrooms()}
              className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-extrabold hover:bg-surface-2"
            >
              {classroomLoading ? "Loading…" : "Load classrooms"}
            </button>
            <button
              type="button"
              onClick={() => void refetchSets()}
              className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-extrabold hover:bg-surface-2"
            >
              Refresh sets
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-extrabold text-foreground">1) Classroom</p>
            {classroomError ? <p className="mt-2 text-sm text-muted-foreground">{classroomError}</p> : null}
            <select
              className={`${INPUT} mt-3`}
              value={String(classroomId ?? "")}
              onChange={(e) => {
                const n = Number(e.target.value);
                setClassroomId(Number.isFinite(n) ? n : null);
                setSetId(null);
                setExistingAssessmentAssignmentId(null);
                setSuccess(null);
              }}
            >
              <option value="">Select classroom…</option>
              {(classrooms || []).map((c) => (
                <option key={c.id} value={String(c.id)}>
                  #{c.id} · {c.name || "Class"} · {String(c.subject || "").toLowerCase()}
                </option>
              ))}
            </select>
            {classroom ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <MetadataPill label="role" value={String(classroom.my_role || "—")} />
                <MetadataPill label="subject" value={String(classroom.subject || "—")} />
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-extrabold text-foreground">2) Assessment set</p>
            {setsError ? <p className="mt-2 text-sm text-muted-foreground">{String((setsError as any)?.message || setsError)}</p> : null}
            <select
              className={`${INPUT} mt-3`}
              value={String(setId ?? "")}
              onChange={(e) => {
                const n = Number(e.target.value);
                const next = Number.isFinite(n) ? n : null;
                setSetId(next);
                if (classroomId && next) {
                  void loadAssignmentsForDuplicateGuard(classroomId, next);
                } else {
                  setExistingAssessmentAssignmentId(null);
                }
                setSuccess(null);
              }}
              disabled={!classroomId || setsLoading}
            >
              <option value="">{!classroomId ? "Select classroom first…" : setsLoading ? "Loading…" : "Select set…"}</option>
              {sets.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  #{s.id} · {s.title} · {s.subject} · {(s.questions || []).length}q
                </option>
              ))}
            </select>
            {selectedSet ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <MetadataPill label="subject" value={selectedSet.subject} />
                <MetadataPill label="category" value={selectedSet.category || "—"} />
                <MetadataPill label="questions" value={String((selectedSet.questions || []).length)} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-extrabold text-foreground">3) Preview</p>
            {!selectedSet ? (
              <p className="mt-2 text-sm text-muted-foreground">Select a set to preview.</p>
            ) : (
              <div className="mt-2">
                <p className="text-base font-extrabold text-foreground">{selectedSet.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{selectedSet.description || "—"}</p>
                <div className="mt-3 grid gap-2">
                  {(selectedSet.questions || [])
                    .slice()
                    .sort((a: { order?: number }, b: { order?: number }) => (a.order ?? 0) - (b.order ?? 0))
                    .slice(0, 6)
                    .map((q: { id: number; question_type: string; points: number; prompt: string }) => (
                      <div key={q.id} className="rounded-xl border border-border bg-card p-3">
                        <p className="text-sm font-extrabold text-foreground">
                          {q.question_type} · {q.points}pt
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{q.prompt}</p>
                      </div>
                    ))}
                </div>
                {(selectedSet.questions || []).length > 6 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing first 6 questions. Total: {(selectedSet.questions || []).length}.
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-extrabold text-foreground">4) Assign</p>
            <div className="mt-3 grid gap-3">
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-label-foreground">Title override (optional)</p>
                <input className={INPUT} value={titleOverride} onChange={(e) => setTitleOverride(e.target.value)} />
              </div>
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wider text-label-foreground">Instructions (optional)</p>
                <textarea className={`${INPUT} min-h-[90px]`} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
              </div>
              {/* No deadline picker: homework is due when the class's next lesson starts. */}
              <p className="text-xs text-muted-foreground">
                Due automatically when this class&apos;s next lesson begins (no deadline if
                the class has no set schedule).
              </p>

              {classroomSubject && selectedSet?.subject && classroomSubject !== selectedSet.subject ? (
                <p className="text-sm text-muted-foreground">
                  Subject mismatch. This will be rejected by backend.
                </p>
              ) : null}

              {existingAssessmentAssignmentId ? (
                <div className="rounded-2xl border border-border bg-surface-2 p-4">
                  <p className="text-sm font-extrabold text-foreground">Duplicate assignment</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This classroom already has this assessment set assigned (assignment #{existingAssessmentAssignmentId}).
                  </p>
                </div>
              ) : null}

              {submitError ? (
                <div className="rounded-2xl border border-border bg-surface-2 p-4">
                  <p className="text-sm font-extrabold text-foreground">Assignment failed</p>
                  <p className="mt-1 text-sm text-muted-foreground">{submitError}</p>
                </div>
              ) : null}
              {success ? (
                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                  <p className="text-sm font-extrabold text-foreground">Assigned</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Assignment created{success.assignment_id ? ` (#${success.assignment_id})` : ""}.
                  </p>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void assignNow()}
                disabled={!canAssign || assign.isPending}
                className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-extrabold hover:bg-primary/15 disabled:opacity-50"
              >
                {assign.isPending ? "Assigning…" : "Assign assessment"}
              </button>
              <p className="text-xs text-muted-foreground">
                Actions are disabled when incomplete, but never hidden. Backend errors are shown verbatim (sanitized by API).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

