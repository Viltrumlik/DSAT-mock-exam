/** The group's monthly price on its create and edit forms; lc-up's while the class follows it. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomCore } from "../classroomsApi";

const classes = { create: vi.fn(), governanceUpdate: vi.fn() };
const toast = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {},
  classesApi: classes,
  examsAdminApi: { getUsers: async () => [] },
}));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("@/features/org/orgHooks", () => ({
  useRegions: () => ({ data: [] }),
  useBranches: () => ({ data: [] }),
}));

const { ClassroomForm } = await import("../ClassroomForm");
const { CreateClassroomModal } = await import("../CreateClassroomModal");

const ROOM = {
  id: 45, name: "G1", subject: "MATH", level: "", description: "", lesson_days: "ODD", lesson_time: "", lesson_hours: 2,
  start_date: null, room_number: "", branch: null, telegram_chat_id: "", telegram_group_url: "", max_students: null,
  monthly_price: 500_000, lcup: null,
} as unknown as ClassroomCore;

let host: HTMLElement;
let root: Root;

function typeInto(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function labelled(text: string) {
  const label = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.includes(text));
  return document.getElementById(label!.getAttribute("for")!) as HTMLInputElement;
}

const button = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  classes.create.mockReset();
  classes.governanceUpdate.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the class's own form", () => {
  it("shows the price and saves a new one", async () => {
    classes.governanceUpdate.mockResolvedValue({});
    act(() => root.render(<ClassroomForm room={ROOM} onSaved={() => {}} />));
    expect(labelled("Monthly price").value).toBe("500000");
    typeInto(labelled("Monthly price"), "600000");
    await act(async () => button("Save").click());
    expect(classes.governanceUpdate.mock.calls[0][1]).toMatchObject({ monthly_price: 600_000 });
  });

  it("sends an empty price as none", async () => {
    classes.governanceUpdate.mockResolvedValue({});
    act(() => root.render(<ClassroomForm room={ROOM} onSaved={() => {}} />));
    typeInto(labelled("Monthly price"), "");
    await act(async () => button("Save").click());
    expect(classes.governanceUpdate.mock.calls[0][1]).toMatchObject({ monthly_price: null });
  });

  it("locks it while the class follows lc-up and leaves it out of the save", async () => {
    classes.governanceUpdate.mockResolvedValue({});
    const managed = { ...ROOM, lcup: { managed: true, group_name: "G1", status: "confirmed", locked_fields: ["monthly_price"] } };
    act(() => root.render(<ClassroomForm room={managed} onSaved={() => {}} />));
    expect(labelled("Monthly price").disabled).toBe(true);
    await act(async () => button("Save").click());
    expect(classes.governanceUpdate.mock.calls[0][1]).not.toHaveProperty("monthly_price");
  });
});

describe("the create form", () => {
  it("sends the price", async () => {
    classes.create.mockResolvedValue({ id: 1 });
    act(() => root.render(<CreateClassroomModal onClose={() => {}} onCreated={() => {}} />));
    await settle();
    typeInto(labelled("Class name"), "New");
    const level = labelled("Level") as unknown as HTMLSelectElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(level, "junior");
      level.dispatchEvent(new Event("change", { bubbles: true }));
    });
    typeInto(labelled("Monthly price"), "450000");
    await act(async () => button("Create classroom").click());
    expect(classes.create.mock.calls[0][0]).toMatchObject({ monthly_price: 450_000 });
  });

  it("leaves it out when none is given", async () => {
    classes.create.mockResolvedValue({ id: 1 });
    act(() => root.render(<CreateClassroomModal onClose={() => {}} onCreated={() => {}} />));
    await settle();
    typeInto(labelled("Class name"), "New");
    const level = labelled("Level") as unknown as HTMLSelectElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(level, "junior");
      level.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button("Create classroom").click());
    expect(classes.create.mock.calls[0][0].monthly_price).toBeUndefined();
  });
});
