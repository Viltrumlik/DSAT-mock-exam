import type { PeopleSection } from "@/features/ops/changelist/peopleApi";
import { formatDate, statusLabel } from "@/features/ops/users/peopleColumns";
import type { PersonCore } from "./personApi";
import { SCHOOL_TIME_ZONE } from "@/lib/schoolTime";

/** "+998 90 123 45 67" from the stored digits ("998901234567"); anything else as it is. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("998")) {
    return `+998 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
  }
  return phone;
}

/** Each people list's name, as the sidebar and the breadcrumb say it. */
export const LIST_LABEL: Record<PeopleSection, string> = { students: "Students", public: "Public users", staff: "Staff" };

/** The account's state in words; a debt freeze says it lifts itself, which an admin's does not. */
export function statusText(person: Pick<PersonCore, "frozen_reason" | "status" | "is_frozen">): string {
  if (person.frozen_reason === "debt") return "Frozen — unpaid (lifts when paid)";
  if (person.frozen_reason === "admin") return "Frozen — by admin";
  return statusLabel(person.status, person.is_frozen);
}

/**
 * A calendar day ("YYYY-MM-DD") as the changelist writes dates. Read as a local day: `new Date`
 * takes a bare date as UTC midnight, which is the day before anywhere west of Greenwich.
 */
export function formatDay(day: string | null | undefined): string {
  if (!day) return "—";
  return formatDate(/^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00` : day);
}

/** "Oct 15, 2026 14:05" — a moment, to the minute, by the school's clock. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: SCHOOL_TIME_ZONE });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: SCHOOL_TIME_ZONE });
  return `${date} ${time}`;
}
