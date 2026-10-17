import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/** A post's page: who got it, what failed, and the buttons that act on exactly that. */

const useTelegramPost = vi.fn();
const act_ = vi.fn();
const confirmSpy = vi.fn();

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/ops/telegram-posts/telegramPostsHooks", () => ({
  useTelegramPost: (id: number) => useTelegramPost(id),
  usePostAction: () => ({ mutate: act_, isPending: false }),
  useSavePost: () => ({ mutate: vi.fn(), isPending: false }),
  useTelegramGroups: () => ({ data: { enabled: true, groups: [] } }),
}));

const { TelegramPostPage } = await import("@/features/ops/telegram-posts/TelegramPostPage");

function detail(over: Record<string, unknown> = {}) {
  return {
    id: 7, kind: "MANUAL", text: "Ertaga mock!", preview: "Ertaga mock!", image_url: null,
    button_text: "", button_url: "", subjects: [], levels: [], classroom_ids: [],
    when: "WEEKLY", send_at: null, weekdays: [5], time_of_day: "18:00:00", is_paused: false, deleted_at: null,
    event_id: null, event_title: "", created_at: "2026-10-17T10:00:00+05:00", audience_label: "All groups",
    next_send_at: "2026-10-24T18:00:00+05:00",
    last_run: { run_on: "2026-10-17", total: 2, sent: 1, failed: 1, missed: 0, pending: 0, deleted: 0 },
    state: "failed",
    runs: [{
      run_on: "2026-10-17",
      deliveries: [
        { id: 1, chat_id: "-1001", group_names: "Senior G1 Math", status: "SENT", error: "", sent_at: "2026-10-17T18:00:05+05:00", attempts: 1 },
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

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<TelegramPostPage id={7} />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  confirmSpy.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
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

  it("retries only when something failed", async () => {
    await render();
    await act(async () => button("Retry failed")!.click());
    expect(act_.mock.calls[0][0]).toBe("retry");
    useTelegramPost.mockReturnValue({
      data: detail({ last_run: { run_on: "2026-10-17", total: 2, sent: 2, failed: 0, missed: 0, pending: 0, deleted: 0 }, state: "scheduled" }),
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await act(async () => root.render(<TelegramPostPage id={7} />));
    expect(button("Retry failed")).toBeUndefined();
  });

  it("asks before deleting from the groups, and says what was too old", async () => {
    act_.mockImplementation((_action: string, opts: { onSuccess: (d: unknown) => void }) =>
      opts.onSuccess({ result: { deleted: 1, too_old: 1, failed: 0, in_flight: 0 }, post: detail() }),
    );
    await render();
    await act(async () => button("Delete from groups")!.click());
    expect(String(confirmSpy.mock.calls[0][0])).toContain("Delete this post from 1 Telegram group");
    expect(act_.mock.calls[0][0]).toBe("delete-from-groups");
    expect(text()).toContain("1 too old — remove it by hand.");
    expect(text()).not.toContain("still sending");
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
