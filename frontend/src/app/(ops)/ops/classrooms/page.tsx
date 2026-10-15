"use client";

import { ClassroomList } from "@/features/ops/classrooms/ClassroomList";

/**
 * /ops/classrooms — a Django-admin changelist of every class (plan 2026-10-15-ops-detail-pages).
 * Creating a class is the list's "Add classroom"; editing one, its staff and its students is the
 * class's own change form at /ops/classrooms/<id>.
 */
export default function OpsClassroomsPage() {
  return <ClassroomList />;
}
