/**
 * /ops/stories' publish window, on a device outside Tashkent.
 *
 * The form's own comment always meant it: an admin setting "Friday 09:00" means Friday 09:00 in
 * Tashkent. Its `datetime-local` fields read and wrote on the device's clock, though, so on a
 * laptop three hours behind (Europe/Kyiv in November) a story set for 16:00 showed as 13:00 when
 * reopened, and one typed for 16:00 went up at 19:00 Tashkent.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn();
const useAdminStories = vi.fn();

vi.mock("@/features/stories/storiesHooks", () => ({
  useAdminStories: () => useAdminStories(),
  useDeleteStory: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveStory: () => ({ mutate: save, isPending: false }),
}));

const { default: OpsStoriesPage } = await import("../page");

/** 16:00 on the 9th in Tashkent — 13:00 on the device. */
const FOUR_PM = "2026-11-09T16:00:00+05:00";
/** 01:00 on the 10th in Tashkent — still the 9th on the device. */
const PAST_MIDNIGHT = "2026-11-10T01:00:00+05:00";

function story(over: Record<string, unknown> = {}) {
  return {
    id: 3, title: "Mock day", caption: "", image_url: null, link_url: "", is_active: true,
    sort_order: 0, starts_at: FOUR_PM, ends_at: PAST_MIDNIGHT, is_live: false,
    created_at: "2026-11-01T10:00:00+05:00",
    ...over,
  };
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;
let savedTz: string | undefined;
const text = () => document.body.textContent ?? "";
const buttonLabelled = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

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
  useAdminStories.mockReturnValue({ data: [story()], isPending: false, isError: false, refetch: vi.fn() });
  save.mockReset();
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
  await act(async () => root!.render(<OpsStoriesPage />));
}

describe("/ops/stories on a device outside Tashkent", () => {
  it("really is on the other clock — otherwise nothing below proves anything", () => {
    expect(new Date(FOUR_PM).getHours()).toBe(13);
  });

  it("dates the window by Tashkent's calendar in the list", async () => {
    await render();
    // Ends 01:00 on the 10th in Tashkent: the device would still call it the 9th.
    expect(text()).toContain(new Date("2026-11-10T12:00:00Z").toLocaleDateString(undefined, { timeZone: "UTC" }));
  });

  it("edits a 16:00 window as 16:00 and saves it untouched as 16:00", async () => {
    await render();
    await act(async () => buttonLabelled("Edit")!.click());

    const fields = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]'));
    expect(fields.map((f) => f.value)).toEqual(["2026-11-09T16:00", "2026-11-10T01:00"]);

    await act(async () => buttonLabelled("Save")!.click());
    expect(save.mock.calls[0][0]).toMatchObject({
      id: 3,
      body: { starts_at: "2026-11-09T11:00:00.000Z", ends_at: "2026-11-09T20:00:00.000Z" },
    });
  });
});
