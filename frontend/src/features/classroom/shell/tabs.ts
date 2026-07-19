import {
  LayoutDashboard,
  CalendarDays,
  ClipboardList,
  Users,
  GraduationCap,
  Settings,
  FolderOpen,
  Timer,
  ListChecks,
} from "lucide-react";
import type { Capabilities } from "../capabilities";

export type ClassroomTabId =
  | "overview"
  | "lessons"
  | "assignments"
  | "materials"
  | "midterms"
  | "results"
  | "stream"
  | "people"
  | "rankings"
  | "grading"
  | "attendance"
  | "analytics"
  | "settings";

export interface ClassroomTabDef {
  id: ClassroomTabId;
  label: string;
  icon: React.ElementType;
  show: (c: Capabilities) => boolean;
}

/** Single source of truth for workspace navigation. Visibility derives from capabilities. */
export const CLASSROOM_TABS: ClassroomTabDef[] = [
  // Overview now hosts the class rankings (Rankings/Stream/Attendance/Analytics tabs removed).
  { id: "overview", label: "Overview", icon: LayoutDashboard, show: () => true },
  // The journal plan delivered into this class. Staff-only: students see the resulting
  // homework in Assignments, never the plan itself.
  { id: "lessons", label: "Lessons", icon: CalendarDays, show: (c) => c.isStaff },
  { id: "assignments", label: "Assignments", icon: ClipboardList, show: () => true },
  { id: "midterms", label: "Midterms", icon: Timer, show: (c) => c.canManageAssignments },
  { id: "materials", label: "Materials", icon: FolderOpen, show: (c) => c.isMember },
  { id: "results", label: "Results", icon: ListChecks, show: (c) => c.isStaff },
  { id: "people", label: "People", icon: Users, show: () => true },
  { id: "grading", label: "Grading", icon: GraduationCap, show: (c) => c.canGrade },
  { id: "settings", label: "Settings", icon: Settings, show: (c) => c.canManageClass },
];

export function visibleTabs(caps: Capabilities): ClassroomTabDef[] {
  return CLASSROOM_TABS.filter((t) => t.show(caps));
}
