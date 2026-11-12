/**
 * A midterm's dates on the student's Midterm page — when a missed one closed, the day a
 * scheduled one opens — read by Tashkent's clock, whatever clock the student's device keeps.
 *
 * Runs on a device set to Europe/Kyiv (UTC+2 in November — three hours behind Tashkent). The
 * suite is pinned to Asia/Tashkent in vitest.config.ts, so only a test that moves the device
 * clock can see a label that follows the device instead of the school. "Now" is pinned too, so
 * the scheduled paper stays in the future and keeps its "Opens" label.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const DEVICE_TZ = "Europe/Kyiv";
/** 16:00 in Tashkent — 13:00 on the device. */
const FOUR_PM = "2026-11-09T16:00:00+05:00";
/** 01:00 on the 10th in Tashkent — still 22:00 on the 9th on the device. */
const ONE_AM_NEXT_DAY = "2026-11-10T01:00:00+05:00";
/** Before both: the scheduled paper has not opened yet. */
const NOW = "2026-11-01T09:00:00+05:00";

function row(over: Record<string, unknown>) {
  return {
    midterm_id: 1, title: "Midterm 1", subject: "MATH", scoring_scale: "SCALE_800", score_ceiling: 800,
    duration_minutes: 70, question_count: 44, flavor: "CLASSROOM", attempt_id: null, state: "NOT_STARTED",
    submitted: false, resit_open: false, is_open: false, is_before_start: false, awaiting_code: false,
    available_at: null, deadline: null, results_visible: false, score: null, certificate: null,
    ...over,
  };
}

const ROWS = [
  // Missed: not started, past its deadline.
  row({ midterm_id: 1, title: "Midterm 1", deadline: FOUR_PM }),
  // Scheduled: its window opens just after midnight in Tashkent.
  row({ midterm_id: 2, title: "Midterm 2", is_before_start: true, available_at: ONE_AM_NEXT_DAY }),
];

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/lib/api", () => ({ classesApi: { downloadCertificate: vi.fn() } }));
vi.mock("@/lib/midtermApi", () => ({
  midtermApi: { myMidterms: () => Promise.resolve(ROWS), createAttempt: vi.fn() },
  subjectLabel: (s: string) => s,
}));

const { default: MidtermList } = await import("../MidtermList");

let savedTz: string | undefined;
let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = DEVICE_TZ;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

afterAll(() => {
  vi.useRealTimers();
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MidtermList />
      </QueryClientProvider>,
    ),
  );
  for (let i = 0; i < 5 && !host.textContent?.includes("Midterm 2"); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function textOf(selector: string, startsWith: string): string {
  const el = [...host.querySelectorAll(selector)].find((e) => e.textContent?.trim().startsWith(startsWith));
  if (!el) throw new Error(`no ${selector} starting "${startsWith}"`);
  return el.textContent?.trim() ?? "";
}

describe("MidtermList on a device outside Tashkent", () => {
  it("really is running on the other clock — otherwise nothing below proves anything", () => {
    expect(new Date(FOUR_PM).getHours()).toBe(13);
  });

  it("says a missed midterm closed at the school's hour", () => {
    const closed = textOf("p", "closed ");
    expect(closed).toMatch(/(16:00|04:00\sPM)/);
    expect(closed).not.toMatch(/(13:00|01:00\sPM)/);
  });

  it("names the school's day a scheduled midterm opens, not the device's day before", () => {
    const opens = textOf("span", "Opens ");
    expect(opens).toMatch(/\b10\b/);
    expect(opens).not.toMatch(/\b9\b/);
  });
});
