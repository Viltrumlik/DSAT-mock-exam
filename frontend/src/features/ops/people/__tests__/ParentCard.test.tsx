/** Whom an admin calls about a learner: shown only when the server gave it, which it does for an admin alone. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const patch = vi.fn();
const toast = vi.fn();

vi.mock("@/lib/api", () => ({ default: { patch: (...a: unknown[]) => patch(...a) } }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));

const { ParentCard } = await import("../ParentCard");

let host: HTMLElement;
let root: Root;
const onSaved = vi.fn();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  patch.mockReset();
  onSaved.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function typeInto(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const inputs = () => Array.from(host.querySelectorAll("input")) as HTMLInputElement[];
const save = () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Save") as HTMLButtonElement;

it("shows what is held and saves a change", async () => {
  patch.mockResolvedValue({ data: {} });
  act(() => root.render(<ParentCard id={7} parent={{ name: "Karim", phone: "998907777777" }} onSaved={onSaved} />));
  expect(inputs().map((i) => i.value)).toEqual(["Karim", "998907777777"]);
  typeInto(inputs()[0], "Salima");
  await act(async () => save().click());
  expect(patch).toHaveBeenCalledWith("/users/admin/people/7/parent/", { parent_name: "Salima", parent_phone: "998907777777" });
  expect(onSaved).toHaveBeenCalled();
});

it("shows the server's reason", async () => {
  patch.mockRejectedValue({ response: { data: { detail: "Parent's phone: may only contain digits." } } });
  act(() => root.render(<ParentCard id={7} parent={{ name: "", phone: "" }} onSaved={onSaved} />));
  await act(async () => save().click());
  expect(host.textContent).toContain("Parent's phone: may only contain digits.");
  expect(onSaved).not.toHaveBeenCalled();
});
