"use client";
import { useCallback, useEffect, useState } from "react";
import {
  addHighlight,
  addUnderline,
  annotationsAt,
  applyAnnotations,
  boundingRange,
  clearAnnotations,
  type Annotation,
  type HighlightColor,
  markFromEvent,
  offsetsOfMark,
  type OffsetRange,
  rangeToOffsets,
  removeRange,
  type UnderlineStyle,
} from "./annotations";
import { readAnnotations, writeAnnotations } from "./annotationStore";

interface UseAnnotatorArgs {
  /** Resolve the annotatable container live from the DOM. */
  getContainer: () => HTMLElement | null;
  attemptId: number | string;
  questionId: number | undefined;
  active: boolean;
}

export interface AnnotatorToolbar {
  /** Anchor point (selection centre x; top/bottom of the selection rect). */
  x: number;
  top: number;
  bottom: number;
  /** The text range this toolbar acts on. */
  range: OffsetRange;
  /** Styles currently covering the whole range (drives the active buttons). */
  current: { color?: HighlightColor; underline?: UnderlineStyle };
}

/** Styles that cover the entire range (used to mark active toolbar buttons). */
function stylesOver(anns: Annotation[], range: OffsetRange) {
  const color = anns.find((a) => a.kind === "highlight" && a.start <= range.start && a.end >= range.end)?.color;
  const underline = anns.find((a) => a.kind === "underline" && a.start <= range.start && a.end >= range.end)?.underline;
  return { color, underline };
}

/**
 * Bluebook-style text annotator. Selecting text (or clicking an existing
 * annotation) opens a toolbar to apply/edit highlight colours and underline
 * styles or delete. Fully isolated: persists to localStorage, paints by
 * wrapping text nodes, never touches answers/autosave/timer.
 */
export function useAnnotator({ getContainer, attemptId, questionId, active }: UseAnnotatorArgs) {
  const [toolbar, setToolbar] = useState<AnnotatorToolbar | null>(null);

  // Repaint stored annotations whenever the question changes (and shortly after,
  // to win against the post-commit KaTeX re-render). Drops any open toolbar.
  useEffect(() => {
    if (questionId == null) return;
    setToolbar(null);
    const paint = () => {
      const c = getContainer();
      if (c) applyAnnotations(c, readAnnotations(attemptId, questionId));
    };
    paint();
    const t = setTimeout(paint, 140);
    return () => clearTimeout(t);
  }, [questionId, attemptId, getContainer]);

  useEffect(() => {
    if (!active || questionId == null) return;

    const onMouseUp = (e: MouseEvent) => {
      // Clicks inside the toolbar are handled by its own buttons.
      if ((e.target as HTMLElement | null)?.closest?.("[data-annot-toolbar]")) return;

      const c = getContainer();
      if (!c) return;
      const sel = window.getSelection();
      const anns = readAnnotations(attemptId, questionId);

      // New selection inside the container → open the toolbar (no auto-apply).
      if (sel && !sel.isCollapsed && sel.rangeCount > 0 && c.contains(sel.anchorNode) && c.contains(sel.focusNode)) {
        const range = sel.getRangeAt(0);
        const off = rangeToOffsets(c, range);
        if (off) {
          const rect = range.getBoundingClientRect();
          setToolbar({
            x: rect.left + rect.width / 2,
            top: rect.top,
            bottom: rect.bottom,
            range: off,
            current: stylesOver(anns, off),
          });
        }
        return;
      }

      // Click on an existing annotation → open the toolbar to edit it.
      const mark = markFromEvent(e.target);
      if (mark) {
        const markRange = offsetsOfMark(c, mark);
        if (markRange) {
          const covering = annotationsAt(anns, markRange.start);
          const range = boundingRange(covering) ?? markRange;
          setToolbar({ x: e.clientX, top: e.clientY, bottom: e.clientY, range, current: stylesOver(anns, range) });
        }
        return;
      }

      // Clicked elsewhere → dismiss.
      setToolbar(null);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setToolbar(null);
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, questionId, attemptId, getContainer]);

  const repaint = useCallback(
    (next: Annotation[]) => {
      if (questionId == null) return;
      const c = getContainer();
      const saved = writeAnnotations(attemptId, questionId, next);
      if (c) applyAnnotations(c, saved);
      window.getSelection()?.removeAllRanges();
    },
    [getContainer, attemptId, questionId],
  );

  const applyColor = useCallback(
    (color: HighlightColor) => {
      if (!toolbar || questionId == null) return;
      repaint(addHighlight(readAnnotations(attemptId, questionId), toolbar.range, color));
      setToolbar((t) => (t ? { ...t, current: { ...t.current, color } } : t));
    },
    [toolbar, attemptId, questionId, repaint],
  );

  const applyUnderline = useCallback(
    (underline: UnderlineStyle) => {
      if (!toolbar || questionId == null) return;
      repaint(addUnderline(readAnnotations(attemptId, questionId), toolbar.range, underline));
      setToolbar((t) => (t ? { ...t, current: { ...t.current, underline } } : t));
    },
    [toolbar, attemptId, questionId, repaint],
  );

  const deleteAnnotation = useCallback(() => {
    if (!toolbar || questionId == null) {
      setToolbar(null);
      return;
    }
    repaint(removeRange(readAnnotations(attemptId, questionId), toolbar.range));
    setToolbar(null);
  }, [toolbar, attemptId, questionId, repaint]);

  const clearAll = useCallback(() => {
    const c = getContainer();
    if (c) clearAnnotations(c);
    if (questionId != null) writeAnnotations(attemptId, questionId, []);
    setToolbar(null);
  }, [getContainer, attemptId, questionId]);

  return { toolbar, applyColor, applyUnderline, deleteAnnotation, dismiss: () => setToolbar(null), clearAll };
}
