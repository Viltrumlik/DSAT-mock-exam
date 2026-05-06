"use client";

import { useMemo } from "react";
import type { AdminCategory, AdminStandaloneQuestion } from "./types";

export default function QuestionRow(props: {
  q: AdminStandaloneQuestion;
  categories: AdminCategory[];
  selected: boolean;
  onSelectChange: (id: number, selected: boolean) => void;
  onArchiveToggle: (questionId: number, nextActive: boolean) => Promise<void>;
  onAssignRequest: (questionId: number) => void;
  onEdit: (questionId: number) => void;
  onShowUsage: (questionId: number) => void;
}) {
  const preview = useMemo(() => {
    const s = (props.q.question_text || "").trim();
    if (!s) return "(empty)";
    return s.length > 140 ? `${s.slice(0, 140)}…` : s;
  }, [props.q.question_text]);

  const catLabel = useMemo(() => {
    const cid = props.q.category as number | undefined;
    if (!cid) return "";
    const c = props.categories.find((x) => x.id === cid);
    if (!c) return `Category #${cid}`;
    return c.subject ? `[${c.subject}] ${c.name}` : c.name;
  }, [props.q, props.categories]);

  const usageN = typeof props.q.usage_count === "number" ? props.q.usage_count : 0;
  const st = props.q.status ?? (props.q.is_active ? "approved" : "archived");
  const canAssign = props.q.is_active && st === "approved";

  const lifecycleClass =
    st === "approved"
      ? "bg-emerald-50 text-emerald-800"
      : st === "review"
        ? "bg-blue-50 text-blue-900"
        : st === "draft"
          ? "bg-slate-100 text-slate-800"
          : "bg-amber-50 text-amber-900";

  return (
    <div className="flex items-start gap-3 border-b py-3">
      <input
        type="checkbox"
        className="mt-2"
        checked={props.selected}
        onChange={(e) => props.onSelectChange(props.q.id, e.target.checked)}
        aria-label={`Select question ${props.q.id}`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-2 py-0.5">{props.q.question_type}</span>
          <span className={`rounded px-2 py-0.5 capitalize ${lifecycleClass}`}>{st.replace("_", " ")}</span>
          {props.q.is_active ? (
            <span className="rounded bg-green-50 px-2 py-0.5 text-green-700">Active</span>
          ) : (
            <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-800">Inactive</span>
          )}
          {catLabel ? <span className="truncate">Category: {catLabel}</span> : <span>No category</span>}
          {usageN > 0 ? (
            <button type="button" className="underline" onClick={() => props.onShowUsage(props.q.id)}>
              Used in {usageN} module(s)
            </button>
          ) : (
            <span>Not in any module</span>
          )}
        </div>

        <div className="mt-2 text-sm font-medium">{preview}</div>
        {props.q.question_prompt ? (
          <div className="mt-1 text-xs text-muted-foreground">
            Prompt: {(props.q.question_prompt || "").slice(0, 180)}
            {(props.q.question_prompt || "").length > 180 ? "…" : ""}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-2">
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canAssign}
          title={
            canAssign
              ? undefined
              : "Only approved and active questions can be assigned to a module."
          }
          onClick={() => canAssign && props.onAssignRequest(props.q.id)}
        >
          Assign
        </button>
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm"
          onClick={async () => props.onArchiveToggle(props.q.id, !props.q.is_active)}
        >
          {props.q.is_active ? "Archive" : "Unarchive"}
        </button>
        <button type="button" className="rounded border px-3 py-1.5 text-sm" onClick={() => props.onEdit(props.q.id)}>
          Edit
        </button>
      </div>
    </div>
  );
}
