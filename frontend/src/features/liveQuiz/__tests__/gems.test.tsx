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
const { gamesToGo, nextGoal } = await import("../theme");

describe("the avatar art", () => {
  it("draws every character in every face at a size with effects", () => {
    for (const character of AVATAR_CHARACTERS) {
      for (const face of ["waiting", "right", "thinking", "oops"] as const) {
        const html = renderToStaticMarkup(<LiveAvatar character={character} skin="legendary" size={96} face={face} />);
        expect(html, `${character}/${face}`).toContain("<svg");
      }
    }
  });

  it("gives each face its own drawing, and small sizes none of the effects", () => {
    const draw = (face: "waiting" | "right" | "oops") => renderToStaticMarkup(<LiveAvatar character="cat" size={96} face={face} />);
    expect(new Set([draw("waiting"), draw("right"), draw("oops")]).size).toBe(3);
    expect(renderToStaticMarkup(<LiveAvatar character="cat" skin="epic" size={96} />)).toContain("A44 9");
    expect(renderToStaticMarkup(<LiveAvatar character="cat" skin="epic" size={28} />)).not.toContain("A44 9");
  });

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
  const button = (selector: string) => host.querySelector(selector) as HTMLButtonElement;
  const buyButton = () =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Buy for")) as HTMLButtonElement;
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

    await act(async () => button('[aria-label="Open fox"]').click());
    await settle();
    await act(async () => buyButton().click());
    await settle();

    expect(apiPost).toHaveBeenCalledWith("/livequiz/shop/buy/", { item: "char:fox" });
    expect(text()).toContain("30");
    expect(text()).toContain("wearing this");
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
    await act(async () => button('[aria-label="Open fox"]').click());
    await settle();
    expect(buyButton().disabled).toBe(true);
    expect(text()).toContain("80 more gems · about one game");
  });

  it("will not sell a skin before its character", async () => {
    apiGet.mockResolvedValue({ data: shopState(500) });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <GemShop />
        </QueryClientProvider>,
      );
    });
    await settle();
    await act(async () => button('[aria-label="Open fox"]').click());
    await settle();
    await act(async () => button('[aria-label="Preview fox"][aria-pressed="false"]').click());
    await settle();
    expect(text()).toContain("A skin needs its character first");
    expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent?.startsWith("Buy for"))).toBe(false);
  });
});

describe("what to save for next", () => {
  const skin = (key: string, price: number, owned = false) => item(key, { price, owned });
  const state = (look: { character: string; skin: null } | null, items: ReturnType<typeof item>[]) =>
    ({ ...shopState(0), look, items }) as unknown as Parameters<typeof nextGoal>[0];

  it("is the cheapest skin of the character they wear", () => {
    const shop = state({ character: "fox", skin: null }, [
      skin("char:fox", 100, true),
      skin("skin:fox:epic", 300),
      skin("skin:fox:rare", 150),
      skin("skin:owl:rare", 150),
      skin("char:owl", 100),
    ]);
    expect(nextGoal(shop)?.key).toBe("skin:fox:rare");
  });

  it("moves on to a new character once that one is complete", () => {
    const shop = state({ character: "fox", skin: null }, [skin("char:fox", 100, true), skin("skin:fox:rare", 150, true), skin("char:dragon", 500), skin("char:owl", 100)]);
    expect(nextGoal(shop)?.key).toBe("char:owl");
  });

  it("is nothing at all when they own the whole shop", () => {
    expect(nextGoal(state({ character: "fox", skin: null }, [skin("char:fox", 100, true)]))).toBeNull();
  });

  it("says roughly how many games a price is", () => {
    expect(gamesToGo(40)).toBe("about one game");
    expect(gamesToGo(180)).toBe("about two games");
    expect(gamesToGo(900)).toBe("about 9 games");
  });
});
