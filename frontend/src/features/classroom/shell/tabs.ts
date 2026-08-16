import {
  LayoutDashboard,
  CalendarDays,
  CalendarCheck,
  ClipboardList,
  Presentation,
  Users,
  GraduationCap,
  Settings,
  FolderOpen,
  Timer,
  ListChecks,
} from "lucide-react";
import type { Capabilities } from "../capabilities";

/**
 * Every tab id the workspace understands — the VALUES, with the union derived from them.
 *
 * Written this way round because the union used to be hand-written here while
 * ClassroomWorkspace kept its own hardcoded copy of the same strings for its `?tab=`
 * guard. The two drifted: the copy still admitted ids that had no tab left. A type
 * cannot be turned back into an array, so the array has to be the source and
 * `isClassroomTabId` (below) has to be the only runtime guard.
 *
 * `stream`, `rankings` and `analytics` have no entry in CLASSROOM_TABS any more —
 * Overview absorbed all three — but they stay admitted here because Overview still
 * calls `onNavigate("rankings")`/`onNavigate("analytics")`; the visibleTabs check lands
 * them on Overview, which is where those views now live.
 */
export const CLASSROOM_TAB_IDS = [
  "overview",
  "lessons",
  "classwork",
  "assignments",
  "materials",
  "midterms",
  "results",
  "stream",
  "people",
  "rankings",
  "grading",
  "attendance",
  "analytics",
  "settings",
] as const;

export type ClassroomTabId = (typeof CLASSROOM_TAB_IDS)[number];

/** Narrow a raw `?tab=` value. The single runtime half of ClassroomTabId — never inline a copy. */
export function isClassroomTabId(v: string | null): v is ClassroomTabId {
  return v != null && (CLASSROOM_TAB_IDS as readonly string[]).includes(v);
}

export interface ClassroomTabDef {
  id: ClassroomTabId;
  label: string;
  icon: React.ElementType;
  show: (c: Capabilities) => boolean;
}

/** Single source of truth for workspace navigation. Visibility derives from capabilities. */
export const CLASSROOM_TABS: ClassroomTabDef[] = [
  // Overview now hosts the class rankings (Rankings/Stream/Analytics tabs removed).
  { id: "overview", label: "Overview", icon: LayoutDashboard, show: () => true },
  // The journal plan delivered into this class. Staff-only: students see the resulting
  // homework in Assignments, never the plan itself.
  { id: "lessons", label: "Lessons", icon: CalendarDays, show: (c) => c.isStaff },
  // What the class was given IN the room, and the points the teacher recorded for it.
  // Every member, students included — this is the one classwork surface a student has.
  // It reads the classwork carrier Assignments, NOT the lesson plan: the plan endpoints
  // are staff-gated server-side, so a student-shaped Lessons tab would only ever 403.
  { id: "classwork", label: "Classwork", icon: Presentation, show: (c) => c.isMember },
  // Staff-only, by the school's decision: attendance is a register the teaching team keeps,
  // not something a student browses. (The page still carries a student self-view branch, and
  // GET attendance/me/ still exists, in case that is ever reopened.)
  { id: "attendance", label: "Attendance", icon: CalendarCheck, show: (c) => c.isStaff },
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
