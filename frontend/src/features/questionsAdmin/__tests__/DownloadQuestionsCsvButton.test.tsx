/**
 * DownloadQuestionsCsvButton (PR 24: the console look is the only one): hidden unless super admin, downloads the
 * server's CSV under the fallback name, and says why when the server refuses.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let me: { role?: string; is_superuser?: boolean } | null = { role: "super_admin" };
const downloadBlob = vi.fn();

vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ me }) }));
vi.mock("@/lib/download", () => ({ downloadBlob: (...a: unknown[]) => downloadBlob(...a) }));

const { DownloadQuestionsCsvButton } = await import("../DownloadQuestionsCsvButton");

let host: HTMLElement;
let root: Root;
const fetchCsv = vi.fn();

async function render() {
  await act(async () => {
    root.render(<DownloadQuestionsCsvButton fetchCsv={fetchCsv} fallbackName="math-module-1" />);
  });
}
async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  me = { role: "super_admin" };
  downloadBlob.mockReset();
  fetchCsv.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("DownloadQuestionsCsvButton", () => {
  it("shows nothing to anyone but a super admin", async () => {
    me = { role: "test_admin" };
    await render();
    expect(host.querySelector("button")).toBeNull();
  });

  it("downloads the CSV in the console button", async () => {
    const blob = new Blob(["a,b\n"], { type: "text/csv" });
    fetchCsv.mockResolvedValue(blob);
    await render();
    const button = host.querySelector<HTMLButtonElement>("button")!;
    expect(button.textContent).toBe("Download CSV");
    expect(button.title).toBe("Download every question and its answer key as a CSV");
    expect(button.className).not.toContain("border-border");
    await act(async () => button.click());
    await settle();
    expect(fetchCsv).toHaveBeenCalledTimes(1);
    expect(downloadBlob).toHaveBeenCalledWith(blob, "math-module-1.csv");
  });

  it("says why when the server refuses", async () => {
    fetchCsv.mockRejectedValue({ response: { status: 403, data: { detail: "Only a super admin can export." } } });
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    await settle();
    expect(host.textContent).toContain("Only a super admin can export.");
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
