/**
 * /ops/support in the console's look: the teacher list (rows, the Off badge, the count), its empty and failed
 * states, the Weekly hours editor for the picked teacher — the week saved with the same PUT body as before,
 * the server's own words when it refuses, the "not set yet" and "every day off" notices — and the Session
 * report tab. The axios instance is mocked, so the real `opsSupportApi` builds every request.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const put = vi.fn();

vi.mock("@/lib/api", () => ({ default: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) } }));
vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/ops/support", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: vi.fn() }) }));
// The report has its own tests; here only that the tab opens it.
vi.mock("@/features/supportReport/SupportReportPage", () => ({ SupportReportPage: () => <div>session report body</div> }));

const { default: Page } = await import("../page");

const TEACHERS = [
  { id: 7, name: "Dilafruz Ibrokhimjonova", email: "dilafruz@example.com", subject: "math", is_active: true },
  { id: 8, name: "", email: "nodir@example.com", subject: "both", is_active: false },
];

const LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function schedule(over: Record<string, unknown> = {}) {
  return {
    support_teacher: { id: 7, name: "Dilafruz Ibrokhimjonova" },
    configured: true,
    open_hour: 8,
    close_hour: 18,
    days: LABELS.map((label, weekday) => ({ weekday, label, is_working: weekday < 6, start_hour: 8, end_hour: 18 })),
    ...over,
  };
}

let teachers: () => Promise<unknown>;
let hours: () => Promise<unknown>;

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    );
  });
  await settle();
}
async function click(el: Element | null | undefined) {
  expect(el, "element to click").toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
async function choose(el: Element | null, value: string) {
  expect(el, "select").toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
    el!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
const text = () => host.textContent ?? "";
const button = (words: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === words) ?? null;
const select = (name: string) => host.querySelector(`select[aria-label="${name}"]`);
/** The switch whose label is the day's name. */
const daySwitch = (day: string) => {
  const label = [...host.querySelectorAll("label")].find((l) => l.textContent === day);
  return label ? document.getElementById(label.htmlFor) : null;
};
/** A teacher's row in the list: initials, name, subject. */
const teacherRow = (name: string) => [...host.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent?.includes(name)) ?? null;
async function pickDilafruz() {
  await click(teacherRow("Dilafruz Ibrokhimjonova"));
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  teachers = async () => ({ data: { results: TEACHERS } });
  hours = async () => ({ data: schedule() });
  get.mockImplementation((url: string) => (url === "/users/" ? teachers() : hours()));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("/ops/support — Weekly hours", () => {
  it("lists the support teachers with their subject, the count and Off, and asks for a pick", async () => {
    await render();

    expect(text()).toContain("Support hours");
    expect(text()).toContain("Who teaches support, and the weekly hours students can book them for.");
    const tabs = [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
    expect(tabs).toEqual(["Weekly hours", "Session report"]);
    expect(text()).toContain("Support teachers2");
    expect(text()).toContain("Dilafruz Ibrokhimjonova");
    expect(text()).toContain("Maths");
    // No name: the email stands in, and "both" reads as Both.
    expect(text()).toContain("nodir@example.com");
    expect(text()).toContain("Both");
    expect(text()).toContain("Off");
    expect(text()).toContain("Pick a support teacher");
    expect(text()).toContain("Choose someone on the left to set the hours students can book them for.");
    expect(get).toHaveBeenCalledWith("/users/", { params: { role: "support_teacher" } });
  });

  it("says when the school has no support teachers yet", async () => {
    teachers = async () => ({ data: { results: [] } });
    await render();
    expect(text()).toContain("No support teachers yet");
    expect(text()).toContain("Create one in Users with the support teacher role.");
  });

  it("says the list didn't load — never 'no support teachers' — and Try again asks again", async () => {
    teachers = async () => {
      throw new Error("boom");
    };
    await render();
    expect(text()).toContain("The list didn't load.");
    expect(text()).not.toContain("No support teachers yet");

    teachers = async () => ({ data: { results: TEACHERS } });
    await click(button("Try again"));
    expect(text()).toContain("Dilafruz Ibrokhimjonova");
  });

  it("opens the picked teacher's week, marked pressed, with each day's hours", async () => {
    await render();
    await pickDilafruz();

    expect(teacherRow("Dilafruz Ibrokhimjonova")?.getAttribute("aria-pressed")).toBe("true");
    expect(teacherRow("nodir@example.com")?.getAttribute("aria-pressed")).toBe("false");
    expect(text()).toContain("Weekly hours · Dilafruz Ibrokhimjonova");
    expect(get).toHaveBeenCalledWith("/classes/support/working-hours/", { params: { support_teacher: 7 } });
    expect(text()).toContain("Set once — Dilafruz is bookable at these hours every week, until you change them.");
    expect((select("Monday — first hour") as HTMLSelectElement).value).toBe("8");
    expect((select("Monday — last hour") as HTMLSelectElement).value).toBe("18");
    expect(text()).toContain("last session 17:00");
    // Sunday is off: no hours, the words instead.
    expect(daySwitch("Sunday")?.getAttribute("aria-checked")).toBe("false");
    expect(select("Sunday — first hour")).toBeNull();
    expect(text()).toContain("Not working");
    // Nothing changed yet, so nothing to save.
    expect((button("Save working hours") as HTMLButtonElement).disabled).toBe(true);
    expect(button("Discard")).toBeNull();
  });

  it("saves the whole week with the same PUT body, and says so", async () => {
    put.mockResolvedValue({ data: { ...schedule(), bookings_outside_schedule: [] } });
    await render();
    await pickDilafruz();

    await choose(select("Monday — first hour"), "10");
    await choose(select("Monday — last hour"), "15");
    expect(text()).toContain("last session 14:00");
    await click(button("Same hours every day"));
    await click(daySwitch("Saturday"));
    expect(daySwitch("Saturday")?.getAttribute("aria-checked")).toBe("false");

    await click(button("Save working hours"));

    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith("/classes/support/working-hours/", {
      support_teacher: 7,
      days: [
        { weekday: 0, is_working: true, start_hour: 10, end_hour: 15 },
        { weekday: 1, is_working: true, start_hour: 10, end_hour: 15 },
        { weekday: 2, is_working: true, start_hour: 10, end_hour: 15 },
        { weekday: 3, is_working: true, start_hour: 10, end_hour: 15 },
        { weekday: 4, is_working: true, start_hour: 10, end_hour: 15 },
        { weekday: 5, is_working: false, start_hour: 10, end_hour: 15 },
        { weekday: 6, is_working: false, start_hour: 8, end_hour: 18 },
      ],
    });
    expect(text()).toContain("Working hours saved. They apply from now on.");
  });

  it("names the bookings a narrower week leaves outside it", async () => {
    put.mockResolvedValue({
      data: {
        ...schedule(),
        bookings_outside_schedule: [
          { booking_id: 1, student: "Aziza", starts_at: "2026-11-16T16:00:00+05:00" },
          { booking_id: 2, student: "Bekzod", starts_at: "2026-11-17T16:00:00+05:00" },
        ],
      },
    });
    await render();
    await pickDilafruz();
    await choose(select("Tuesday — last hour"), "12");
    await click(button("Save working hours"));

    expect(text()).toContain(
      "Working hours saved. 2 existing bookings now sit outside these hours. They are still going ahead — Dilafruz can cancel them from the teacher portal if they should not.",
    );
  });

  it("shows the server's own words when it refuses the week, and its fallback otherwise", async () => {
    put.mockRejectedValueOnce({ response: { data: { detail: "Hours must fall between 08:00 and 18:00." } } });
    await render();
    await pickDilafruz();
    await choose(select("Monday — first hour"), "9");
    await click(button("Save working hours"));
    expect(text()).toContain("Hours must fall between 08:00 and 18:00.");
    expect(text()).not.toContain("Working hours saved.");

    put.mockRejectedValueOnce(new Error("network"));
    await click(button("Save working hours"));
    expect(text()).toContain("Those hours couldn't be saved.");
  });

  it("Discard puts the saved week back", async () => {
    await render();
    await pickDilafruz();
    await choose(select("Monday — first hour"), "11");
    expect((button("Save working hours") as HTMLButtonElement).disabled).toBe(false);

    await click(button("Discard"));
    expect((select("Monday — first hour") as HTMLSelectElement).value).toBe("8");
    expect(button("Discard")).toBeNull();
    expect((button("Save working hours") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says when nobody has set the week up, and when every day is switched off", async () => {
    hours = async () => ({
      data: schedule({
        configured: false,
        days: LABELS.map((label, weekday) => ({ weekday, label, is_working: weekday === 0, start_hour: 8, end_hour: 18 })),
      }),
    });
    await render();
    await pickDilafruz();
    expect(text()).toContain(
      "No schedule has been set yet, so Dilafruz is currently bookable 08:00–18:00 every day — the platform default. Save below to replace it.",
    );

    await click(daySwitch("Monday"));
    expect(text()).toContain("Every day is switched off. Saving this takes Dilafruz off the students' booking calendar entirely.");
    // With no working day there is nothing to copy across.
    expect(button("Same hours every day")).toBeNull();
  });

  it("says the week didn't load — never 'works no days' — and Try again asks again", async () => {
    hours = async () => {
      throw new Error("boom");
    };
    await render();
    await pickDilafruz();
    expect(text()).toContain("The weekly schedule didn't load.");
    expect(button("Save working hours")).toBeNull();

    hours = async () => ({ data: schedule() });
    await click(button("Try again"));
    expect(select("Monday — first hour")).not.toBeNull();
  });
});

describe("/ops/support — Session report", () => {
  it("opens the report under its own tab, with its own description", async () => {
    await render();
    await click([...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === "Session report"));

    expect(text()).toContain("session report body");
    expect(text()).toContain("Every support session the desk has run: who was helped, when, on what, and how it ended.");
    expect(text()).not.toContain("Pick a support teacher");
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("support-sessions");
  });
});
