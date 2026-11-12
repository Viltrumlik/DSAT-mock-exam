"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
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
import { Icon } from "@/components/ui/Icon";
import { Badge, Button, EmptyState, buttonClass } from "@/features/console/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { CONTROL, SERIF_AREA } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";
import { useMe } from "@/hooks/useMe";
import { levelLabel } from "@/lib/levels";
import { BOX, CheckRow, Field, INSET, Notice, STATUS_TONE, Shimmer, SurveyDialog } from "./surveyLook";
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
import {
  isNumericType,
  type Survey,
  type SurveyPatch,
  type SurveyQuestion,
  type SurveyStatus,
} from "./surveysApi";
import {
  errorText,
  useAddQuestion,
  useAdminSurvey,
  useAdminSurveys,
  useCreateSurvey,
  useDeleteQuestion,
  useDeleteSurvey,
  useDuplicateSurvey,
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

/** One line describing how the question will behave, for the list. */
function questionSubtitle(q: SurveyQuestion): string {
  const bits: string[] = [TYPE_LABELS[q.question_type]];
  if (q.options?.length) bits.push(q.options.join(" · "));
  if (isNumericType(q.question_type)) bits.push(`${q.scale_min}–${q.scale_max}`);
  if (q.follow_up_threshold != null) bits.push(`asks why below ${q.follow_up_threshold}`);
  if (q.follow_up_options?.length) bits.push(`asks more on “${q.follow_up_options[0]}”`);
  return bits.join(" · ");
}

/** How a conditional question describes its own rule, for the list. */
function conditionSummary(q: SurveyQuestion, all: SurveyQuestion[]): string | null {
  if (!q.condition_question || !q.condition_operator) return null;
  const at = all.findIndex((x) => x.id === q.condition_question);
  const source = at >= 0 ? `Q${at + 1}` : "an earlier question";
  const value = Array.isArray(q.condition_value)
    ? q.condition_value.join(", ")
    : String(q.condition_value ?? "");
  switch (q.condition_operator) {
    case "AT_LEAST": return `only if ${source} ≥ ${value}`;
    case "BELOW": return `only if ${source} < ${value}`;
    case "ANY_OF": return `only if ${source} is ${value}`;
    case "NONE_OF": return `only if ${source} is not ${value}`;
    case "ANSWERED": return `only if ${source} was answered`;
    default: return null;
  }
}

function SortableQuestionRow({
  question,
  index,
  onEdit,
  onDelete,
  busy,
  allQuestions,
}: {
  question: SurveyQuestion;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
  allQuestions: SurveyQuestion[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
  });
  return (
    <div
      ref={setNodeRef}
      data-question={question.id}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex items-start gap-2 border-b border-ms-line px-1 py-3 last:border-b-0"
    >
      <button
        type="button"
        className="ms-transition mt-0.5 grid size-8 shrink-0 cursor-grab place-items-center rounded-ms-ctl text-ms-fg-3 hover:bg-ms-surface-2 hover:text-ms-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ms-ring active:cursor-grabbing"
        aria-label={`Reorder question ${index + 1}`}
        {...attributes}
        {...listeners}
      >
        <Icon name="grip" size="sm" />
      </button>
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-[15px] font-semibold leading-[22px] text-ms-fg">
          <span className="mr-1.5 tabular-nums text-ms-fg-3">{index + 1}.</span>
          {question.prompt}
          {question.is_required && <span className="ml-1 text-ms-critical-fg">*</span>}
        </p>
        <p className="mt-0.5 text-[13px] text-ms-fg-2">{questionSubtitle(question)}</p>
        {conditionSummary(question, allQuestions) && (
          <Badge tone="info" icon="filter" className="mt-1.5">
            {conditionSummary(question, allQuestions)}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        {/* Editing exists at last. The PATCH endpoint has always been there; nothing called
            it, so a typo meant delete-and-retype — and delete is refused once anyone has
            replied, which made a typo permanent. */}
        <Button size="sm" variant="ghost" icon="pencil" onClick={onEdit} aria-label={`Edit question ${index + 1}`} />
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          disabled={busy}
          onClick={onDelete}
          aria-label={`Delete question ${index + 1}`}
        />
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
  const duplicate = useDuplicateSurvey();

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
    errorText(reorder.error) ??
    errorText(duplicate.error);

  if (!isSuperAdmin) {
    return (
      <div className={cn(BOX, "animate-ms-card-in flex items-start gap-3 p-5")}>
        <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-ms-surface-2 text-ms-fg-3">
          <Icon name="lock" />
        </span>
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-ms-fg">Surveys are managed by a super admin.</p>
          <p className="mt-1 text-[14px] text-ms-fg-2">
            Ask a super admin to create or publish a survey.
          </p>
        </div>
      </div>
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

  async function patchSurvey(
    patch: Parameters<typeof update.mutateAsync>[0]["patch"],
    image?: File | null,
  ) {
    setPageError(null);
    try {
      await update.mutateAsync({ patch, image });
    } catch (e) {
      setPageError(errorText(e) ?? "That change couldn’t be saved.");
    }
  }

  // Shown both before anything is picked and if the detail request comes back empty.
  const pickASurvey = (
    <EmptyState
      icon="clipboard"
      title="Pick a survey to start"
      detail="Choose one from the list, or create a new survey and start adding questions."
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <OpsPageHeader
        section="Super admin"
        title="Surveys"
        description="Ask students a question. Finishing a survey earns them points, so only published surveys are answerable."
      />

      {mutationError && <Notice tone="danger" title={mutationError} />}

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        {/* ── Survey list + create ─────────────────────────────────────────── */}
        <section className={cn(BOX, "animate-ms-card-in flex flex-col gap-3 p-4")}>
          {/* Solid + inset, not dashed: the dashed border is EmptyState's material, and a
              live form wearing it reads as "nothing here" — the same box sits directly
              above the empty state in this rail. */}
          <div className={cn(INSET, "flex flex-col gap-3 p-3.5")}>
            <Field label="New survey" htmlFor="new-survey-title">
              <input
                id="new-survey-title"
                value={newTitle}
                maxLength={200}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Survey title"
                className={CONTROL}
              />
            </Field>
            <Button
              variant="primary"
              size="sm"
              icon="plus"
              className="w-full"
              state={create.isPending ? "busy" : "idle"}
              disabled={!newTitle.trim() || create.isPending}
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
            <Shimmer rows={3} className="h-16" />
          ) : surveys.isError ? (
            <div className="flex flex-col gap-2">
              <Notice tone="danger" title="Couldn’t load surveys">
                The list didn’t come back this time.
              </Notice>
              <Button
                size="sm"
                variant="secondary"
                icon="refresh"
                className="w-full"
                onClick={() => void surveys.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : (surveys.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="clipboard"
              title="No surveys yet"
              detail="Create one above and it will show up here."
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              {surveys.data?.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-survey={s.id}
                  aria-pressed={selectedId === s.id}
                  onClick={() => {
                    setSelectedId(s.id);
                    setShowResponses(false);
                  }}
                  className={cn(
                    "ms-transition w-full rounded-ms-ctl border px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ms-ring",
                    selectedId === s.id
                      ? "border-ms-primary bg-ms-primary-soft"
                      : "border-ms-border bg-ms-card hover:bg-ms-surface",
                  )}
                >
                  <p className="truncate text-[14px] font-semibold text-ms-fg">{s.title}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {/* `is_open`, not the status alone: a PUBLISHED survey whose closing
                        date has passed is no longer answerable, and the console used to
                        keep calling it Published. */}
                    <Badge tone={STATUS_TONE[s.status]} dot={s.status !== "DRAFT"}>
                      {s.status === "PUBLISHED" && !s.is_open ? "Closed by date" : STATUS_LABELS[s.status]}
                    </Badge>
                    {s.allow_anonymous && (
                      <span title="Replies may be anonymous" className="text-ms-fg-3">
                        <Icon name="shield" size="sm" className="size-3.5" />
                      </span>
                    )}
                    <span className="text-[12px] tabular-nums text-ms-fg-3">
                      {s.question_count} q · {s.response_count} replies
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Builder ──────────────────────────────────────────────────────── */}
        <section className={cn(BOX, "animate-ms-card-in min-w-0 p-4 sm:p-5")} style={{ animationDelay: "40ms" }}>
          {!selectedId ? (
            pickASurvey
          ) : survey.isPending ? (
            <div aria-busy="true" className="flex flex-col gap-3">
              <div className="h-7 w-1/2 animate-ms-shimmer rounded-ms-ctl bg-ms-surface-2" />
              <Shimmer rows={4} className="h-4" />
            </div>
          ) : survey.isError ? (
            <div className="flex flex-col items-start gap-3">
              <Notice tone="danger" title="Couldn’t load this survey">
                It may have been removed, or the request didn’t get through.
              </Notice>
              <Button variant="secondary" icon="refresh" onClick={() => void survey.refetch()}>
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
              onDuplicate={async () => {
                setPageError(null);
                try {
                  const copy = await duplicate.mutateAsync(detail.id);
                  setSelectedId(copy.id);
                  setShowResponses(false);
                } catch (e) {
                  setPageError(errorText(e) ?? "That survey couldn’t be copied.");
                }
              }}
              duplicating={duplicate.isPending}
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
        </section>
      </div>

      {/* The copy names what the server will actually do. It used to promise that every reply
          would be deleted with it — and the server refuses outright once anyone has replied. */}
      <SurveyDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
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
              icon="trash"
              state={remove.isPending ? "busy" : "idle"}
              disabled={Boolean(detail?.response_count) || remove.isPending}
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
        {modalError && <Notice tone="danger" title={modalError} />}
      </SurveyDialog>
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
  onDuplicate,
  duplicating,
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
  // The real write surface, not an inline subset — an ad-hoc shape here is how a field the
  // server accepts ends up with no way to send it.
  onPatch: (patch: SurveyPatch, image?: File | null) => void;
  onAskDelete: () => void;
  onDuplicate: () => void;
  duplicating: boolean;
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-[16rem]">
          <h2 className="truncate text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">{detail.title}</h2>
          <p className="mt-0.5 text-[13px] tabular-nums text-ms-fg-2">
            {detail.question_count} question{detail.question_count === 1 ? "" : "s"} ·{" "}
            {detail.response_count} replies
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="secondary" icon="users" onClick={onShowResponses}>
            Replies
          </Button>
          {detail.status === "DRAFT" && (
            <Button
              size="sm"
              variant="primary"
              icon="send"
              state={updating ? "busy" : "idle"}
              disabled={detail.question_count === 0 || updating}
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
              icon="lock"
              state={updating ? "busy" : "idle"}
              disabled={updating}
              onClick={() => onPatch({ status: "CLOSED" })}
            >
              Close
            </Button>
          )}
          {/* Reopen. Closing sits one button away from Publish, and a survey closed by
              mistake — or closed on Friday when eight students were off ill — was a dead end
              with no way back short of the Django admin. */}
          {detail.status === "CLOSED" && (
            <Button
              size="sm"
              variant="secondary"
              icon="send"
              state={updating ? "busy" : "idle"}
              disabled={updating}
              onClick={() => onPatch({ status: "PUBLISHED" })}
            >
              Reopen
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            icon="layers"
            state={duplicating ? "busy" : "idle"}
            disabled={duplicating}
            onClick={onDuplicate}
            title="Copy this survey and its questions into a new draft"
          >
            Duplicate
          </Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={onAskDelete} aria-label="Delete survey" />
        </div>
      </div>

      {/* ── Survey-level settings, none of which had a control before ──────── */}
      <div className={cn(INSET, "flex flex-col gap-4 p-4")}>
        <Field
          label="Introduction"
          htmlFor="survey-description"
          hint="Shown under the title on the student's form."
        >
          <textarea
            id="survey-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              if (description !== detail.description) onPatch({ description });
            }}
            className={SERIF_AREA}
          />
        </Field>
        {/* The survey's own picture. The backend, the API and the student's form have all
            carried this since it shipped; there was simply no way to set one, which is the
            same "the function exists and cannot be reached" shape as the question editor. */}
        <Field label="Picture" hint="Optional. Shown under the title on the student's form.">
          <div className="flex flex-col items-start gap-2">
            {detail.image_url && (
              <div className="w-full max-w-sm overflow-hidden rounded-ms-ctl border border-ms-border bg-ms-card">
                {/* `unoptimized`: the bucket is private, so this is a signed URL that expires
                    in an hour and Next's optimizer would cache a 403. */}
                <Image
                  src={detail.image_url}
                  alt=""
                  width={640}
                  height={360}
                  unoptimized
                  className="h-auto w-full object-contain"
                />
              </div>
            )}
            <label
              aria-disabled={updating || undefined}
              className={buttonClass({ variant: "secondary", size: "sm", className: updating ? undefined : "cursor-pointer" })}
            >
              <Icon name="image" size="sm" />
              {detail.image_url ? "Replace picture" : "Add a picture"}
              <input
                type="file"
                accept="image/*"
                disabled={updating}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Sent on its own with an empty patch: the image rides multipart, and
                  // bundling it with the text fields would turn every keystroke-blur save
                  // into a re-upload of the same picture.
                  if (file) onPatch({}, file);
                }}
              />
            </label>
          </div>
        </Field>

        {/* WHO IT GOES TO. Until now every published survey went to the entire centre, and
            that single absence was the root of four separate complaints: you could not ask
            one year group, could not get a response RATE (no audience means no denominator),
            could not list who had not replied, and could not read results per class. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who gets it" htmlFor="survey-audience">
            <select
              id="survey-audience"
              value={detail.audience_kind}
              onChange={(e) =>
                onPatch({
                  audience_kind: e.target.value as Survey["audience_kind"],
                  // The old narrowing means nothing under a new kind, and a stale level left
                  // behind would quietly aim the survey at a group nobody chose.
                  audience_level: "",
                  audience_classrooms: [],
                  audience_branch: null,
                })
              }
              className={CONTROL}
            >
              <option value="ALL">Everyone in the learning center</option>
              <option value="LEVEL">One level</option>
              <option value="CLASSROOMS">Chosen classrooms</option>
              <option value="BRANCH">One branch</option>
            </select>
          </Field>

          {detail.audience_kind === "LEVEL" && (
            <Field label="Which level" htmlFor="survey-level">
              <select
                id="survey-level"
                value={detail.audience_level}
                onChange={(e) => onPatch({ audience_level: e.target.value })}
                className={CONTROL}
              >
                <option value="">— Choose a level —</option>
                {["foundation", "junior", "middle", "senior"].map((l) => (
                  <option key={l} value={l}>{levelLabel(l)}</option>
                ))}
              </select>
            </Field>
          )}

          <Field
            label="What it pays"
            htmlFor="survey-points"
            hint={
              detail.points_award === 0
                ? "Nothing — no points row is created at all."
                : "Points a student earns for finishing it."
            }
          >
            <input
              id="survey-points"
              type="number"
              min={0}
              max={500}
              value={detail.points_award}
              onChange={(e) => onPatch({ points_award: Number(e.target.value) || 0 })}
              className={CONTROL}
            />
          </Field>
        </div>

        {detail.audience_kind !== "ALL" && !detail.audience_level &&
          detail.audience_classrooms.length === 0 && !detail.audience_branch && (
            <Notice tone="warning" title="This survey currently reaches nobody">
              Choose who it is for, or set it back to everyone.
            </Notice>
          )}

        <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
          <Field
            label="Opens on"
            htmlFor="survey-opens"
            hint="Optional. Publish it now and it goes live on that date by itself."
          >
            <input
              id="survey-opens"
              type="date"
              value={detail.opens_at ? detail.opens_at.slice(0, 10) : ""}
              onChange={(e) =>
                onPatch({ opens_at: e.target.value ? `${e.target.value}T00:00:00` : null })
              }
              className={CONTROL}
            />
          </Field>
          <Field
            label="Closes on"
            htmlFor="survey-closes"
            hint="Optional. After this it stops accepting answers."
          >
            <input
              id="survey-closes"
              type="date"
              value={detail.closes_at ? detail.closes_at.slice(0, 10) : ""}
              onChange={(e) =>
                onPatch({
                  // End of the chosen day, so "closes on the 5th" includes the 5th.
                  closes_at: e.target.value ? `${e.target.value}T23:59:59` : null,
                })
              }
              className={CONTROL}
            />
          </Field>
          <div className="sm:col-span-2">
            <CheckRow
              label="Let students reply anonymously"
              checked={detail.allow_anonymous}
              onChange={(on) => onPatch({ allow_anonymous: on })}
            />
            <p className="mt-0.5 text-[13px] leading-[18px] text-ms-fg-3">
              They choose per reply. Their name is kept off the results — the answer is still
              one reply from one student, so nobody can answer twice.
            </p>
          </div>
        </div>
      </div>

      {/* ── Questions ─────────────────────────────────────────────────────── */}
      {detail.questions.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title="No questions yet"
          detail="Add the first one below — students see it as soon as you publish."
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
            <div className="rounded-ms-card border border-ms-border px-2">
              {detail.questions.map((q, i) => (
                <SortableQuestionRow
                  key={q.id}
                  question={q}
                  index={i}
                  busy={deleting}
                  onEdit={() => onOpenEdit(q)}
                  onDelete={() => onDeleteQuestion(q.id)}
                  allQuestions={detail.questions}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* ── Add / edit a question ─────────────────────────────────────────── */}
      {editing === null ? (
        <Button variant="secondary" icon="plus" className="w-full" onClick={onOpenNew}>
          Add a question
        </Button>
      ) : (
        <div className="animate-ms-fade-in flex flex-col gap-4 rounded-ms-card border border-ms-primary bg-ms-surface p-4 shadow-[0_0_0_3px_var(--ms-primary-soft)]">
          <p className="text-[15px] font-bold text-ms-fg">
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
            // Only the questions ABOVE this one — a condition may point backwards only, and
            // offering a later question would build a rule the server refuses on save.
            // A NEW question is appended last, so it may depend on any of them.
            earlierQuestions={
              editing === "new"
                ? detail.questions
                : detail.questions.slice(
                    0,
                    Math.max(0, detail.questions.findIndex((q) => q.id === editing)),
                  )
            }
          />
          <DraftProblems problems={problems} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon="plus"
              state={saving ? "busy" : "idle"}
              disabled={problems.length > 0 || saving}
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
    </div>
  );
}
