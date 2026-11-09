/**
 * The posts list's "Next:" time is the hour the bot posts in Tashkent, whatever clock the
 * reader's device keeps.
 *
 * Runs on a device set to Europe/Kyiv (UTC+2 in November — three hours behind Tashkent). The
 * suite is pinned to Asia/Tashkent in vitest.config.ts, so only a test that moves the device
 * clock can see a label that follows the device instead of the school.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

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

const DEVICE_TZ = "Europe/Kyiv";
/** 16:00 in Tashkent — 13:00 on the device. */
const FOUR_PM = "2026-11-09T16:00:00+05:00";
/** 01:00 on the 10th in Tashkent — still 22:00 on the 9th on the device. */
const ONE_AM_NEXT_DAY = "2026-11-10T01:00:00+05:00";

function post(nextSendAt: string) {
  return {
    id: 7, kind: "MANUAL", text: "Mock exam on Sunday", preview: "Mock exam on Sunday",
    image_url: null, button_text: "", button_url: "", subjects: [], levels: [], classroom_ids: [],
    when: "WEEKLY", send_at: null, weekdays: [5], time_of_day: "18:00:00", is_paused: false, deleted_at: null,
    event_id: null, event_title: "", created_at: "2026-11-01T10:00:00+05:00", audience_label: "All groups",
    next_send_at: nextSendAt,
    last_run: null,
    state: "scheduled",
  };
}

let savedTz: string | undefined;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = DEVICE_TZ;
});

afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) {
    const mounted = root;
    await act(async () => mounted.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

async function renderNext(nextSendAt: string): Promise<string> {
  useTelegramPosts.mockReturnValue({
    data: { enabled: true, posts: [post(nextSendAt)] }, isPending: false, isError: false, refetch: vi.fn(),
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const mounted = createRoot(host);
  container = host;
  root = mounted;
  await act(async () => mounted.render(<TelegramPostsPage />));
  const next = [...host.querySelectorAll("span")].find((s) => s.textContent?.startsWith("Next: "));
  if (!next) throw new Error("no Next: label");
  return next.textContent ?? "";
}

describe("TelegramPostsPage on a device outside Tashkent", () => {
  it("really is running on the other clock — otherwise nothing below proves anything", () => {
    expect(new Date(FOUR_PM).getHours()).toBe(13);
  });

  it("says when the post goes out by the school's clock", async () => {
    const next = await renderNext(FOUR_PM);
    expect(next).toMatch(/(16:00|\b4:00:00\sPM)/);
    expect(next).not.toMatch(/(13:00|\b1:00:00\sPM)/);
  });

  it("keeps a post just after midnight in Tashkent on that hour, not the device's evening before", async () => {
    const next = await renderNext(ONE_AM_NEXT_DAY);
    expect(next).toMatch(/(01:00:00|\b1:00:00\sAM)/);
    expect(next).not.toMatch(/(22:00|\b10:00:00\sPM)/);
  });
});
