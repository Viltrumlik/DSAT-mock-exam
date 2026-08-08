"use client";
import { useEffect, useState } from "react";

import {
  clearAnnotationSync,
  flushAnnotations,
  primeAnnotations,
  setAnnotationSync,
} from "@/features/testing-simulation/tools/highlight/annotationStore";
import { annotationsApi, type AnnotationScope } from "./api";

/**
 * Load this student's marks for one attempt / vocabulary set, and route later writes to the
 * server.
 *
 * Returns `ready`, which the review pages wait on before painting. They must: a review page
 * renders once and settles, so painting from an empty cache and priming a moment later would
 * leave the marks off screen until something else happened to re-render. The *runner* does
 * not wait — it repaints on every commit anyway, so highlights simply appear when the fetch
 * lands, and a student is never blocked from starting a question by a slow request.
 *
 * `ready` also turns true when the request fails. Whatever is in localStorage is then the
 * best answer available, which for the student who just sat the test is usually the right
 * one, and refusing to paint would be strictly worse than painting what we have.
 */
/**
 * `ref` is the **same string the annotator passes as `attemptId`** — `123` for an exam,
 * `asmt-123` for an assessment. Storing the prefixed form server-side is slightly redundant
 * now that `scope` separates them, but making the two differ would mean a mapping between
 * the localStorage key and the server key, and a mismatch there fails silently: the marks
 * simply never appear, with nothing in the console to say why.
 */
export function useAnnotationSync(
  scope: AnnotationScope,
  ref: string | number | null | undefined,
): { ready: boolean } {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ref === null || ref === undefined || ref === "") return;
    let cancelled = false;

    setAnnotationSync(scope, ref);
    setReady(false);

    annotationsApi
      .list(scope, ref)
      .then((rows) => {
        if (cancelled) return;
        primeAnnotations(ref, rows);
      })
      .catch(() => {
        /* localStorage is the fallback — see the docstring. */
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    // A tab closed mid-debounce would otherwise lose the last mark. `pagehide` fires on the
    // paths `beforeunload` misses — bfcache, and Safari on iOS in particular.
    const flush = () => flushAnnotations();
    window.addEventListener("pagehide", flush);

    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", flush);
      clearAnnotationSync();
    };
  }, [scope, ref]);

  return { ready };
}
