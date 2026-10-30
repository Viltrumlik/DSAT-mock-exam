/**
 * /ops/lcup → Archive: what the copy of lc-up holds (lcup.archive), kept for the day the centre leaves
 * lc-up — counts per kind of record, the backfill, the runs. Never the records themselves.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const { ArchivePanel } = await import("../LcupPanels");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function mount(archive: object) {
  get.mockImplementation(async (url: string) => {
    if (url === "/lcup/archive/") return { data: archive };
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ArchivePanel />
      </QueryClientProvider>,
    );
  });
  for (let tick = 0; tick < 50 && get.mock.calls.length === 0; tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const ENTITY = { live: 0, gone: 0, versions: 0, first_day: null, last_day: null, last_seen_at: null };

describe("lc-up archive panel", () => {
  it("shows what is held per kind of record, and each run", async () => {
    await mount({
      enabled: true,
      since: "2025-01-01",
      backfill: { attendance: { done: 4, total: 6 }, payment: { done: 6, total: 6 } },
      entities: [
        { ...ENTITY, entity: "student", label: "Student", total: 514, live: 510, gone: 4, versions: 900, last_seen_at: "2026-10-30T03:10:00+05:00" },
        { ...ENTITY, entity: "attendance", label: "Attendance", total: 41000, live: 41000, versions: 41200, first_day: "2026-01-10", last_day: "2026-10-29" },
      ],
      runs: [
        { id: 2, started_at: "2026-10-30T03:05:00+05:00", finished_at: null, dry_run: false, ok: false, counts: {}, errors: ["payment: LcupUnavailable"], alerts: [] },
        { id: 1, started_at: "2026-10-29T03:05:00+05:00", finished_at: null, dry_run: true, ok: true,
          counts: { student: { new: 514, changed: 0, gone: 0 }, attendance: { new: 41000, changed: 3, gone: 1 } }, errors: [], alerts: [] },
      ],
    });
    expect(host.textContent).toContain("Copied every night at 03:05");
    expect(host.textContent).toContain("attendance: 4 of 6 older windows done");
    expect(host.textContent).toContain("Student514");
    expect(host.textContent).toContain("2026-01-10 – 2026-10-29");
    expect(host.textContent).toContain("Failed");
    expect(host.textContent).toContain("payment: LcupUnavailable");
    expect(host.textContent).toContain("OK (dry run)");
    expect(host.textContent).toContain("41514 new · 3 changed · 1 gone");
  });

  it("says when nothing is copied yet and the nightly switch is off", async () => {
    await mount({ enabled: false, since: "2025-01-01", backfill: {}, runs: [],
      entities: [{ ...ENTITY, entity: "student", label: "Student", total: 0 }] });
    expect(host.textContent).toContain("The nightly copy is off");
    expect(host.textContent).toContain("Nothing copied from lc-up yet.");
  });
});
