"use client";

import { useId, useMemo } from "react";
import { CONTROL, FIELD_LABEL, HINT } from "@/features/questionsAdmin/questionLook";
import {
  parseJson,
  type AssessmentQuestionEditorDraft,
} from "@/features/assessments/components/assessmentQuestionEditorShared";

// ─── Numeric ──────────────────────────────────────────────────────────────────

export function NumericEditor({
  draft,
  onPatch,
  disabled,
}: {
  draft: AssessmentQuestionEditorDraft;
  onPatch: (p: Partial<AssessmentQuestionEditorDraft>) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const gradingObj = useMemo(
    () => parseJson<Record<string, unknown>>(draft.gradingConfigText, {}),
    [draft.gradingConfigText],
  );
  const toleranceRaw = gradingObj.tolerance;
  const toleranceStr =
    typeof toleranceRaw === "number" && Number.isFinite(toleranceRaw)
      ? String(toleranceRaw)
      : typeof toleranceRaw === "string" ? toleranceRaw : "";

  const setGradingPatch = (patch: Record<string, unknown>) => {
    const next = { ...gradingObj, ...patch };
    if (next.tolerance === "" || next.tolerance === null || typeof next.tolerance === "undefined")
      delete next.tolerance;
    onPatch({ gradingConfigText: JSON.stringify(next, null, 2) });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={`${id}-value`} className={FIELD_LABEL}>
          Correct value(s)
        </label>
        <input
          id={`${id}-value`}
          className={CONTROL}
          disabled={disabled}
          type="text"
          placeholder="e.g. 42, 3.14, 1/2 — or 10.25, 21/2"
          value={(() => {
            try {
              const parsed = JSON.parse(draft.correctAnswerText);
              if (parsed === null || parsed === undefined) return "";
              // A list = several acceptable answers; show them comma-separated.
              if (Array.isArray(parsed)) return parsed.map((x) => String(x)).join(", ");
              return String(parsed);
            } catch {
              return draft.correctAnswerText ?? "";
            }
          })()}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw.trim() === "") {
              onPatch({ correctAnswerText: JSON.stringify(null) });
              return;
            }
            // Preserve the raw text (commas, partial typing like "3." or "1/") so the
            // field types smoothly. On save the backend splits comma-separated values
            // into a list of acceptable answers and coerces each to a number/fraction.
            onPatch({ correctAnswerText: JSON.stringify(raw) });
          }}
        />
        <p className={HINT}>
          Separate multiple accepted answers with commas (e.g. <span className="font-ms-mono">10.25, 21/2</span>).
        </p>
      </div>
      <div>
        <label htmlFor={`${id}-tolerance`} className={FIELD_LABEL}>
          Tolerance (±)
        </label>
        <input
          id={`${id}-tolerance`}
          className={CONTROL}
          disabled={disabled}
          type="text"
          inputMode="decimal"
          placeholder="0"
          value={toleranceStr}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              const next = { ...gradingObj };
              delete next.tolerance;
              onPatch({ gradingConfigText: JSON.stringify(next, null, 2) });
            } else if (!Number.isNaN(Number(raw))) {
              setGradingPatch({ tolerance: Number(raw) });
            }
          }}
        />
      </div>
    </div>
  );
}
