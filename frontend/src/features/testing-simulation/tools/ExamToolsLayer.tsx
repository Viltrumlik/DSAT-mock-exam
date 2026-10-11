"use client";
import { DesmosCalculator } from "./calculator/DesmosCalculator";
import { ReferenceSheet } from "./ReferenceSheet";
import { NotesPanel } from "./notes/NotesPanel";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";
import { AnnotationToolbar } from "./highlight/AnnotationToolbar";
import type { ExamTools } from "./useExamTools";

interface ExamToolsLayerProps {
  tools: ExamTools;
  attemptId: number | string;
  /**
   * Whether this paper may offer Desmos at all (selectors.calculatorAllowed). Defaults to
   * false so a caller that forgets it fails CLOSED — the calculator is a rule, not a tool.
   */
  calculatorEnabled?: boolean;
  /** Desmos's Scientific calculator only — no Graphing tab (junior Math midterms). */
  calculatorScientificOnly?: boolean;
}

/**
 * Renders every floating/overlay tool. Single mount point so the page only needs
 * one line. Each child is independent and self-persisting. The calculator floats
 * (draggable, Bluebook-style) and never reserves layout space.
 *
 * Desmos mounts on `calculatorEnabled && calculatorOpen`, never on `calculatorOpen` alone.
 * The open flag is tool state that outlives the rule: the header button that toggles it
 * disappears when the paper stops allowing a calculator (a Foundation Math midterm since
 * 2026-10-11, the school's request — worked by hand), but a calculator opened before the
 * snapshot said so would otherwise stay on screen with no button left to close it.
 */
export function ExamToolsLayer({
  tools,
  attemptId,
  calculatorEnabled = false,
  calculatorScientificOnly = false,
}: ExamToolsLayerProps) {
  return (
    <>
      {calculatorEnabled && tools.calculatorOpen && (
        <DesmosCalculator
          onClose={tools.toggleCalculator}
          enlarged={tools.calculatorEnlarged}
          onToggleEnlarge={tools.toggleCalculatorEnlarge}
          scientificOnly={calculatorScientificOnly}
        />
      )}
      {tools.referenceOpen && <ReferenceSheet onClose={tools.toggleReference} />}
      {tools.notesOpen && <NotesPanel attemptId={attemptId} onClose={tools.toggleNotes} />}
      {tools.helpOpen && <KeyboardShortcutsHelp onClose={tools.closeHelp} />}
      {tools.highlighter.toolbar && (
        <AnnotationToolbar
          toolbar={tools.highlighter.toolbar}
          onColor={tools.highlighter.applyColor}
          onUnderline={tools.highlighter.applyUnderline}
          onDelete={tools.highlighter.deleteAnnotation}
          onClose={tools.highlighter.dismiss}
          onAddNote={tools.toggleNotes}
        />
      )}
    </>
  );
}
