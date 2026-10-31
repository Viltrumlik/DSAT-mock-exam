import type { AssessmentChoice } from "@/features/assessments/types";
import type { DailyQuestion, DailyQuestionReward } from "./dailyQuestionsApi";

/** What the prompt and the runner print for each subject the server deals. */
export const SUBJECT_LABEL: Record<string, string> = { english: "English", math: "Math" };

export function levelLabel(level: string): string {
  return level ? level[0].toUpperCase() + level.slice(1) : "";
}

/** "Math · Senior" — one question's subject and the class level it was dealt at. */
export function trackLabel(item: Pick<DailyQuestion, "subject" | "level">): string {
  const subject = SUBJECT_LABEL[item.subject] ?? item.subject;
  const level = levelLabel(item.level);
  return level ? `${subject} · ${level}` : subject;
}

export function rewardLabel(r: DailyQuestionReward): string {
  return `+${r.xp} XP · +${r.points} points`;
}

export function parseChoices(raw: unknown): AssessmentChoice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const id = String((x as Record<string, unknown>).id ?? "").trim();
      return id ? { id, text: String((x as Record<string, unknown>).text ?? "") } : null;
    })
    .filter((x): x is AssessmentChoice => x !== null);
}

/** "B", "0.5 or 1/2", "True" — the answer key as a student reads it. */
export function formatAnswer(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatAnswer).filter(Boolean).join(" or ");
  if (typeof value === "boolean") return value ? "True" : "False";
  if (value === null || value === undefined) return "";
  return String(value);
}

export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** The ids the key accepts, upper-cased — a choice question's key may be "b" or ["B"]. */
export function acceptedIds(correct: unknown): Set<string> {
  const list = Array.isArray(correct) ? correct : [correct];
  return new Set(list.filter((v) => v !== null && v !== undefined).map((v) => String(v).trim().toUpperCase()));
}
