import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const toast = vi.fn();
vi.mock("@/lib/api", () => ({ default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));

import { TelegramSection } from "../sections/TelegramSection";

const PART = {
  configured: true,
  health: { ok: true, title: "G15", member_count: 23, problem: "" },
  counts: { in_group: 23, known: 2, managed: 1, frozen_in_group: 1 },
  members: [
    { id: 1, user_id: 10, name: "Aziz Testov", telegram_user_id: 1001, telegram_username: "aziz", telegram_display_name: "Aziz", status: "JOINED", managed: true, frozen: false, frozen_for_debt: false, joined_at: null },
    { id: 2, user_id: 11, name: "Malika Testova", telegram_user_id: 1002, telegram_username: "", telegram_display_name: "Malika", status: "JOINED", managed: false, frozen: true, frozen_for_debt: true, joined_at: null },
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

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: PART });
  post.mockReset().mockResolvedValue({ data: { removed: true } });
  toast.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => root.render(<QueryClientProvider client={client}><TelegramSection id={45} /></QueryClientProvider>));
  await settle();
}

describe("TelegramSection", () => {
  it("shows the counts and marks the unpaid member the bot will not remove", async () => {
    await render();
    expect(get).toHaveBeenCalledWith("/classes/admin/classrooms/45/telegram/");
    expect(host.textContent).toContain("23 in the group");
    expect(host.textContent).toContain("Frozen — unpaid");
    expect(host.textContent).toContain("bot will not remove");
  });

  it("removes a member by hand and reloads the part", async () => {
    await render();
    const removeButtons = [...host.querySelectorAll("button")].filter((b) => b.textContent === "Remove");
    await act(async () => removeButtons[1].click());
    await settle();
    expect(post).toHaveBeenCalledWith("/classes/admin/classrooms/45/telegram/remove/", { member_id: 2 });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "success" }));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("explains a class with no group", async () => {
    get.mockResolvedValue({ data: { ...PART, configured: false, health: null, members: [] } });
    await render();
    expect(host.textContent).toContain("No Telegram group is set for this class");
  });

  it("reloads the part when Telegram refuses, since the row may have changed", async () => {
    post.mockRejectedValue({ response: { status: 409, data: { detail: "Telegram did not remove them: they may have left already." } } });
    await render();
    const removeButtons = [...host.querySelectorAll("button")].filter((b) => b.textContent === "Remove");
    await act(async () => removeButtons[0].click());
    await settle();
    expect(toast).toHaveBeenCalledWith({ tone: "error", message: "Telegram did not remove them: they may have left already." });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
