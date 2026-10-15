/**
 * /ops/classrooms as a changelist on `GET /classes/admin/classrooms/`: the columns, a row linking to
 * its change form with the list remembered, the filters sent from the address, and "Add classroom".
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomPage } from "../classroomsApi";

const get = vi.fn();
let search = "";

vi.mock("@/lib/api", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/ops/classrooms",
}));
vi.mock("../CreateClassroomModal", () => ({
  CreateClassroomModal: () => <div role="dialog">Add classroom</div>,
}));

const { ClassroomList } = await import("../ClassroomList");

const PAGE: ClassroomPage = {
  count: 2,
  page: 1,
  pages: 1,
  page_size: 50,
  ordering: "-created",
  filters: [
    {
      key: "lcup",
      label: "lc-up",
      options: [
        { value: "paired", label: "Paired", count: 1 },
        { value: "unpaired", label: "Not paired", count: 1 },
      ],
      selected: null,
    },
  ],
  results: [
    {
      id: 45, name: "Junior G21 Math", subject: "MATH", level: "JUNIOR", teacher: { id: 3, name: "Vali Aliyev" },
      students: 12, lesson_days: "ODD", lesson_time: "14:00", room_number: "301", branch: "Chilonzor", lcup: true,
      is_active: true, created_at: null,
    },
    {
      id: 46, name: "Own class", subject: "ENGLISH", level: "", teacher: null, students: 3, lesson_days: "EVEN",
      lesson_time: "", room_number: "", branch: "", lcup: false, is_active: false, created_at: null,
    },
  ],
};

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderList(query = "") {
  search = query;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <ClassroomList />
      </QueryClientProvider>,
    ),
  );
  await settle();
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
  get.mockResolvedValue({ data: PAGE });
  search = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the Classrooms changelist", () => {
  it("shows a class's subject, teacher, size, schedule, room, lc-up and status", async () => {
    await renderList();
    const heads = [...host.querySelectorAll("thead th")].map((th) => th.textContent?.trim()).filter(Boolean);
    expect(heads).toEqual(
      expect.arrayContaining(["Name", "Subject", "Level", "Teacher", "Students", "Schedule", "Room", "lc-up", "Status"]),
    );
    const [paired, own] = [...host.querySelectorAll("tbody tr")].map((tr) => tr.textContent ?? "");
    expect(paired).toContain("Math");
    expect(paired).toContain("Vali Aliyev");
    expect(paired).toContain("Odd days 14:00");
    expect(paired).toContain("Yes");
    expect(own).toContain("Archived");
  });

  it("links a row to its change form and remembers the list", async () => {
    await renderList("lcup=paired");
    const link = host.querySelector("tbody a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/ops/classrooms/45?_changelist_filters=lcup%3Dpaired");
  });

  it("asks the server with the filters in the address", async () => {
    await renderList("lcup=paired&q=301&junk=1");
    const [url, config] = get.mock.calls[0];
    expect(url).toBe("/classes/admin/classrooms/");
    expect(config.params).toEqual({ lcup: "paired", q: "301", page_size: 50 });
  });

  it("opens Add classroom from the header", async () => {
    await renderList();
    const add = [...host.querySelectorAll("button")].find((b) => b.textContent === "Add classroom")!;
    act(() => add.click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toBe("Add classroom");
  });
});
