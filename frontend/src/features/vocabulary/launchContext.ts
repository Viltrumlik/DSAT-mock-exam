"use client";

/**
 * Which homework a study run was launched from.
 *
 * WHY THIS EXISTS: `POST /api/vocabulary/sessions/` binds a run to a
 * `VocabHomework`. When the client says nothing, the server has to GUESS, and
 * its guess is "the newest published assignment carrying this set, across every
 * classroom the student belongs to". One set on two live assignments therefore
 * banks every run against one of them — measured end-to-end as
 * `percent monday = 0.0, percent wednesday = 100.0`. Only the client knows which
 * card the student actually opened, so only the client can end the guessing.
 *
 * WHY THE URL, and not React state or a context provider: the four study modes
 * are separate routes (`/vocabulary/sets/<id>/<mode>`) reached by a real
 * client-side navigation, and their page components live outside this feature
 * and hand the mode nothing but `setId`. Anything held in memory dies at the
 * route change; the query string is the only carrier that survives it — and it
 * survives a reload and a back-button too.
 *
 * The param is named `assignment` rather than reusing the assessment flow's
 * `?homework=`: there, `homework` is an AssignmentHomework row id, here it is
 * the classroom `Assignment` id, and two different ids under one name is how
 * this class of bug starts.
 */

import { useSearchParams } from "next/navigation";

export const LAUNCH_ASSIGNMENT_PARAM = "assignment";

/**
 * The server's serializer is `IntegerField(min_value=1)`, so a junk value is a
 * 400 that kills the whole round rather than a field the server ignores. Junk
 * is dropped here instead: a hand-mangled URL must cost the student nothing
 * more than the binding.
 */
function isAssignmentId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Append the launch homework to a link, if there is one. No-op when there isn't. */
export function withLaunchAssignment(href: string, assignmentId?: number | null): string {
  if (!isAssignmentId(assignmentId)) return href;
  return `${href}${href.includes("?") ? "&" : "?"}${LAUNCH_ASSIGNMENT_PARAM}=${assignmentId}`;
}

/**
 * The launch homework of the current screen, or `undefined` for self-study.
 *
 * `useSearchParams()` returns `null` outside an App Router tree — which is
 * exactly where the mode unit tests mount these components — so it is read
 * defensively rather than assumed present. `Number(null)` and `Number("")` are
 * both `0`, which `isAssignmentId` rejects along with `NaN`.
 */
export function useLaunchAssignmentId(): number | undefined {
  const params = useSearchParams();
  const raw = params?.get(LAUNCH_ASSIGNMENT_PARAM);
  const id = Number(raw);
  return isAssignmentId(id) ? id : undefined;
}
