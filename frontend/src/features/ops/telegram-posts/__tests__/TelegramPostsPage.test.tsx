import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/** The posts list: what each post is, where it goes, and how its last run went. */

const useTelegramPosts = vi.fn();

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/ops/telegram-posts/telegramPostsHooks", () => ({
  useTelegramPosts: () => useTelegramPosts(),
  useTelegramGroups: () => ({ data: { enabled: true, groups: [] } }),
  useSavePost: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { TelegramPostsPage } = await import("@/features/ops/telegram-posts/TelegramPostsPage");

function post(over: Record<string, unknown> = {}) {
  return {
    id: 7, kind: "MANUAL", text: "Ertaga yakshanba soat 10:00 da mock!", preview: "Ertaga yakshanba soat 10:00 da mock!",
    image_url: null, button_text: "", button_url: "", subjects: [], levels: [], classroom_ids: [],
    when: "WEEKLY", send_at: null, weekdays: [5], time_of_day: "18:00:00", is_paused: false, deleted_at: null,
    event_id: null, event_title: "", created_at: "2026-10-17T10:00:00+05:00", audience_label: "All groups",
    next_send_at: "2026-10-24T18:00:00+05:00",
    last_run: { run_on: "2026-10-17", total: 26, sent: 25, failed: 1, missed: 0, pending: 0, deleted: 0, uncertain: 0 },
    state: "failed",
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<TelegramPostsPage />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useTelegramPosts.mockReturnValue({ data: { enabled: true, posts: [post()] }, isPending: false, isError: false, refetch: vi.fn() });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("TelegramPostsPage", () => {
  it("lists each post with its state, schedule, audience and last run", async () => {
    await render();
    expect(text()).toContain("Ertaga yakshanba soat 10:00 da mock!");
    expect(text()).toContain("Some failed");
    expect(text()).toContain("Every Sat at 18:00");
    expect(text()).toContain("All groups");
    expect(text()).toContain("Sent 25/26 · 1 failed");
    expect(document.querySelector('a[href="/ops/telegram-posts/7"]')).not.toBeNull();
  });

  it("warns when posting is switched off on the server", async () => {
    useTelegramPosts.mockReturnValue({ data: { enabled: false, posts: [] }, isPending: false, isError: false, refetch: vi.fn() });
    await render();
    expect(text()).toContain(
      "Posting is switched off on this server — Now posts are refused; scheduled posts go out at their time once it is on.",
    );
    expect(text()).toContain("No posts yet");
  });

  it("offers a retry when the list fails", async () => {
    useTelegramPosts.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() });
    await render();
    expect(text()).toContain("The posts didn't load.");
  });
});
