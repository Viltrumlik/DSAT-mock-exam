/**
 * Gems and avatars: every catalog key draws, the room learns what a game paid, and the shop
 * shows the balance the server sends back after a purchase — never one it worked out itself.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/live/shop", useRouter: () => ({ push: vi.fn() }) }));

const { AVATAR_CHARACTERS, LiveAvatar, PlayerAvatar } = await import("../avatars");
const { GemShop } = await import("../GemShop");
const { EMPTY_ROOM, reduce } = await import("../useLiveQuiz");

describe("the avatar art", () => {
  it("draws all twelve characters in all four looks", () => {
    expect(AVATAR_CHARACTERS).toHaveLength(12);
    for (const character of AVATAR_CHARACTERS) {
      for (const skin of [null, "rare", "epic", "legendary"] as const) {
        const html = renderToStaticMarkup(<LiveAvatar character={character} skin={skin} />);
        expect(html, `${character}/${skin}`).toContain("<svg");
        expect(html).toContain('role="img"');
      }
    }
  });

  it("names the look for a screen reader", () => {
    expect(renderToStaticMarkup(<LiveAvatar character="owl" skin="legendary" />)).toContain('aria-label="Golden Hoot"');
  });

  it("falls back to initials for a player with no avatar, or one this build does not know", () => {
    expect(renderToStaticMarkup(<PlayerAvatar avatar={null} name="Aziza Rahimova" />)).toContain("AR");
    expect(renderToStaticMarkup(<PlayerAvatar avatar={{ character: "kraken", skin: null }} name="Bek Tursunov" />)).toContain("BT");
  });
});

describe("the room hears what a game paid", () => {
  it("keeps the gems_awarded frame", () => {
    const room = reduce(EMPTY_ROOM, {
      type: "gems_awarded",
      data: { earned: 80, balance: 230, capped: false, breakdown: { correct: 30, finish: 10, podium: 50, total: 90 } },
    });
    expect(room.gems?.earned).toBe(80);
    expect(room.gems?.balance).toBe(230);
  });
});

const item = (key: string, extra: Record<string, unknown> = {}) => {
  const [kind, character, tier] = key.split(":");
  return {
    key,
    kind: kind === "char" ? "character" : "skin",
    character,
    tier: tier ?? "common",
    name: character,
    price: kind === "char" ? 100 : 150,
    starter: false,
    owned: false,
    ...extra,
  };
};

const shopState = (balance: number, owned: string[] = []) => ({
  balance,
  today_earned: 40,
  daily_cap: 300,
  can_claim_starter: owned.length === 0,
  starters: ["owl", "cat", "robot"],
  look: owned.length ? { character: "fox", skin: null } : null,
  items: ["char:fox", "skin:fox:rare", "char:owl"].map((k) => item(k, { owned: owned.includes(k) })),
});

describe("the shop", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    apiGet.mockReset();
    apiPost.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const text = () => (host.textContent ?? "").replace(/\s+/g, " ");
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  };

  it("buys, then shows the balance and the ownership the server answered with", async () => {
    apiGet.mockResolvedValue({ data: shopState(130) });
    apiPost.mockResolvedValue({ data: shopState(30, ["char:fox"]) });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <GemShop />
        </QueryClientProvider>,
      );
    });
    await settle();
    expect(text()).toContain("130");
    expect(text()).toContain("Pick your free character");

    const buyFox = Array.from(host.querySelectorAll("button")).find(
      (b) => b.closest("li")?.querySelector('[aria-label="Ember"]') && b.textContent?.includes("100"),
    );
    expect(buyFox).toBeTruthy();
    await act(async () => buyFox!.click());
    await settle();

    expect(apiPost).toHaveBeenCalledWith("/livequiz/shop/buy/", { item: "char:fox" });
    expect(text()).toContain("30");
    expect(text()).toContain("Wearing");
    expect(text()).not.toContain("Pick your free character");
  });

  it("will not offer what the student cannot afford", async () => {
    apiGet.mockResolvedValue({ data: shopState(20) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <GemShop />
        </QueryClientProvider>,
      );
    });
    await settle();
    const buyFox = Array.from(host.querySelectorAll("button")).find(
      (b) => b.closest("li")?.querySelector('[aria-label="Ember"]') && b.textContent?.includes("100"),
    );
    expect(buyFox?.disabled).toBe(true);
    expect(text()).toContain("80 more to go");
  });
});
