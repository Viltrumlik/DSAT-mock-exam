"use client";

import { useEffect, useState } from "react";
import {
  ClipboardList,
  EyeOff,
  GripVertical,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  Skeleton,
  SkeletonText,
  Textarea,
} from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import {
  BLANK_DRAFT,
  DraftProblems,
  QuestionEditor,
  TYPE_LABELS,
  draftFrom,
  draftProblems,
  patchFrom,
  type QuestionDraft,
} from "./QuestionEditor";
import { SurveyResultsPanel } from "./SurveyResultsPanel";
import { isNumericType, type Survey, type SurveyQuestion, type SurveyStatus } from "./surveysApi";
import {
  errorText,
  useAddQuestion,
  useAdminSurvey,
  useAdminSurveys,
  useCreateSurvey,
  useDeleteQuestion,
  useDeleteSurvey,
  useReorderQuestions,
  useUpdateQuestion,
  useUpdateSurvey,
} from "./surveysHooks";

// SURVEY AUTHORING — super_admin only. The API enforces that on every endpoint; this page
// and its nav entry only avoid offering something the server would refuse.

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

/** One line describing how the question will behave, for the list. */
function questionSubtitle(q: SurveyQuestion): string {
  const bits: string[] = [TYPE_LABELS[q.question_type]];
  if (q.options?.length) bits.push(q.options.join(" · "));
  if (isNumericType(q.question_type)) bits.push(`${q.scale_min}–${q.scale_max}`);
  if (q.follow_up_threshold != null) bits.push(`asks why below ${q.follow_up_threshold}`);
  if (q.follow_up_options?.length) bits.push(`asks more on “${q.follow_up_options[0]}”`);
  return bits.join(" · ");
}

function SortableQuestionRow({
  question,
  index,
  onEdit,
  onDelete,
  busy,
}: {
  question: SurveyQuestion;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex items-start gap-2 border-b border-border py-3 last:border-b-0"
    >
      <button
        type="button"
        className="ds-ring mt-0.5 shrink-0 cursor-grab rounded-md p-1 text-muted-foreground hover:bg-surface-2 active:cursor-grabbing"
        aria-label={`Reorder question ${index + 1}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          <span className="ds-num mr-1.5 text-muted-foreground">{index + 1}.</span>
          {question.prompt}
          {question.is_required && <span className="ml-1 text-danger">*</span>}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{questionSubtitle(question)}</p>
      </div>
      <div className="flex shrink-0 items-center">
        {/* Editing exists at last. The PATCH endpoint has always been there; nothing called
            it, so a typo meant delete-and-retype — and delete is refused once anyone has
            replied, which made a typo permanent. */}
        <IconButton size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit question ${index + 1}`}>
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onDelete}
          aria-label={`Delete question ${index + 1}`}
        >
          <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

export function SurveyBuilderPage() {
  const { me } = useMe();
  const role = String((me as { role?: string } | undefined)?.role ?? "").toLowerCase();
  const isSuperAdmin =
    role === "super_admin" || Boolean((me as { is_superuser?: boolean } | undefined)?.is_superuser);

  const surveys = useAdminSurveys();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showResponses, setShowResponses] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const survey = useAdminSurvey(selectedId);

  const create = useCreateSurvey();
  const update = useUpdateSurvey(selectedId);
  const remove = useDeleteSurvey();
  const addQuestion = useAddQuestion(selectedId);
  const updateQuestion = useUpdateQuestion(selectedId);
  const deleteQuestion = useDeleteQuestion(selectedId);
  const reorder = useReorderQuestions(selectedId);

  const [newTitle, setNewTitle] = useState("");
  // Which question is being written. `null` = nothing open; `"new"` = the add form; a number
  // = editing that question.
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<QuestionDraft>(BLANK_DRAFT);
  const [draftImage, setDraftImage] = useState<File | null>(null);
  // Errors raised inside the delete modal, rendered INSIDE it — the page-level Alert sits
  // under a z-[200] portal, so a failure there used to be invisible.
  const [modalError, setModalError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const detail = survey.data;

  // Half-written questions used to follow the author from one survey to the next.
  useEffect(() => {
    setEditing(null);
    setDraft(BLANK_DRAFT);
    setDraftImage(null);
    setPageError(null);
  }, [selectedId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const mutationError =
    pageError ??
    errorText(create.error) ??
    errorText(update.error) ??
    errorText(addQuestion.error) ??
    errorText(updateQuestion.error) ??
    errorText(deleteQuestion.error) ??
    errorText(reorder.error);

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

  const problems = draftProblems(draft);

  function openNew() {
    setDraft(BLANK_DRAFT);
    setDraftImage(null);
    setEditing("new");
    setPageError(null);
  }

  function openEdit(q: SurveyQuestion) {
    setDraft(draftFrom(q));
    setDraftImage(null);
    setEditing(q.id);
    setPageError(null);
  }

  async function saveDraft() {
    if (!selectedId || problems.length > 0) return;
    setPageError(null);
    try {
      if (editing === "new") {
        await addQuestion.mutateAsync({ body: patchFrom(draft), image: draftImage });
      } else if (typeof editing === "number") {
        await updateQuestion.mutateAsync({
          questionId: editing,
          patch: patchFrom(draft),
          image: draftImage,
        });
      }
      setEditing(null);
      setDraft(BLANK_DRAFT);
      setDraftImage(null);
    } catch (e) {
      // Caught, not left to reject unhandled — and shown, which is the part that was missing.
      setPageError(errorText(e) ?? "That question couldn’t be saved.");
    }
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !detail) return;
    const ids = detail.questions.map((q) => q.id);
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from === -1 || to === -1) return;
    setPageError(null);
    try {
      await reorder.mutateAsync(arrayMove(ids, from, to));
    } catch (e) {
      setPageError(errorText(e) ?? "The new order couldn’t be saved.");
    }
  }

  async function patchSurvey(patch: Parameters<typeof update.mutateAsync>[0]["patch"]) {
    setPageError(null);
    try {
      await update.mutateAsync({ patch });
    } catch (e) {
      setPageError(errorText(e) ?? "That change couldn’t be saved.");
    }
  }

  // Shown both before anything is picked and if the detail request comes back empty.
  const pickASurvey = (
    <EmptyState
      icon={ClipboardList}
      title="Pick a survey to start"
      description="Choose one from the list, or create a new survey and start adding questions."
    />
  );

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

      {mutationError && <Alert tone="danger" title={mutationError} />}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* ── Survey list + create ─────────────────────────────────────────── */}
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
                  maxLength={200}
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
                  setPageError(null);
                  try {
                    const made = await create.mutateAsync({ title: newTitle.trim() });
                    setNewTitle("");
                    setSelectedId(made.id);
                    setShowResponses(false);
                  } catch (e) {
                    setPageError(errorText(e) ?? "That survey couldn’t be created.");
                  }
                }}
              >
                Create
              </Button>
            </div>

            {surveys.isPending ? (
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
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={selectedId === s.id}
                    onClick={() => {
                      setSelectedId(s.id);
                      setShowResponses(false);
                    }}
                    className={cn(
                      "ds-ring w-full rounded-xl border px-3 py-2 text-left transition-colors",
                      selectedId === s.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-surface-2",
                    )}
                  >
                    <p className="truncate text-sm font-semibold text-foreground">{s.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {/* `is_open`, not the status alone: a PUBLISHED survey whose closing
                          date has passed is no longer answerable, and the console used to
                          keep calling it Published. */}
                      <Badge variant={STATUS_TONE[s.status]}>
                        {s.status === "PUBLISHED" && !s.is_open ? "Closed by date" : STATUS_LABELS[s.status]}
                      </Badge>
                      {s.allow_anonymous && (
                        <span title="Replies may be anonymous">
                          <EyeOff className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        </span>
                      )}
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

        {/* ── Builder ──────────────────────────────────────────────────────── */}
        <Card>
          <CardContent>
            {!selectedId ? (
              pickASurvey
            ) : survey.isPending ? (
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
              <SurveyResultsPanel
                surveyId={detail.id}
                title={detail.title}
                onClose={() => setShowResponses(false)}
              />
            ) : (
              <SurveyEditor
                detail={detail}
                sensors={sensors}
                onDragEnd={onDragEnd}
                onShowResponses={() => setShowResponses(true)}
                onPatch={patchSurvey}
                onAskDelete={() => {
                  setModalError(null);
                  setConfirmDelete(true);
                }}
                updating={update.isPending}
                deleting={deleteQuestion.isPending}
                editing={editing}
                draft={draft}
                draftImage={draftImage}
                problems={problems}
                saving={addQuestion.isPending || updateQuestion.isPending}
                onOpenNew={openNew}
                onOpenEdit={openEdit}
                onDraftChange={setDraft}
                onDraftImage={setDraftImage}
                onCancelEdit={() => setEditing(null)}
                onSaveDraft={saveDraft}
                onDeleteQuestion={(id) => {
                  setPageError(null);
                  deleteQuestion.mutate(id, {
                    onError: (e) =>
                      setPageError(errorText(e) ?? "That question couldn’t be deleted."),
                  });
                }}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* The copy names what the server will actually do. It used to promise that every reply
          would be deleted with it — and the server refuses outright once anyone has replied. */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        title="Delete this survey?"
        description={
          detail?.response_count
            ? `“${detail.title}” has ${detail.response_count} repl${detail.response_count === 1 ? "y" : "ies"}. A survey with replies cannot be deleted — close it instead, and the answers stay.`
            : `“${detail?.title ?? "This survey"}” and its questions will be permanently deleted. This cannot be undone.`
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              disabled={Boolean(detail?.response_count)}
              leftIcon={<Trash2 aria-hidden />}
              onClick={async () => {
                if (!selectedId) return;
                setModalError(null);
                try {
                  await remove.mutateAsync(selectedId);
                  setConfirmDelete(false);
                  setSelectedId(null);
                } catch (e) {
                  setModalError(errorText(e) ?? "That survey couldn’t be deleted.");
                }
              }}
            >
              Delete survey
            </Button>
          </>
        }
      >
        {modalError && <Alert tone="danger" title={modalError} />}
      </Modal>
    </div>
  );
}

/** The right-hand pane when a survey is selected and the replies are not showing. */
function SurveyEditor({
  detail,
  sensors,
  onDragEnd,
  onShowResponses,
  onPatch,
  onAskDelete,
  updating,
  deleting,
  editing,
  draft,
  draftImage,
  problems,
  saving,
  onOpenNew,
  onOpenEdit,
  onDraftChange,
  onDraftImage,
  onCancelEdit,
  onSaveDraft,
  onDeleteQuestion,
}: {
  detail: Survey;
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (e: DragEndEvent) => void;
  onShowResponses: () => void;
  onPatch: (patch: { status?: SurveyStatus; description?: string; allow_anonymous?: boolean; closes_at?: string | null }) => void;
  onAskDelete: () => void;
  updating: boolean;
  deleting: boolean;
  editing: number | "new" | null;
  draft: QuestionDraft;
  draftImage: File | null;
  problems: string[];
  saving: boolean;
  onOpenNew: () => void;
  onOpenEdit: (q: SurveyQuestion) => void;
  onDraftChange: (d: QuestionDraft) => void;
  onDraftImage: (f: File | null) => void;
  onCancelEdit: () => void;
  onSaveDraft: () => void;
  onDeleteQuestion: (id: number) => void;
}) {
  const [description, setDescription] = useState(detail.description);
  useEffect(() => setDescription(detail.description), [detail.id, detail.description]);
  const editingQuestion =
    typeof editing === "number" ? detail.questions.find((q) => q.id === editing) ?? null : null;

  return (
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
          <Button size="sm" variant="secondary" leftIcon={<Users aria-hidden />} onClick={onShowResponses}>
            Replies
          </Button>
          {detail.status === "DRAFT" && (
            <Button
              size="sm"
              leftIcon={<Send aria-hidden />}
              loading={updating}
              disabled={detail.question_count === 0}
              title={detail.question_count === 0 ? "Add a question first" : undefined}
              onClick={() => onPatch({ status: "PUBLISHED" })}
            >
              Publish
            </Button>
          )}
          {detail.status === "PUBLISHED" && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Lock aria-hidden />}
              loading={updating}
              onClick={() => onPatch({ status: "CLOSED" })}
            >
              Close
            </Button>
          )}
          <IconButton size="sm" variant="ghost" onClick={onAskDelete} aria-label="Delete survey">
            <Trash2 className="h-4 w-4 text-danger" aria-hidden />
          </IconButton>
        </div>
      </div>

      {/* ── Survey-level settings, none of which had a control before ──────── */}
      <div className="mb-4 space-y-3 rounded-xl border border-border bg-surface-2 p-4">
        <Field
          label="Introduction"
          htmlFor="survey-description"
          hint="Shown under the title on the student's form."
        >
          <Textarea
            id="survey-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              if (description !== detail.description) onPatch({ description });
            }}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
          <Field
            label="Closes on"
            htmlFor="survey-closes"
            hint="Optional. After this it stops accepting answers."
          >
            <Input
              id="survey-closes"
              type="date"
              value={detail.closes_at ? detail.closes_at.slice(0, 10) : ""}
              onChange={(e) =>
                onPatch({
                  // End of the chosen day, so "closes on the 5th" includes the 5th.
                  closes_at: e.target.value ? `${e.target.value}T23:59:59` : null,
                })
              }
            />
          </Field>
          <div className="pb-2.5">
            <Checkbox
              id="survey-anon"
              label="Let students reply anonymously"
              checked={detail.allow_anonymous}
              onChange={(e) => onPatch({ allow_anonymous: e.target.checked })}
            />
            <p className="mt-1 text-[12px] text-muted-foreground">
              They choose per reply. Their name is kept off the results — the answer is still
              one reply from one student, so nobody can answer twice.
            </p>
          </div>
        </div>
      </div>

      {/* ── Questions ─────────────────────────────────────────────────────── */}
      {detail.questions.length === 0 ? (
        <EmptyState
          compact
          icon={ClipboardList}
          title="No questions yet"
          description="Add the first one below — students see it as soon as you publish."
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => {
            void onDragEnd(e);
          }}
        >
          <SortableContext
            items={detail.questions.map((q) => q.id)}
            strategy={verticalListSortingStrategy}
          >
            <div>
              {detail.questions.map((q, i) => (
                <SortableQuestionRow
                  key={q.id}
                  question={q}
                  index={i}
                  busy={deleting}
                  onEdit={() => onOpenEdit(q)}
                  onDelete={() => onDeleteQuestion(q.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* ── Add / edit a question ─────────────────────────────────────────── */}
      {editing === null ? (
        <Button
          className="mt-4"
          fullWidth
          variant="secondary"
          leftIcon={<Plus aria-hidden />}
          onClick={onOpenNew}
        >
          Add a question
        </Button>
      ) : (
        <div className="mt-4 space-y-3 rounded-xl border border-primary/40 bg-surface-2 p-4">
          <p className="text-sm font-bold text-foreground">
            {editing === "new" ? "New question" : `Editing question ${
              detail.questions.findIndex((q) => q.id === editing) + 1
            }`}
          </p>
          <QuestionEditor
            draft={draft}
            onChange={onDraftChange}
            image={draftImage}
            onImageChange={onDraftImage}
            existingImageUrl={editingQuestion?.image_url}
            idPrefix={`q-${editing}`}
          />
          <DraftProblems problems={problems} />
          <div className="flex flex-wrap gap-2">
            <Button
              loading={saving}
              disabled={problems.length > 0}
              leftIcon={<Plus aria-hidden />}
              onClick={onSaveDraft}
            >
              {editing === "new" ? "Add question" : "Save changes"}
            </Button>
            <Button variant="ghost" onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
