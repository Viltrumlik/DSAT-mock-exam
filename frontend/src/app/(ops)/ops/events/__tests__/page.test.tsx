/**
 * /ops/events in the console's look: the list with each event's state, seats and Telegram run; the empty and the
 * failed list; the form with the same checks and the same body; Publish, Delete and Call it off asking first with
 * the same sentences; and Who came marking a row with the same call.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useAdminEvents = vi.fn();
const save = vi.fn();
const publish = vi.fn();
const cancel = vi.fn();
const remove = vi.fn();
const mark = vi.fn();
const useEventRegistrations = vi.fn();
const confirmSpy = vi.fn();
let telegram: { enabled: boolean; groups: { id: number; name: string; subject: string; level: string; chat_id: string }[] } = {
  enabled: true,
  groups: [
    { id: 1, name: "Senior G1 Math", subject: "MATH", level: "senior", chat_id: "-1001" },
    { id: 2, name: "Junior G2 English", subject: "ENGLISH", level: "junior", chat_id: "-1002" },
  ],
};

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/ops/telegram-posts/telegramPostsHooks", () => ({
  useTelegramGroups: () => ({ data: telegram }),
}));
vi.mock("@/features/events/eventsHooks", () => ({
  useAdminEvents: () => useAdminEvents(),
  useSaveEvent: () => ({ mutate: save, isPending: false }),
  usePublishEvent: () => ({ mutate: publish, isPending: false }),
  useCancelEvent: () => ({ mutate: cancel, isPending: false }),
  useDeleteEvent: () => ({ mutate: remove, isPending: false }),
  useEventRegistrations: (id: number) => useEventRegistrations(id),
  useMarkAttendance: () => ({ mutate: mark, isPending: false }),
  useTicket: () => ({ data: undefined, isPending: false, isError: false }),
}));

const { default: Page } = await import("../page");

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

function event(id: number, over: Record<string, unknown> = {}) {
  return {
    id, title: `Event ${id}`, description: "About it", location: "Chilonzor, room 3", seats: 30, seats_left: 18,
    status: "DRAFT", starts_at: inDays(3), ends_at: inDays(3.1), cover_image_url: null,
    telegram_post: true, telegram_audience: { subjects: [], levels: [] }, telegram: null,
    ...over,
  };
}

let host: HTMLElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === words);
const row = (id: number) => host.querySelector<HTMLElement>(`[data-event="${id}"]`)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

async function render() {
  await act(async () => root.render(<Page />));
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [useAdminEvents, save, publish, cancel, remove, mark, useEventRegistrations, confirmSpy]) f.mockReset();
  confirmSpy.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
  telegram = { ...telegram, enabled: true };
  useAdminEvents.mockReturnValue({
    data: [
      event(1, { title: "Mock day" }),
      event(2, {
        title: "Open day",
        status: "PUBLISHED",
        telegram: { post_id: 9, sent: 25, total: 26, failed: 1, deleted: 0 },
      }),
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the events list", () => {
  it("shows each event with its state, seats and Telegram run, and the actions its state allows", async () => {
    await render();
    expect(host.querySelector("h1")!.textContent).toBe("Events");
    expect(row(1).textContent).toContain("Mock day");
    expect(row(1).textContent).toContain("Draft");
    expect(row(1).textContent).toContain("12/30");
    expect(row(1).textContent).toContain("Chilonzor, room 3");
    expect(buttonIn(row(1), "Publish")).toBeDefined();
    expect(buttonIn(row(1), "Delete")).toBeDefined();
    expect(buttonIn(row(1), "Who came")).toBeUndefined();

    expect(row(2).textContent).toContain("Published");
    const link = row(2).querySelector('a[href="/ops/telegram-posts/9"]')!;
    expect(link.textContent).toBe("Telegram 25/26 · 1 failed");
    expect(buttonIn(row(2), "Who came")).toBeDefined();
    expect(buttonIn(row(2), "Call it off")).toBeDefined();
    expect(buttonIn(row(2), "Publish")).toBeUndefined();
  });

  it("says so when there are no events, and offers a retry when the list fails", async () => {
    useAdminEvents.mockReturnValue({ data: [], isPending: false, isError: false, refetch: vi.fn() });
    await render();
    expect(text()).toContain("No events yet");
    expect(text()).toContain("Add one, then publish it when it is ready.");

    const refetch = vi.fn();
    useAdminEvents.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch });
    await render();
    expect(text()).toContain("The events didn't load.");
    await click(buttonIn(host, "Try again")!);
    expect(refetch).toHaveBeenCalled();
  });

  it("asks before publishing, naming the Telegram groups, and publishes only on yes", async () => {
    await render();
    await click(buttonIn(row(1), "Publish")!);
    expect(confirmSpy).toHaveBeenCalledWith(
      "Publish “Mock day”, email every student and post to 2 Telegram groups? This can't be undone.",
    );
    expect(publish).toHaveBeenCalledWith(1);

    publish.mockReset();
    confirmSpy.mockReturnValue(false);
    await click(buttonIn(row(1), "Publish")!);
    expect(publish).not.toHaveBeenCalled();
  });

  it("leaves Telegram out of the question when posting is off", async () => {
    telegram = { ...telegram, enabled: false };
    await render();
    await click(buttonIn(row(1), "Publish")!);
    expect(confirmSpy).toHaveBeenCalledWith("Publish “Mock day” and email every student? This can't be undone.");
  });

  it("asks before deleting a draft and calling off a published event", async () => {
    await render();
    await click(buttonIn(row(1), "Delete")!);
    expect(confirmSpy).toHaveBeenLastCalledWith("Delete “Mock day”? This cannot be undone.");
    expect(remove).toHaveBeenCalledWith(1);
    await click(buttonIn(row(2), "Call it off")!);
    expect(confirmSpy).toHaveBeenLastCalledWith("Call off “Open day”? Everyone who signed up will be emailed.");
    expect(cancel).toHaveBeenCalledWith(2);
  });
});

describe("the event form", () => {
  it("refuses an event with no start or end, without asking the server", async () => {
    await render();
    await click(buttonIn(host, "Add an event")!);
    const d = dialog()!;
    expect(d.textContent).toContain("Add an event");
    await click(buttonIn(d, "Save draft")!);
    expect(text()).toContain("An event needs a start and an end.");
    expect(save).not.toHaveBeenCalled();
  });

  it("saves a new event with the same fields, and the Telegram choice it shows", async () => {
    await render();
    await click(buttonIn(host, "Add an event")!);
    await type(document.querySelector<HTMLInputElement>("#event-title")!, "Mock day");
    await type(document.querySelector<HTMLTextAreaElement>("#event-description")!, "Bring a pencil");
    await type(document.querySelector<HTMLInputElement>("#event-starts")!, "2026-11-20T10:00");
    await type(document.querySelector<HTMLInputElement>("#event-ends")!, "2026-11-20T13:00");
    await type(document.querySelector<HTMLInputElement>("#event-location")!, "Chilonzor");
    expect(text()).toContain("Goes to 2 Telegram groups.");
    await click(buttonIn(dialog()!, "Save draft")!);
    expect(save).toHaveBeenCalledTimes(1);
    const { id, body } = save.mock.calls[0][0];
    expect(id).toBeUndefined();
    expect(body).toEqual({
      title: "Mock day",
      description: "Bring a pencil",
      location: "Chilonzor",
      seats: 30,
      // The typed wall time through the same conversion the form has always used.
      starts_at: new Date("2026-11-20T10:00").toISOString(),
      ends_at: new Date("2026-11-20T13:00").toISOString(),
      telegram_post: true,
      telegram_audience: { subjects: [], levels: [] },
    });
  });

  it("sends the unticked Telegram choice, and hides the audience", async () => {
    await render();
    await click(buttonIn(host, "Add an event")!);
    await type(document.querySelector<HTMLInputElement>("#event-starts")!, "2026-11-20T10:00");
    await type(document.querySelector<HTMLInputElement>("#event-ends")!, "2026-11-20T13:00");
    const box = document.querySelector<HTMLInputElement>('input[aria-label="Post to Telegram groups"]')!;
    await click(box);
    expect(text()).not.toContain("Goes to");
    await click(buttonIn(dialog()!, "Save draft")!);
    expect(save.mock.calls[0][0].body).toMatchObject({ telegram_post: false });
  });

  it("shows the server's words when a save is refused", async () => {
    save.mockImplementation((_vars: unknown, opts: { onError: (e: unknown) => void }) =>
      opts.onError({ response: { data: { seats: ["Ensure this value is greater than or equal to 1."] } } }),
    );
    await render();
    await click(buttonIn(row(1), "Edit")!);
    expect(dialog()!.textContent).toContain("Edit event");
    expect(document.querySelector<HTMLInputElement>("#event-title")!.value).toBe("Mock day");
    await click(buttonIn(dialog()!, "Save draft")!);
    expect(save.mock.calls[0][0].id).toBe(1);
    expect(dialog()!.textContent).toContain("Ensure this value is greater than or equal to 1.");
  });
});

describe("who came", () => {
  it("lists who signed up and marks a row with the same call", async () => {
    useEventRegistrations.mockReturnValue({
      data: {
        marking_opens_at: new Date(Date.now() - 60_000).toISOString(),
        counts: { registered: 2, attended: 1, missed: 0, not_marked: 1 },
        registrations: [
          { id: 31, student_name: "Ali Valiyev", phone: "+998901234567", ticket_code: "4K29-7XPD", registered_at: "2026-11-10T10:00:00Z", status: "ACTIVE", attendance: null },
          { id: 32, student_name: "Vali Aliyev", phone: "", ticket_code: "", registered_at: "2026-11-10T11:00:00Z", status: "CANCELLED", attendance: null },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    await render();
    await click(buttonIn(row(2), "Who came")!);
    const d = dialog()!;
    expect(d.textContent).toContain("Who signed up, and who came");
    expect(d.textContent).toContain("Registered 2 · Attended 1 · Missed 0 · Not marked 1");
    expect(d.textContent).toContain("Ali Valiyev");
    expect(d.textContent).toContain("4K29-7XPD");
    expect(d.textContent).toContain("No phone · cancelled");
    expect(d.textContent).toContain("Gave the seat back");
    await click(buttonIn(d, "Attended")!);
    expect(mark).toHaveBeenCalledWith({ id: 31, attendance: "ATTENDED" });
  });

  it("keeps the marks off before arrivals open, and says nobody signed up", async () => {
    useEventRegistrations.mockReturnValue({
      data: { marking_opens_at: inDays(1), counts: { registered: 0, attended: 0, missed: 0, not_marked: 0 }, registrations: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    await render();
    await click(buttonIn(row(2), "Who came")!);
    expect(dialog()!.textContent).toContain("You can mark arrivals from");
    expect(dialog()!.textContent).toContain("Nobody has signed up yet.");
  });
});
