"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUpsertAssessmentSet } from "@/features/assessments/hooks";
import type { Subject } from "@/features/assessments/types";
import { normalizeApiError } from "@/lib/apiError";
import { getSubject } from "@/lib/permissions";
import { AssessmentCategorySelect } from "@/features/assessments/components/AssessmentCategorySelect";
import { allowedSourcesForSubject, sourceLabel } from "@/lib/assessmentSources";

const INPUT =
  "ui-input w-full rounded-xl border border-border bg-surface-2/80 px-3 py-2 text-sm shadow-sm";

export default function NewAssessmentSetPage() {
  const router = useRouter();
  const upsert = useUpsertAssessmentSet();
  const subj = getSubject();

  const [form, setForm] = useState<{
    subject: Subject;
    source: string;
    category: string;
    title: string;
    description: string;
    is_active: boolean;
  }>({
    subject: subj || "math",
    source: "",
    category: "",
    title: "",
    description: "",
    is_active: true,
  });
  const [error, setError] = useState<string | null>(null);

  const sourceOptions = allowedSourcesForSubject(form.subject);

  const save = async () => {
    setError(null);
    if (!form.source) {
      setError("Please choose a source for this set.");
      return;
    }
    try {
      const created = await upsert.mutateAsync({ id: null, payload: form });
      router.push(`/builder/sets/${created.id}`);
    } catch (e) {
      const ax = normalizeApiError(e);
      setError(ax.message);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold text-foreground">Create assessment set</p>
          <p className="mt-1 text-sm text-muted-foreground">Draft a set, then add questions.</p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={upsert.isPending}
          className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-extrabold hover:bg-primary/15 disabled:opacity-50"
        >
          {upsert.isPending ? "Saving…" : "Save"}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-border bg-surface-2 p-4">
          <p className="text-sm font-extrabold text-foreground">Error</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-label-foreground">Subject</p>
            <select
              className={INPUT}
              value={form.subject}
              onChange={(e) => {
                const subject = e.target.value as Subject;
                // Reset source if it isn't valid for the newly-selected subject.
                const stillValid = allowedSourcesForSubject(subject).includes(form.source as never);
                setForm({ ...form, subject, source: stillValid ? form.source : "" });
              }}
              disabled={Boolean(subj)}
            >
              <option value="math">math</option>
              <option value="english">english</option>
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-label-foreground">Active</p>
            <select
              className={INPUT}
              value={String(form.is_active)}
              onChange={(e) => setForm({ ...form, is_active: e.target.value === "true" })}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-label-foreground">Source *</p>
          <select
            className={INPUT}
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
          >
            <option value="">Select a source…</option>
            {sourceOptions.map((s) => (
              <option key={s} value={s}>{sourceLabel(s)}</option>
            ))}
          </select>
        </div>

        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-label-foreground">Title</p>
          <input className={INPUT} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-label-foreground">Category</p>
          <AssessmentCategorySelect
            subject={form.subject}
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v })}
            className={INPUT}
          />
        </div>
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-label-foreground">Description</p>
          <textarea
            className={`${INPUT} min-h-[110px]`}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

