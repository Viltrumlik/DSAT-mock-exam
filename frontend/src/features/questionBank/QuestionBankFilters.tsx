"use client";

import type {
  ActiveFilter,
  AdminCategory,
  LifecycleStatusFilter,
  SubjectFilter,
} from "./types";

export default function QuestionBankFilters(props: {
  q: string;
  onQChange: (v: string) => void;
  categoryId: number | "all";
  onCategoryChange: (v: number | "all") => void;
  subject: SubjectFilter;
  onSubjectChange: (v: SubjectFilter) => void;
  isActive: ActiveFilter;
  onIsActiveChange: (v: ActiveFilter) => void;
  lifecycleStatus: LifecycleStatusFilter;
  onLifecycleStatusChange: (v: LifecycleStatusFilter) => void;
  categories: AdminCategory[];
}) {
  return (
    <div className="space-y-3 rounded border p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4 lg:grid-cols-5">
        <div className="md:col-span-2 lg:col-span-2">
          <label className="text-xs font-semibold">Search</label>
          <input
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={props.q}
            onChange={(e) => props.onQChange(e.target.value)}
            placeholder="Search question text / prompt / explanation…"
          />
        </div>

        <div>
          <label className="text-xs font-semibold">Subject</label>
          <select
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={props.subject}
            onChange={(e) => props.onSubjectChange(e.target.value as SubjectFilter)}
          >
            <option value="all">All</option>
            <option value="MATH">Math</option>
            <option value="READING_WRITING">Reading & Writing</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold">Active</label>
          <select
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={props.isActive}
            onChange={(e) => props.onIsActiveChange(e.target.value as ActiveFilter)}
          >
            <option value="all">All</option>
            <option value="1">Active only</option>
            <option value="0">Archived only</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold">Lifecycle</label>
          <select
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={props.lifecycleStatus}
            onChange={(e) => props.onLifecycleStatusChange(e.target.value as LifecycleStatusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="review">In review</option>
            <option value="approved">Approved</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="text-xs font-semibold">Category</label>
          <select
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
            value={props.categoryId === "all" ? "all" : String(props.categoryId)}
            onChange={(e) => {
              const v = e.target.value;
              props.onCategoryChange(v === "all" ? "all" : Number(v));
            }}
          >
            <option value="all">All</option>
            {props.categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.subject ? `[${c.subject}] ` : ""}{c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

