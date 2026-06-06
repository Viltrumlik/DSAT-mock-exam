"use client";

import { useEffect, useState } from "react";
import { BookMarked, Loader2, School, Users } from "lucide-react";
import {
  accessApi,
  SUBJECT_SCOPED_TYPES,
  type BulkResult,
  type SubjectScope,
} from "@/lib/accessApi";
import { classesApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { StudentMultiSelect } from "./StudentMultiSelect";
import { ResourcePicker, type SelectedResource } from "./ResourcePicker";

// Resource-centric only: access is always granted through a resource, to students
// or to a whole classroom. (Subject-only and module-choice assignment were removed.)
type Mode = "resource_students" | "resource_classroom";

const MODES: { key: Mode; label: string; icon: React.ElementType; hint: string }[] = [
  { key: "resource_students", label: "Resource → students", icon: BookMarked, hint: "Grant one resource to one or many students." },
  { key: "resource_classroom", label: "Resource → classroom", icon: School, hint: "Grant a resource to every enrolled student (transactional)." },
];

const SCOPES: { key: SubjectScope; label: string }[] = [
  { key: "math", label: "Math" },
  { key: "reading", label: "Reading" },
  { key: "both", label: "Both" },
];

type ClassroomRow = { id: number; name: string; subject?: string };

export function GrantPanel({ onSuccess }: { onSuccess?: () => void }) {
  const [mode, setMode] = useState<Mode>("resource_students");
  const [userIds, setUserIds] = useState<number[]>([]);
  const [resource, setResource] = useState<SelectedResource | null>(null);
  const [subjectScope, setSubjectScope] = useState<SubjectScope>("both");
  const [classroomId, setClassroomId] = useState<number | "">("");
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Math/Reading/Both only applies to pack resources that expand to subject sections.
  const showScope = !!resource && SUBJECT_SCOPED_TYPES.has(resource.resource_type);

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
    setUserIds([]);
    setResource(null);
    setSubjectScope("both");
    setClassroomId("");
    setExpiresAt("");
  };

  const canSubmit = (() => {
    if (submitting || !resource) return false;
    if (mode === "resource_students") return userIds.length > 0;
    return classroomId !== "";
  })();

  const submit = async () => {
    if (!resource) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    const expires_at = expiresAt ? new Date(expiresAt).toISOString() : null;
    const scope = showScope ? subjectScope : undefined;
    try {
      let res: BulkResult;
      if (mode === "resource_students") {
        res = await accessApi.grantResource({
          user_ids: userIds,
          resource_type: resource.resource_type,
          resource_id: resource.resource_id,
          subject_scope: scope,
          expires_at,
        });
      } else {
        res = await accessApi.grantClassroom({
          classroom_id: Number(classroomId),
          resource_type: resource.resource_type,
          resource_id: resource.resource_id,
          subject_scope: scope,
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

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
      {/* Mode selector */}
      <div className="grid gap-2 sm:grid-cols-2">
        {MODES.map((m) => {
          const active = mode === m.key;
          const Icon = m.icon;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                setMode(m.key);
                setResult(null);
                setError(null);
              }}
              className={cn(
                "flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors",
                active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-surface-2",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Icon className="h-4 w-4 text-primary" />
                {m.label}
              </span>
              <span className="text-xs text-muted-foreground">{m.hint}</span>
            </button>
          );
        })}
      </div>

      {/* Target selectors */}
      <div className="space-y-4">
        {mode === "resource_classroom" ? (
          <Field label="Classroom" icon={School}>
            <select
              value={classroomId}
              onChange={(e) => setClassroomId(e.target.value ? Number(e.target.value) : "")}
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">Select a classroom…</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.subject ? ` · ${c.subject}` : ""}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Students" icon={Users}>
            <StudentMultiSelect value={userIds} onChange={setUserIds} />
          </Field>
        )}

        <Field label="Resource" icon={BookMarked}>
          <ResourcePicker value={resource} onChange={setResource} />
        </Field>

        {showScope && (
          <Field label="Sections">
            <div className="flex gap-2">
              {SCOPES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSubjectScope(s.key)}
                  className={cn(
                    "rounded-xl border px-4 py-2 text-sm font-bold transition-colors",
                    subjectScope === s.key
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-foreground hover:bg-surface-2",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Math grants only the Math section, Reading only the Reading &amp; Writing section.
            </p>
          </Field>
        )}

        <Field label="Expires at (optional)">
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
          />
          <p className="mt-1 text-xs text-muted-foreground">Leave empty for permanent access.</p>
        </Field>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>
      )}
      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
          Granted: {result.created} created, {result.skipped} already had access ({result.requested} requested).
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Grant access
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </label>
      {children}
    </div>
  );
}
