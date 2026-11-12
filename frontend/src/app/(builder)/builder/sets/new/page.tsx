"use client";

/**
 * /builder/sets/new — Create assessment set. In the console's look (design handoff v0.3, PR 17a): the same
 * fields in the same order, the same two checks, the same payload; then the new set opens.
 */

import { Suspense, useId, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useUpsertAssessmentSet } from "@/features/assessments/hooks";
import type { Subject } from "@/features/assessments/types";
import { AssessmentCategorySelect } from "@/features/assessments/components/AssessmentCategorySelect";
import { FIELD, FIELD_LABEL, LibraryError } from "@/features/builderLibrary/sectionParts";
import { Button, inputShell } from "@/features/console/ui";
import { normalizeApiError } from "@/lib/apiError";
import { allowedSourcesForSubject, reconcileSource, sourceLabel } from "@/lib/assessmentSources";
import { getSubject } from "@/lib/permissions";
import {
  levelsForSubject,
  levelLabel,
  reconcileSecondaryLevel,
  secondaryLevelOptions,
  setLevelsLabel,
  type LevelKey,
} from "@/lib/levels";

/** A value the drill-down fixed: shown, not editable. */
const LOCKED = inputShell({ readOnly: true, className: "w-full text-ms-fg-2" });
const AREA = inputShell({ area: true, className: "w-full outline-none placeholder:text-ms-fg-3" });
const SUBJECT_LABELS: Record<string, string> = { math: "Math", english: "English" };

function FormField({ id, label, children }: { id?: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      {id ? (
        <label htmlFor={id} className={FIELD_LABEL}>
          {label}
        </label>
      ) : (
        <p className={FIELD_LABEL}>{label}</p>
      )}
      {children}
    </div>
  );
}

function NewAssessmentSetForm() {
  const router = useRouter();
  const upsert = useUpsertAssessmentSet();
  const subj = getSubject();
  const params = useSearchParams();
  const id = useId();

  // Subject+level come from the builder drill-down (?subject=&level=). A teacher is also
  // locked to their own subject. When they arrive from a bucket, both are fixed so the new
  // set lands where the admin was standing.
  const rawSubject = params.get("subject");
  const validSubject: Subject | null =
    rawSubject === "math" || rawSubject === "english" ? rawSubject : null;
  const effSubject: Subject = (subj || validSubject || "math") as Subject;
  const rawLevel = params.get("level");
  const validLevel: string | null =
    validSubject && rawLevel && levelsForSubject(effSubject).includes(rawLevel as LevelKey)
      ? rawLevel
      : null;
  const lockedSubject = Boolean(subj) || Boolean(validSubject);
  const lockedLevel = Boolean(validLevel);

  const [form, setForm] = useState<{
    subject: Subject;
    source: string;
    level: string;
    /** OPTIONAL second cohort (2026-10-11, the school's request). "" = primary only. */
    secondary_level: string;
    category: string;
    title: string;
    description: string;
    is_active: boolean;
  }>({
    subject: effSubject,
    source: "",
    level: validLevel ?? "",
    secondary_level: "",
    category: "",
    title: "",
    description: "",
    is_active: true,
  });
  const [error, setError] = useState<string | null>(null);

  const sourceOptions = allowedSourcesForSubject(form.subject, [form.level, form.secondary_level]);
  const levelOptions = levelsForSubject(form.subject);
  const secondaryOptions = secondaryLevelOptions(form.subject, form.level);

  const save = async () => {
    setError(null);
    if (!form.source) {
      setError("Please choose a source for this set.");
      return;
    }
    if (!form.level) {
      setError("Please choose a level for this set.");
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
    <section aria-labelledby={`${id}-title`} className="animate-ms-card-in rounded-ms-card bg-ms-card p-5 shadow-ms-1 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 id={`${id}-title`} className="font-ms-display text-ms-b-display text-ms-fg">
            Create assessment set
          </h1>
          <p className="mt-1 text-[14px] text-ms-fg-2">
            {lockedLevel
              ? `New ${SUBJECT_LABELS[form.subject]} · ${setLevelsLabel(form.level, form.secondary_level)} set — then add questions.`
              : "Draft a set, then add questions."}
          </p>
        </div>
        <Button
          variant="primary"
          icon="check"
          state={upsert.isPending ? "busy" : "idle"}
          busyLabel="Saving…"
          disabled={upsert.isPending}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>

      {error ? (
        <div className="mt-4">
          <LibraryError>
            <strong className="font-semibold">Error</strong> · {error}
          </LibraryError>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField id={lockedSubject ? undefined : `${id}-subject`} label="Subject">
            {lockedSubject ? (
              <div className={LOCKED}>{SUBJECT_LABELS[form.subject] ?? form.subject}</div>
            ) : (
              <select
                id={`${id}-subject`}
                className={FIELD}
                value={form.subject}
                onChange={(e) => {
                  const subject = e.target.value as Subject;
                  // Reset source/level if they aren't valid for the newly-selected subject
                  // (e.g. English has no Foundation level).
                  const sourceOk = allowedSourcesForSubject(subject).includes(form.source as never);
                  const levelOk = levelsForSubject(subject).includes(form.level as never);
                  const level = levelOk ? form.level : "";
                  setForm({
                    ...form,
                    subject,
                    source: sourceOk ? form.source : "",
                    level,
                    // The second level follows the same rule (and is cleared with the
                    // primary — it never stands alone).
                    secondary_level: reconcileSecondaryLevel(subject, level, form.secondary_level),
                  });
                }}
              >
                <option value="math">Math</option>
                <option value="english">English</option>
              </select>
            )}
          </FormField>
          <FormField id={`${id}-active`} label="Active">
            <select
              id={`${id}-active`}
              className={FIELD}
              value={String(form.is_active)}
              onChange={(e) => setForm({ ...form, is_active: e.target.value === "true" })}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField id={`${id}-source`} label="Source *">
            <select
              id={`${id}-source`}
              className={FIELD}
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            >
              <option value="">Select a source…</option>
              {sourceOptions.map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id={lockedLevel ? undefined : `${id}-level`} label="Level *">
            {lockedLevel ? (
              <div className={LOCKED}>{levelLabel(form.level)}</div>
            ) : (
              <select
                id={`${id}-level`}
                className={FIELD}
                value={form.level}
                onChange={(e) => {
                  const level = e.target.value;
                  // Blanking the primary, or moving it onto the second level, clears the
                  // second level — the server would reject either pair. A Foundation
                  // homework source goes too once no level is Foundation.
                  const secondary_level = reconcileSecondaryLevel(form.subject, level, form.secondary_level);
                  setForm({
                    ...form,
                    level,
                    secondary_level,
                    source: reconcileSource(form.subject, form.source, [level, secondary_level]),
                  });
                }}
              >
                <option value="">Select a level…</option>
                {levelOptions.map((l) => (
                  <option key={l} value={l}>
                    {levelLabel(l)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>

        {/* Optional second level (2026-10-11, the school's request): the set is shown to
            two cohorts at once. Sits under Level, which it extends. Never required, and
            editable even when the primary is fixed by the ?level= bucket — a set made from
            the Junior bucket can still also be for Middle. */}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-start-2">
            <FormField id={`${id}-second`} label="Second level (optional)">
              <select
                id={`${id}-second`}
                className={FIELD}
                value={form.secondary_level}
                disabled={!form.level}
                onChange={(e) => {
                  const secondary_level = e.target.value;
                  setForm({
                    ...form,
                    secondary_level,
                    source: reconcileSource(form.subject, form.source, [form.level, secondary_level]),
                  });
                }}
              >
                <option value="">None</option>
                {secondaryOptions.map((l) => (
                  <option key={l} value={l}>
                    {levelLabel(l)}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </div>

        <FormField id={`${id}-name`} label="Title">
          <input id={`${id}-name`} className={FIELD} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </FormField>
        <FormField id={`${id}-category`} label="Category">
          <AssessmentCategorySelect
            id={`${id}-category`}
            subject={form.subject}
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v })}
            className={FIELD}
          />
        </FormField>
        <FormField id={`${id}-description`} label="Description">
          <textarea
            id={`${id}-description`}
            className={`${AREA} min-h-[110px]`}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </FormField>
      </div>
    </section>
  );
}

export default function NewAssessmentSetPage() {
  return (
    <Suspense fallback={null}>
      <NewAssessmentSetForm />
    </Suspense>
  );
}
