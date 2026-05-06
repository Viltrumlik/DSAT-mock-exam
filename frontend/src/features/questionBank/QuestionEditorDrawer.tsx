"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useApproveStandaloneQuestion,
  usePatchStandaloneQuestion,
  useRejectStandaloneQuestion,
  useStandaloneQuestion,
  useSubmitStandaloneQuestionForReview,
} from "./hooks";
import type { AdminCategory, AdminStandaloneQuestion } from "./types";
import { useMe } from "@/hooks/useMe";
import { normalizeApiError } from "@/lib/apiError";

const HEAVY_USAGE_THRESHOLD = 8;

function canPublishRole(roleRaw: unknown): boolean {
  const r = String(roleRaw ?? "").trim().toLowerCase();
  return r === "admin" || r === "super_admin";
}

type Draft = {
  question_type: string;
  question_text: string;
  question_prompt: string;
  explanation: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  category: number | null;
  is_math_input: boolean;
  score: number;
  is_active: boolean;
};

function emptyDraft(): Draft {
  return {
    question_type: "READING",
    question_text: "",
    question_prompt: "",
    explanation: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct_answer: "A",
    category: null,
    is_math_input: false,
    score: 10,
    is_active: true,
  };
}

export default function QuestionEditorDrawer(props: {
  open: boolean;
  questionId: number | null;
  categories: AdminCategory[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { me } = useMe();
  const canPublish = useMemo(() => canPublishRole(me?.role), [me?.role]);

  const detailQ = useStandaloneQuestion(props.questionId, props.open && props.questionId != null);
  const patchM = usePatchStandaloneQuestion();
  const submitM = useSubmitStandaloneQuestionForReview();
  const approveM = useApproveStandaloneQuestion();
  const rejectM = useRejectStandaloneQuestion();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [rejectNote, setRejectNote] = useState("");

  const row = detailQ.data as AdminStandaloneQuestion | undefined;
  const status = row?.status ?? "draft";
  const usageN = typeof row?.usage_count === "number" ? row.usage_count : 0;
  const heavilyUsed = usageN >= HEAVY_USAGE_THRESHOLD;

  useEffect(() => {
    if (!props.open || !detailQ.data) return;
    const d = detailQ.data as AdminStandaloneQuestion & { correct_answer?: string };
    setDraft({
      question_type: d.question_type || "READING",
      question_text: d.question_text || "",
      question_prompt: d.question_prompt || "",
      explanation: d.explanation || "",
      option_a: d.option_a ?? "",
      option_b: d.option_b ?? "",
      option_c: d.option_c ?? "",
      option_d: d.option_d ?? "",
      correct_answer: (d.correct_answer || "").trim() || "A",
      category: d.category ?? null,
      is_math_input: Boolean(d.is_math_input),
      score: typeof d.score === "number" ? d.score : 10,
      is_active: d.is_active !== false,
    });
    setRejectNote("");
  }, [props.open, detailQ.data]);

  const set = <K extends keyof Draft>(key: K, val: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: val }));

  const save = async () => {
    if (!props.questionId) return;
    if (heavilyUsed) {
      const ok = window.confirm(
        `This question is linked in ${usageN} module place(s). Save content changes anyway?`,
      );
      if (!ok) return;
    }
    await patchM.mutateAsync({
      questionId: props.questionId,
      data: {
        question_type: draft.question_type,
        question_text: draft.question_text,
        question_prompt: draft.question_prompt,
        explanation: draft.explanation,
        option_a: draft.option_a,
        option_b: draft.option_b,
        option_c: draft.option_c,
        option_d: draft.option_d,
        correct_answer: draft.correct_answer,
        category: draft.category,
        is_math_input: draft.is_math_input,
        score: draft.score,
        is_active: draft.is_active,
      },
    });
    props.onSaved?.();
    props.onClose();
  };

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      window.alert(normalizeApiError(e).message);
    }
  };

  if (!props.open || props.questionId == null) return null;

  const reviewBusy = submitM.isPending || approveM.isPending || rejectM.isPending;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-xl flex-col bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">Edit question #{props.questionId}</div>
          <button type="button" className="text-sm underline" onClick={props.onClose}>
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {detailQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : detailQ.isError ? (
            <div className="text-sm text-red-600">Failed to load question.</div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="rounded border bg-muted/30 px-3 py-2 text-xs">
                <div className="font-semibold capitalize">Status: {status.replace("_", " ")}</div>
                {usageN > 0 ? (
                  <div className="mt-1 text-muted-foreground">
                    Module usage: <span className="font-medium text-foreground">{usageN}</span> link(s)
                  </div>
                ) : (
                  <div className="mt-1 text-muted-foreground">Not used in any module yet.</div>
                )}
                {row?.review_comment ? (
                  <div className="mt-2 border-t border-border pt-2 text-amber-900 dark:text-amber-200">
                    <span className="font-semibold">Reviewer note: </span>
                    {row.review_comment}
                  </div>
                ) : null}
                {row?.updated_at ? (
                  <div className="mt-1 text-muted-foreground">
                    Updated {new Date(row.updated_at).toLocaleString()}
                    {row.updated_by?.email ? ` · ${row.updated_by.email}` : ""}
                  </div>
                ) : null}
              </div>

              {heavilyUsed ? (
                <div
                  className="rounded border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
                  role="status"
                >
                  Heavily used in modules ({usageN}). Edits affect every live exam that references this
                  question; double-check before saving.
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {status === "draft" ? (
                  <button
                    type="button"
                    disabled={reviewBusy}
                    className="rounded border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                    onClick={() =>
                      void run(async () => {
                        await submitM.mutateAsync(props.questionId!);
                      })
                    }
                  >
                    Submit for review
                  </button>
                ) : null}

                {status === "review" ? (
                  <>
                    {canPublish ? (
                      <div className="flex w-full flex-col gap-2 rounded border border-border p-2">
                        <div className="text-xs font-semibold">Publisher actions</div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={reviewBusy}
                            className="rounded border border-emerald-600/50 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                            onClick={() =>
                              void run(async () => {
                                await approveM.mutateAsync(props.questionId!);
                              })
                            }
                          >
                            Approve
                          </button>
                        </div>
                        <label className="block text-xs">
                          <span className="font-semibold">Reject (back to draft)</span>
                          <textarea
                            className="mt-1 w-full rounded border px-2 py-1.5 text-xs"
                            rows={2}
                            placeholder="Optional feedback for the author…"
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={reviewBusy}
                          className="self-start rounded border border-destructive/50 px-3 py-1.5 text-xs font-semibold text-destructive disabled:opacity-50"
                          onClick={() =>
                            void run(async () => {
                              await rejectM.mutateAsync({
                                questionId: props.questionId!,
                                comment: rejectNote,
                              });
                            })
                          }
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        In review — only an admin or super admin can approve or reject.
                      </p>
                    )}
                  </>
                ) : null}
              </div>

              <label className="block">
                <span className="text-xs font-semibold">Type</span>
                <select
                  className="mt-1 w-full rounded border px-2 py-2"
                  value={draft.question_type}
                  onChange={(e) => set("question_type", e.target.value)}
                >
                  <option value="READING">Reading</option>
                  <option value="WRITING">Writing</option>
                  <option value="MATH">Math</option>
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-semibold">Category</span>
                <select
                  className="mt-1 w-full rounded border px-2 py-2"
                  value={draft.category != null ? String(draft.category) : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    set("category", v === "" ? null : Number(v));
                  }}
                >
                  <option value="">None</option>
                  {props.categories.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.subject ? `[${c.subject}] ${c.name}` : c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-semibold">Stem</span>
                <textarea
                  className="mt-1 min-h-[72px] w-full rounded border px-2 py-2 font-mono text-xs"
                  value={draft.question_text}
                  onChange={(e) => set("question_text", e.target.value)}
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold">Prompt (optional)</span>
                <textarea
                  className="mt-1 min-h-[48px] w-full rounded border px-2 py-2 text-xs"
                  value={draft.question_prompt}
                  onChange={(e) => set("question_prompt", e.target.value)}
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                {(["option_a", "option_b", "option_c", "option_d"] as const).map((k, i) => (
                  <label key={k} className="block">
                    <span className="text-xs font-semibold">Option {String.fromCharCode(65 + i)}</span>
                    <textarea
                      className="mt-1 min-h-[40px] w-full rounded border px-2 py-1 text-xs"
                      value={draft[k]}
                      onChange={(e) => set(k, e.target.value)}
                    />
                  </label>
                ))}
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.is_math_input}
                  onChange={(e) => set("is_math_input", e.target.checked)}
                />
                <span className="text-xs font-semibold">Math input (typed answer)</span>
              </label>

              <label className="block">
                <span className="text-xs font-semibold">
                  {draft.is_math_input ? "Correct answers (comma-separated)" : "Correct letter"}
                </span>
                <input
                  className="mt-1 w-full rounded border px-2 py-2 font-mono text-xs"
                  value={draft.correct_answer}
                  onChange={(e) => set("correct_answer", e.target.value)}
                  placeholder={draft.is_math_input ? "e.g. 2, 1/2" : "A / B / C / D"}
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold">Explanation</span>
                <textarea
                  className="mt-1 min-h-[64px] w-full rounded border px-2 py-2 text-xs"
                  value={draft.explanation}
                  onChange={(e) => set("explanation", e.target.value)}
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs font-semibold">Score</span>
                  <input
                    type="number"
                    className="mt-1 w-full rounded border px-2 py-2"
                    value={draft.score}
                    onChange={(e) => set("score", Number(e.target.value) || 0)}
                  />
                </label>
                <label className="flex items-end gap-2 pb-1">
                  <input
                    type="checkbox"
                    checked={draft.is_active}
                    onChange={(e) => set("is_active", e.target.checked)}
                  />
                  <span className="text-xs font-semibold">Active</span>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                Archiving sets lifecycle to archived. Unarchiving returns the item to draft for a new review
                cycle.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button type="button" className="rounded border px-3 py-2 text-sm" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded border bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
            disabled={patchM.isPending || detailQ.isLoading || !detailQ.data}
            onClick={() => void save()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
