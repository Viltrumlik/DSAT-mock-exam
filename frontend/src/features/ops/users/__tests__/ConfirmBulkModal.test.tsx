/**
 * The people lists' bulk confirm (PR 22, console dialog): the same words for freeze and delete, the exam-results
 * line, Delete waiting for DELETE typed in, and Cancel / the action calling back.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmBulkModal, type BulkAction } from "../ConfirmBulkModal";

let host: HTMLElement;
let root: Root;
const onCancel = vi.fn();
const onConfirm = vi.fn();

async function render(action: BulkAction, count: number, attemptTotal = 0, busy = false) {
  await act(async () => {
    root.render(
      <ConfirmBulkModal action={action} count={count} attemptTotal={attemptTotal} busy={busy} onCancel={onCancel} onConfirm={onConfirm} />,
    );
  });
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const buttons = () => Array.from(dialog().querySelectorAll<HTMLButtonElement>("button"));
const buttonIn = (words: string) => buttons().find((b) => b.textContent?.trim().startsWith(words))!;
async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onCancel.mockReset();
  onConfirm.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ConfirmBulkModal", () => {
  it("asks to freeze with a reversible sentence and confirms at once", async () => {
    await render("freeze", 3);
    expect(dialog().textContent).toContain("Freeze 3 accounts?");
    expect(dialog().textContent).toContain("This will freeze 3 accounts. You can reverse it later.");
    expect(dialog().querySelector("input")).toBeNull();
    await act(async () => buttonIn("Freeze").click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await act(async () => buttonIn("Cancel").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("makes a delete wait for DELETE and names the exam results that go with it", async () => {
    await render("delete", 1, 12);
    expect(dialog().textContent).toContain("Delete 1 account?");
    expect(dialog().textContent).toContain("This permanently deletes 1 account. This cannot be undone.");
    expect(dialog().textContent).toContain("12 exam results will be permanently deleted with this account.");
    expect(buttonIn("Delete").disabled).toBe(true);
    const field = dialog().querySelector<HTMLInputElement>("input")!;
    expect(dialog().querySelector(`label[for="${field.id}"]`)!.textContent).toBe("Type DELETE to confirm");
    await type(field, " delete ");
    expect(buttonIn("Delete").disabled).toBe(false);
    await act(async () => buttonIn("Delete").click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("holds both buttons while it runs", async () => {
    await render("unfreeze", 2, 0, true);
    expect(dialog().textContent).toContain("This will unfreeze 2 accounts. You can reverse it later.");
    const footer = buttons().slice(-2);
    expect(footer.every((b) => b.disabled)).toBe(true);
  });
});
