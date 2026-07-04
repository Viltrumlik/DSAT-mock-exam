/**
 * Human-readable weekdays for class meta (matches center schedule).
 * EVEN = Tue/Thu/Sat; ODD = Mon/Wed/Fri.
 */
export function formatLessonDaysMeta(lessonDays: string | undefined | null): string {
  if (!lessonDays) return "";
  if (lessonDays === "EVEN") return "Tuesday, Thursday, Saturday";
  if (lessonDays === "ODD") return "Monday, Wednesday, Friday";
  return lessonDays;
}

/** Abbreviated weekdays for compact chrome (e.g. classroom header): "Tue, Thu, Sat". */
export function formatLessonDaysShort(lessonDays: string | undefined | null): string {
  if (!lessonDays) return "";
  if (lessonDays === "EVEN") return "Tue, Thu, Sat";
  if (lessonDays === "ODD") return "Mon, Wed, Fri";
  return lessonDays;
}

/** Leading " · " + meta text, or empty when nothing to show. */
export function lessonDaysMetaSuffix(lessonDays: string | undefined | null): string {
  const d = formatLessonDaysMeta(lessonDays);
  return d ? ` · ${d}` : "";
}

