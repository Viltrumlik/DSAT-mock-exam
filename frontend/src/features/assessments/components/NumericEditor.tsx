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
        <label className={LABEL}>Correct value(s)</label>
        <input
          className={INPUT}
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
        <p className="mt-1 text-[11px] text-muted-foreground">
          Separate multiple accepted answers with commas (e.g. <span className="font-mono">10.25, 21/2</span>).
        </p>
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
