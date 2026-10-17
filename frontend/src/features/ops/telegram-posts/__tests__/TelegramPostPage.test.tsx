import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/** A post's page: who got it, what failed, and the buttons that act on exactly that. */

const useTelegramPost = vi.fn();
const act_ = vi.fn();
const confirmSpy = vi.fn();
let actionPending = false;

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/ops/telegram-posts/telegramPostsHooks", () => ({
  useTelegramPost: (id: number) => useTelegramPost(id),
  usePostAction: () => ({ mutate: act_, isPending: actionPending }),
  useSavePost: () => ({ mutate: vi.fn(), isPending: false }),
  useTelegramGroups: () => ({ data: { enabled: true, groups: [] } }),
}));

const { TelegramPostPage } = await import("@/features/ops/telegram-posts/TelegramPostPage");

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function run(sent: number, failed: number, missed = 0) {
  return { run_on: "2026-10-17", total: sent + failed + missed, sent, failed, missed, pending: 0, deleted: 0 };
}

function detail(over: Record<string, unknown> = {}) {
  return {
    id: 7, kind: "MANUAL", text: "Ertaga mock!", preview: "Ertaga mock!", image_url: null,
    button_text: "", button_url: "", subjects: [], levels: [], classroom_ids: [],
    when: "WEEKLY", send_at: null, weekdays: [5], time_of_day: "18:00:00", is_paused: false, deleted_at: null,
    event_id: null, event_title: "", created_at: "2026-10-17T10:00:00+05:00", audience_label: "All groups",
    next_send_at: "2026-10-24T18:00:00+05:00",
    last_run: run(1, 1),
    state: "failed",
    runs: [{
      run_on: "2026-10-17",
      deliveries: [
        { id: 1, chat_id: "-1001", group_names: "Senior G1 Math", status: "SENT", error: "", sent_at: hoursAgo(1), attempts: 1 },
        { id: 2, chat_id: "-1002", group_names: "Junior G2 Math", status: "FAILED", error: "403: Forbidden: bot was kicked", sent_at: null, attempts: 1 },
      ],
    }],
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

async function render(id = 7) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<TelegramPostPage id={id} />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  confirmSpy.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
  actionPending = false;
  act_.mockReset();
  useTelegramPost.mockReturnValue({ data: detail(), isPending: false, isError: false, refetch: vi.fn() });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("TelegramPostPage", () => {
  it("lists every group of the run, with the reason a send failed", async () => {
    await render();
    expect(text()).toContain("Senior G1 Math");
    expect(text()).toContain("Junior G2 Math");
    expect(text()).toContain("403: Forbidden: bot was kicked");
  });

  it("names a post that goes out now without an empty slot in its header", async () => {
    useTelegramPost.mockReturnValue({
      data: detail({ when: "NOW", weekdays: [], time_of_day: null, next_send_at: null }),
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    expect(text()).toContain("Now · All groups");
    expect(text()).not.toContain("·  ·");
  });

  it("retries only when something failed", async () => {
    await render();
    await act(async () => button("Retry failed")!.click());
    expect(act_.mock.calls[0][0]).toBe("retry");
    useTelegramPost.mockReturnValue({
      data: detail({ last_run: run(2, 0), state: "scheduled" }),
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await act(async () => root.render(<TelegramPostPage id={7} />));
    expect(button("Retry failed")).toBeUndefined();
  });

  it("asks before retrying, naming how many groups failed — and sends nothing if declined", async () => {
    useTelegramPost.mockReturnValue({
      data: detail({ last_run: run(24, 2), state: "failed" }),
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    await act(async () => button("Retry failed")!.click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain("Send this post again to 2 Telegram groups?");
    expect(act_.mock.calls[0][0]).toBe("retry");

    act_.mockClear();
    confirmSpy.mockReturnValue(false);
    await act(async () => button("Retry failed")!.click());
    expect(act_).not.toHaveBeenCalled();
  });

  it("asks before sending the missed ones, naming how many groups missed — and sends nothing if declined", async () => {
    useTelegramPost.mockReturnValue({
      data: detail({ last_run: run(23, 0, 3), state: "missed" }),
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    await act(async () => button("Send missed now")!.click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain("Send this post now to 3 Telegram groups that missed it?");
    expect(act_.mock.calls[0][0]).toBe("send-missed");

    act_.mockClear();
    confirmSpy.mockReturnValue(false);
    await act(async () => button("Send missed now")!.click());
    expect(act_).not.toHaveBeenCalled();
  });

  it("asks before deleting from the groups, and says what was too old", async () => {
    act_.mockImplementation((_action: string, opts: { onSuccess: (d: unknown) => void }) =>
      opts.onSuccess({ result: { deleted: 1, too_old: 1, failed: 0, in_flight: 0 }, post: detail() }),
    );
    await render();
    await act(async () => button("Delete from groups")!.click());
    const question = String(confirmSpy.mock.calls[0][0]);
    expect(question).toContain("Delete this post from 1 Telegram group and stop it for good?");
    expect(question).toContain("Messages older than 48 hours can't be deleted by the bot.");
    expect(act_.mock.calls[0][0]).toBe("delete-from-groups");
    expect(text()).toContain("1 too old — remove it by hand.");
    expect(text()).not.toContain("still sending");
  });

  it("counts the groups to delete from the sends of the last 48 hours, not from the last run", async () => {
    useTelegramPost.mockReturnValue({
      data: detail({
        // The last run says 26 sent; only two of those messages are young enough to take down.
        last_run: run(26, 0),
        state: "sent",
        runs: [
          {
            run_on: "2026-10-17",
            deliveries: [
              { id: 1, chat_id: "-1001", group_names: "Senior G1 Math", status: "SENT", error: "", sent_at: hoursAgo(2), attempts: 1 },
              { id: 2, chat_id: "-1002", group_names: "Junior G2 Math", status: "SENT", error: "", sent_at: hoursAgo(47), attempts: 1 },
              { id: 3, chat_id: "-1003", group_names: "Senior G3 English", status: "SENT", error: "", sent_at: hoursAgo(49), attempts: 1 },
              { id: 4, chat_id: "-1004", group_names: "Junior G4 English", status: "FAILED", error: "403", sent_at: null, attempts: 1 },
            ],
          },
        ],
      }),
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    await act(async () => button("Delete from groups")!.click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain("Delete this post from 2 Telegram groups and stop it for good?");
  });

  it("still says the post stops for good when every send is older than 48 hours", async () => {
    useTelegramPost.mockReturnValue({
      data: detail({
        last_run: run(26, 0),
        state: "sent",
        runs: [{
          run_on: "2026-10-10",
          deliveries: [
            { id: 1, chat_id: "-1001", group_names: "Senior G1 Math", status: "SENT", error: "", sent_at: hoursAgo(24 * 7), attempts: 1 },
          ],
        }],
      }),
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    await act(async () => button("Delete from groups")!.click());
    const question = String(confirmSpy.mock.calls[0][0]);
    expect(question).toContain("Delete this post from 0 Telegram groups and stop it for good?");
    expect(question).toContain("Messages older than 48 hours can't be deleted by the bot.");
    expect(act_.mock.calls[0][0]).toBe("delete-from-groups");
  });

  it("says a post that was never sent has nothing to take down", async () => {
    useTelegramPost.mockReturnValue({
      data: detail({ last_run: null, state: "scheduled", runs: [] }),
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    await act(async () => button("Delete from groups")!.click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain(
      "Stop this post for good? It hasn't been sent to any group yet.",
    );
    expect(act_.mock.calls[0][0]).toBe("delete-from-groups");
  });

  it("says how many sends were still in flight when the post was deleted", async () => {
    act_.mockImplementation((_action: string, opts: { onSuccess: (d: unknown) => void }) =>
      opts.onSuccess({ result: { deleted: 1, too_old: 0, failed: 0, in_flight: 2 }, post: detail() }),
    );
    await render();
    await act(async () => button("Delete from groups")!.click());
    expect(text()).toContain("Deleted from 1 group.");
    expect(text()).toContain("2 still sending — removed as they land.");
  });

  it("does nothing when the delete is declined", async () => {
    confirmSpy.mockReturnValue(false);
    await render();
    await act(async () => button("Delete from groups")!.click());
    expect(act_).not.toHaveBeenCalled();
  });

  it("shows the server's reason when an action is refused, and a plain sentence when the body is not JSON", async () => {
    act_.mockImplementationOnce((_action: string, opts: { onError: (e: unknown) => void }) =>
      opts.onError({ response: { data: { code: "deleted", detail: "This post was deleted from the groups." } } }),
    );
    await render();
    await act(async () => button("Pause")!.click());
    expect(text()).toContain("This post was deleted from the groups.");

    act_.mockImplementationOnce((_action: string, opts: { onError: (e: unknown) => void }) =>
      opts.onError({ response: { data: "<html><body>413 Request Entity Too Large</body></html>" } }),
    );
    await act(async () => button("Pause")!.click());
    expect(text()).toContain("That didn't work. Try again.");
    expect(text()).not.toContain("<html>");
    expect(text()).not.toContain("This post was deleted from the groups.");
  });

  it("disables the action buttons while an action is in flight", async () => {
    actionPending = true;
    await render();
    for (const label of ["Pause", "Retry failed", "Delete from groups"]) {
      expect((button(label) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("says so when the address is not a post, rather than loading forever", async () => {
    // A disabled v5 query reports "pending" forever — which is what a NaN id gives.
    useTelegramPost.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: vi.fn() });
    await render(Number.NaN);
    expect(text()).toContain("That post doesn't exist.");
    expect(text()).not.toContain("Loading…");
    expect(document.querySelector('a[href="/ops/telegram-posts"]')).not.toBeNull();
  });

  it("sends an event's post back to its event for edits", async () => {
    useTelegramPost.mockReturnValue({
      data: detail({ kind: "EVENT_REMINDER", when: "EVENT", event_id: 3, event_title: "Admission Workshop" }),
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    expect(button("Edit")).toBeUndefined();
    expect(text()).toContain("Admission Workshop");
    expect(button("Pause")).toBeDefined();
  });
});
