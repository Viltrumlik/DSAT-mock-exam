/**
 * New set (PR 17a): the two checks before saving, the bucket's subject and level fixed, the same payload, and
 * the server's own words when it refuses.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSet = vi.fn();
const routerPush = vi.fn();
let query = "";
let subject: "math" | "english" | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock("@/lib/permissions", () => ({ getSubject: () => subject, getRole: () => "admin" }));
vi.mock("@/features/assessments/hooks", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useUpsertAssessmentSet: () => useMutation({ mutationFn: (x: { id: number | null; payload: unknown }) => createSet(x.payload) }),
  };
});

const { default: Page } = await import("../page");

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <Page />
      </QueryClientProvider>,
    );
  });
  await settle();
}

/** The control a label names (useId ids carry colons, so by id, not by selector). */
function field<T extends HTMLElement>(label: string): T {
  const l = Array.from(host.querySelectorAll("label")).find((x) => x.textContent === label)!;
  return document.getElementById(l.htmlFor) as T;
}

function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

const save = async () => {
  const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Save"))!;
  await act(async () => {
    button.click();
  });
  await settle();
};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  createSet.mockReset();
  routerPush.mockReset();
  query = "";
  subject = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("New set", () => {
  it("asks for a source, then a level, before saving", async () => {
    await render();
    expect(host.textContent).toContain("Create assessment set");
    expect(host.textContent).toContain("Draft a set, then add questions.");
    await save();
    expect(host.textContent).toContain("Please choose a source for this set.");
    setValue(field<HTMLSelectElement>("Source *"), "SQB");
    await save();
    expect(host.textContent).toContain("Please choose a level for this set.");
    expect(createSet).not.toHaveBeenCalled();
  });

  it("fixes the bucket's subject and level, and sends the same payload", async () => {
    query = "subject=math&level=junior";
    createSet.mockResolvedValue({ id: 91 });
    await render();
    expect(host.textContent).toContain("New Math · Junior set — then add questions.");
    // Subject and Level are shown, not editable: the selects left are Active, Source, Second level, Category.
    expect(host.querySelectorAll("select")).toHaveLength(4);
    setValue(field<HTMLSelectElement>("Second level (optional)"), "middle");
    setValue(field<HTMLSelectElement>("Source *"), "MATHBOOK");
    setValue(field<HTMLInputElement>("Title"), "Ratios");
    setValue(field<HTMLTextAreaElement>("Description"), "Unit 2");
    await save();
    expect(createSet).toHaveBeenCalledWith({
      subject: "math",
      source: "MATHBOOK",
      level: "junior",
      secondary_level: "middle",
      category: "",
      title: "Ratios",
      description: "Unit 2",
      is_active: true,
    });
    expect(routerPush).toHaveBeenCalledWith("/builder/sets/91");
  });

  it("shows the server's words when it refuses", async () => {
    query = "subject=english&level=senior";
    createSet.mockRejectedValue({ response: { status: 400, data: { detail: "A set with this title already exists." } } });
    await render();
    setValue(field<HTMLSelectElement>("Source *"), "SQB");
    await save();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("A set with this title already exists.");
    expect(routerPush).not.toHaveBeenCalled();
  });
});
