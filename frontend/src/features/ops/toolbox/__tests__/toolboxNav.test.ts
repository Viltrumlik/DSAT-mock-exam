/**
 * The Toolbox menu item exists only on the test copy (NEXT_PUBLIC_STAGING_TOOLBOX=1), for the owner and admins, with
 * a TEST badge. The map is built when `opsNav` loads, so each case loads it afresh under its own environment.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ACCOUNTANT_ME, ADMIN_ME, OWNER_ME, TEACHER_ME } from "@/features/ops/testing/me";

async function loadNav() {
  vi.resetModules();
  return import("@/features/ops/shell/opsNav");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the Toolbox menu item", () => {
  it("is listed under People & system with a TEST badge on the test copy", async () => {
    vi.stubEnv("NEXT_PUBLIC_STAGING_TOOLBOX", "1");
    const { OPS_CATEGORIES } = await loadNav();
    const system = OPS_CATEGORIES.find((c) => c.id === "system");
    const item = system?.groups.flatMap((g) => g.items).find((i) => i.href === "/ops/toolbox");
    expect(item?.label).toBe("Toolbox");
    expect(item?.badge).toBe("TEST");
  });

  it("is not there anywhere else", async () => {
    for (const value of [undefined, "", "0", "true"]) {
      vi.stubEnv("NEXT_PUBLIC_STAGING_TOOLBOX", value);
      const { OPS_NAV_GROUPS } = await loadNav();
      expect(OPS_NAV_GROUPS.flatMap((g) => g.items).some((i) => i.href === "/ops/toolbox")).toBe(false);
    }
  });

  it("shows to the owner and an admin, not to an accountant or a teacher", async () => {
    vi.stubEnv("NEXT_PUBLIC_STAGING_TOOLBOX", "1");
    const { OPS_NAV_GROUPS, canSeeItem, opsPathAllowed } = await loadNav();
    const item = OPS_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === "/ops/toolbox");
    expect(item).toBeDefined();
    expect([OWNER_ME, ADMIN_ME, ACCOUNTANT_ME, TEACHER_ME].map((me) => canSeeItem(item!, me))).toEqual([true, true, false, false]);
    expect(opsPathAllowed("/ops/toolbox", ADMIN_ME)).toBe(true);
  });
});
