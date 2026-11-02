/**
 * The red band under the header (owner, 2026-11-02): a centre student who owes sees it on every page
 * that has a header. A public learner, staff browsing the student site, a frozen learner (their own
 * screen says the amount) and the runners without a header do not, and a payment clears it by itself.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mine = vi.fn();
let me: Record<string, unknown>;
let pathname: string;

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => router }));
vi.mock("@/hooks/useMe", () => ({
  useMe: () => ({ bootState: "AUTHENTICATED", isAuthenticated: true, me, globalInteractionBlockedHard: false }),
}));
vi.mock("@/lib/api", () => ({
  default: { get: () => Promise.reject(new Error("not this test's request")) },
  authApi: { logout: vi.fn() },
}));
vi.mock("@/features/finance/financeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/finance/financeApi")>()),
  financeApi: { mine: (...args: unknown[]) => mine(...args) },
}));
// Each reads its own endpoints, and none has a say in the band.
vi.mock("../StudentPrompts", () => ({ StudentPrompts: () => null }));
vi.mock("../StudentHeaderExtras", () => ({
  EventsHeaderButton: () => null,
  EventsMenuRow: () => null,
  StudentHeaderExtras: () => null,
  StudentAccountMenuRows: () => null,
}));
vi.mock("@/features/dailyQuestions/QuestionOfTheDayPrompt", () => ({
  QOTD_PATH: "/question-of-the-day",
  QuestionOfTheDayPrompt: ({ belowTicker }: { belowTicker?: boolean }) => (
    <i data-testid="qotd" data-below-ticker={String(!!belowTicker)} />
  ),
}));

const { default: StudentAppShell } = await import("../StudentAppShell");

const OWES = {
  linked: true, balance: -250000, debt: 250000, updated_at: "2026-11-02T09:00:00+05:00", frozen_for_debt: false,
  debt_notice: true, freeze_day: 6, monthly_cost: 500000, groups: [{ name: "Junior G21", monthly_cost: 500000 }],
  payments: [],
};
const PAID = { ...OWES, balance: 0, debt: 0, debt_notice: false };

const STUDENT = { id: 7, role: "student", is_frozen: false, permissions: [], first_name: "Aziz" };

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mine.mockReset();
  me = STUDENT;
  pathname = "/";
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <StudentAppShell>
          <p>page</p>
        </StudentAppShell>
      </QueryClientProvider>,
    );
  });
  await advance(100);
}

const band = () => host.querySelector('[role="status"]');

describe("StudentAppShell — the debt ticker", () => {
  it("runs right under the header for a centre student who owes", async () => {
    mine.mockResolvedValue(OWES);
    await mount();
    expect(band()?.textContent).toContain("You owe 250,000 UZS. Please visit the administration.");
    expect(host.querySelector("header")?.nextElementSibling).toBe(band());
    expect(band()?.nextElementSibling?.tagName).toBe("MAIN");
  });

  it("is not there when the server says it is not theirs", async () => {
    // An exempted student still has a debt; the server's word decides.
    mine.mockResolvedValue({ ...OWES, debt_notice: false });
    await mount();
    expect(band()).toBeNull();
  });

  it("is not there for a student lc-up does not know", async () => {
    mine.mockResolvedValue({ linked: false });
    await mount();
    expect(band()).toBeNull();
  });

  it("is never asked for on a public learner's behalf", async () => {
    me = { ...STUDENT, role: "public_student" };
    pathname = "/mock-exam";
    mine.mockResolvedValue(OWES);
    await mount();
    expect(mine).not.toHaveBeenCalled();
    expect(band()).toBeNull();
  });

  it("is never asked for on behalf of staff browsing the student site", async () => {
    me = { ...STUDENT, role: "admin", permissions: ["*"] };
    mine.mockResolvedValue(OWES);
    await mount();
    expect(mine).not.toHaveBeenCalled();
    expect(band()).toBeNull();
  });

  it("gives way to a frozen learner's own screen", async () => {
    me = { ...STUDENT, is_frozen: true };
    mine.mockResolvedValue(OWES);
    await mount();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(band()).toBeNull();
  });

  it("stays out of a runner, which has no header: not even a request", async () => {
    pathname = "/assessments/attempt/5";
    mine.mockResolvedValue(OWES);
    await mount();
    expect(host.querySelector("header")).toBeNull();
    expect(mine).not.toHaveBeenCalled();
    expect(band()).toBeNull();
  });

  it("clears by itself after a payment, without a reload", async () => {
    mine.mockResolvedValue(OWES);
    await mount();
    expect(band()).not.toBeNull();
    mine.mockResolvedValue(PAID);
    await advance(15 * 60 * 1000);
    expect(band()).toBeNull();
  });

  it("makes the Question of the Day prompt stand clear of it, only while it is there", async () => {
    mine.mockResolvedValue(OWES);
    await mount();
    expect(host.querySelector('[data-testid="qotd"]')?.getAttribute("data-below-ticker")).toBe("true");
    mine.mockResolvedValue(PAID);
    await advance(15 * 60 * 1000);
    expect(host.querySelector('[data-testid="qotd"]')?.getAttribute("data-below-ticker")).toBe("false");
  });
});
