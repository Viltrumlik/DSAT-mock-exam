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
  /** Desmos's Scientific calculator only — no Graphing tab (junior/foundation Math midterms). */
  calculatorScientificOnly?: boolean;
}

/**
 * Renders every floating/overlay tool. Single mount point so the page only needs
 * one line. Each child is independent and self-persisting. The calculator floats
 * (draggable, Bluebook-style) and never reserves layout space.
 */
export function ExamToolsLayer({ tools, attemptId, calculatorScientificOnly = false }: ExamToolsLayerProps) {
  return (
    <>
      {tools.calculatorOpen && (
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
