/**
 * "Assign midterm to the class?" — its day and time pickers, on a device outside Tashkent.
 *
 * The pickers offer "Today", "Tomorrow" and the rest of the week, and 08:00–18:00 slots: hours in
 * the room, in Tashkent. They used to count the days and read the slot on the device's clock, so
 * on a laptop three hours behind (Europe/Kyiv in November) a 16:00 slot opened the paper at 19:00
 * Tashkent, and just after Tashkent's midnight "Today" was still yesterday.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const assignToClassroom = vi.fn();

vi.mock("@/lib/midtermApi", () => ({
  midtermApi: {
    catalog: vi.fn(async () => [
      { id: 11, title: "Unit 3 Midterm", subject: "MATH", level: "", duration_minutes: 70, question_count: 44 },
    ]),
    classroomMidterms: vi.fn(async () => []),
    assignToClassroom: (...args: unknown[]) => assignToClassroom(...args),
  },
  subjectLabel: (s: string) => (s === "MATH" ? "Mathematics" : "Reading & Writing"),
}));
vi.mock("@/lib/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: { downloadCertificate: vi.fn() },
}));

const { Midterms } = await import("../pages/Midterms");
type Classroom = React.ComponentProps<typeof Midterms>["classroom"];

/** 01:00 on the 10th in Tashkent — still 22:00 on the 9th on the device. */
const PAST_MIDNIGHT = "2026-11-10T01:00:00+05:00";

let host: HTMLElement;
let root: Root;
let savedTz: string | undefined;

beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = "Europe/Kyiv";
});

afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(PAST_MIDNIGHT));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  assignToClassroom.mockReset().mockResolvedValue({});
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function settle(ticks = 12) {
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const classroom = { id: 34, name: "Senior Math", subject: "MATH", level: "", my_role: "TEACHER" } as unknown as Classroom;
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Midterms classroom={classroom} />
      </QueryClientProvider>,
    );
  });
  await settle();
}

const buttonsLabelled = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).filter((b) => b.textContent?.trim() === label);
const selects = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLSelectElement>(`select[aria-label="${label}"]`));

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("assigning a midterm on a device outside Tashkent", () => {
  it("really is on the other clock — otherwise nothing below proves anything", () => {
    expect(new Date().getDate()).toBe(9);
  });

  it("offers Tashkent's today, and opens the paper at the picked Tashkent hour", async () => {
    await mount();
    await act(async () => buttonsLabelled("Assign to class")[0].click());

    const [startDay] = selects("Date");
    const firstDay = startDay.options[1];
    expect(firstDay.value).toBe("2026-11-10");
    expect(firstDay.textContent).toBe("Today · Tue, Nov 10");

    await choose(startDay, "2026-11-10");
    await choose(selects("Time")[0], "16:00");
    await act(async () => buttonsLabelled("Assign to class").at(-1)!.click());
    await settle(3);

    expect(assignToClassroom).toHaveBeenCalledWith(34, 11, {
      starts_at: "2026-11-10T11:00:00.000Z",
      deadline: undefined,
    });
  });
});
