/**
 * The time machine's panel: one request at a time, then it waits for the machine (the copy restarts meanwhile, so a
 * failed ask is "still working") and reloads the page once its request is done, so the clock script runs again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { DayReport, TimeJob, TimeState } from "../toolboxApi";

const time = vi.fn();
const ask = vi.fn();
vi.mock("@/features/ops/toolbox/toolboxApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ops/toolbox/toolboxApi")>()),
  toolboxApi: { time: () => time(), ask: (body: unknown) => ask(body) },
}));

const { TimeMachinePanel } = await import("@/features/ops/toolbox/TimeMachinePanel");

function stateOf(over: Partial<TimeState> = {}): TimeState {
  return {
    offset_days: 0, test_date: "2026-11-25", checkpoints: [], busy: null, last: null, history: [], saved_at: null,
    pending: false, ...over,
  };
}

function day(test_date: string, count: number, amount: number, alerts: string[] = []): DayReport {
  return {
    test_date, lessons: { count, amount }, frozen: 3, unfrozen: 1, messages: { sms: 5, telegram: 2, email: 0, push: 4 },
    alerts, errors: [],
  };
}

const RUNNING: TimeJob = { id: "r1", action: "forward", params: { days: 1 }, by: "Aziz Karimov", started_at: "2026-11-25T10:00:00+05:00" };

let host: HTMLDivElement;
let root: Root;

function render(reload = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<QueryClientProvider client={client}><TimeMachinePanel reload={reload} /></QueryClientProvider>));
  return reload;
}

/** Lets answers arrive: react-query hands them over on a 0 ms timer, and the timers here are fake. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 3; i += 1) await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`no button "${name}" in: ${host.textContent}`);
  return found;
}

beforeEach(() => {
  vi.useFakeTimers();
  time.mockReset();
  ask.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("TimeMachinePanel", () => {
  it("asks for one day forward, then asks the time machine every 3 s until it is done, and reloads", async () => {
    time.mockResolvedValue(stateOf());
    ask.mockResolvedValue({ id: "r1" });
    const reload = render();
    await settle();
    expect(host.textContent).toContain("25 Nov 2026");

    await act(async () => button("+1 day").click());
    await settle();
    expect(ask).toHaveBeenCalledWith({ action: "forward", days: 1 });
    expect(host.textContent).toContain("The time machine is working… (the copy restarts, 10–60 s)");

    const asked = time.mock.calls.length;
    time.mockResolvedValue(stateOf({ busy: RUNNING }));
    await advance(3_000);
    expect(time.mock.calls.length).toBe(asked + 1);
    expect(reload).not.toHaveBeenCalled();

    time.mockResolvedValue(stateOf({ offset_days: 1, test_date: "2026-11-26", last: { ...RUNNING, ok: true, result: { checkpoint: 1, days: [] } } }));
    await advance(3_000);
    expect(time.mock.calls.length).toBe(asked + 2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("turns every button off while the time machine is busy", async () => {
    time.mockResolvedValue(stateOf({
      busy: RUNNING,
      checkpoints: [
        { id: 0, db: "stg_cp_0", kind: "base", label: "Copy of prod", offset_days: 0, test_date: "2026-11-25", taken_at: "2026-11-25T09:00:00+05:00" },
        { id: 1, db: "stg_cp_1", kind: "jump", label: "Before +1 day", offset_days: 0, test_date: "2026-11-25", taken_at: "2026-11-25T10:00:00+05:00" },
      ],
    }));
    render();
    await settle();
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(
      expect.arrayContaining(["+1 day", "+1 week", "Go to date", "Go back here", "Back to today", "Refresh from prod"]),
    );
    expect(buttons.filter((b) => !b.disabled).map((b) => b.textContent)).toEqual([]);
    expect(host.querySelector<HTMLInputElement>('input[type="date"]')?.disabled).toBe(true);
    expect(host.textContent).toContain("The time machine is working");
  });

  it("keeps saying it is working while the restarting copy answers 502 or nothing", async () => {
    time.mockResolvedValue(stateOf());
    ask.mockResolvedValue({ id: "r1" });
    const reload = render();
    await settle();
    await act(async () => button("+1 day").click());
    await settle();

    time.mockRejectedValue(Object.assign(new Error("Request failed with status code 502"), { response: { status: 502 } }));
    await advance(3_000);
    time.mockRejectedValue(new Error("Network Error"));
    await advance(3_000);
    const asked = time.mock.calls.length;
    expect(host.textContent).toContain("The time machine is working");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(reload).not.toHaveBeenCalled();

    await advance(3_000);
    expect(time.mock.calls.length).toBe(asked + 1);
  });

  it("shows the last run's report, a row per day, its alerts in amber", async () => {
    time.mockResolvedValue(stateOf({
      offset_days: 2,
      test_date: "2026-11-27",
      last: {
        ...RUNNING, params: { days: 2 }, ok: true, finished_at: "2026-11-25T10:01:00+05:00",
        result: { checkpoint: 1, days: [day("2026-11-26", 112, 4_312_000), day("2026-11-27", 0, 0, ["balance warnings: not installed"])] },
      },
    }));
    render();
    await settle();
    const rows = [...host.querySelectorAll("[data-day-row]")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("26 Nov 2026");
    expect(rows[0].textContent).toContain("112");
    expect(rows[0].textContent).toContain("4 312 000");
    expect(rows[1].textContent).toContain("27 Nov 2026");
    const alerts = [...host.querySelectorAll("[data-alert]")];
    expect(alerts.map((a) => a.textContent)).toEqual([expect.stringContaining("balance warnings: not installed")]);
    expect(alerts[0].className).toContain("attention");
  });

  it("after a 409 reads the machine again, so someone else's request shows as working", async () => {
    time.mockResolvedValueOnce(stateOf()).mockResolvedValue(stateOf({ pending: true }));
    ask.mockRejectedValue(
      Object.assign(new Error("Request failed with status code 409"), {
        response: { status: 409, data: { detail: "A request is already waiting for the time machine." } },
      }),
    );
    render();
    await settle();
    const asked = time.mock.calls.length;
    await act(async () => button("+1 day").click());
    await settle();
    expect(time.mock.calls.length).toBeGreaterThan(asked);
    expect(host.textContent).toContain("A request is already waiting for the time machine.");
    expect(host.textContent).toContain("The time machine is working");
    expect(button("+1 day").disabled).toBe(true);
  });

  it("gives up after ten minutes without an answer, and says so", async () => {
    time.mockResolvedValue(stateOf());
    ask.mockResolvedValue({ id: "r1" });
    const reload = render();
    await settle();
    await act(async () => button("+1 day").click());
    await settle();

    time.mockRejectedValue(new Error("Network Error"));
    await advance(9 * 60_000);
    expect(host.textContent).not.toContain("has not answered");
    await advance(60_000 + 3_000);
    expect(host.textContent).toContain("The time machine has not answered; it may be stopped.");
    expect(host.textContent).not.toContain("The time machine is working");
    const asked = time.mock.calls.length;
    await advance(60_000);
    expect(time.mock.calls.length).toBe(asked);
    expect(reload).not.toHaveBeenCalled();
  });
});
