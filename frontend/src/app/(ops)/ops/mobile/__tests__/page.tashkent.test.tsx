/**
 * The times on /ops/mobile — when the release policy last changed, when a crash group was
 * first and last seen — read by Tashkent's clock, whatever clock the admin's device keeps.
 *
 * Runs on a device set to Europe/Kyiv (UTC+2 in November — three hours behind Tashkent). The
 * suite is pinned to Asia/Tashkent in vitest.config.ts, so only a test that moves the device
 * clock can see a label that follows the device instead of the school.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const DEVICE_TZ = "Europe/Kyiv";
/** 16:00 in Tashkent — 13:00 on the device. */
const FOUR_PM = "2026-11-09T16:00:00+05:00";
/** 01:00 on the 10th in Tashkent — still 22:00 on the 9th on the device. */
const ONE_AM_NEXT_DAY = "2026-11-10T01:00:00+05:00";

const POLICY = {
  platform: "ios", latest_version: "1.2.0", minimum_version: "1.1.0", update_url: "", message: "",
  updated_at: FOUR_PM, updated_by: null,
};
const DIAGNOSTICS = {
  days: 7,
  totals: { crash: 1, hang: 0, cpu: 0, disk: 0, error: 0 },
  app_versions: ["1.2.0"],
  groups: [
    { signature: "SampleCrash", kind: "crash", count: 2, installs: 1, first_seen: FOUR_PM, last_seen: ONE_AM_NEXT_DAY, sample_id: 1 },
  ],
  recent: [],
};

vi.mock("@/features/mobile/mobileHooks", () => ({
  useReleasePolicy: () => ({ data: POLICY, isError: false, isLoading: false }),
  useSaveReleasePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDiagnostics: () => ({ data: DIAGNOSTICS, isError: false, isLoading: false }),
  useDiagnostic: () => ({ data: undefined, isError: false }),
}));

const { default: OpsMobilePage } = await import("../page");

let savedTz: string | undefined;
let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = DEVICE_TZ;
});

afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<OpsMobilePage />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("/ops/mobile on a device outside Tashkent", () => {
  it("really is running on the other clock — otherwise nothing below proves anything", () => {
    expect(new Date(FOUR_PM).getHours()).toBe(13);
  });

  it("says when the release policy last changed by the school's clock", () => {
    const changed = [...host.querySelectorAll("span")].find((s) => s.textContent?.startsWith("Last changed "));
    expect(changed?.textContent).toBe("Last changed 9 Nov, 16:00");
  });

  it("dates a crash group's first and last report by the school's clock", () => {
    const cells = [...host.querySelectorAll("tbody td")].map((td) => td.textContent);
    // First seen, then last seen — the last one just after midnight, so on the school's 10th.
    expect(cells.slice(-2)).toEqual(["9 Nov, 16:00", "10 Nov, 01:00"]);
  });
});
