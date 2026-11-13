/**
 * `me` payloads for tests, as GET /users/me/ gives them since the CRM permissions (plan 2026-11-12-crm-roles).
 * A test that renders a console component reading permissions mocks `useMe` with one of these:
 *
 *   vi.mock("@/hooks/useMe", async (importOriginal) => ({
 *     ...(await importOriginal<object>()),
 *     useMe: () => ({ me: (await import("@/features/ops/testing/me")).ADMIN_ME }),
 *   }));
 */

/** An administrator: the old six permissions, plus every CRM permission but manage_staff (the owner's). */
export const ADMIN_ME = {
  id: 1,
  role: "admin",
  permissions: [
    "adjust_balance", "assign_access", "create_classroom", "debt_freeze", "edit_people", "enroll", "events_shop",
    "lcup_tools", "manage_groups", "manage_seats", "manage_tests", "manage_users", "send_debt_sms",
    "send_sms", "set_prices", "submit_test", "take_payment", "view_dashboard", "view_money", "view_people",
    "view_reports", "void_payment",
  ],
};

/** A teacher who can open the console: no CRM permission. */
export const TEACHER_ME = { id: 2, role: "teacher", permissions: ["assign_access", "create_classroom", "manage_tests", "submit_test", "view_dashboard"] };

/** The owner. */
export const OWNER_ME = { id: 3, role: "super_admin", permissions: ["*"] };

/** An accountant: the money only. */
export const ACCOUNTANT_ME = {
  id: 4,
  role: "accountant",
  permissions: [
    "adjust_balance", "debt_freeze", "send_debt_sms", "set_prices", "take_payment", "view_dashboard", "view_money",
    "view_people", "view_reports", "void_payment",
  ],
};
