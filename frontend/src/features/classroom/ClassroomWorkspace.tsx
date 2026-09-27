"use client";

import { Suspense, lazy, useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoadingState, ErrorState } from "./ui";
import { ClassroomShell } from "./shell/ClassroomShell";
import { isClassroomTabId, visibleTabs, type ClassroomTabId } from "./shell/tabs";
import { capabilitiesFor } from "./capabilities";
import { useClassroom } from "./hooks";
import { People } from "./pages/People";
import { Assignments } from "./pages/Assignments";
import { Classwork } from "./pages/Classwork";
import { Lessons } from "./pages/Lessons";
import { Settings } from "./pages/Settings";
import { Rankings } from "./pages/Rankings";
import { Gradebook } from "./pages/Gradebook";
import { Materials } from "./pages/Materials";
import { Midterms } from "./pages/Midterms";
import { Results } from "./pages/Results";
import { Attendance } from "./pages/Attendance";
/**
 * Split off, and loaded when a STAFF viewer opens a classroom rather than when this file does.
 *
 * This file is the shared workspace: the student site mounts it too, and a static import would
 * put the whole teacher kit (`features/teacher/ui`, the overview, its hooks) in the chunk every
 * student's browser downloads to look at a class — code that can never run for them, because
 * the branch below is on `caps.isStaff`. Same reason the mistakes slice lazies its pop-up.
 */
const TeacherClassroomOverview = lazy(() =>
  import("@/features/teacher/classroomOverview").then((m) => ({ default: m.TeacherClassroomOverview })),
);

// The `?tab=` guard lives in shell/tabs.ts next to the ids it narrows. It used to be a
// second hardcoded copy of the list here, which drifted out of step with the union.

export function ClassroomWorkspace({
  classId,
  backHref,
  backLabel,
  consumer = false,
}: {
  classId: number;
  backHref?: string;
  backLabel?: string;
  /**
   * Force the consumer (student) view regardless of the viewer's classroom role. Used on the
   * student site (mastersat.uz) so teacher/admin accounts never see management controls there —
   * all teacher management lives on the teacher portal. Derives capabilities as STUDENT, which
   * cascades to every tab/page (they each read `classroom.my_role`).
   */
  consumer?: boolean;
}) {
  const { data: rawClassroom, isLoading, isError, refetch } = useClassroom(classId);
  const classroom =
    consumer && rawClassroom ? { ...rawClassroom, my_role: "STUDENT" } : rawClassroom;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initial = searchParams.get("tab");
  const [active, setActive] = useState<ClassroomTabId>(isClassroomTabId(initial) ? initial : "overview");

  const onTabChange = useCallback(
    (tab: ClassroomTabId) => {
      setActive(tab);
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.set("tab", tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  if (isLoading) return <LoadingState label="Opening classroom…" />;
  if (isError || !classroom) return <ErrorState title="Class not available" message="It may have been removed, or you're not enrolled." onRetry={() => refetch()} />;

  const caps = capabilitiesFor(classroom.my_role);
  // Guard: if the active tab isn't permitted for this viewer, fall back to overview.
  const allowed = visibleTabs(caps).some((t) => t.id === active);
  const current: ClassroomTabId = allowed ? active : "overview";

  return (
    <ClassroomShell classroom={classroom} active={current} onTabChange={onTabChange} backHref={backHref} backLabel={backLabel}>
      {/* Overview answers a different question for each of the two people who open it. A
          teacher gets what needs them today; everyone else gets the class rankings, exactly as
          before. The branch is on CAPABILITIES, never on the route: this component is mounted
          by both hosts, and the student site's `consumer` rewrite (above) is what makes
          `caps.isStaff` airtight where `pathname` would not be. */}
      {current === "overview" && (caps.isStaff
        ? (
          // The fallback is the shell's own spinner, not the teacher kit's — the kit is in the
          // chunk that has not arrived yet.
          <Suspense fallback={<LoadingState label="Opening the overview…" />}>
            <TeacherClassroomOverview classroom={classroom} onOpenTab={onTabChange} />
          </Suspense>
        )
        : <Rankings classroom={classroom} />)}
      {current === "lessons" && caps.isStaff && <Lessons classroom={classroom} />}
      {/* Every member, students included. Mirrors the tab's own gate — the third of the
          three places a tab is gated, without which the tab renders an empty shell. */}
      {current === "classwork" && caps.isMember && <Classwork classroom={classroom} />}
      {/* Staff-only register — students never see attendance. Mirrors the tab's own gate;
          a student who deep-links ?tab=attendance is already bounced to overview above. */}
      {current === "attendance" && caps.isStaff && <Attendance classroom={classroom} />}
      {current === "assignments" && <Assignments classroom={classroom} />}
      {current === "midterms" && caps.canManageAssignments && <Midterms classroom={classroom} />}
      {current === "materials" && caps.isMember && <Materials classroom={classroom} />}
      {current === "results" && caps.isStaff && <Results classroom={classroom} />}
      {current === "people" && <People classroom={classroom} />}
      {current === "grading" && caps.canGrade && <Gradebook classroom={classroom} />}
      {current === "settings" && caps.canManageClass && <Settings classroom={classroom} />}
    </ClassroomShell>
  );
}
