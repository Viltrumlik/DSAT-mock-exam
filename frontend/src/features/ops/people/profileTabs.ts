import { P, holds, type MeLike } from "@/features/ops/permissions";
import type { PersonCore } from "./personApi";

/**
 * A student's profile tabs in lc-up's order (Guruhlar, To'lovlar, Eslatma, Chegirma, Imtihonlar, Tarix, Xaridlar,
 * SMS, Mashqlar, Tanga/Kristal — lc-up structure, 22 Nov 2026), then our own Attendance and Security. Labels stay
 * English. A tab whose record this system does not keep says so in one line; it is never left out of the order.
 */
export type ProfileTab =
  | "groups"
  | "payments"
  | "notes"
  | "discounts"
  | "exams"
  | "history"
  | "purchases"
  | "sms"
  | "exercises"
  | "coins"
  | "attendance"
  | "security";

export const PROFILE_TAB_LABEL: Record<ProfileTab, string> = {
  groups: "Groups",
  payments: "Payments",
  notes: "Notes",
  discounts: "Discounts",
  exams: "Exams",
  history: "History",
  purchases: "Purchases",
  sms: "SMS",
  exercises: "Exercises",
  coins: "Coins & crystals",
  attendance: "Attendance",
  security: "Security",
};

const ORDER: ProfileTab[] = [
  "groups", "payments", "notes", "discounts", "exams", "history", "purchases", "sms", "exercises", "coins", "attendance", "security",
];

/** The open tab when the address names none. */
export const FIRST_PROFILE_TAB: ProfileTab = "groups";

/** Addresses from before the redesign keep working: the old Overview opens Groups, Results opens Exams. */
const OLD_KEYS: Record<string, ProfileTab> = { overview: "groups", results: "exams" };

/**
 * The tabs this viewer gets: money (Payments, Discounts) only with `view_money`, SMS only with an SMS permission —
 * the same gates the page had (features/ops/permissions); the server refuses the rest anyway.
 */
export function profileTabsFor(me: MeLike): ProfileTab[] {
  return ORDER.filter((key) => {
    if (key === "payments" || key === "discounts") return holds(me, P.viewMoney);
    if (key === "sms") return holds(me, P.sendSms, P.sendDebtSms);
    return true;
  });
}

/** The open tab from `?tab=`: an old key is read as its new home; anything unknown, or not offered, is Groups. */
export function openProfileTab(raw: string | null, tabs: ProfileTab[]): ProfileTab {
  const key = (raw && (OLD_KEYS[raw] ?? raw)) || FIRST_PROFILE_TAB;
  return (tabs as string[]).includes(key) ? (key as ProfileTab) : FIRST_PROFILE_TAB;
}

/** What a tab holds, on the tab when worth knowing before opening: the groups, the attendance rate. */
export function profileTabCounts(person: PersonCore): Partial<Record<ProfileTab, { count: number | string; tone?: "critical" | "attention" }>> {
  const out: Partial<Record<ProfileTab, { count: number | string; tone?: "critical" | "attention" }>> = {};
  if (person.groups.length) out.groups = { count: person.groups.length };
  const rate = person.glance?.attendance_rate;
  if (rate != null) out.attendance = { count: `${Math.round(rate)} %`, tone: rate < 60 ? "critical" : rate < 85 ? "attention" : undefined };
  return out;
}
