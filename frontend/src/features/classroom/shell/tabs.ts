import {
  LayoutDashboard,
  ClipboardList,
  MessageSquare,
  Users,
  Trophy,
  GraduationCap,
  CalendarCheck,
  BarChart3,
  Settings,
  FolderOpen,
  Timer,
  ListChecks,
} from "lucide-react";
import type { Capabilities } from "../capabilities";

export type ClassroomTabId =
  | "overview"
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
  { id: "overview", label: "Overview", icon: LayoutDashboard, show: () => true },
  { id: "assignments", label: "Assignments", icon: ClipboardList, show: () => true },
  { id: "midterms", label: "Midterms", icon: Timer, show: (c) => c.canManageAssignments },
  { id: "materials", label: "Materials", icon: FolderOpen, show: (c) => c.isMember },
  { id: "results", label: "Results", icon: ListChecks, show: (c) => c.isStaff },
  { id: "stream", label: "Stream", icon: MessageSquare, show: () => true },
  { id: "people", label: "People", icon: Users, show: () => true },
  { id: "rankings", label: "Rankings", icon: Trophy, show: () => true },
  { id: "grading", label: "Grading", icon: GraduationCap, show: (c) => c.canGrade },
  { id: "attendance", label: "Attendance", icon: CalendarCheck, show: (c) => c.isMember },
  { id: "analytics", label: "Analytics", icon: BarChart3, show: (c) => c.isMember },
  { id: "settings", label: "Settings", icon: Settings, show: (c) => c.canManageClass },
];

export function visibleTabs(caps: Capabilities): ClassroomTabDef[] {
  return CLASSROOM_TABS.filter((t) => t.show(caps));
}
