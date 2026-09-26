"use client";

/**
 * Preview of the rebuilt teacher dashboard, on invented data. `/teacher` itself needs a
 * teacher account and live classes; this route renders the same component from a fixed
 * sample, which is how the page is reviewed without one.
 */

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { teacherNav } from "@/components/shell/navConfig";
import { TeacherDashboard, type TeacherDashboardPreview } from "@/features/teacher/TeacherDashboard";

const SAMPLE: TeacherDashboardPreview = {
  today: {
    date: "2026-09-21",
    now: "2026-09-21T10:35:00+05:00",
    nextLessonDate: "2026-09-22",
    classes: [
      {
        classroomId: 1, name: "Math Junior 3", subject: "MATH", room: "22",
        lessonDays: "ODD", lessonDaysLabel: "Mon, Wed, Fri", lessonTime: "10:00",
        studentCount: 14, nextLessonAt: "2026-09-21T10:00:00+05:00", state: "now",
        homework: {
          assignmentId: 91, title: "Linear functions, set 4", turnedIn: 11, missing: 3,
          missingStudents: [
            { id: 1, name: "Aziza K." }, { id: 2, name: "Bekzod T." }, { id: 3, name: "Malika R." },
          ],
        },
      },
      {
        classroomId: 2, name: "Reading Senior 1", subject: "ENGLISH", room: "4",
        lessonDays: "ODD", lessonDaysLabel: "Mon, Wed, Fri", lessonTime: "14:30",
        studentCount: 18, nextLessonAt: "2026-09-21T14:30:00+05:00", state: "upcoming",
        homework: { assignmentId: 92, title: "Inference set 7", turnedIn: 18, missing: 0, missingStudents: [] },
      },
      {
        classroomId: 3, name: "Math Senior 2", subject: "MATH", room: "6",
        lessonDays: "EVEN", lessonDaysLabel: "Tue, Thu, Sat", lessonTime: "18:00",
        studentCount: 12, nextLessonAt: "2026-09-22T18:00:00+05:00", state: "upcoming", homework: null,
      },
      {
        classroomId: 4, name: "Reading Junior 2", subject: "ENGLISH", room: "",
        lessonDays: "ODD", lessonDaysLabel: "Mon, Wed, Fri", lessonTime: null,
        studentCount: 9, nextLessonAt: null, state: "off", homework: null,
      },
    ],
    gradingQueue: [
      {
        classroomId: 1, name: "Math Junior 3", waiting: 9,
        assignments: [
          {
            assignmentId: 88, title: "Quadratics, week 3", waiting: 6,
            students: [
              { id: 11, name: "Dilnoza S.", submittedAt: "2026-09-19T19:10:00+05:00" },
              { id: 12, name: "Eldor U.", submittedAt: "2026-09-20T08:02:00+05:00" },
              { id: 13, name: "Farrux X.", submittedAt: "2026-09-20T21:40:00+05:00" },
            ],
          },
          {
            assignmentId: 91, title: "Linear functions, set 4", waiting: 3,
            students: [
              { id: 14, name: "Gulnora Y.", submittedAt: "2026-09-21T07:30:00+05:00" },
              { id: 15, name: "Husan A.", submittedAt: "2026-09-21T08:15:00+05:00" },
              { id: 16, name: "Iroda M.", submittedAt: "2026-09-21T09:05:00+05:00" },
            ],
          },
        ],
      },
      {
        classroomId: 2, name: "Reading Senior 1", waiting: 4,
        assignments: [
          {
            assignmentId: 92, title: "Inference set 7", waiting: 4,
            students: [
              { id: 21, name: "Jasur N.", submittedAt: "2026-09-20T12:00:00+05:00" },
              { id: 22, name: "Kamola R.", submittedAt: "2026-09-20T13:20:00+05:00" },
            ],
          },
        ],
      },
    ],
    upcomingMidterms: [
      { midtermId: 5, title: "September midterm", classroomId: 1, className: "Math Junior 3", startsAt: "2026-09-24T10:00:00+05:00", passMark: 60 },
      { midtermId: 6, title: "Diagnostic", classroomId: 3, className: "Math Senior 2", startsAt: "2026-09-29T18:00:00+05:00", passMark: null },
    ],
    stats: {
      attendanceWeek: [
        { classroomId: 1, name: "Math Junior 3", present: 38, late: 3, missed: 5, excused: 1 },
        { classroomId: 2, name: "Reading Senior 1", present: 49, late: 2, missed: 3, excused: 0 },
        { classroomId: 3, name: "Math Senior 2", present: 30, late: 5, missed: 7, excused: 2 },
      ],
      homework30d: [
        { classroomId: 1, name: "Math Junior 3", expected: 126, turnedIn: 98 },
        { classroomId: 2, name: "Reading Senior 1", expected: 162, turnedIn: 151 },
        { classroomId: 3, name: "Math Senior 2", expected: 96, turnedIn: 54 },
      ],
      attendanceTrend: [
        { date: "2026-09-08", present: 74, late: 4, missed: 12 },
        { date: "2026-09-10", present: 78, late: 3, missed: 9 },
        { date: "2026-09-12", present: 71, late: 6, missed: 13 },
        { date: "2026-09-15", present: 80, late: 2, missed: 8 },
        { date: "2026-09-17", present: 83, late: 4, missed: 6 },
        { date: "2026-09-19", present: 77, late: 5, missed: 10 },
      ],
    },
  },
};

export default function TeacherDashboardPreview() {
  const pathname = usePathname();
  return (
    <AppShell
      brand={{ name: "MasterSAT", tagline: "Teacher" }}
      nav={teacherNav}
      pathname={pathname === "/ui-catalog/teacher" ? "/teacher" : pathname}
      user={{ name: "Preview" }}
      onSignOut={() => {}}
    >
      <TeacherDashboard preview={SAMPLE} />
    </AppShell>
  );
}
