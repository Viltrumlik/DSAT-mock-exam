/**
 * Student roadmap payload — the shape returned by GET /api/classes/roadmap/.
 * See backend/classes/roadmap.py for the contract. Locked (other-level) lessons carry
 * ONLY {lesson_number, title, lesson_type, is_midterm}; the own-level fields below are
 * present only when the level `is_own_level`.
 */

export type RoadmapLessonState = "completed" | "available" | "upcoming";
export type RoadmapLessonType = "HOMEWORK" | "MIDTERM";

export type RoadmapLesson = {
  lesson_number: number;
  title: string;
  lesson_type: RoadmapLessonType;
  is_midterm: boolean;
  // Own-level only (absent on locked lessons):
  accessible?: boolean;
  state?: RoadmapLessonState;
  assignment_id?: number | null;
  scheduled_for?: string | null;
};

export type RoadmapLevel = {
  level: string;
  level_label: string;
  /** False for a rung the subject does not offer (English Foundation). */
  offered: boolean;
  is_own_level: boolean;
  /** False → no published journal for this level yet ("coming soon"). */
  journal_published: boolean;
  lesson_count: number;
  lessons: RoadmapLesson[];
};

export type RoadmapTrack = {
  subject: "math" | "english";
  subject_label: string;
  own_level: string | null;
  own_level_label: string | null;
  /** The classroom whose released homework the own-level lessons link to. */
  own_classroom_id: number | null;
  levels: RoadmapLevel[];
};

export type RoadmapResponse = { tracks: RoadmapTrack[] };
