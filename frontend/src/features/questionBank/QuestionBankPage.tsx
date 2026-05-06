"use client";

import { useMemo, useState } from "react";
import QuestionBankFilters from "@/features/questionBank/QuestionBankFilters";
import QuestionRow from "@/features/questionBank/QuestionRow";
import QuestionEditorDrawer from "@/features/questionBank/QuestionEditorDrawer";
import ModuleUsageModal from "@/features/questionBank/ModuleUsageModal";
import AssignToModuleDialog from "@/features/questionBank/AssignToModuleDialog";
import {
  useArchiveStandaloneQuestion,
  useAssignStandaloneQuestionToModule,
  useCreateStandaloneQuestion,
  useQuestionBankCategories,
  useQuestionBankQuestions,
} from "@/features/questionBank/hooks";
import type { ActiveFilter, LifecycleStatusFilter, SubjectFilter } from "@/features/questionBank/types";

export default function QuestionBankPage() {
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState<number | "all">("all");
  const [subject, setSubject] = useState<SubjectFilter>("all");
  const [isActive, setIsActive] = useState<ActiveFilter>("1");
  const [lifecycleStatus, setLifecycleStatus] = useState<LifecycleStatusFilter>("all");

  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorQuestionId, setEditorQuestionId] = useState<number | null>(null);
  const [usageQuestionId, setUsageQuestionId] = useState<number | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignQuestionIds, setAssignQuestionIds] = useState<number[]>([]);

  const catsQ = useQuestionBankCategories();
  const questionsQ = useQuestionBankQuestions({ q, categoryId, subject, isActive, lifecycleStatus });
  const archiveM = useArchiveStandaloneQuestion();
  const assignM = useAssignStandaloneQuestionToModule();
  const createM = useCreateStandaloneQuestion();

  const categories = catsQ.data || [];
  const questions = questionsQ.data || [];

  const title = useMemo(() => {
    const parts = ["Question bank"];
    if (isActive === "1") parts.push("(active)");
    if (isActive === "0") parts.push("(archived)");
    return parts.join(" ");
  }, [isActive]);

  const selectedIds = useMemo(
    () => questions.filter((qq) => selected[qq.id]).map((qq) => qq.id),
    [questions, selected],
  );

  const selectedAssignableIds = useMemo(
    () =>
      questions
        .filter((qq) => selected[qq.id] && qq.is_active && qq.status === "approved")
        .map((qq) => qq.id),
    [questions, selected],
  );

  const toggleAll = (on: boolean) => {
    const next: Record<number, boolean> = { ...selected };
    for (const qq of questions) {
      if (on) next[qq.id] = true;
      else delete next[qq.id];
    }
    setSelected(next);
  };

  const openNew = async () => {
    const row = await createM.mutateAsync({
      question_type: "READING",
      question_text: "New question — edit stem and options",
      question_prompt: "",
      option_a: "Option A",
      option_b: "Option B",
      option_c: "",
      option_d: "",
      correct_answer: "A",
      explanation: "",
      score: 10,
      is_math_input: false,
      is_active: true,
    });
    const id = (row as { id?: number }).id;
    if (typeof id === "number") {
      setEditorQuestionId(id);
      setEditorOpen(true);
    }
  };

  const bulkArchive = async () => {
    const ids = selectedIds;
    if (ids.length === 0) return;
    if (!window.confirm(`Archive ${ids.length} question(s)?`)) return;
    for (const id of ids) {
      await archiveM.mutateAsync({ questionId: id, isActive: false });
    }
    setSelected({});
  };

  const openBulkAssign = () => {
    if (selectedAssignableIds.length === 0) {
      window.alert(
        "Select approved and active questions only. Drafts must be reviewed and approved before assigning.",
      );
      return;
    }
    setAssignQuestionIds(selectedAssignableIds);
    setAssignDialogOpen(true);
  };

  const openSingleAssign = (questionId: number) => {
    setAssignQuestionIds([questionId]);
    setAssignDialogOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{title}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Drafts go through submit → approve. Only approved, active items can ship into modules.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
            disabled={createM.isPending}
            onClick={() => void openNew()}
          >
            + New question
          </button>
        </div>
      </div>

      {selectedIds.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{selectedIds.length} selected</span>
          <button type="button" className="rounded border px-2 py-1 text-xs" onClick={openBulkAssign}>
            Bulk assign
          </button>
          <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => void bulkArchive()}>
            Bulk archive
          </button>
          <button type="button" className="text-xs underline" onClick={() => setSelected({})}>
            Clear selection
          </button>
        </div>
      ) : null}

      <QuestionBankFilters
        q={q}
        onQChange={setQ}
        categoryId={categoryId}
        onCategoryChange={setCategoryId}
        subject={subject}
        onSubjectChange={setSubject}
        isActive={isActive}
        onIsActiveChange={setIsActive}
        lifecycleStatus={lifecycleStatus}
        onLifecycleStatusChange={setLifecycleStatus}
        categories={categories}
      />

      <div className="mt-4 rounded border">
        {questions.length > 0 ? (
          <div className="flex items-center gap-3 border-b px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={questions.length > 0 && questions.every((qq) => selected[qq.id])}
              onChange={(e) => toggleAll(e.target.checked)}
              aria-label="Select all visible"
            />
            <span className="text-muted-foreground">Select all on page</span>
          </div>
        ) : null}

        {questionsQ.isLoading ? (
          <div className="p-4 text-sm">Loading questions…</div>
        ) : questionsQ.isError ? (
          <div className="p-4 text-sm text-red-600">Failed to load questions.</div>
        ) : questions.length === 0 ? (
          <div className="p-4 text-sm">
            {q ||
            categoryId !== "all" ||
            subject !== "all" ||
            isActive !== "all" ||
            lifecycleStatus !== "all" ? (
              <>
                <div className="font-semibold">No results.</div>
                <div className="mt-1 text-muted-foreground">Try changing your filters or search.</div>
              </>
            ) : (
              <>
                <div className="font-semibold">No questions yet.</div>
                <div className="mt-1 text-muted-foreground">Use “New question” to create one.</div>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y">
            {questions.map((qq) => (
              <QuestionRow
                key={qq.id}
                q={qq}
                categories={categories}
                selected={Boolean(selected[qq.id])}
                onSelectChange={(id, sel) =>
                  setSelected((prev) => {
                    const next = { ...prev };
                    if (sel) next[id] = true;
                    else delete next[id];
                    return next;
                  })
                }
                onArchiveToggle={async (questionId, nextActive) => {
                  await archiveM.mutateAsync({ questionId, isActive: nextActive });
                }}
                onAssignRequest={openSingleAssign}
                onEdit={(id) => {
                  setEditorQuestionId(id);
                  setEditorOpen(true);
                }}
                onShowUsage={(id) => setUsageQuestionId(id)}
              />
            ))}
          </div>
        )}
      </div>

      {(archiveM.isPending || assignM.isPending || createM.isPending) && (
        <div className="mt-3 text-xs text-muted-foreground">Saving…</div>
      )}

      <QuestionEditorDrawer
        open={editorOpen}
        questionId={editorQuestionId}
        categories={categories}
        onClose={() => {
          setEditorOpen(false);
          setEditorQuestionId(null);
        }}
      />

      <ModuleUsageModal
        open={usageQuestionId != null}
        questionId={usageQuestionId}
        onClose={() => setUsageQuestionId(null)}
      />

      <AssignToModuleDialog
        open={assignDialogOpen}
        onClose={() => {
          setAssignDialogOpen(false);
          setAssignQuestionIds([]);
        }}
        questionIds={assignQuestionIds}
        onAssign={async (args) => assignM.mutateAsync(args)}
      />
    </div>
  );
}
