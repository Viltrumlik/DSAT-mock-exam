import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let state: Record<string, unknown> | undefined;
vi.mock("../telegramHooks", () => ({ useTelegramGroup: () => ({ data: state }) }));

import { TelegramHeaderButton } from "../shell/TelegramHeaderButton";

let host: HTMLElement;
let root: Root;
const open = vi.fn();

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  open.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(legacyUrl = "") {
  act(() => root.render(<TelegramHeaderButton classId={7} legacyUrl={legacyUrl} onOpenDialog={open} />));
}

describe("TelegramHeaderButton", () => {
  it("links straight to the bot when the bot sign-in is on", () => {
    state = { managed: true, bot_url: "https://t.me/Bot?start=login", status: "NONE" };
    render();
    const a = host.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://t.me/Bot?start=login");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps the join dialog while the bot sign-in is off", () => {
    state = { managed: true, bot_url: "", status: "NONE" };
    render();
    act(() => host.querySelector("button")?.click());
    expect(open).toHaveBeenCalledOnce();
  });

  it("falls back to the old static link for a class the bot does not run", () => {
    state = { managed: false, bot_url: "", status: "NONE" };
    render("https://t.me/+static");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("https://t.me/+static");
  });

  it("shows nothing with neither", () => {
    state = { managed: false, bot_url: "", status: "NONE" };
    render("");
    expect(host.innerHTML).toBe("");
  });
});
