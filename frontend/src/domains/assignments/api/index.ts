/**
 * Domain API: Assignments
 *
 * Assignment CRUD across all classrooms.
 * This is the ops console entry point for assignment management.
 *
 * Key invariants enforced here:
 *   - Assignments are always scoped to a specific classroom
 *   - Once an assignment leaves DRAFT, its pinned content cannot change
 *   - All mutations emit events (enforced by backend; this layer does not bypass)
 */

import { classesApi } from "@/lib/api";
import type { NormalizedList, Assignment } from "@/lib/criticalApiContract";

/**
 * List assignments for a single classroom.
 */
export async function listClassroomAssignments(
  classroomId: number,
): Promise<NormalizedList<Assignment>> {
  return classesApi.listAssignments(classroomId);
}

/**
 * Create an assignment in a classroom.
 * The payload must include a reference to the content being assigned.
 */
export async function createAssignment(
  classroomId: number,
  payload: Record<string, unknown>,
): Promise<Assignment> {
  return classesApi.createAssignment(classroomId, payload) as Promise<Assignment>;
}

/**
 * Update an assignment (only allowed in DRAFT state; backend enforces).
 */
export async function updateAssignment(
  classroomId: number,
  assignmentId: number,
  payload: Record<string, unknown>,
): Promise<Assignment> {
  return classesApi.updateAssignment(classroomId, assignmentId, payload) as Promise<Assignment>;
}

/**
 * Delete (cancel) an assignment.
 * Backend enforces: only DRAFT and SCHEDULED assignments can be deleted.
 * ACTIVE/COMPLETED assignments must be archived through the state machine.
 */
export async function deleteAssignment(
  classroomId: number,
  assignmentId: number,
): Promise<void> {
  return classesApi.deleteAssignment(classroomId, assignmentId);
}
