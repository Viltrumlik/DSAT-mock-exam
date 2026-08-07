"use client";

import { useState } from "react";
import { Plus, Trash2, Send, Lock, ClipboardList, X, Users, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMe } from "@/hooks/useMe";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  SkeletonText,
  Textarea,
} from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import type { SurveyQuestionType, SurveyStatus } from "@/features/surveys/surveysApi";
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

const STATUS_LABELS: Record<SurveyStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  CLOSED: "Closed",
};

const STATUS_TONE: Record<SurveyStatus, BadgeVariant> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  CLOSED: "warning",
};

export default function OpsSurveysPage() {
  const { me } = useMe();
  const role = String((me as { role?: string } | undefined)?.role ?? "").toLowerCase();
  const isSuperAdmin = role === "super_admin" || Boolean((me as { is_superuser?: boolean } | undefined)?.is_superuser);

  const surveys = useAdminSurveys();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showResponses, setShowResponses] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
      <Card>
        <CardContent>
          <p className="ds-h4">Surveys are managed by a super admin.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask a super admin to create or publish a survey.
          </p>
        </CardContent>
      </Card>
    );
  }

  const detail = survey.data;
  const needsOptions = qType === "SINGLE_CHOICE" || qType === "MULTI_CHOICE";

  // Shown both before anything is picked and if the detail request comes back empty.
  const pickASurvey = (
    <EmptyState
      icon={ClipboardList}
      title="Pick a survey to start"
      description="Choose one from the list, or create a new survey and start adding questions."
    />
  );

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
        <div className="min-w-0">
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

      {anyError && <Alert tone="danger" title={anyError} />}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Survey list + create */}
        <Card>
          <CardContent className="space-y-3">
            {/* Solid + inset, not dashed: the dashed border is EmptyState's material, and a
                live form wearing it reads as "nothing here" — the same box sits directly
                above the empty state in this rail. */}
            <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-4">
              <Field label="New survey" htmlFor="new-survey-title">
                <Input
                  id="new-survey-title"
                  inputSize="sm"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Survey title"
                />
              </Field>
              <Button
                size="sm"
                fullWidth
                leftIcon={<Plus aria-hidden />}
                loading={create.isPending}
                disabled={!newTitle.trim()}
                onClick={async () => {
                  const made = await create.mutateAsync({ title: newTitle.trim() });
                  setNewTitle(""); setSelectedId(made.id); setShowResponses(false);
                }}
              >
                Create
              </Button>
            </div>

            {surveys.isLoading ? (
              <div className="space-y-1.5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            ) : surveys.isError ? (
              <div className="space-y-2">
                <Alert tone="danger" title="Couldn’t load surveys">
                  The list didn’t come back this time.
                </Alert>
                <Button
                  size="sm"
                  fullWidth
                  variant="secondary"
                  leftIcon={<RefreshCw aria-hidden />}
                  onClick={() => void surveys.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : (surveys.data?.length ?? 0) === 0 ? (
              <EmptyState
                compact
                icon={ClipboardList}
                title="No surveys yet"
                description="Create one above and it will show up here."
              />
            ) : (
              <div className="space-y-1.5">
                {surveys.data?.map((s) => (
                  <button key={s.id} type="button"
                    aria-pressed={selectedId === s.id}
                    onClick={() => { setSelectedId(s.id); setShowResponses(false); }}
                    className={cn(
                      "ds-ring w-full rounded-xl border px-3 py-2 text-left transition-colors",
                      selectedId === s.id ? "border-primary bg-primary/5" : "border-border hover:bg-surface-2",
                    )}>
                    <p className="truncate text-sm font-semibold text-foreground">{s.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant={STATUS_TONE[s.status]}>{STATUS_LABELS[s.status]}</Badge>
                      <span className="ds-num text-[11px] text-muted-foreground">
                        {s.question_count} q · {s.response_count} replies
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Builder */}
        <Card>
          <CardContent>
            {!selectedId ? (
              pickASurvey
            ) : survey.isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-6 w-1/2 rounded-xl" />
                <SkeletonText lines={4} />
              </div>
            ) : survey.isError ? (
              <div className="space-y-3">
                <Alert tone="danger" title="Couldn’t load this survey">
                  It may have been removed, or the request didn’t get through.
                </Alert>
                <Button
                  variant="secondary"
                  leftIcon={<RefreshCw aria-hidden />}
                  onClick={() => void survey.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : !detail ? (
              pickASurvey
            ) : showResponses ? (
              <>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="ds-h4 min-w-0 truncate">Replies — {detail.title}</h2>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => setShowResponses(false)}
                    aria-label="Close replies"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </IconButton>
                </div>
                {responses.isLoading ? (
                  <div className="space-y-3">
                    {[0, 1].map((i) => (
                      <Skeleton key={i} className="h-20 rounded-xl" />
                    ))}
                  </div>
                ) : responses.isError ? (
                  <div className="space-y-3">
                    <Alert tone="danger" title="Couldn’t load the replies">
                      The answers didn’t come back this time.
                    </Alert>
                    <Button
                      variant="secondary"
                      leftIcon={<RefreshCw aria-hidden />}
                      onClick={() => void responses.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (responses.data?.length ?? 0) === 0 ? (
                  <EmptyState
                    compact
                    icon={Users}
                    title="No replies yet"
                    description="Answers will appear here as students finish the survey."
                  />
                ) : (
                  <div className="space-y-3">
                    {responses.data?.map((r) => (
                      <div key={r.id} className="rounded-xl border border-border p-3">
                        <p className="truncate text-sm font-semibold text-foreground">{r.student_name}</p>
                        <dl className="mt-2 space-y-1.5">
                          {r.answers.map((a) => (
                            <div key={a.question} className="min-w-0">
                              <dt className="text-xs text-muted-foreground">{a.prompt}</dt>
                              <dd className="text-sm text-foreground">
                                {a.value == null
                                  ? <span className="text-muted-foreground">Skipped</span>
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
                    <h2 className="ds-h4 truncate">{detail.title}</h2>
                    <p className="ds-num mt-0.5 text-xs text-muted-foreground">
                      {detail.question_count} question{detail.question_count === 1 ? "" : "s"} ·{" "}
                      {detail.response_count} replies
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      leftIcon={<Users aria-hidden />}
                      onClick={() => setShowResponses(true)}
                    >
                      Replies
                    </Button>
                    {detail.status === "DRAFT" && (
                      <Button
                        size="sm"
                        leftIcon={<Send aria-hidden />}
                        loading={update.isPending}
                        disabled={detail.question_count === 0}
                        title={detail.question_count === 0 ? "Add a question first" : undefined}
                        onClick={() => update.mutate({ status: "PUBLISHED" })}
                      >
                        Publish
                      </Button>
                    )}
                    {detail.status === "PUBLISHED" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={<Lock aria-hidden />}
                        loading={update.isPending}
                        onClick={() => update.mutate({ status: "CLOSED" })}
                      >
                        Close
                      </Button>
                    )}
                    <IconButton
                      size="sm"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => setConfirmDelete(true)}
                      aria-label="Delete survey"
                    >
                      <Trash2 className="h-4 w-4 text-danger" aria-hidden />
                    </IconButton>
                  </div>
                </div>

                {/* Questions */}
                {detail.questions.length === 0 ? (
                  <EmptyState
                    compact
                    icon={ClipboardList}
                    title="No questions yet"
                    description="Add the first one below — students see it as soon as you publish."
                  />
                ) : (
                  <div className="divide-y divide-border">
                    {detail.questions.map((q, i) => (
                      <div key={q.id} className="flex items-start justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">
                            <span className="ds-num mr-1.5 text-muted-foreground">{i + 1}.</span>
                            {q.prompt}
                            {q.is_required && <span className="ml-1 text-danger">*</span>}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {TYPE_LABELS[q.question_type]}
                            {q.options?.length ? ` · ${q.options.join(", ")}` : ""}
                            {q.question_type === "SCALE" ? ` · ${q.scale_min}–${q.scale_max}` : ""}
                          </p>
                        </div>
                        <IconButton
                          size="sm"
                          variant="ghost"
                          className="shrink-0"
                          disabled={deleteQuestion.isPending}
                          onClick={() => deleteQuestion.mutate(q.id)}
                          aria-label={`Delete question ${i + 1}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add a question */}
                <div className="mt-4 space-y-3 rounded-xl border border-border bg-surface-2 p-4">
                  <Field label="New question" htmlFor="q-prompt">
                    <Input
                      id="q-prompt"
                      value={qPrompt}
                      onChange={(e) => setQPrompt(e.target.value)}
                      placeholder="What do you want to ask?"
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <Field label="Answer type" htmlFor="q-type">
                      <Select
                        id="q-type"
                        value={qType}
                        onChange={(e) => setQType(e.target.value as SurveyQuestionType)}
                      >
                        {(Object.keys(TYPE_LABELS) as SurveyQuestionType[]).map((t) => (
                          <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                        ))}
                      </Select>
                    </Field>
                    <div className="flex h-11 items-center px-1">
                      <Checkbox
                        id="q-required"
                        label="Required"
                        checked={qRequired}
                        onChange={(e) => setQRequired(e.target.checked)}
                      />
                    </div>
                  </div>
                  {needsOptions && (
                    <Field label="Options" htmlFor="q-options">
                      <Textarea
                        id="q-options"
                        rows={3}
                        value={qOptions}
                        onChange={(e) => setQOptions(e.target.value)}
                        placeholder="One option per line"
                      />
                    </Field>
                  )}
                  <Button
                    fullWidth
                    leftIcon={<Plus aria-hidden />}
                    loading={addQuestion.isPending}
                    disabled={!qPrompt.trim() || (needsOptions && !qOptions.trim())}
                    onClick={submitQuestion}
                  >
                    Add question
                  </Button>
                </div>

                <Modal
                  open={confirmDelete}
                  onClose={() => setConfirmDelete(false)}
                  size="sm"
                  title="Delete this survey?"
                  description={`“${detail.title}” and every reply to it will be permanently deleted. This cannot be undone.`}
                  footer={
                    <>
                      <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                      <Button
                        variant="danger"
                        loading={remove.isPending}
                        leftIcon={<Trash2 aria-hidden />}
                        onClick={async () => {
                          await remove.mutateAsync(selectedId);
                          setConfirmDelete(false);
                          setSelectedId(null);
                        }}
                      >
                        Delete survey
                      </Button>
                    </>
                  }
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
