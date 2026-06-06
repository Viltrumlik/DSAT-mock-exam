"use client";
import { useCallback, useEffect, useState } from "react";
import { applyHighlights, clearHighlights, markFromEvent, offsetsOfMark, rangeToOffsets, type HighlightRange } from "./offsets";
import { readRanges, writeRanges } from "./highlightStore";

interface UseHighlighterArgs {
  /** Resolve the highlightable container live from the DOM. */
  getContainer: () => HTMLElement | null;
  attemptId: number | string;
  questionId: number | undefined;
  active: boolean;
}

export interface HighlightPopover {
  x: number;
  y: number;
  mark: HTMLElement;
}

/**
 * Selection highlighting for the passage. Fully isolated: persists to
 * localStorage, paints by wrapping text nodes, and exposes a small popover for
 * removing a highlight. Never touches answers, autosave, or the timer.
 */
export function useHighlighter({ getContainer, attemptId, questionId, active }: UseHighlighterArgs) {
  const [popover, setPopover] = useState<HighlightPopover | null>(null);

  // Paint stored highlights whenever the question changes (and shortly after, to
  // win against the post-commit KaTeX re-render).
  useEffect(() => {
    if (questionId == null) return;
    const paint = () => {
      const c = getContainer();
      if (c) applyHighlights(c, readRanges(attemptId, questionId));
    };
    paint();
    const t = setTimeout(paint, 140);
    return () => clearTimeout(t);
  }, [questionId, attemptId, getContainer]);

  useEffect(() => {
    if (!active || questionId == null) return;

    const onMouseUp = () => {
      const sel = window.getSelection();
      const c = getContainer();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !c) return;
      if (!c.contains(sel.anchorNode) || !c.contains(sel.focusNode)) return;
      const off = rangeToOffsets(c, sel.getRangeAt(0));
      if (!off) return;
      const merged = writeRanges(attemptId, questionId, [...readRanges(attemptId, questionId), off]);
      applyHighlights(c, merged);
      sel.removeAllRanges();
    };

    const onClick = (e: MouseEvent) => {
      const mark = markFromEvent(e.target);
      if (mark) setPopover({ x: e.clientX, y: e.clientY, mark });
    };

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("click", onClick);
    };
  }, [active, questionId, attemptId, getContainer]);

  // Turning the tool off clears the selection cursor styling but keeps marks.
  const removeHighlight = useCallback(() => {
    const c = getContainer();
    if (!c || !popover || questionId == null) {
      setPopover(null);
      return;
    }
    const target = offsetsOfMark(c, popover.mark);
    if (target) {
      const kept = readRanges(attemptId, questionId).filter((r: HighlightRange) => !(r.start < target.end && target.start < r.end));
      const merged = writeRanges(attemptId, questionId, kept);
      applyHighlights(c, merged);
    }
    setPopover(null);
  }, [getContainer, popover, attemptId, questionId]);

  const clearAll = useCallback(() => {
    const c = getContainer();
    if (c) clearHighlights(c);
    if (questionId != null) writeRanges(attemptId, questionId, []);
    setPopover(null);
  }, [getContainer, attemptId, questionId]);

  return { popover, dismissPopover: () => setPopover(null), removeHighlight, clearAll };
}
