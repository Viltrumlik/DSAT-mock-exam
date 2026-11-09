/**
 * An assessment's due date on its start page reads by Tashkent's clock, whatever clock the
 * student's device keeps.
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

const useMyAssessmentResult = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ assignmentId: "5" }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
// The guard is about sessions, not dates: let the page through.
vi.mock("@/components/AuthGuard", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/features/assessments/hooks", () => ({
  useMyAssessmentResult: () => useMyAssessmentResult(),
  useStartAttempt: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { default: AssessmentStartPage } = await import("../page");

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

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

/** Render the page for a homework due at `dueAt` and read the date under "Due". */
async function dueLabel(dueAt: string): Promise<string> {
  useMyAssessmentResult.mockReturnValue({
    data: {
      attempt: null,
      result: null,
      meta: {
        assignment_title: "Homework 1", set_title: "Homework 1", set_category: null,
        due_at: dueAt, question_count: 10, classroom_name: null,
      },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  await act(async () => root.render(<AssessmentStartPage />));
  const heading = [...host.querySelectorAll("p")].find((p) => p.textContent === "Due");
  if (!heading?.nextElementSibling) throw new Error("no Due date on the page");
  return (heading.nextElementSibling.textContent ?? "").replace(/\s/g, " ");
}

describe("assessment start page on a device outside Tashkent", () => {
  it("really is running on the other clock — otherwise nothing below proves anything", () => {
    expect(new Date(FOUR_PM).getHours()).toBe(13);
  });

  it("shows the due hour by the school's clock", async () => {
    expect(await dueLabel(FOUR_PM)).toBe("Nov 9, 04:00 PM");
  });

  it("dates a just-after-midnight deadline on the school's day, not the device's evening before", async () => {
    expect(await dueLabel(ONE_AM_NEXT_DAY)).toBe("Nov 10, 01:00 AM");
  });
});
