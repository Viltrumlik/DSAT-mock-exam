"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bulkAssignApi } from "@/features/bulkAssign/api";
import { getSubject } from "@/lib/permissions";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{label}</label>
      {children}
    </div>
  );
}

function normalizeClassroomSubject(raw: unknown): "math" | "english" | null {
  const u = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (u === "MATH") return "math";
  if (u === "ENGLISH") return "english";
  return null;
}

export type AssessmentClassroomAssignPanelProps = {
  canAssign: boolean;
  showToast: (msg: string) => void;
  /** Pre-select a specific classroom (e.g. when opened from a classroom detail page). */
  defaultClassroomId?: number | null;
  /** Called after a successful assignment so the parent can refresh its list. */
  onAssigned?: () => void;
};

/**
 * Classroom homework assignment for LMS assessment sets (same API as /assessments/homework/assign/).
 * Used from Assignments tab on admin.* and from Assessments tab on questions.*.
 */
export function AssessmentClassroomAssignPanel({ canAssign, showToast, defaultClassroomId, onAssigned }: AssessmentClassroomAssignPanelProps) {
  const assessmentsAdminApi = bulkAssignApi.assessments;
  const classesApi = bulkAssignApi.classes;
  const [sets, setSets] = useState<any[]>([]);
  const [setsLoading, setSetsLoading] = useState(false);
  const [setId, setSetId] = useState<number | null>(null);

  const [classrooms, setClassrooms] = useState<any[] | null>(null);
  const [classroomLoading, setClassroomLoading] = useState(false);
  const [classroomId, setClassroomId] = useState<number | null>(defaultClassroomId ?? null);

  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [due, setDue] = useState("");
  const [dupAssignmentId, setDupAssignmentId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const idempotencyRef = useRef<string | null>(null);

  const fetchSets = useCallback(async () => {
    setSetsLoading(true);
    try {
      const dom = getSubject();
      const data = await assessmentsAdminApi.adminListSets(dom ? { subject: dom } : undefined);
      // API returns paginated { count, results: [...] } — unwrap it.
      const arr = Array.isArray(data)
        ? data
        : Array.isArray((data as { results?: unknown[] })?.results)
          ? (data as { results: unknown[] }).results
          : [];
      setSets(arr);
    } catch {
      setSets([]);
      showToast("Could not load assessment sets.");
    } finally {
      setSetsLoading(false);
    }
  }, [showToast]);

  const loadClassrooms = useCallback(async () => {
    setClassroomLoading(true);
    try {
      const all = await classesApi.list();
      setClassrooms(all.items);
    } catch (e: unknown) {
      setClassrooms([]);
      const ax = e as { response?: { status?: number; data?: { detail?: string } } };
      const detail = ax?.response?.data?.detail;
      const st = ax?.response?.status;
      const suffix =
        typeof detail === "string" && detail.trim()
          ? ` ${detail.trim()}`
          : st != null
            ? ` (HTTP ${st})`
            : "";
      showToast(`Could not load classrooms.${suffix}`);
    } finally {
      setClassroomLoading(false);
    }
  }, [showToast]);

  const loadDupGuard = useCallback(async (cid: number, sid: number | null) => {
    setDupAssignmentId(null);
    if (!cid || !sid) return;
    try {
      const rows = await classesApi.listAssignments(cid);
      const list = rows.items;
      const hit = list.find((a: any) => Number(a?.assessment_homework?.set?.id) === Number(sid));
      if (hit?.id) setDupAssignmentId(Number(hit.id));
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    if (!canAssign) return;
    void fetchSets();
    void loadClassrooms();
  }, [canAssign, fetchSets, loadClassrooms]);

  useEffect(() => {
    idempotencyRef.current = null;
  }, [classroomId, setId]);

  useEffect(() => {
    if (!classroomId || !setId) {
      setDupAssignmentId(null);
      return;
    }
    void loadDupGuard(classroomId, setId);
  }, [classroomId, setId, loadDupGuard]);

  const selectedClassroom = useMemo(
    () => (classrooms || []).find((c: any) => Number(c.id) === Number(classroomId)) ?? null,
    [classrooms, classroomId],
  );

  const selectedSet = useMemo(() => sets.find((s: any) => Number(s.id) === Number(setId)) ?? null, [sets, setId]);

  const canSubmit = useMemo(() => {
    if (!canAssign) return false;
    if (!classroomId || !setId) return false;
    const cSub = normalizeClassroomSubject(selectedClassroom?.subject);
    const sSub = selectedSet?.subject as string | undefined;
    if (cSub && sSub && cSub !== sSub) return false;
    if (dupAssignmentId) return false;
    return true;
  }, [canAssign, classroomId, setId, selectedClassroom, selectedSet, dupAssignmentId]);

  const handleAssign = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setStatusMsg(null);
    const idempotencyKey =
      idempotencyRef.current ??
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    idempotencyRef.current = idempotencyKey;
    try {
      await assessmentsAdminApi.assignHomework(
        {
          classroom_id: classroomId!,
          set_id: setId!,
          title: title.trim() || undefined,
          instructions: instructions.trim() || undefined,
          due_at: due ? new Date(due).toISOString() : null,
        },
        idempotencyKey,
      );
      idempotencyRef.current = null;
      setStatusMsg("Assigned successfully.");
      showToast("Assessment assigned");
      onAssigned?.();
      await loadDupGuard(classroomId!, setId);
    } catch (e: any) {
      const st = e?.response?.status;
      const d = e?.response?.data;
      const msg = d?.detail || d?.message || e?.message || "Assign failed";
      showToast(String(msg));
      if (st === 409 || st === 400) void loadDupGuard(classroomId!, setId);
      if (st >= 400 && st < 500 && st !== 409 && st !== 429) idempotencyRef.current = null;
    } finally {
      setSubmitting(false);
    }
  };

  if (!canAssign) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Assessment homework assignment requires <span className="font-bold text-foreground">assign access</span>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Assessment homework</p>
        <button
          type="button"
          onClick={() => void fetchSets()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
        >
          Refresh sets
        </button>
      </div>

      {(setsLoading || classroomLoading) && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Assessment set">
            <select
              className="input-modern"
              value={setId ? String(setId) : ""}
              onChange={(e) => {
                const n = Number(e.target.value);
                setSetId(Number.isFinite(n) && n > 0 ? n : null);
              }}
            >
              <option value="">Select set…</option>
              {sets.map((s: any) => (
                <option key={s.id} value={String(s.id)}>
                  #{s.id} · {String(s.title || "")} · {String(s.subject || "")}
                </option>
              ))}
            </select>
          </Field>
          {!defaultClassroomId && (
            <Field label="Classroom">
              <select
                className="input-modern"
                value={classroomId ? String(classroomId) : ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setClassroomId(Number.isFinite(n) && n > 0 ? n : null);
                }}
              >
                <option value="">Select classroom…</option>
                {(classrooms || []).map((c: any) => (
                  <option key={c.id} value={String(c.id)}>
                    #{c.id} · {String(c.name || "Class")} · {String(c.subject || "").toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Due at (optional)">
            <input className="input-modern" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Title override (optional)">
            <input className="input-modern" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Instructions (optional)">
              <textarea className="input-modern min-h-[80px]" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            </Field>
          </div>
        </div>

        {dupAssignmentId && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            This classroom already has an assignment for this set (#{dupAssignmentId}). The server will reject a duplicate.
          </div>
        )}

        {statusMsg && (
          <p className="text-xs font-bold text-emerald-700">{statusMsg}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canSubmit || submitting}
            onClick={() => void handleAssign()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? "Assigning…" : "Assign to classroom"}
          </button>
          {!canSubmit && !submitting && (
            <p className="text-xs text-muted-foreground">
              Select a set{!defaultClassroomId ? " and classroom" : ""}, resolve any warnings to continue.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
