/**
 * The midterm panel's schedule editor and its "Start midterm" dialog, on a device outside Tashkent.
 *
 * A midterm opens at an hour in Tashkent — the class sits it in the room. The panel already says
 * when it "Opens…" by Tashkent's clock (#364), but its two `datetime-local` fields read and wrote
 * on the device's clock: on a laptop three hours behind (Europe/Kyiv in November) a 16:00 start
 * showed as 13:00 in the field, and a teacher who typed 16:00 opened the paper at 19:00.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const classroomPanel = vi.fn();
const updateClassroomSchedule = vi.fn();
const generateStartCode = vi.fn();

vi.mock("@/lib/midtermApi", () => ({
  midtermApi: {
    classroomPanel: (...args: unknown[]) => classroomPanel(...args),
    updateClassroomSchedule: (...args: unknown[]) => updateClassroomSchedule(...args),
    generateStartCode: (...args: unknown[]) => generateStartCode(...args),
    issueClassroomCertificates: vi.fn(),
    allowResit: vi.fn(),
    withdrawResit: vi.fn(),
    downloadClassroomCertificates: vi.fn(),
    getVersions: vi.fn(),
    previewVersions: vi.fn(),
    commitSeating: vi.fn(),
  },
  subjectLabel: (s: string) => (s === "MATH" ? "Mathematics" : "Reading & Writing"),
}));
vi.mock("@/lib/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: { downloadCertificate: vi.fn() },
}));

const { MidtermPanel } = await import("../pages/MidtermPanel");
const { capabilitiesFor } = await import("../capabilities");

/** 16:00 on the 9th in Tashkent — 13:00 on the device. */
const FOUR_PM = "2026-11-09T16:00:00+05:00";
const SIX_PM = "2026-11-09T18:00:00+05:00";

const PANEL = {
  midterm: { id: 7, title: "Unit 3 Midterm", subject: "MATH", scoring_scale: "SCALE_100", score_ceiling: 100 },
  schedule: {
    starts_at: FOUR_PM, deadline: SIX_PM, ignore_start: false,
    results_released: false, available_at: null, is_before_start: true, is_open: false,
    access_code: null, requires_code: true, notified_at: null,
  },
  students: [],
  stats: {
    assigned: 0, completed: 0, average: null, highest: null, lowest: null,
    score_ceiling: 100, mixed_scales: false, pass_mark: 60,
  },
  all_finished: false, certificates_issued: false, has_versions: false, versions: [],
};

let host: HTMLElement;
let root: Root;
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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  classroomPanel.mockReset().mockResolvedValue(PANEL);
  updateClassroomSchedule.mockReset().mockResolvedValue({});
  generateStartCode.mockReset().mockResolvedValue({ access_code: "123456" });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function settle(ticks = 12) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MidtermPanel classId={34} midtermId={7} title="Unit 3 Midterm" caps={capabilitiesFor("TEACHER")} onBack={() => {}} />
      </QueryClientProvider>,
    );
  });
  await settle();
}

const buttonLabelled = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
const timeFields = () =>
  Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]'));

describe("MidtermPanel's schedule on a device outside Tashkent", () => {
  it("really is on the other clock — otherwise nothing below proves anything", () => {
    expect(new Date(FOUR_PM).getHours()).toBe(13);
  });

  it("shows a 16:00 start as 16:00 and saves it untouched as 16:00", async () => {
    await mount();
    await act(async () => buttonLabelled("Schedule")!.click());

    expect(timeFields().map((f) => f.value)).toEqual(["2026-11-09T16:00", "2026-11-09T18:00"]);

    await act(async () => buttonLabelled("Save schedule")!.click());
    await settle(3);
    expect(updateClassroomSchedule).toHaveBeenCalledWith(34, 7, {
      starts_at: "2026-11-09T11:00:00.000Z",
      deadline: "2026-11-09T13:00:00.000Z",
      ignore_start: false,
    });
  });

  it("opens the Start dialog on the 16:00 start and keeps it at 16:00", async () => {
    await mount();
    await act(async () => buttonLabelled("Start midterm — generate code")!.click());

    expect(timeFields().map((f) => f.value)).toEqual(["2026-11-09T16:00"]);

    await act(async () => buttonLabelled("Set time & generate code")!.click());
    await settle(3);
    expect(updateClassroomSchedule).toHaveBeenCalledWith(34, 7, { starts_at: "2026-11-09T11:00:00.000Z" });
  });
});
