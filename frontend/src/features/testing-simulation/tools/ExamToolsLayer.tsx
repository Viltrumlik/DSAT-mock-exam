"use client";
import { ReferenceSheet } from "./ReferenceSheet";
import { NotesPanel } from "./notes/NotesPanel";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";
import { HighlightPopover } from "./highlight/HighlightPopover";
import type { ExamTools } from "./useExamTools";

interface ExamToolsLayerProps {
  tools: ExamTools;
  attemptId: number | string;
}

/**
 * Renders every floating/overlay tool. Single mount point so the page only needs
 * one line. Each child is independent and self-persisting.
 *
 * NOTE: the calculator is NOT here — it is docked into the question layout by
 * the runner (reserved area, never overlapping content). See item: Calculator
 * Layout and `ExamRunnerPage`.
 */
export function ExamToolsLayer({ tools, attemptId }: ExamToolsLayerProps) {
  return (
    <>
      {tools.referenceOpen && <ReferenceSheet onClose={tools.toggleReference} />}
      {tools.notesOpen && <NotesPanel attemptId={attemptId} onClose={tools.toggleNotes} />}
      {tools.helpOpen && <KeyboardShortcutsHelp onClose={tools.closeHelp} />}
      {tools.highlighter.popover && (
        <HighlightPopover popover={tools.highlighter.popover} onRemove={tools.highlighter.removeHighlight} />
      )}
    </>
  );
}
