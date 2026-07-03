"use client";

import { useMemo } from "react";
import { STUDIO_FIELD_LABEL, STUDIO_INPUT } from "@/components/studio/primitives";
import {
  parseJson,
  type AssessmentQuestionEditorDraft,
} from "@/features/assessments/components/assessmentQuestionEditorShared";

const INPUT = STUDIO_INPUT;
const LABEL = STUDIO_FIELD_LABEL;

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
        <label className={LABEL}>Correct value</label>
        <input
          className={INPUT}
          disabled={disabled}
          type="text"
          inputMode="decimal"
          placeholder="e.g. 42, 3.14, or 1/2"
          value={(() => {
            try {
              const parsed = JSON.parse(draft.correctAnswerText);
              if (parsed === null || parsed === undefined) return "";
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
            // Allow partial numeric typing (e.g. "3.", ".5", "-2") by
            // preserving the raw string. The save handler coerces to a
            // number before sending to the backend.
            const n = Number(raw);
            if (Number.isFinite(n) && String(n) === raw.trim()) {
              onPatch({ correctAnswerText: JSON.stringify(n) });
            } else {
              onPatch({ correctAnswerText: JSON.stringify(raw) });
            }
          }}
        />
      </div>
      <div>
        <label className={LABEL}>Tolerance (±)</label>
        <input
          className={INPUT}
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
