"use client";

import { useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoadingState, ErrorState } from "./ui";
import { ClassroomShell } from "./shell/ClassroomShell";
import { visibleTabs, type ClassroomTabId } from "./shell/tabs";
import { capabilitiesFor } from "./capabilities";
import { useClassroom } from "./hooks";
import { People } from "./pages/People";
import { Assignments } from "./pages/Assignments";
import { Lessons } from "./pages/Lessons";
import { Settings } from "./pages/Settings";
import { Rankings } from "./pages/Rankings";
import { Gradebook } from "./pages/Gradebook";
import { Materials } from "./pages/Materials";
import { Midterms } from "./pages/Midterms";
import { Results } from "./pages/Results";

function isTabId(v: string | null): v is ClassroomTabId {
  return v != null && ["overview", "lessons", "assignments", "materials", "midterms", "results", "stream", "people", "rankings", "grading", "attendance", "analytics", "settings"].includes(v);
}

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
  const [active, setActive] = useState<ClassroomTabId>(isTabId(initial) ? initial : "overview");

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
      {/* Overview now hosts the class rankings. */}
      {current === "overview" && <Rankings classroom={classroom} />}
      {current === "lessons" && caps.isStaff && <Lessons classroom={classroom} />}
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
