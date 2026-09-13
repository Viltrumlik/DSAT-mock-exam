/**
 * Domain: Assignments
 * Canonical types for the assignment management domain.
 *
 * Assignments live exclusively in admin.mastersat.uz (the ops console).
 * Question authors (questions.mastersat.uz) do NOT create assignments.
 * This type layer enforces that conceptual separation.
 */

import type { Assignment } from "@/lib/criticalApiContract";

export type { Assignment };

/**
 * Assignment lifecycle state.
 * Mirrors governance document Part 1.4.
 */
export type AssignmentState =
  | "DRAFT"
  | "SCHEDULED"
  | "ACTIVE"
  | "COMPLETED"
  | "ARCHIVED"
  | "CANCELLED";

/**
 * Filters for the assignment management list.
 */
export type AssignmentFilters = {
  classroomId?: number | "all";
  state?: AssignmentState | "active_only" | "all";
  search?: string;
};
