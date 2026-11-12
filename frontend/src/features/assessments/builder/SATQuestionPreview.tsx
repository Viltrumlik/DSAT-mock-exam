"use client";

import { useEffect, useMemo, useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import { renderMath } from "@/lib/mathRender";
import { AssessmentText } from "@/lib/assessmentText";
import { cn } from "@/lib/cn";
import { CHOICE, CHOICE_IDLE, CHOICE_KEY, LETTER, LETTER_IDLE, LETTER_KEY } from "@/features/questionsAdmin/questionLook";

// ─── Live SAT preview ─────────────────────────────────────────────────────────

export function SATQuestionPreview({
  prompt,
  question_type,
  choicesText,
  correctAnswerText,
  explanation,
  stimulusContext,
}: {
  prompt: string;
  question_type: string;
  choicesText: string;
  correctAnswerText: string;
  explanation: string;
  /** Optional passage/stimulus excerpt shown above the question stem (SAT Reading pattern). */
  stimulusContext?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const choices = useMemo(() => {
    try {
      const parsed = JSON.parse(choicesText) as Array<{ id: string; text: string }>;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [choicesText]);

  const correctId = useMemo(() => {
    try { return JSON.parse(correctAnswerText) as string | null; } catch { return null; }
  }, [correctAnswerText]);

  // ── RENDERING FALLBACK OWNERSHIP DECLARATION ──────────────────────────────
  //
  // Fallback type:  Container-level KaTeX safety net
  // Owner:          BuilderSetEditorContainer / SATQuestionPreview scope only
  // Authority:      SUPPLEMENTARY — not primary rendering ownership
  //
  // 1. WHY THIS FALLBACK EXISTS
  //    KaTeX is loaded as a CDN script (layout.tsx `<Script>`), not a bundled
  //    module. On slow networks the CDN load completes after React's initial
  //    render and useEffect batch. Individual <AssessmentText> useEffects fire while
  //    renderMathInElement is still undefined, becoming silent no-ops. This
  //    container sweep runs on every content keystroke, so the first character
  //    typed after CDN load triggers a full re-pass across the entire preview.
  //
  // 2. FAILURE MODE PROTECTED AGAINST
  //    Without this sweep: on slow networks, a freshly loaded authoring session
  //    shows raw LaTeX delimiters (e.g. \( x^2 \)) in the preview pane until
  //    the author happens to type a character. The preview appears broken on
  //    load even though the content and the component are correct.
  //
  // 3. SURFACES THAT RELY ON THIS FALLBACK
  //    SATQuestionPreview inside this container — author-facing preview only.
  //    The student runner, review page, and choice live previews do NOT rely
  //    on this sweep; they have per-element AssessmentText useEffects and the CDN
  //    is typically warm by the time students reach those pages.
  //
  // 4. WHEN THIS FALLBACK IS REMOVABLE
  //    If KaTeX is migrated from CDN script to a bundled npm import
  //    (`katex` + `katex/contrib/auto-render`), the race condition disappears.
  //    Individual <AssessmentText> useEffects become sufficient. To remove safely:
  //      a) Bundle KaTeX via npm (remove <Script> from layout.tsx)
  //      b) Verify preview renders math immediately on fresh load (no flash)
  //      c) Confirm full test suite passes
  //    Do NOT remove until (a) is confirmed in production.
  //
  // 5. WHY THIS IS NOT PRIMARY RENDERING OWNERSHIP
  //    Each <AssessmentText> owns rendering of its content through its own useEffect.
  //    This sweep is a CDN-timing guard, not an authority over what renders.
  //    If math on a new sub-component only renders because of this sweep, that
  //    sub-component is missing its own <AssessmentText> — fix the sub-component,
  //    do not expand the scope of this sweep to cover the gap.
  //
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (containerRef.current) {
      renderMath({ root: containerRef.current });
    }
  }, [prompt, choicesText, explanation, stimulusContext]);

  if (!prompt.trim() && !stimulusContext?.trim()) {
    return (
      <div className="flex items-center justify-center rounded-ms-card border border-dashed border-ms-border-strong px-4 py-16 text-center text-[14px] text-ms-fg-3">
        Enter a question to see the preview
      </div>
    );
  }

  // The question as the student reads it (design handoff v0.3, PR 17c): Georgia, the choices as the student's
  // cards, the answer key's card in green — as the module editor and the question bank draw it.
  const box = "rounded-[12px] border-[1.5px] border-ms-border-strong bg-ms-card px-3 py-3 text-[15px] text-ms-fg-2";
  return (
    <div ref={containerRef} className="animate-ms-fade-in overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1">
      <div className="flex items-center gap-2 border-b border-ms-line bg-ms-primary-soft px-4 py-2.5">
        <Icon name="eye" size="sm" className="size-3.5 shrink-0 text-ms-primary-text" />
        <span className="text-ms-over uppercase text-ms-primary-text">Student preview</span>
      </div>
      <div className="flex flex-col gap-4 p-5 font-ms-serif">
        {/* Main content — rendered FIRST/at the top (Math: the question · Reading: the passage). */}
        <AssessmentText text={prompt} block className="text-[16px] leading-[26px] text-ms-fg" />
        {/* Question prompt — rendered AFTER the main content, right above the choices. */}
        {stimulusContext?.trim() && (
          <AssessmentText text={stimulusContext} block className="text-[16px] font-semibold leading-[26px] text-ms-fg" />
        )}

        {question_type === "multiple_choice" && choices.length > 0 && (
          <div className="flex flex-col gap-2">
            {choices.map((c, i) => {
              const letter = String.fromCharCode(65 + i);
              const isCorrect = c.id === correctId;
              return (
                <div key={c.id ?? i} data-preview-choice={letter} className={cn(CHOICE, "items-start gap-3", isCorrect ? CHOICE_KEY : CHOICE_IDLE)}>
                  <span className={cn(LETTER, "font-ms-sans", isCorrect ? LETTER_KEY : LETTER_IDLE)}>
                    {isCorrect ? <Icon name="check" size="sm" className="size-4" /> : letter}
                    {isCorrect ? <span className="sr-only">{letter}</span> : null}
                  </span>
                  {c.text ? (
                    <AssessmentText text={c.text} preserveNewlines className="min-w-0 flex-1 pt-0.5 text-[15px] leading-6 text-ms-fg" />
                  ) : (
                    <em className="pt-0.5 text-[15px] text-ms-fg-3">empty</em>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {question_type === "numeric" && (
          <div className={box}>
            Student enters a number
            {correctId != null && correctId !== "" && (
              <span className="ml-2 font-semibold text-ms-positive-fg">
                (Correct: {Array.isArray(correctId) ? (correctId as unknown[]).map((x) => String(x)).join(", ") : String(correctId)})
              </span>
            )}
          </div>
        )}

        {question_type === "short_text" && <div className={box}>Student types a short answer</div>}

        {question_type === "boolean" && (
          <div className="flex gap-2">
            {[{ label: "True", val: "true" }, { label: "False", val: "false" }].map(({ label, val }) => {
              let parsed: unknown = null;
              try { parsed = JSON.parse(correctAnswerText); } catch { /* ignore */ }
              const isCorrect = parsed === val || (parsed === true && val === "true") || (parsed === false && val === "false");
              return (
                <div
                  key={val}
                  className={cn(CHOICE, "flex-1 items-center justify-center gap-2 text-[15px] font-semibold", isCorrect ? cn(CHOICE_KEY, "text-ms-positive-fg") : cn(CHOICE_IDLE, "text-ms-fg"))}
                >
                  <Icon name={isCorrect ? "ok" : "circle"} size="sm" className={cn("size-4", !isCorrect && "text-ms-fg-3")} />
                  {label}
                </div>
              );
            })}
          </div>
        )}

        {explanation && (
          <div className="rounded-[12px] border border-ms-info-line bg-ms-info-soft px-4 py-3">
            <p className="mb-1 font-ms-sans text-ms-over uppercase text-ms-info-fg">Explanation</p>
            <AssessmentText text={explanation} block className="text-[15px] leading-6 text-ms-fg" />
          </div>
        )}
      </div>
    </div>
  );
}
