"use client";

/**
 * What the class missed on one homework — over the data path that already exists.
 *
 * There is no new endpoint and no new fetcher here. `questionAnalysisApi` and
 * `questionAnalysisKeys` are the same two functions and the same two query keys the full
 * statistics section uses, which is the point: when both are on the homework's page they
 * share one cache entry each and the browser makes one request per kind, not two.
 *
 * **The deadline verdict is the server's, and it is asked for.** It would be cheaper to read
 * `due_at` off the assignment already in hand and skip the request while the homework is
 * open — and it would be wrong. The reader's clock is not evidence about a deadline (a laptop
 * set a day forward would unlock a homework students can still hand in), so the block asks
 * the endpoint and the endpoint answers `locked: true` with nothing else in the payload. That
 * is one request, and it carries no question, no prompt and no answer key. Nothing else is
 * fetched until the answer comes back unlocked — the question bodies behind the pop-up are
 * only ever asked for from a row, and before the deadline there are no rows.
 *
 * **A half-failure is not an empty class.** A homework can carry both kinds of work. If one
 * request fails and the other succeeds, the rows that did arrive are shown and the gap is
 * named out loud. Only when everything failed is this an error — and then it is an error,
 * with a retry, never "nobody missed anything".
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizeApiError } from "@/lib/apiError";
import { questionAnalysisApi, questionAnalysisKeys } from "@/features/questionAnalysis/api";
import { DEFAULT_THRESHOLD } from "@/features/questionAnalysis/format";
import {
  isAssessmentHomeworkAnalysis,
  isPastpaperHomeworkAnalysis,
  type HomeworkBlock,
  type PapersTruncated,
} from "@/features/questionAnalysis/types";
import { missedRows, type MissedRow } from "./rows";

export type MostMissed =
  /** The deadline has not passed. One line, no figures — and nothing else was asked for. */
  | { status: "locked"; homework: HomeworkBlock }
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | {
      status: "ready";
      homework: HomeworkBlock;
      rows: MissedRow[];
      /** Which half did not load, in words, when one of two did not. `null` normally. */
      gap: string | null;
      /**
       * The cap the past-paper endpoint applied, when it applied one. Carried because the
       * rows below are then NOT every question the class missed, and a list that says it is
       * would be exactly the silent truncation `readPapersTruncated` exists to forbid.
       */
      truncated: PapersTruncated | null;
      retry: () => void;
    };

export function useMostMissed({
  assignmentId,
  hasAssessments,
  hasPastPapers,
  threshold = DEFAULT_THRESHOLD,
}: {
  assignmentId: number;
  hasAssessments: boolean;
  hasPastPapers: boolean;
  threshold?: number;
}): MostMissed {
  const assessments = useQuery({
    queryKey: questionAnalysisKeys.assignmentAssessments(assignmentId, threshold),
    queryFn: () =>
      questionAnalysisApi.assessmentsForAssignment({ assignment: assignmentId, threshold }),
    enabled: hasAssessments && assignmentId > 0,
  });
  const pastpapers = useQuery({
    queryKey: questionAnalysisKeys.assignmentPastpapers(assignmentId, threshold),
    queryFn: () =>
      questionAnalysisApi.pastpapersForAssignment({ assignment: assignmentId, threshold }),
    enabled: hasPastPapers && assignmentId > 0,
  });

  const retry = () => {
    if (hasAssessments) void assessments.refetch();
    if (hasPastPapers) void pastpapers.refetch();
  };

  // Either endpoint can state the deadline — they are answering about the same homework — but
  // only the server ever states it.
  const homework: HomeworkBlock | null =
    assessments.data?.homework ?? pastpapers.data?.homework ?? null;

  const rows = useMemo(() => {
    const a = assessments.data;
    const p = pastpapers.data;
    return missedRows(
      a && isAssessmentHomeworkAnalysis(a) ? a : null,
      p && isPastpaperHomeworkAnalysis(p) ? p : null,
    );
  }, [assessments.data, pastpapers.data]);

  const live = [
    ...(hasAssessments ? [assessments] : []),
    ...(hasPastPapers ? [pastpapers] : []),
  ];
  const failed = live.filter((q) => q.isError);

  if (homework == null) {
    if (live.length > 0 && failed.length === live.length) {
      return {
        status: "error",
        message: normalizeApiError(failed[0].error).message,
        retry,
      };
    }
    return { status: "loading" };
  }

  if (homework.locked) return { status: "locked", homework };

  const gap =
    failed.length === 0
      ? null
      : failed.length === live.length
        ? null
        : assessments.isError
          ? "The assessment half of this homework did not load, so its questions are not counted below."
          : "The past-paper half of this homework did not load, so its questions are not counted below.";

  // Both halves down after one of them already told us the deadline has passed: there is
  // nothing to rank, and saying "nobody missed anything" here would be the inversion this
  // codebase keeps paying for.
  if (live.length > 0 && failed.length === live.length) {
    return { status: "error", message: normalizeApiError(failed[0].error).message, retry };
  }

  const p = pastpapers.data;
  const truncated = p && isPastpaperHomeworkAnalysis(p) ? p.papers_truncated : null;

  return { status: "ready", homework, rows, gap, truncated, retry };
}
