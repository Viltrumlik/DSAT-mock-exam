/**
 * /ops/mobile in the console's look: the release policy loads into its fields and saves the same four fields,
 * warns before the minimum is raised, and shows a refusal under the field the server named; the crash reports
 * filter by window, kind and version with the same query, open a report in the console dialog, and say plainly
 * when nothing was reported or the reports did not load.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  policy: vi.fn(),
  savePolicy: vi.fn(),
  diagnostics: vi.fn(),
  diagnostic: vi.fn(),
}));

vi.mock("@/features/mobile/mobileApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/mobile/mobileApi")>()),
  mobileApi: api,
}));

const { default: Page } = await import("../page");

const POLICY = {
  platform: "ios",
  latest_version: "1.2.0",
  minimum_version: "1.1.0",
  update_url: "https://apps.apple.com/app/id1",
  message: "Faster tests.",
  updated_at: "2026-11-10T09:30:00Z",
  updated_by: "owner@example.com",
};

function summary(over: Record<string, unknown> = {}) {
  return {
    days: 7,
    totals: { crash: 3, hang: 1, cpu: 0, disk: 0, error: 5 },
    app_versions: ["1.2.0", "1.1.0"],
    groups: [
      { signature: "EXC_BAD_ACCESS in QuestionView", kind: "crash", count: 3, installs: 2, first_seen: "2026-11-09T08:00:00Z", last_seen: "2026-11-10T08:00:00Z", sample_id: 41 },
      { signature: "decode: /me/", kind: "error", count: 5, installs: 4, first_seen: null, last_seen: null, sample_id: 42 },
    ],
    recent: [],
    ...over,
  };
}

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <Page />
      </QueryClientProvider>,
    );
  });
  await settle();
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const field = (id: string) => host.querySelector<HTMLInputElement>(`#${id}`)!;
const buttonIs = (words: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === words)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of Object.values(api)) f.mockReset();
  api.policy.mockResolvedValue(POLICY);
  api.savePolicy.mockImplementation(async (body: Record<string, string>) => ({ ...POLICY, ...body }));
  api.diagnostics.mockResolvedValue(summary());
  api.diagnostic.mockResolvedValue({
    id: 41,
    kind: "crash",
    signature: "EXC_BAD_ACCESS in QuestionView",
    message: "Crashed while drawing a question.",
    app_version: "1.2.0",
    build: "57",
    os_version: "iOS 18.1",
    device_model: "iPhone15,2",
    occurred_at: "2026-11-10T08:00:00Z",
    received_at: "2026-11-10T08:05:00Z",
    user: null,
    payload: { frames: ["main"] },
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the release policy", () => {
  it("loads the policy into its fields and says who changed it last", async () => {
    await render();
    expect(host.querySelector("h1")!.textContent).toBe("Mobile app");
    expect(field("policy-latest").value).toBe("1.2.0");
    expect(field("policy-minimum").value).toBe("1.1.0");
    expect(field("policy-url").value).toBe("https://apps.apple.com/app/id1");
    expect(host.querySelector<HTMLTextAreaElement>("#policy-message")!.value).toBe("Faster tests.");
    expect(host.textContent).toContain("by owner@example.com");
    expect(host.textContent).toContain("Last changed");
  });

  it("saves the four fields as typed and says when phones pick it up", async () => {
    await render();
    await type(field("policy-latest"), "1.3.0");
    await click(buttonIs("Save policy"));
    expect(api.savePolicy).toHaveBeenCalledWith({
      latest_version: "1.3.0",
      minimum_version: "1.1.0",
      update_url: "https://apps.apple.com/app/id1",
      message: "Faster tests.",
    });
    expect(host.textContent).toContain("Saved. Phones pick it up within a minute.");
  });

  it("warns before the minimum is raised", async () => {
    await render();
    expect(host.textContent).not.toContain("will stop at an update screen");
    await type(field("policy-minimum"), "1.2.0");
    expect(host.textContent).toContain(
      "Every app older than 1.2.0 will stop at an update screen within a minute of saving. Make sure that version is already live in the App Store.",
    );
  });

  it("shows a refusal under the field the server named", async () => {
    api.savePolicy.mockRejectedValue({ response: { status: 400, data: { minimum_version: ["Not a version number."] } } });
    await render();
    await click(buttonIs("Save policy"));
    const minimum = field("policy-minimum").closest("div")!.parentElement!;
    expect(minimum.textContent).toContain("Not a version number.");
    expect(host.textContent).not.toContain("Saved.");
  });

  it("says a save failed when the server gave no reason", async () => {
    api.savePolicy.mockRejectedValue(new Error("offline"));
    await render();
    await click(buttonIs("Save policy"));
    expect(host.textContent).toContain("That didn't save. Try again.");
  });

  it("says the policy did not load instead of showing empty fields", async () => {
    api.policy.mockRejectedValue(new Error("boom"));
    await render();
    expect(host.textContent).toContain("The policy didn't load. Nothing has changed — reload to try again.");
    expect(host.querySelector("#policy-latest")).toBeNull();
  });
});

describe("crash & error reports", () => {
  it("lists each group with its kind, reports and phones", async () => {
    await render();
    expect(api.diagnostics).toHaveBeenCalledWith({ days: 7, kind: "", app_version: "" });
    const row = host.querySelector('tr[data-group="41"]')!;
    expect(row.textContent).toContain("EXC_BAD_ACCESS in QuestionView");
    expect(row.textContent).toContain("Crash");
    expect(row.textContent).toContain("3");
    expect(row.textContent).toContain("2");
    expect(host.querySelector('tr[data-group="42"]')!.textContent).toContain("App error");
    // The kind chips carry their totals.
    expect(buttonIs("Crash · 3")).toBeDefined();
    expect(buttonIs("App error · 5")).toBeDefined();
  });

  it("filters by window, kind and version with the same query", async () => {
    await render();
    await click(buttonIs("30 days"));
    expect(api.diagnostics).toHaveBeenLastCalledWith({ days: 30, kind: "", app_version: "" });
    await click(buttonIs("Crash · 3"));
    expect(api.diagnostics).toHaveBeenLastCalledWith({ days: 30, kind: "crash", app_version: "" });
    const version = host.querySelector<HTMLSelectElement>('select[aria-label="App version"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(version, "1.1.0");
      version.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(api.diagnostics).toHaveBeenLastCalledWith({ days: 30, kind: "crash", app_version: "1.1.0" });
  });

  it("opens a report in the console dialog", async () => {
    await render();
    await click(host.querySelector('tr[data-group="41"]')!);
    expect(api.diagnostic).toHaveBeenCalledWith(41);
    const d = dialog()!;
    expect(d.querySelector("h2")!.textContent).toBe("Crash");
    expect(d.textContent).toContain("Crashed while drawing a question.");
    expect(d.textContent).toContain("1.2.0 (57)");
    expect(d.textContent).toContain("iPhone15,2 · iOS 18.1");
    expect(d.textContent).toContain("Nobody");
    expect(d.textContent).toContain("Payload — symbolicate call stacks against this build's dSYM");
    expect(d.querySelector("pre")!.textContent).toContain('"main"');
    await click(d.querySelector('button[aria-label="Close"]')!);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(dialog()).toBeNull();
  });

  it("says nothing was reported in the window", async () => {
    api.diagnostics.mockResolvedValue(summary({ groups: [], app_versions: [] }));
    await render();
    expect(host.textContent).toContain("Nothing reported in the last 7 days");
    expect(host.textContent).toContain("Crashes arrive the next time the app opens after one; errors as they happen.");
  });

  it("never draws failed reports as none", async () => {
    api.diagnostics.mockRejectedValue(new Error("boom"));
    await render();
    expect(host.textContent).toContain("The reports didn't load. They are still on the server — reload to try again.");
    expect(host.textContent).not.toContain("Nothing reported");
  });
});
