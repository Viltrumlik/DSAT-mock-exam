import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * A new text for eskiz's moderation. It counts as eskiz will bill it, refuses what the server
 * refuses (empty, over 1000 characters), and posts the trimmed text.
 */

const submit = vi.fn();
const toast = vi.fn();
const onClose = vi.fn();

vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("@/features/ops/sms/smsHooks", () => ({
  useSubmitTemplate: () => ({ mutate: submit, isPending: false }),
}));

const { SubmitTemplateModal } = await import("@/features/ops/sms/SubmitTemplateModal");

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;

async function type(value: string) {
  const area = document.body.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<SubmitTemplateModal onClose={onClose} />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  submit.mockReset();
  toast.mockReset();
  onClose.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("SubmitTemplateModal", () => {
  it("tells where the student's name goes", async () => {
    await render();
    expect(text()).toContain("(STUDENT)");
  });

  it("counts characters and parts, and warns about non-Latin letters", async () => {
    await render();
    await type("Salom (STUDENT)!");
    expect(text()).toContain("16/1000 characters · 1 SMS part");
    expect(text()).not.toContain("not plain Latin");
    await type("Oʻquvchi (STUDENT)!");
    expect(text()).toContain("not plain Latin");
  });

  it("refuses an empty text", async () => {
    await render();
    await type("   ");
    await act(async () => button("Send to moderation").click());
    expect(text()).toContain("Write the text first.");
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses a text over 1000 characters", async () => {
    await render();
    await type("a".repeat(1001));
    await act(async () => button("Send to moderation").click());
    expect(text()).toContain("eskiz takes up to 1000 characters; this is 1001.");
    expect(submit).not.toHaveBeenCalled();
  });

  it("posts the trimmed text, then closes with a notice", async () => {
    submit.mockImplementation((_t: unknown, opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({ template: null, sync: { added: 0, updated: 32, gone: 0, total: 32 } }),
    );
    await render();
    await type("  Salom (STUDENT)!  ");
    await act(async () => button("Send to moderation").click());
    expect(submit.mock.calls[0][0]).toBe("Salom (STUDENT)!");
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Sent to eskiz moderation." });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows eskiz's words when it refuses", async () => {
    submit.mockImplementation((_t: unknown, opts: { onError: (e: unknown) => void }) =>
      opts.onError({ response: { data: { code: "eskiz", detail: "Shablon allaqachon mavjud" } } }),
    );
    await render();
    await type("Salom (STUDENT)!");
    await act(async () => button("Send to moderation").click());
    expect(text()).toContain("Shablon allaqachon mavjud");
    expect(onClose).not.toHaveBeenCalled();
  });
});
