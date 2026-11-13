import api from "@/lib/api";
import type { AttentionItem } from "./attention";

/** `GET /api/classes/admin/lessons/today/` — every active class meeting today and its register. */
export type LessonRow = {
  classroom: { id: number; name: string; room?: string | null; branch?: string | null };
  teacher: { id: number; name: string } | null;
  starts_at: string | null;
  ends_at: string | null;
  phase: "upcoming" | "now" | "ended" | "unknown";
  register: {
    roster: number;
    marked: number;
    present: number;
    late: number;
    absent: number;
    excused: number;
    taken: boolean;
    /** The register window: "not_yet" / "open" / "closed" (classes.lessons_today). */
    state: string;
    closes_at: string | null;
  };
};
export type LessonsToday = {
  date: string;
  lessons: LessonRow[];
  counts: { lessons: number; now: number; not_marked: number; no_teacher: number };
};

export const lessonsTodayKey = ["classes", "admin", "lessons", "today"] as const;

export async function fetchLessonsToday(): Promise<LessonsToday> {
  return (await api.get<LessonsToday>("/classes/admin/lessons/today/")).data;
}

/** "15:00" by the learning center's clock. */
export function hhmm(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** A register someone can still fix: the lesson ended, nobody marked it, and it is still open. */
export function isNotMarked(l: LessonRow): boolean {
  return l.phase === "ended" && !l.register.taken && String(l.register.state).toUpperCase() === "OPEN";
}

export function notMarkedItem(d: LessonsToday): AttentionItem | null {
  const n = d.counts.not_marked;
  if (!n) return null;
  const first = d.lessons.find(isNotMarked);
  return {
    id: "lessons",
    icon: "calcheck",
    tone: "critical",
    count: n,
    title: n === 1 && first ? `${first.classroom.name} attendance not marked` : `${n} registers not marked`,
    detail: first ? [first.ends_at ? `Lesson ended ${hhmm(first.ends_at)}` : "", first.teacher?.name ?? ""].filter(Boolean).join(" · ") || undefined : undefined,
    action: { label: "Mark now", href: first ? `/ops/classrooms/${first.classroom.id}?tab=attendance` : "/ops/classrooms" },
  };
}
