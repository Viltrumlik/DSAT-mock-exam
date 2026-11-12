/**
 * GrantPanel's "Expires at", on a device outside Tashkent.
 *
 * Access is granted at the centre and runs out at an hour in Tashkent. The field read what was
 * typed on the device's clock, so on a laptop three hours behind (Europe/Kyiv in November) access
 * typed to end at 16:00 ran on until 19:00 Tashkent.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const grantResources = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: { list: vi.fn(async () => ({ items: [] })) },
}));
vi.mock("@/lib/accessApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accessApi")>()),
  accessApi: {
    grantResources: (...args: unknown[]) => grantResources(...args),
    grantClassroomResources: vi.fn(),
  },
}));

const { GrantPanel } = await import("../GrantPanel");

let container: HTMLDivElement | undefined;
let root: Root | undefined;
let savedTz: string | undefined;

beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "Europe/Kyiv";
});

afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  grantResources.mockReset().mockResolvedValue({ created: 1, updated: 0, skipped: 0 });
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  document.body.innerHTML = "";
});

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <GrantPanel lockUserIds={[5]} lockResource={{ resource_type: "practice_test", resource_id: 9, label: "Practice Test 3" }} />,
    ),
  );
}

describe("GrantPanel on a device outside Tashkent", () => {
  it("really is on the other clock — otherwise nothing below proves anything", () => {
    expect(new Date("2026-12-01T16:00:00+05:00").getHours()).toBe(13);
  });

  it("ends access at the typed hour in Tashkent", async () => {
    await render();
    const expiry = document.body.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(expiry, "2026-12-01T16:00");
      expiry.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const grant = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Grant access")!;
    await act(async () => grant.click());

    expect(grantResources).toHaveBeenCalledWith(
      expect.objectContaining({ user_ids: [5], expires_at: "2026-12-01T11:00:00.000Z" }),
    );
  });
});
