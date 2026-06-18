"use client";

import { useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoadingState, ErrorState } from "./ui";
import { ClassroomShell } from "./shell/ClassroomShell";
import { visibleTabs, type ClassroomTabId } from "./shell/tabs";
import { capabilitiesFor } from "./capabilities";
import { useClassroom } from "./hooks";
import { ClassroomOverview } from "./pages/Overview";
import { People } from "./pages/People";
import { Assignments } from "./pages/Assignments";
import { Settings } from "./pages/Settings";
import { Attendance } from "./pages/Attendance";
import { Rankings } from "./pages/Rankings";
import { Analytics } from "./pages/Analytics";
import { Gradebook } from "./pages/Gradebook";
import { Materials } from "./pages/Materials";
import { Midterms } from "./pages/Midterms";
import { ComingSoon } from "./pages/ComingSoon";

function isTabId(v: string | null): v is ClassroomTabId {
  return v != null && ["overview", "assignments", "materials", "midterms", "stream", "people", "rankings", "grading", "attendance", "analytics", "settings"].includes(v);
}

export function ClassroomWorkspace({ classId }: { classId: number }) {
  const { data: classroom, isLoading, isError, refetch } = useClassroom(classId);
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
    <ClassroomShell classroom={classroom} active={current} onTabChange={onTabChange}>
      {current === "overview" && <ClassroomOverview classroom={classroom} onNavigate={onTabChange} />}
      {current === "assignments" && <Assignments classroom={classroom} />}
      {current === "midterms" && caps.canManageAssignments && <Midterms classroom={classroom} />}
      {current === "materials" && caps.isMember && <Materials classroom={classroom} />}
      {current === "people" && <People classroom={classroom} />}
      {current === "rankings" && <Rankings classroom={classroom} />}
      {current === "grading" && caps.canGrade && <Gradebook classroom={classroom} />}
      {current === "stream" && <ComingSoon title="Class stream" description="Announcements and discussion are being rebuilt." />}
      {current === "attendance" && caps.isMember && <Attendance classroom={classroom} />}
      {current === "analytics" && caps.isMember && <Analytics classroom={classroom} />}
      {current === "settings" && caps.canManageClass && <Settings classroom={classroom} />}
    </ClassroomShell>
  );
}
