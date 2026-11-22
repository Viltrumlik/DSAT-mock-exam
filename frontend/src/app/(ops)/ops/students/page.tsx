"use client";

import { StudentsList } from "@/features/ops/students/StudentsList";

/**
 * /ops/students — the learning centre's students (role `student`) in lc-up's list shape (canvas board "Students",
 * 22 Nov 2026): chips, a filter card, groups as course tags, signed balances and a quick card per group.
 */
export default function OpsStudentsPage() {
  return <StudentsList />;
}
