/**
 * Which list a student's midterm belongs in. Shared by the student site's Midterms page and the
 * Windows app's "Your tests", so a paper is "available" in exactly the same cases in both.
 * Moved here verbatim from `app/(main)/midterm/MidtermList.tsx`.
 */
import type { MidtermRow } from "@/lib/midtermApi";

export interface MidtermBuckets {
  available: MidtermRow[];
  scheduled: MidtermRow[];
  missed: MidtermRow[];
  past: MidtermRow[];
}

// A started-but-unfinished attempt is always resumable (even past the deadline), so it
// belongs in "Available"; a not-started midterm past its deadline is "Missed".
export const isResumable = (m: MidtermRow) => !m.submitted && m.attempt_id != null && m.state !== "NOT_STARTED";

export function bucketMidterms(midterms: MidtermRow[]): MidtermBuckets {
  const resumable = isResumable;
  // A granted re-sit lifts the once-only rule for a paper they already finished — it belongs in
  // "Available" (the actionable place), NOT in "Past" where it would only show the old mark they
  // are about to replace. It out-ranks the schedule/deadline buckets (the backend exempts a
  // re-sit from the class window), so a re-sittable midterm never reads as scheduled or missed.
  return {
    available: midterms.filter((m) => m.resit_open || (!m.submitted && (resumable(m) || m.is_open))),
    scheduled: midterms.filter(
      (m) => !m.resit_open && !m.submitted && !m.is_open && !resumable(m) && (m.is_before_start || m.awaiting_code),
    ),
    missed: midterms.filter(
      (m) => !m.resit_open && !m.submitted && !m.is_open && !resumable(m) && !m.is_before_start && !m.awaiting_code,
    ),
    past: midterms.filter((m) => m.submitted && !m.resit_open),
  };
}
