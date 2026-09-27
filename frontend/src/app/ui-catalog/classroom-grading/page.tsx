"use client";

/**
 * Preview of the classroom Grading tab, on invented data.
 *
 * The real tab needs a teacher account, a class, a published homework and students who have
 * turned work in. This route seeds the three queries it reads and renders the SAME component,
 * so the three levels the owner asked for — every homework, then the students on one, then one
 * student's own work and the place to mark it — can be clicked through and looked at.
 *
 * Nothing here reimplements the tab.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { Gradebook } from "@/features/classroom/pages/Gradebook";
import type { ClassroomWithRole } from "@/features/classroom/types";

const CLASS_ID = 34;
const HW = 102;

const COUNTS = { graded: 1, needs_grading: 2, submitted: 2, needs_revision: 0, missing: 1, total: 4 };

const META = {
  id: HW, title: "Essay: the passage on migration", status: "PUBLISHED" as const,
  category: "HOMEWORK", due_at: "2026-09-26T18:00:00+05:00",
  is_auto_graded: false, source_label: "Manual", max_score: "100",
};

const OVERVIEW = {
  students: 4,
  needs_grading_total: 2,
  assignments: [
    { ...META, counts: COUNTS, performance: null },
    {
      id: 103, title: "Percentages quiz", status: "PUBLISHED" as const, category: "HOMEWORK",
      due_at: "2026-09-24T18:00:00+05:00", is_auto_graded: true, source_label: "Quiz", max_score: "100",
      counts: { graded: 3, needs_grading: 0, submitted: 3, needs_revision: 0, missing: 1, total: 4 },
      performance: { completion_rate: 75, average: 74, highest: 92, lowest: 51, completed: 3 },
    },
  ],
};

/** Invented names. This repository is public; no real student appears here. */
const ASSIGNMENT = {
  assignment: META,
  counts: COUNTS,
  performance: null,
  roster: [
    { student_id: 1, name: "Aziza Karimova", email: "a@example.invalid", profile_image_url: null,
      status: "SUBMITTED" as const, grade: null, max_score: "100", source: null, submission_id: 501 },
    { student_id: 2, name: "Bekzod Tursunov", email: "b@example.invalid", profile_image_url: null,
      status: "SUBMITTED" as const, grade: null, max_score: "100", source: null, submission_id: 502 },
    { student_id: 3, name: "Malika Rahimova", email: "m@example.invalid", profile_image_url: null,
      status: "GRADED" as const, grade: "88", max_score: "100", source: "TEACHER" as const, submission_id: 503 },
    { student_id: 4, name: "Jasur Alimov", email: "j@example.invalid", profile_image_url: null,
      status: "MISSING" as const, grade: null, max_score: "100", source: null, submission_id: null },
  ],
};

/** 20% of this homework is the teacher's mark; the other 80% is already settled at 76. */
const share = (manual: number | null) => ({
  // The constant the backend sends (`grade_composition.STATE_AWAITING_MANUAL`). Writing a
  // near-miss here made the panel read "Marked" on work nobody had marked — the fixture was
  // wrong, not the screen, and a preview that lies is worse than no preview.
  state: manual == null ? "awaiting_manual_mark" : "final",
  percent: manual == null ? 76 : Math.round(0.8 * 76 + 0.2 * manual),
  is_final: manual != null,
  automatic_percent: 76,
  manual_percent: manual,
  manual_weight_percent: 20,
  automatic_weight_percent: 80,
});

const SUBMISSIONS = [
  { id: 501, status: "SUBMITTED", submitted_at: "2026-09-25T14:02:00+05:00", student: { id: 1 },
    files: [
      { id: 1, url: "/file/essay-migration.pdf", file_name: "essay-migration.pdf", file_type: "application/pdf" },
      { id: 2, url: "/file/notes-page-1.jpg", file_name: "notes-page-1.jpg", file_type: "image/jpeg" },
      { id: 3, url: "/file/notes-page-2.jpg", file_name: "notes-page-2.jpg", file_type: "image/jpeg" },
    ],
    review: null, composed_grade: share(null) },
  { id: 502, status: "SUBMITTED", submitted_at: "2026-09-25T16:40:00+05:00", student: { id: 2 },
    files: [], review: null, composed_grade: share(null) },
  { id: 503, status: "REVIEWED", submitted_at: "2026-09-24T09:15:00+05:00", student: { id: 3 },
    files: [{ id: 4, url: "/file/malika.pdf", file_name: "malika.pdf", file_type: "application/pdf" }],
    review: { grade: 88, feedback: "Clear argument. Watch the second paragraph's evidence." },
    composed_grade: share(88) },
];

const CLASSROOM = { id: CLASS_ID, name: "Reading Senior 1", my_role: "TEACHER" } as unknown as ClassroomWithRole;

export default function Page() {
  const [qc] = useState(() => {
    const c = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    c.setQueryData(["classroom", "gradebook", CLASS_ID], OVERVIEW);
    c.setQueryData(["classroom", "gradebook", CLASS_ID, HW], ASSIGNMENT);
    c.setQueryData(["classroom", "submitted-work", CLASS_ID, HW], SUBMISSIONS);
    return c;
  });
  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <QueryClientProvider client={qc}>
        {/* The tab reads `?assignment=` through `useSearchParams`, which needs a boundary in the
            app router: without one `next build` refuses to prerender this route and EXITS 1 —
            the whole production build, brought down by a preview page. The real route at
            `(teacher)/teacher/classrooms/[classId]` wraps its workspace for the same reason. */}
        <Suspense fallback={<div style={{ minHeight: 240 }} />}>
          <Gradebook classroom={CLASSROOM} />
        </Suspense>
      </QueryClientProvider>
    </div>
  );
}
