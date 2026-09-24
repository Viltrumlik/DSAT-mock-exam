"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { teacherNav } from "@/components/shell/navConfig";
import { TeacherHomework } from "@/features/teacher/TeacherHomework";
import { SAMPLE_TEACHER_ANALYTICS } from "@/features/teacher/sampleAnalytics";
import type { AssignmentRecord, TeacherAnalyticsModel } from "@/features/teacher/useTeacherAnalytics";

const DAY = 86_400_000;
/**
 * Midnight UTC rather than the moment this module loads, so the date the server renders and the
 * date the browser hydrates are the same string — and so the preview's deadlines stay sensible
 * for as long as the page exists rather than sliding into the past.
 */
const TODAY = Math.floor(Date.now() / DAY) * DAY;

/**
 * The shared sample is built for three pages at once, and this one asks more of it than the
 * others: it RANKS its rows, and it prints a deadline on each. So two things are set locally
 * rather than in `sampleAnalytics`, which the analytics preview also draws from.
 *
 * Deadlines. Every sample assignment has `createdMs: null` — the field the hook fills from
 * `due_at` — so every row would have read "No due date" and the ordering inside a band would
 * never have been visible. One row keeps its null on purpose: an undated assignment is a real
 * case, it sorts last, and it is the only way to review that line of copy.
 *
 * The bands. The sample has work in the first band (past due with work still missing) and the
 * last (nothing outstanding), but nothing in the two between, so two rows are added: one under
 * half turned in with its deadline still ahead, and one the class found hard. A chip nobody
 * reviews is how a state gets quietly lost, and "Challenging" is reachable in the sample only
 * through a tie that "low-completion" wins.
 *
 * Invented data only: this repository is public and no real student may appear in it.
 */
const DUE_BY_TITLE: Record<string, number | null> = {
  "Full mock 3": TODAY - 6 * DAY,
  "Percentages quiz": TODAY - 2 * DAY,
  "Linear functions HW": TODAY + 5 * DAY,
  "Inferences set": TODAY + 9 * DAY,
  "Practice test 2": TODAY + 12 * DAY,
  "Geometry basics": null,
};

const EXTRA: AssignmentRecord[] = [
  {
    id: 7, title: "Vocabulary set 12", classId: 2, className: "Reading B",
    completionPct: 38, submitted: 7, total: 18,
    isAssessment: false, isOverdue: false, groupMean: null, createdMs: TODAY + DAY,
    effectiveness: "low-completion",
  },
  {
    id: 8, title: "Inference drill 4", classId: 2, className: "Reading B",
    completionPct: 81, submitted: 17, total: 21,
    isAssessment: false, isOverdue: false, groupMean: 1240, createdMs: TODAY + 3 * DAY,
    effectiveness: "challenging",
  },
];

const PREVIEW: TeacherAnalyticsModel = {
  ...SAMPLE_TEACHER_ANALYTICS,
  assignments: [
    ...SAMPLE_TEACHER_ANALYTICS.assignments.map((a) => ({ ...a, createdMs: DUE_BY_TITLE[a.title] ?? null })),
    ...EXTRA,
  ],
};

export default function HomeworkPreview() {
  const pathname = usePathname();
  return (
    <AppShell brand={{ name: "MasterSAT", tagline: "Teacher" }} nav={teacherNav} pathname={pathname.includes("homework") ? "/teacher/homework" : pathname} user={{ name: "Mr. Karimov" }} onSignOut={() => {}}>
      <TeacherHomework previewModel={PREVIEW} />
    </AppShell>
  );
}
