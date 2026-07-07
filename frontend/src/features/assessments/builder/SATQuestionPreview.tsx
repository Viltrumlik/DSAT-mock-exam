"use client";

import { useEffect, useMemo, useRef } from "react";
import { CheckCircle2, Circle, Eye } from "lucide-react";
import { renderMath } from "@/lib/mathRender";
import { AssessmentText } from "@/lib/assessmentText";
import { cn } from "@/lib/cn";

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
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-border bg-surface-2/30 py-16 text-sm text-muted-foreground">
        Enter a question to see the preview
      </div>
    );
  }

  return (
    <div ref={containerRef} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-4 py-2.5">
        <Eye className="h-3.5 w-3.5 shrink-0 text-primary/70" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-primary/80">
          Student preview
        </span>
      </div>
      <div className="space-y-4 p-5">
        {/* Stimulus / passage context block */}
        {stimulusContext?.trim() && (
          <div className="rounded-xl border border-border/60 bg-surface-2/30 px-4 py-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Passage context
            </p>
            <AssessmentText
              text={stimulusContext}
              block
              className="text-sm leading-relaxed text-foreground/80 italic"
            />
          </div>
        )}
        {/* Question stem */}
        <AssessmentText
          text={prompt}
          block
          className="text-sm font-medium leading-relaxed text-foreground"
        />

        {question_type === "multiple_choice" && choices.length > 0 && (
          <div className="space-y-2">
            {choices.map((c, i) => {
              const letter = String.fromCharCode(65 + i);
              const isCorrect = c.id === correctId;
              return (
                <div
                  key={c.id ?? i}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border px-3 py-2.5",
                    isCorrect
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                      : "border-border bg-surface-2/40 text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      isCorrect
                        ? "bg-emerald-500 text-white"
                        : "border border-border bg-background text-muted-foreground",
                    )}
                  >
                    {letter}
                  </span>
                  {c.text
                    ? <AssessmentText text={c.text} preserveNewlines className="pt-0.5 text-sm leading-relaxed" />
                    : <em className="pt-0.5 text-sm opacity-40">empty</em>
                  }
                  {isCorrect && (
                    <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {question_type === "numeric" && (
          <div className="rounded-xl border border-border bg-surface-2/40 px-3 py-3 text-sm text-muted-foreground">
            Student enters a number
            {correctId != null && correctId !== "" && (
              <span className="ml-2 font-bold text-emerald-700">
                (Correct: {Array.isArray(correctId) ? (correctId as unknown[]).map((x) => String(x)).join(", ") : String(correctId)})
              </span>
            )}
          </div>
        )}

        {question_type === "short_text" && (
          <div className="rounded-xl border border-border bg-surface-2/40 px-3 py-3 text-sm text-muted-foreground">
            Student types a short answer
          </div>
        )}

        {question_type === "boolean" && (
          <div className="flex gap-2">
            {[{ label: "True", val: "true" }, { label: "False", val: "false" }].map(({ label, val }) => {
              let parsed: unknown = null;
              try { parsed = JSON.parse(correctAnswerText); } catch { /* ignore */ }
              const isCorrect = parsed === val || (parsed === true && val === "true") || (parsed === false && val === "false");
              return (
                <div
                  key={val}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold",
                    isCorrect
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                      : "border-border bg-surface-2/40 text-foreground",
                  )}
                >
                  {isCorrect ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-muted-foreground/40" />}
                  {label}
                </div>
              );
            })}
          </div>
        )}

        {explanation && (
          <div className="rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1">
              Explanation
            </p>
            <AssessmentText
              text={explanation}
              block
              className="text-sm text-foreground leading-relaxed"
            />
          </div>
        )}
      </div>
    </div>
  );
}
