import { describe, it, expect } from "vitest";
import { parseUserMePayload } from "@/lib/criticalApiContract";

/**
 * Regression: a support teacher covering BOTH subjects was bounced from the teacher portal
 * back to /login, forever. `/users/me/` returned 200 with `subject: "both"`, but the contract
 * schema only accepted `"math" | "english" | null`, so the parse threw, the query went to
 * `error`, boot state read UNAUTHENTICATED, and AuthGuard redirected to /login. No 401 was ever
 * involved and no backend change could fix it — the failure was this client-side schema.
 */

const base = {
  id: 43,
  is_frozen: false,
  is_admin: true,
  telegram_linked: false,
  role: "support_teacher",
  permissions: ["submit_test", "view_dashboard"],
  last_password_change: null,
  security_step_up_active: false,
  has_recent_security_alerts: false,
};

describe("parseUserMePayload subject", () => {
  it('accepts subject "both" without throwing (the support-teacher login loop)', () => {
    const me = parseUserMePayload({ ...base, subject: "both" }, "test");
    expect(me.id).toBe(43);
  });

  it.each(["math", "english", null])("accepts subject %s", (subject) => {
    expect(() => parseUserMePayload({ ...base, subject }, "test")).not.toThrow();
  });

  it("tolerates an unknown future subject value rather than taking the shell down", () => {
    expect(() => parseUserMePayload({ ...base, subject: "science" }, "test")).not.toThrow();
  });
});
