/**
 * Which subject a support teacher covers, as a student reads it.
 *
 * A student with a Math and an English support teacher sees two names on the calendar; without
 * the subject beside each, the only way to find out who to bring quadratics to is to book one
 * and ask. The account's `subject` is "math", "english" or "both" — a support teacher is the
 * one role allowed to cover both.
 */
import { Pill } from "@/features/classroom/ui";
import type { PillTone } from "@/features/classroom/ui";

const LABEL: Record<string, string> = {
  math: "Math",
  english: "English",
  both: "Math & English",
};

// Math and English wear the tones the classroom header gives them, so the same subject reads
// the same colour on a class and on its support teacher.
const TONE: Record<string, PillTone> = {
  math: "info",
  english: "primary",
  both: "neutral",
};

const key = (subject: string | null | undefined) => (subject ?? "").trim().toLowerCase();

/** "Math", "English", "Math & English" — or null when the server named no subject. */
export function supportSubjectLabel(subject: string | null | undefined): string | null {
  return LABEL[key(subject)] ?? null;
}

/** The subject as a pill. Renders nothing when there is no subject to name. */
export function SupportSubjectPill({
  subject,
  className,
}: {
  subject: string | null | undefined;
  className?: string;
}) {
  const label = supportSubjectLabel(subject);
  if (!label) return null;
  return (
    <Pill tone={TONE[key(subject)]} className={className}>
      <span className="sr-only">Subject: </span>
      {label}
    </Pill>
  );
}
