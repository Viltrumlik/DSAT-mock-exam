import { formatDate } from "@/features/ops/users/peopleColumns";

/**
 * A calendar day ("YYYY-MM-DD") as the changelist writes dates. Read as a local day: `new Date`
 * takes a bare date as UTC midnight, which is the day before anywhere west of Greenwich.
 */
export function formatDay(day: string | null | undefined): string {
  if (!day) return "—";
  return formatDate(/^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00` : day);
}

/** "Oct 15, 2026 14:05" — a moment, to the minute. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${formatDate(iso)} ${time}`;
}
