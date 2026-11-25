/** "Add classroom" offers the teachers from the desk's own list, so an administrator sees them too. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const teacherChoices = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {},
  classesApi: { create: vi.fn(), teacherChoices: (...a: unknown[]) => teacherChoices(...a) },
  examsAdminApi: { getUsers: async () => { throw new Error("the directory is not the teacher list"); } },
}));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: vi.fn() }) }));
vi.mock("@/features/org/orgHooks", () => ({
  useRegions: () => ({ data: [] }),
  useBranches: () => ({ data: [] }),
}));

const { CreateClassroomModal } = await import("../CreateClassroomModal");

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  teacherChoices.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function open() {
  await act(async () => {
    root.render(<CreateClassroomModal onClose={() => {}} onCreated={() => {}} />);
  });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("Add classroom teacher list", () => {
  it("lists the teachers the desk list returns, after the 'later' option", async () => {
    teacherChoices.mockResolvedValue({
      teachers: [{ id: 7, name: "Vali Aliyev", email: "vali@x.uz", subject: "math" }],
      support_teachers: [],
    });
    await open();
    const options = [...(document.getElementById("create-teacher") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options[0]).toContain("Assign a teacher later");
    expect(options.join("|")).toContain("Vali Aliyev");
  });

  it("says so under the picker when the teachers cannot be loaded", async () => {
    teacherChoices.mockRejectedValue(new Error("Network Error"));
    await open();
    expect(document.body.textContent).toContain("Could not load the teachers. You can create the group and assign a teacher later.");
  });

  it("shows no such note when they load", async () => {
    teacherChoices.mockResolvedValue({ teachers: [], support_teachers: [] });
    await open();
    expect(document.body.textContent).not.toContain("Could not load the teachers");
  });
});
