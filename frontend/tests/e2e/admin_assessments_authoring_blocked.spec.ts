import { test, expect } from "@playwright/test";

test.describe("admin: assessments authoring blocked on admin console", () => {
  test("shows banner and hides New set button", async ({ page, context }) => {
    // This one needs a server of its own: the cookie below is scoped to `localhost` and the
    // navigation is relative. `playwright.config.ts` defaults `baseURL` to
    // https://questions.mastersat.uz, so with nothing set it drove a browser at **production**
    // — where the cookie does not apply, nobody is signed in, and the Assessments tab it waits
    // for never appears. That is what the 60s timeout in CI was.
    //
    // Every other spec in this directory already guards itself this way (`test.skip` when its
    // E2E_* vars are missing). This one did not, so it was the only test in the merge gate's
    // Playwright step that ran at all — and it ran against the live site.
    const target = String(process.env.PLAYWRIGHT_BASE_URL || "").trim();
    test.skip(
      !target,
      "Set PLAYWRIGHT_BASE_URL to a locally served build — this spec is not safe against prod",
    );

    const domain = new URL(target).hostname;

    // Simulate admin.* console mode as used by the page.
    await context.addCookies([
      {
        name: "lms_console",
        value: "admin",
        domain,
        path: "/",
      },
    ]);

    await page.goto("/admin");

    // Switch to Assessments tab.
    await page.getByRole("button", { name: /assessments/i }).click();

    await expect(page.getByText(/authoring disabled on this subdomain/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /new set/i })).toHaveCount(0);
  });
});
