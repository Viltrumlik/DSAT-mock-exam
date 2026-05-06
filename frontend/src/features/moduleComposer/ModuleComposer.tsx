"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuestionBankCategories, useQuestionBankModules, useQuestionBankTests } from "@/features/questionBank/hooks";
import { useModuleQuestionsQuery, useReorderModuleQuestion } from "@/features/questionsAdmin/hooks";
import type { AdminModuleQuestion } from "@/features/questionsAdmin/types";
import type { AdminStandaloneQuestion } from "@/features/questionBank/types";
import type { SubjectFilter } from "@/features/questionBank/types";
import { normalizeApiError } from "@/lib/apiError";
import { PAGE_SIZE, useComposerAssign, useComposerBankQuery, useComposerUnlink } from "./hooks";

function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function ModuleComposer(props: { testId: number; moduleId: number }) {
  const { testId, moduleId } = props;

  const testsQ = useQuestionBankTests();
  const catsQ = useQuestionBankCategories();
  const modulesQ = useQuestionBankModules(testId);

  const tests = testsQ.data || [];
  const testMeta = useMemo(() => tests.find((t) => t.id === testId), [tests, testId]);

  const subjectFilter: SubjectFilter = useMemo(() => {
    const s = (testMeta as { subject?: string } | undefined)?.subject;
    if (s === "MATH") return "MATH";
    return "READING_WRITING";
  }, [testMeta]);

  const [categoryId, setCategoryId] = useState<number | "all">("all");
  const [searchRaw, setSearchRaw] = useState("");
  const debouncedQ = useDebouncedValue(searchRaw.trim(), 300);
  const [bankOffset, setBankOffset] = useState(0);

  useEffect(() => {
    setBankOffset(0);
  }, [debouncedQ, categoryId, subjectFilter, moduleId]);

  const bankQ = useComposerBankQuery({
    enabled: Boolean(testMeta),
    excludeModuleId: moduleId,
    subject: subjectFilter,
    categoryId,
    q: debouncedQ,
    offset: bankOffset,
  });

  const moduleQ = useModuleQuestionsQuery(testId, moduleId);
  const reorderM = useReorderModuleQuestion(testId, moduleId);
  const assignM = useComposerAssign(testId, moduleId);
  const unlinkM = useComposerUnlink(testId, moduleId);

  const categories = catsQ.data || [];
  const bankRows = bankQ.data || [];
  const moduleQuestions = moduleQ.data || [];

  const modulesForTest = modulesQ.data || [];
  const modRow = useMemo(
    () => modulesForTest.find((m) => m.id === moduleId) as
      | { id: number; module_order: number; time_limit_minutes?: number }
      | undefined,
    [modulesForTest, moduleId],
  );

  const stats = useMemo(() => {
    const n = moduleQuestions.length;
    const pts = moduleQuestions.reduce((s, q) => s + (typeof q.score === "number" ? q.score : 0), 0);
    const mins = modRow?.time_limit_minutes;
    return { n, pts, mins };
  }, [moduleQuestions, modRow]);

  const hasMoreBank = bankRows.length === PAGE_SIZE;

  const onAdd = async (q: AdminStandaloneQuestion) => {
    if (!q.is_active || q.status !== "approved") return;
    try {
      await assignM.mutateAsync(q.id);
    } catch (e) {
      window.alert(normalizeApiError(e).message);
    }
  };

  const onUnlink = async (q: AdminModuleQuestion) => {
    try {
      await unlinkM.mutateAsync(q.id);
    } catch (e) {
      window.alert(normalizeApiError(e).message);
    }
  };

  const onMove = (questionId: number, action: "up" | "down") => {
    reorderM.mutate({ questionId, action });
  };

  const busy = assignM.isPending || unlinkM.isPending || reorderM.isPending;

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4 lg:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border bg-card lg:max-w-[50%]">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-bold">Question bank</h2>
          <p className="text-xs text-muted-foreground">Add reusable questions ({subjectFilter}). Excludes items already in this module.</p>
        </div>
        <div className="space-y-2 border-b border-border px-3 py-2">
          <input
            className="w-full rounded border px-2 py-1.5 text-sm"
            placeholder="Search (debounced)…"
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
          />
          <select
            className="w-full rounded border px-2 py-1.5 text-sm"
            value={categoryId === "all" ? "all" : String(categoryId)}
            onChange={(e) => {
              const v = e.target.value;
              setCategoryId(v === "all" ? "all" : Number(v));
            }}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.subject ? `[${c.subject}] ${c.name}` : c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {!testMeta ? (
            <p className="text-sm text-muted-foreground">Loading test…</p>
          ) : bankQ.isLoading && bankOffset === 0 ? (
            <p className="text-sm text-muted-foreground">Loading bank…</p>
          ) : bankQ.isError ? (
            <p className="text-sm text-red-600">Could not load bank.</p>
          ) : bankRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matching questions (or all already in this module).</p>
          ) : (
            <ul className="space-y-2">
              {bankRows.map((q) => (
                <li key={q.id} className="rounded border border-border p-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{(q.question_text || "").slice(0, 120) || "—"}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        #{q.id} · {q.question_type} · score {typeof q.score === "number" ? q.score : "—"}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy || q.is_active === false || q.status !== "approved"}
                      title={
                        q.is_active === false
                          ? "Inactive — activate in bank first."
                          : q.status !== "approved"
                            ? "Only approved questions can enter modules."
                            : "Add to module"
                      }
                      className="shrink-0 rounded border bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                      onClick={() => void onAdd(q)}
                    >
                      Add
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {hasMoreBank ? (
            <button
              type="button"
              className="mt-3 w-full rounded border py-2 text-sm font-semibold"
              disabled={bankQ.isFetching}
              onClick={() => setBankOffset((o) => o + PAGE_SIZE)}
            >
              {bankQ.isFetching ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </div>
      </section>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border bg-card">
        <div className="border-b border-border px-3 py-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold">Module composition</h2>
              <p className="text-xs text-muted-foreground">
                Test #{testId} · Module #{moduleId}
                {modRow ? ` · slot ${modRow.module_order}` : null}
              </p>
            </div>
            <Link href="/questions/bank" className="text-xs font-semibold underline">
              Open bank home
            </Link>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
            <div
              className="rounded border bg-muted/40 px-2 py-1"
              title="Number of questions currently linked to this module."
            >
              <div className="font-semibold text-muted-foreground">Questions</div>
              <div className="text-lg font-bold tabular-nums">{stats.n}</div>
            </div>
            <div
              className="rounded border bg-muted/40 px-2 py-1"
              title="Sum of point values from module questions (when scores are present)."
            >
              <div className="font-semibold text-muted-foreground">Score total</div>
              <div className="text-lg font-bold tabular-nums">{stats.pts}</div>
            </div>
            <div
              className="rounded border bg-muted/40 px-2 py-1"
              title="Timer cap for this module during attempts, from module settings. Not an estimated sum per question."
            >
              <div className="font-semibold text-muted-foreground">Module time limit</div>
              <div className="text-lg font-bold tabular-nums">{stats.mins != null ? `${stats.mins} min` : "—"}</div>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {moduleQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading module…</p>
          ) : moduleQ.isError ? (
            <p className="text-sm text-red-600">Could not load module questions.</p>
          ) : moduleQuestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No questions yet — add from the bank.</p>
          ) : (
            <ul className="space-y-2">
              {moduleQuestions.map((q, i) => (
                <li key={q.id} className="flex gap-2 rounded border border-border p-2 text-sm">
                  <div className="w-8 shrink-0 pt-1 text-xs tabular-nums text-muted-foreground">{q.order}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{(q.question_text || "").slice(0, 200) || "—"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      #{q.id} · {q.question_type} · {typeof q.score === "number" ? `${q.score} pts` : ""}
                      {q.is_active === false ? " · archived" : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      className="rounded border px-2 py-0.5 text-xs disabled:opacity-40"
                      disabled={busy || i === 0}
                      onClick={() => onMove(q.id, "up")}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="rounded border px-2 py-0.5 text-xs disabled:opacity-40"
                      disabled={busy || i >= moduleQuestions.length - 1}
                      onClick={() => onMove(q.id, "down")}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="rounded border border-destructive/40 px-2 py-0.5 text-xs text-destructive disabled:opacity-40"
                      disabled={busy}
                      onClick={() => void onUnlink(q)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
