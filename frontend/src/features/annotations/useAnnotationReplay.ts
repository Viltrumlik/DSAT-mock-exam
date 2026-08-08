"use client";
import { useLayoutEffect } from "react";

import { applyAnnotations } from "@/features/testing-simulation/tools/highlight/annotations";
import { readAnnotations } from "@/features/testing-simulation/tools/highlight/annotationStore";
import type { AnnotatableContainer } from "@/features/testing-simulation/tools/highlight/useAnnotator";

interface Args {
  /** The same key the runner used — `123` for an exam, `asmt-123` for an assessment. */
  attemptId: number | string | null | undefined;
  questionId: number | null | undefined;
  getContainers: () => AnnotatableContainer[];
  /** Hold off until the server fetch has landed, or the first paint finds an empty cache. */
  enabled?: boolean;
}

/**
 * Paint a student's saved marks, read-only.
 *
 * The reading half of `useAnnotator`, with none of the writing: no selection handling, no
 * toolbar, no way to add or delete. Review is a record of what happened, and letting a
 * student annotate a finished paper would quietly change a document they are also being
 * shown as final.
 *
 * A layout effect on every commit, exactly as the runner does it: these regions render
 * through `dangerouslySetInnerHTML`, so any re-render resets their HTML and would wipe the
 * marks. Running before the browser paints means the highlights never visibly flicker off.
 *
 * **Offsets only line up if the review page uses the same container keys and renders the
 * same text as the runner did.** They are character offsets into the region's rendered text,
 * not anchored to the DOM — a review page that adds "Question 4 · Correct" inside an
 * annotated container shifts every mark in it.
 */
export function useAnnotationReplay({ attemptId, questionId, getContainers, enabled = true }: Args): void {
  useLayoutEffect(() => {
    if (!enabled || attemptId == null || questionId == null) return;
    for (const { key, el } of getContainers()) {
      if (!el) continue;
      applyAnnotations(el, readAnnotations(attemptId, questionId, key));
    }
  });
}
