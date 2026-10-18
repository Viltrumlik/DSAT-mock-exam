import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { EVENT_TEMPLATE, REJECTED_TEMPLATE, template } from "./fixtures";

/**
 * The eskiz templates as the panel caches them: what eskiz approved beside what was written, the
 * slots, the parts, and the warning that one non-Latin character doubles the price. Refresh asks
 * eskiz again; New template opens the moderation form.
 */

const templates = vi.fn();
const sync = vi.fn();
const toast = vi.fn();
const refetch = vi.fn();

vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("@/features/ops/sms/smsHooks", () => ({
  useSmsTemplates: () => templates(),
  useSyncTemplates: () => ({ mutate: sync, isPending: false }),
}));
vi.mock("@/features/ops/sms/SubmitTemplateModal", () => ({
  SubmitTemplateModal: () => <div role="dialog">submit-open</div>,
}));

const { TemplatesPanel } = await import("@/features/ops/sms/TemplatesPanel");

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;

const ROWS = [
  template(),
  template({ ...EVENT_TEMPLATE, status: "reklama" }),
  template({
    eskiz_id: 61001, status: "moderation", usable: false, pattern: "Oʻquvchi %w", original: "Oʻquvchi (STUDENT)",
    ascii: false, submitted_by_name: "Admin Aliyev", submitted_at: "2026-10-18T12:00:00+05:00",
  }),
  REJECTED_TEMPLATE,
];

async function render(state: Record<string, unknown>) {
  templates.mockReturnValue({ isPending: false, isError: false, refetch, ...state });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<TemplatesPanel />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sync.mockReset();
  toast.mockReset();
  refetch.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("TemplatesPanel", () => {
  it("shows each template: id, status, pattern, original, slots, parts and the ASCII warning", async () => {
    await render({ data: { templates: ROWS, synced_at: "2026-10-18T09:00:00+05:00" } });
    const rows = [...container.querySelectorAll("tbody tr")].map((r) => r.textContent ?? "");
    expect(rows[0]).toContain("64942");
    expect(rows[0]).toContain("Service");
    expect(rows[0]).toContain("%w{1,4} sizda");
    expect(rows[0]).toContain("(STUDENT), sizda");
    expect(rows[0]).toContain("1–4 words · Student's name");
    expect(rows[1]).toContain("Ad price");
    expect(rows[1]).toContain("a number · Same text for all");
    expect(rows[2]).toContain("Moderation");
    expect(rows[2]).toContain("Not plain Latin");
    expect(rows[2]).toContain("Admin Aliyev");
    expect(rows[3]).toContain("Rejected");
    expect(rows[0]).not.toContain("Not plain Latin");
    expect(text()).toContain("Last synced 18 Oct 2026");
  });

  it("refreshes from eskiz and says what changed", async () => {
    sync.mockImplementation((_v: unknown, opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({ added: 1, updated: 31, gone: 0, total: 32 }),
    );
    await render({ data: { templates: ROWS, synced_at: null } });
    await act(async () => button("Refresh from eskiz").click());
    expect(sync).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      tone: "success",
      message: "Templates refreshed: 1 added, 31 updated, 0 gone — 32 in all.",
    });
  });

  it("says when eskiz could not be reached", async () => {
    sync.mockImplementation((_v: unknown, opts: { onError: (e: unknown) => void }) =>
      opts.onError({ response: { data: { detail: "eskiz did not answer." } } }),
    );
    await render({ data: { templates: ROWS, synced_at: null } });
    await act(async () => button("Refresh from eskiz").click());
    expect(toast).toHaveBeenCalledWith({ tone: "error", message: "eskiz did not answer." });
  });

  it("opens the new-template form", async () => {
    await render({ data: { templates: ROWS, synced_at: null } });
    await act(async () => button("New template").click());
    expect(text()).toContain("submit-open");
  });

  it("says the list is empty until the first refresh, and offers a retry when it did not load", async () => {
    await render({ data: { templates: [], synced_at: null } });
    expect(text()).toContain("No templates yet");
    expect(text()).toContain("Never synced");
    await act(async () => root.unmount());
    container.remove();

    await render({ isError: true, data: undefined });
    expect(text()).toContain("The templates didn't load.");
    await act(async () => button("Try again").click());
    expect(refetch).toHaveBeenCalled();
  });
});
