"use client";

import { useState } from "react";
import { Plus, Trash2, Send, Eye, ClipboardList, X, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMe } from "@/hooks/useMe";
import type { SurveyQuestionType } from "@/features/surveys/surveysApi";
import {
  useAdminSurveys,
  useAdminSurvey,
  useCreateSurvey,
  useUpdateSurvey,
  useDeleteSurvey,
  useAddQuestion,
  useDeleteQuestion,
  useSurveyResponses,
} from "@/features/surveys/surveysHooks";

// SURVEY AUTHORING — super_admin only. The API enforces that on every endpoint; this page
// and its nav entry only avoid offering something the server would refuse.

const TYPE_LABELS: Record<SurveyQuestionType, string> = {
  SHORT_TEXT: "Short answer",
  LONG_TEXT: "Paragraph",
  SINGLE_CHOICE: "Multiple choice",
  MULTI_CHOICE: "Checkboxes",
  SCALE: "Linear scale",
  DATE: "Date",
};

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  PUBLISHED: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-amber-100 text-amber-800",
};

const inputClass =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30";

export default function OpsSurveysPage() {
  const { me } = useMe();
  const role = String((me as { role?: string } | undefined)?.role ?? "").toLowerCase();
  const isSuperAdmin = role === "super_admin" || Boolean((me as { is_superuser?: boolean } | undefined)?.is_superuser);

  const surveys = useAdminSurveys();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showResponses, setShowResponses] = useState(false);
  const survey = useAdminSurvey(selectedId);
  const responses = useSurveyResponses(showResponses ? selectedId : null);

  const create = useCreateSurvey();
  const update = useUpdateSurvey(selectedId);
  const remove = useDeleteSurvey();
  const addQuestion = useAddQuestion(selectedId);
  const deleteQuestion = useDeleteQuestion(selectedId);

  const [newTitle, setNewTitle] = useState("");
  const [qPrompt, setQPrompt] = useState("");
  const [qType, setQType] = useState<SurveyQuestionType>("SHORT_TEXT");
  const [qRequired, setQRequired] = useState(false);
  const [qOptions, setQOptions] = useState("");

  const err = (e: unknown) =>
    (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  const anyError =
    err(create.error) || err(update.error) || err(remove.error) ||
    err(addQuestion.error) || err(deleteQuestion.error);

  if (!isSuperAdmin) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-bold text-foreground">Surveys are managed by a super admin.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask a super admin to create or publish a survey.
        </p>
      </div>
    );
  }

  const needsOptions = qType === "SINGLE_CHOICE" || qType === "MULTI_CHOICE";

  async function submitQuestion() {
    if (!selectedId || !qPrompt.trim()) return;
    await addQuestion.mutateAsync({
      prompt: qPrompt.trim(),
      question_type: qType,
      is_required: qRequired,
      options: needsOptions
        ? qOptions.split("\n").map((o) => o.trim()).filter(Boolean)
        : [],
    });
    setQPrompt(""); setQOptions(""); setQRequired(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-primary">
            Admin console · Super admin
          </p>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Surveys</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask students a question. Finishing a survey earns them points, so only published
            surveys are answerable.
          </p>
        </div>
      </div>

      {anyError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {anyError}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Survey list + create */}
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              placeholder="New survey title" className={inputClass} />
            <button type="button" disabled={!newTitle.trim() || create.isPending}
              onClick={async () => {
                const made = await create.mutateAsync({ title: newTitle.trim() });
                setNewTitle(""); setSelectedId(made.id); setShowResponses(false);
              }}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Plus className="h-4 w-4" /> Create
            </button>
          </div>

          {surveys.isLoading ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">Loading…</p>
          ) : surveys.isError ? (
            <p className="px-1 py-2 text-sm text-red-600">Couldn&apos;t load surveys.</p>
          ) : (surveys.data?.length ?? 0) === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">No surveys yet.</p>
          ) : (
            <div className="space-y-1.5">
              {surveys.data?.map((s) => (
                <button key={s.id} type="button"
                  onClick={() => { setSelectedId(s.id); setShowResponses(false); }}
                  className={cn(
                    "w-full rounded-xl border px-3 py-2 text-left",
                    selectedId === s.id ? "border-primary bg-primary/5" : "border-border hover:bg-surface-2",
                  )}>
                  <p className="truncate text-sm font-bold text-foreground">{s.title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={cn("rounded-lg px-1.5 py-0.5 text-[10px] font-black uppercase", STATUS_TONE[s.status])}>
                      {s.status}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {s.question_count} q · {s.response_count} replies
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Builder */}
        <div className="rounded-2xl border border-border bg-card p-5">
          {!selectedId || !survey.data ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <ClipboardList className="h-8 w-8 text-muted-foreground opacity-40" />
              <p className="text-sm font-semibold text-muted-foreground">
                Pick a survey, or create one.
              </p>
            </div>
          ) : showResponses ? (
            <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-base font-bold text-foreground">
                  Replies — {survey.data.title}
                </h2>
                <button type="button" onClick={() => setShowResponses(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {responses.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (responses.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody has answered yet.</p>
              ) : (
                <div className="space-y-3">
                  {responses.data?.map((r) => (
                    <div key={r.id} className="rounded-xl border border-border p-3">
                      <p className="text-sm font-bold text-foreground">{r.student_name}</p>
                      <dl className="mt-2 space-y-1.5">
                        {r.answers.map((a) => (
                          <div key={a.question}>
                            <dt className="text-xs text-muted-foreground">{a.prompt}</dt>
                            <dd className="text-sm text-foreground">
                              {a.value == null
                                ? <span className="text-muted-foreground">— skipped —</span>
                                : Array.isArray(a.value) ? a.value.join(", ") : String(a.value)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-foreground">{survey.data.title}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {survey.data.question_count} question{survey.data.question_count === 1 ? "" : "s"} ·{" "}
                    {survey.data.response_count} replies
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setShowResponses(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold hover:bg-surface-2">
                    <Users className="h-3.5 w-3.5" /> Replies
                  </button>
                  {survey.data.status === "DRAFT" && (
                    <button type="button" disabled={update.isPending || survey.data.question_count === 0}
                      title={survey.data.question_count === 0 ? "Add a question first" : undefined}
                      onClick={() => update.mutate({ status: "PUBLISHED" })}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                      <Send className="h-3.5 w-3.5" /> Publish
                    </button>
                  )}
                  {survey.data.status === "PUBLISHED" && (
                    <button type="button" disabled={update.isPending}
                      onClick={() => update.mutate({ status: "CLOSED" })}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold hover:bg-surface-2 disabled:opacity-50">
                      <Eye className="h-3.5 w-3.5" /> Close
                    </button>
                  )}
                  <button type="button" disabled={remove.isPending}
                    onClick={async () => {
                      if (!window.confirm(`Delete “${survey.data?.title}”?`)) return;
                      await remove.mutateAsync(selectedId);
                      setSelectedId(null);
                    }}
                    className="rounded-xl p-2 text-rose-600 hover:bg-rose-500/10 disabled:opacity-50" aria-label="Delete survey">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Questions */}
              <div className="divide-y divide-border">
                {survey.data.questions.map((q, i) => (
                  <div key={q.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>
                        {q.prompt}
                        {q.is_required && <span className="ml-1 text-rose-500">*</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {TYPE_LABELS[q.question_type]}
                        {q.options?.length ? ` · ${q.options.join(", ")}` : ""}
                        {q.question_type === "SCALE" ? ` · ${q.scale_min}–${q.scale_max}` : ""}
                      </p>
                    </div>
                    <button type="button" disabled={deleteQuestion.isPending}
                      onClick={() => deleteQuestion.mutate(q.id)}
                      className="shrink-0 rounded-lg p-1.5 text-rose-600 hover:bg-rose-500/10 disabled:opacity-50"
                      aria-label={`Delete question ${i + 1}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {survey.data.questions.length === 0 && (
                  <p className="py-3 text-sm text-muted-foreground">No questions yet.</p>
                )}
              </div>

              {/* Add a question */}
              <div className="mt-4 space-y-2 rounded-xl border border-dashed border-border p-3">
                <input value={qPrompt} onChange={(e) => setQPrompt(e.target.value)}
                  placeholder="Question" className={inputClass} />
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <select value={qType} onChange={(e) => setQType(e.target.value as SurveyQuestionType)}
                    className={cn(inputClass, "min-w-0")}>
                    {(Object.keys(TYPE_LABELS) as SurveyQuestionType[]).map((t) => (
                      <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  <label className="inline-flex items-center gap-2 px-1 text-sm font-semibold text-muted-foreground">
                    <input type="checkbox" checked={qRequired} onChange={(e) => setQRequired(e.target.checked)}
                      className="accent-primary" />
                    Required
                  </label>
                </div>
                {needsOptions && (
                  <textarea rows={3} value={qOptions} onChange={(e) => setQOptions(e.target.value)}
                    placeholder="One option per line" className={inputClass} />
                )}
                <button type="button"
                  disabled={!qPrompt.trim() || addQuestion.isPending || (needsOptions && !qOptions.trim())}
                  onClick={submitQuestion}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  <Plus className="h-4 w-4" /> Add question
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
