/**
 * The lc-up and Trials pages' tabs, apart from the pages: Next lets a `page.tsx` export nothing else,
 * and the console's panel draws the same tabs as trees under "lc-up link" and Demo
 * (Shell v0.4), in the same words.
 */
export type LcupTab = "status" | "groups" | "students" | "teachers" | "accounts" | "attendance" | "archive";

export const LCUP_TAB_IDS: readonly LcupTab[] = ["status", "groups", "students", "teachers", "accounts", "attendance", "archive"];

export const LCUP_TAB_LABEL: Record<LcupTab, string> = {
  status: "Status",
  groups: "Groups",
  students: "Students",
  teachers: "Teachers",
  accounts: "Accounts",
  attendance: "Attendance",
  archive: "Archive",
};

export type TrialsTab = "trials" | "missing";

export const TRIALS_TAB_IDS: readonly TrialsTab[] = ["trials", "missing"];

export const TRIALS_TAB_LABEL: Record<TrialsTab, string> = {
  trials: "Demo students",
  missing: "Not on class list",
};
