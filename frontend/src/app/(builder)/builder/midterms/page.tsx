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
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { examsAdminApi } from "@/features/examsAdmin/api";
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  FileText,
  GraduationCap,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { STUDIO_FIELD_LABEL, STUDIO_INPUT } from "@/components/studio/primitives";

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
  midterm_target_question_count: number;
  midterm_module_question_limit: number;
  midterm_level: string | null;
  midterm_period: string | null;
  midterm_type: string | null;
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
};

const DEFAULT_FORM: MidtermForm = {
  title: "",
  practice_date: "",
  midterm_subject: "READING_WRITING",
  midterm_scoring_scale: "SCALE_100",
  midterm_module_count: "2",
  midterm_module1_minutes: "60",
  midterm_module2_minutes: "60",
  midterm_target_question_count: "44",
  midterm_module_question_limit: "30",
  midterm_level: "",
  midterm_period: "",
  midterm_type: "MIDTERM",
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
  if (s === "READING_WRITING") return "Reading & Writing";
  if (s === "MATH") return "Mathematics";
  return s ?? "—";
}

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

const FL = STUDIO_FIELD_LABEL;
const SI = STUDIO_INPUT;

// ─── Midterm modal ────────────────────────────────────────────────────────────

function MidtermModal({
  open,
  heading,
  initial,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  heading: string;
  initial: MidtermForm;
  saving: boolean;
  error: string | null;
  onSubmit: (f: MidtermForm) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<MidtermForm>(initial);

  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  if (!open) return null;

  const set =
    (k: keyof MidtermForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  const twoModules = form.midterm_module_count === "2";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl overflow-y-auto max-h-[90vh]">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-extrabold text-foreground">{heading}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-surface-2">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(form);
          }}
        >
          {/* Title */}
          <div>
            <label className={FL}>
              Title <span className="text-red-500">*</span>
            </label>
            <input
              value={form.title}
              onChange={set("title")}
              required
              placeholder="e.g. Algebra Midterm — Spring 2025"
              className={SI}
            />
          </div>

          {/* Date + Subject */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={FL}>Date</label>
              <input type="date" value={form.practice_date} onChange={set("practice_date")} className={SI} />
            </div>
            <div>
              <label className={FL}>Subject</label>
              <select
                value={form.midterm_subject}
                onChange={(e) => {
                  const subj = e.target.value as "READING_WRITING" | "MATH";
                  // Foundation is Math-only — drop it when switching to R&W.
                  setForm((p) => ({
                    ...p,
                    midterm_subject: subj,
                    midterm_level: subj !== "MATH" && p.midterm_level === "foundation" ? "" : p.midterm_level,
                  }));
                }}
                className={SI}
              >
                <option value="READING_WRITING">Reading &amp; Writing</option>
                <option value="MATH">Mathematics</option>
              </select>
            </div>
          </div>

          {/* Taxonomy — level (by subject) · type · period. Used for filtering. */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={FL}>Level</label>
              <select value={form.midterm_level} onChange={set("midterm_level")} className={SI}>
                {levelOptionsForSubject(form.midterm_subject).map((o) => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={FL}>Type</label>
              <select value={form.midterm_type} onChange={set("midterm_type")} className={SI}>
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={FL}>Period</label>
              <select value={form.midterm_period} onChange={set("midterm_period")} className={SI}>
                {PERIOD_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Scoring scale — controls how the final result is reported and how
              the question console frames per-question scoring. */}
          <div>
            <label className={FL}>Scoring system</label>
            <select value={form.midterm_scoring_scale} onChange={set("midterm_scoring_scale")} className={SI}>
              <option value="SCALE_100">100-point (percentage)</option>
              <option value="SCALE_800">800-point (SAT scaled)</option>
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              {form.midterm_scoring_scale === "SCALE_800"
                ? "Final score maps onto the SAT 200–800 curve. Give each question a point weight in the question console."
                : "Final score is a clean 0–100 percentage. Every question counts equally."}
            </p>
          </div>

          {/* Module count + timing */}
          <div>
            <label className={FL}>Modules</label>
            <select value={form.midterm_module_count} onChange={set("midterm_module_count")} className={SI}>
              <option value="1">1 module (single-part)</option>
              <option value="2">2 modules (standard)</option>
            </select>
          </div>

          <div className={`grid gap-3 ${twoModules ? "grid-cols-2" : "grid-cols-1"}`}>
            <div>
              <label className={FL}>Module 1 — minutes</label>
              <input
                type="number"
                min={5}
                max={600}
                value={form.midterm_module1_minutes}
                onChange={set("midterm_module1_minutes")}
                className={SI}
              />
            </div>
            {twoModules && (
              <div>
                <label className={FL}>Module 2 — minutes</label>
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={form.midterm_module2_minutes}
                  onChange={set("midterm_module2_minutes")}
                  className={SI}
                />
              </div>
            )}
          </div>

          {/* Target question count */}
          <div>
            <label className={FL}>Target question count</label>
            <input
              type="number"
              min={1}
              max={200}
              value={form.midterm_target_question_count}
              onChange={set("midterm_target_question_count")}
              className={SI}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Total questions across all modules. Used for grading and score calculation.
            </p>
          </div>

          {/* Per-module question limit (hard cap enforced in the question console) */}
          <div>
            <label className={FL}>Questions per module (limit)</label>
            <input
              type="number"
              min={1}
              max={200}
              value={form.midterm_module_question_limit}
              onChange={set("midterm_module_question_limit")}
              className={SI}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Maximum questions you can add to each module. Default 30.
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.title.trim()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? "Saving…" : "Save midterm"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Midterm row ──────────────────────────────────────────────────────────────

const VERSION_LETTERS = ["A", "B", "C", "D"];

function MidtermRow({
  exam,
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

  const statusLabel = exam.is_published ? "Published" : exam.publish_ready ? "Ready" : "Draft";
  const statusColors = exam.is_published
    ? "bg-emerald-100 text-emerald-800"
    : exam.publish_ready
    ? "bg-amber-100 text-amber-800"
    : "bg-surface-2 text-muted-foreground";

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Info block */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-extrabold text-foreground truncate">
              {exam.title || `Midterm #${exam.id}`}
            </h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusColors}`}>
              {statusLabel}
            </span>
            {exam.midterm_type && exam.midterm_type !== "MIDTERM" ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                {TYPE_LABELS[exam.midterm_type] ?? exam.midterm_type}
              </span>
            ) : null}
            {exam.midterm_level ? (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {MIDTERM_LEVEL_LABELS[exam.midterm_level] ?? exam.midterm_level}
              </span>
            ) : null}
            {exam.midterm_period ? (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {PERIOD_LABELS[exam.midterm_period] ?? exam.midterm_period}
              </span>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap gap-3">
            {/* Subject */}
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <BookOpen className="h-3 w-3" />
              {subjectLabel(exam.midterm_subject)}
            </span>

            {/* Date */}
            {exam.practice_date && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                {formatDate(exam.practice_date)}
              </span>
            )}

            {/* Timing */}
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {exam.midterm_module_count === 1
                ? `${exam.midterm_module1_minutes} min`
                : `${exam.midterm_module1_minutes} + ${exam.midterm_module2_minutes} min`}
            </span>

            {/* Questions */}
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <FileText className="h-3 w-3" />
              {exam.midterm_target_question_count} target questions
            </span>

            {/* Modules created */}
            {totalModules > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                {totalModules} module{totalModules !== 1 ? "s" : ""} created
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {exam.is_published ? (
            <button
              type="button"
              onClick={onUnpublish}
              disabled={publishing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
            >
              {publishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
              Unpublish
            </button>
          ) : (
            <button
              type="button"
              onClick={onPublish}
              disabled={!exam.publish_ready || publishing}
              title={!exam.publish_ready ? exam.publish_block_reason : undefined}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
            >
              {publishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
              Publish
            </button>
          )}

          <button
            type="button"
            onClick={onResults}
            className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100 transition-colors"
          >
            <FileText className="h-3 w-3" />
            Results
          </button>

          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>

          {confirmDelete ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onDelete}
                className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 transition-colors"
              >
                Confirm delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Publish block */}
      {!exam.is_published && !exam.publish_ready && exam.publish_block_reason && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <Zap className="h-3.5 w-3.5 shrink-0 text-amber-600 mt-0.5" />
          <p className="text-xs text-amber-800">{exam.publish_block_reason}</p>
        </div>
      )}

      {/* Versions → each is a parallel copy with its own questions (max 4). */}
      <div className="mt-4 space-y-3">
        {exam.tests.map((test, vIdx) => {
          const modules = test.modules ?? [];
          return (
            <div key={test.id} className="rounded-xl border border-border bg-surface-2/30 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-foreground">
                  <Layers className="h-3.5 w-3.5 text-primary" />
                  Version {VERSION_LETTERS[vIdx] ?? vIdx + 1}
                </span>
                {exam.tests.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onRemoveVersion(test.id)}
                    disabled={versionBusy}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                  >
                    <Trash2 className="h-3 w-3" /> Remove
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {modules.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] italic text-muted-foreground">No modules yet.</p>
                ) : (
                  modules.map((mod) => (
                    <Link
                      key={mod.id}
                      href={`/builder/mock-exams/${exam.id}/${test.id}/${mod.id}`}
                      className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5"
                    >
                      <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                      <span className="flex-1">
                        {mod.module_order != null ? `Module ${mod.module_order}` : `Module #${mod.id}`}
                        {mod.time_limit_minutes != null && <span className="ml-2 text-muted-foreground">{mod.time_limit_minutes} min</span>}
                      </span>
                      <span className="text-xs font-bold text-primary group-hover:underline">Edit questions →</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                    </Link>
                  ))
                )}
              </div>
            </div>
          );
        })}
        {exam.tests.length < 4 && (
          <button
            type="button"
            onClick={onAddVersion}
            disabled={versionBusy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add version{exam.tests.length > 0 ? ` (${exam.tests.length}/4)` : ""}
          </button>
        )}
      </div>
    </div>
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
  // Builder filters — by monthly period and midterm type (and level).
  const [filterLevel, setFilterLevel] = useState("ALL");
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

  const openCreate = () => {
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
        midterm_target_question_count: Number(form.midterm_target_question_count),
        midterm_module_question_limit: Number(form.midterm_module_question_limit),
        midterm_level: form.midterm_level,
        midterm_period: form.midterm_period,
        midterm_type: form.midterm_type,
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
      }
    : DEFAULT_FORM;

  const published = midterms.filter((m) => m.is_published).length;
  const drafts = midterms.filter((m) => !m.is_published).length;
  const filteredMidterms = midterms.filter((m) => {
    if (filterLevel !== "ALL" && (m.midterm_level || "") !== filterLevel) return false;
    if (filterPeriod !== "ALL" && (m.midterm_period || "") !== filterPeriod) return false;
    if (filterType !== "ALL" && (m.midterm_type || "MIDTERM") !== filterType) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-primary">
            Learning System
          </p>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Midterms</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-xl">
            Teacher-assigned, classroom-scoped midterm exams. Each midterm is subject-specific,
            timed per-module, and graded by the instructor. Students access them through
            their classroom, not the SAT simulation interface.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground hover:bg-surface-2 disabled:opacity-50 transition-colors"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New midterm
          </button>
        </div>
      </div>

      {/* Stats */}
      {!loading && midterms.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <div className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground">
            <GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />
            {midterms.length} midterm{midterms.length !== 1 ? "s" : ""}
          </div>
          {published > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              <Eye className="h-3.5 w-3.5" />
              {published} published
            </div>
          )}
          {drafts > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
              <Pencil className="h-3.5 w-3.5" />
              {drafts} draft{drafts !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      {/* Filters — period + type (+ level) */}
      {!loading && midterms.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          {[
            { label: "Level", value: filterLevel, set: setFilterLevel, opts: [{ v: "ALL", l: "All levels" }, { v: "foundation", l: "Foundation" }, { v: "junior", l: "Junior" }, { v: "middle", l: "Middle" }, { v: "senior", l: "Senior" }] },
            { label: "Type", value: filterType, set: setFilterType, opts: [{ v: "ALL", l: "All types" }, ...TYPE_OPTIONS] },
            { label: "Period", value: filterPeriod, set: setFilterPeriod, opts: [{ v: "ALL", l: "All periods" }, ...PERIOD_OPTIONS.filter((o) => o.v !== "")] },
          ].map((f) => (
            <div key={f.label} className="flex flex-col gap-1">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">{f.label}</span>
              <select
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {f.opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
          ))}
          {(filterLevel !== "ALL" || filterType !== "ALL" || filterPeriod !== "ALL") && (
            <button
              type="button"
              onClick={() => { setFilterLevel("ALL"); setFilterType("ALL"); setFilterPeriod("ALL"); }}
              className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-surface-2"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Domain clarification note */}
      <div className="rounded-2xl border border-border bg-surface-2/30 px-4 py-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Note:</strong> Midterms are classroom pedagogy tools —
          not SAT simulations. Use them for semester exams, unit tests, and curriculum assessments.
          For SAT-style timed mocks, go to{" "}
          <Link href="/builder/mock-exams" className="font-semibold text-primary hover:underline">
            Builder → Mock Exams
          </Link>
          .
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : midterms.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2">
            <GraduationCap className="h-7 w-7 text-muted-foreground/40" />
          </div>
          <p className="font-extrabold text-foreground">No midterms yet</p>
          <p className="mt-1 mx-auto max-w-xs text-sm text-muted-foreground leading-relaxed">
            Create a midterm exam, configure its structure and timing, then author
            questions for each module. Assign it to a classroom when ready.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New midterm
          </button>
        </div>
      ) : filteredMidterms.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <p className="font-extrabold text-foreground">No midterms match these filters</p>
          <p className="mt-1 text-sm text-muted-foreground">Try a different level, type, or period.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredMidterms.map((m) => (
            <MidtermRow
              key={m.id}
              exam={m}
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
        onSubmit={(f) => void handleSave(f)}
        onClose={() => setModalOpen(false)}
      />

      {resultsExam && (
        <MidtermResultsModal exam={resultsExam} onClose={() => setResultsExam(null)} />
      )}
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

function MidtermResultsModal({ exam, onClose }: { exam: AdminMidterm; onClose: () => void }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-card shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-extrabold text-foreground truncate">
              Results · {exam.title || `Midterm #${exam.id}`}
            </h2>
            <p className="text-xs text-muted-foreground">Visible to teachers only</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-2">
          {err && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
          )}
          {!rows && !err && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {rows && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No students have completed this midterm yet.</p>
          )}
          {rows?.map((r) => (
            <div key={r.attempt_id} className="rounded-xl border border-border bg-surface-1">
              <button
                type="button"
                onClick={() => setExpanded((cur) => (cur === r.attempt_id ? null : r.attempt_id))}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0">
                  <p className="font-bold text-foreground truncate">{r.student_name || r.student_username}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.correct_count}/{r.total_questions} correct · {r.wrong_count} wrong
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-black tabular-nums text-foreground">
                    {r.score}
                    <span className="text-xs font-bold text-muted-foreground"> / {r.max_score}</span>
                  </p>
                </div>
              </button>
              {expanded === r.attempt_id && (
                <div className="border-t border-border px-4 py-3 space-y-2">
                  {r.wrong_questions.length === 0 ? (
                    <p className="text-xs font-semibold text-emerald-600">Perfect — no wrong answers.</p>
                  ) : (
                    r.wrong_questions.map((w) => (
                      <div key={w.question_id} className="rounded-lg bg-surface-2 px-3 py-2 text-xs">
                        <p className="font-semibold text-foreground">
                          M{w.module_order} · {w.prompt || `Question #${w.question_id}`}
                        </p>
                        <p className="mt-0.5 text-red-600">
                          Answered: {String(w.student_answer ?? "—")}
                        </p>
                        <p className="text-emerald-600">
                          Correct: {Array.isArray(w.correct_answers) ? w.correct_answers.join(", ") : String(w.correct_answers ?? "—")}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
