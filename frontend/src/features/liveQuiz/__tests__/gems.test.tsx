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

const { AVATAR_CHARACTERS, AvatarDisc, EmoteBubble, LiveAvatar, PlayerAvatar } = await import("../avatars");
const { GemShop } = await import("../GemShop");
const { Locker } = await import("../Locker");
const { NextLookCard } = await import("../PlayerSummary");
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

describe("the locker", () => {
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

  const hat = (key: string, name: string, owned: boolean, price = 200) => ({
    key: `hat:${key}`,
    kind: "hat",
    character: "",
    slot_key: key,
    tier: "rare",
    name,
    price,
    starter: false,
    owned,
  });
  const state = (balance: number, owned: Record<string, boolean>, look: Record<string, unknown> = {}) => ({
    balance,
    today_earned: 0,
    daily_cap: 300,
    can_claim_starter: false,
    starters: [],
    look: { character: "fox", skin: null, ...look },
    items: [
      item("char:fox", { owned: true, name: "Ember" }),
      hat("crown", "Crown", Boolean(owned.crown), 600),
      hat("doppi", "Doʻppi", Boolean(owned.doppi)),
    ],
  });
  const showShop = (data: unknown) => {
    // The locker also asks who is signed in; only the shop's answer matters here.
    apiGet.mockImplementation(async (url: string) => (url.includes("shop") ? { data } : { data: { id: 1, first_name: "Ali", last_name: "Vali" } }));
  };
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  };
  const open = async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Locker />
        </QueryClientProvider>,
      );
    });
    await settle();
  };
  const text = () => (host.textContent ?? "").replace(/\s+/g, " ");
  const pick = async (label: string) => {
    await act(async () => (host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click());
    await settle();
  };
  const buttonStarting = (start: string) =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith(start)) as HTMLButtonElement | undefined;

  it("sends a student with no character to pick one", async () => {
    showShop({ ...state(0, {}), look: null });
    await open();
    expect(text()).toContain("Pick your character");
  });

  it("tapping only previews: nothing is sent until Save look", async () => {
    showShop(state(0, { doppi: true }));
    await open();
    expect(buttonStarting("You are wearing this")?.disabled).toBe(true);
    await pick("Doʻppi");
    expect(apiPost).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Ember with Doʻppi"]')).toBeTruthy();

    apiPost.mockResolvedValue({ data: state(0, { doppi: true }, { hat: "doppi" }) });
    await act(async () => buttonStarting("Save look")!.click());
    await settle();
    expect(apiPost).toHaveBeenCalledWith("/livequiz/shop/equip/", { character: "fox", skin: null, hat: "doppi", frame: null, emote: null });
  });

  it("an item not owned turns the button into its price, and short of gems it is off", async () => {
    showShop(state(100, {}));
    await open();
    await pick("Crown");
    expect(buttonStarting("Save look")).toBeUndefined();
    expect(buttonStarting("Buy Crown for")?.disabled).toBe(true);
    expect(text()).toContain("500 more gems · about five games");
  });

  it("buys what the look needs, then offers to save it", async () => {
    showShop(state(700, {}));
    await open();
    await pick("Crown");
    apiPost.mockResolvedValue({ data: state(100, { crown: true }) });
    await act(async () => buttonStarting("Buy Crown for")!.click());
    await settle();
    expect(apiPost).toHaveBeenCalledWith("/livequiz/shop/buy/", { item: "hat:crown" });
    expect(buttonStarting("Save look")?.disabled).toBe(false);
  });

  it("takes a hat off with No hat", async () => {
    showShop(state(0, { doppi: true }, { hat: "doppi" }));
    await open();
    await pick("No hat");
    apiPost.mockResolvedValue({ data: state(0, { doppi: true }) });
    await act(async () => buttonStarting("Save look")!.click());
    await settle();
    expect(apiPost).toHaveBeenCalledWith("/livequiz/shop/equip/", { character: "fox", skin: null, hat: null, frame: null, emote: null });
  });
});

describe("what a look wears", () => {
  it("draws every hat on every character, and names it", () => {
    for (const character of AVATAR_CHARACTERS) {
      for (const hat of ["grad_cap", "headphones", "doppi", "crown"]) {
        expect(renderToStaticMarkup(<LiveAvatar character={character} hat={hat} size={96} />), `${character}/${hat}`).toContain("<svg");
      }
    }
    expect(renderToStaticMarkup(<LiveAvatar character="cat" hat="crown" size={96} />)).toContain('aria-label="Mochi with Crown"');
  });

  it("ignores a hat this build does not know, rather than breaking the avatar", () => {
    expect(renderToStaticMarkup(<LiveAvatar character="cat" hat="top_hat" size={96} />)).toContain('aria-label="Mochi"');
  });

  it("rings the disc with a frame only when one is worn", () => {
    const plain = renderToStaticMarkup(<AvatarDisc avatar={{ character: "cat", skin: null }} name="A" size={96} />);
    const framed = renderToStaticMarkup(<AvatarDisc avatar={{ character: "cat", skin: null, frame: "gold" }} name="A" size={96} />);
    expect(plain).not.toContain("linear-gradient(135deg");
    expect(framed).toContain("linear-gradient(135deg");
  });

  describe("a frame", () => {
    const RING = "linear-gradient(135deg";
    const worn = { character: "cat", skin: null, frame: "gold" };

    it("shows wherever the avatar is drawn, not only on a disc", () => {
      expect(renderToStaticMarkup(<PlayerAvatar avatar={{ character: "cat", skin: null }} name="A" size={28} />)).not.toContain(RING);
      expect(renderToStaticMarkup(<PlayerAvatar avatar={worn} name="A" size={28} />)).toContain(RING);
    });

    it("is drawn once on a disc, not a ring inside a ring", () => {
      expect(renderToStaticMarkup(<AvatarDisc avatar={worn} name="A" size={96} />).split(RING)).toHaveLength(2);
    });

    it("keeps the space the avatar was given, so a row does not move", () => {
      expect(renderToStaticMarkup(<PlayerAvatar avatar={worn} name="A" size={28} />)).toContain("width:28px;height:28px");
    });

    it("passes the face and the name on to the character inside", () => {
      const html = renderToStaticMarkup(<PlayerAvatar avatar={worn} name="A" size={128} face="right" />);
      expect(html).toBe(renderToStaticMarkup(<AvatarDisc avatar={worn} name="A" size={128} face="right" />));
      expect(html).toContain('aria-label="Mochi"');
    });

    it("is ignored when this build does not know it", () => {
      const html = renderToStaticMarkup(<PlayerAvatar avatar={{ ...worn, frame: "neon" }} name="A" size={28} />);
      expect(html).not.toContain(RING);
      expect(html).toContain('aria-label="Mochi"');
    });

    it("rings a player with no character too, around their initials", () => {
      const html = renderToStaticMarkup(<PlayerAvatar avatar={{ ...worn, character: "kraken" }} name="Bek Tursunov" size={28} />);
      expect(html).toContain(RING);
      expect(html).toContain("BT");
    });
  });

  it("says the emote, and nothing for one it does not know", () => {
    expect(renderToStaticMarkup(<EmoteBubble emote="gg" />)).toContain("GG");
    expect(renderToStaticMarkup(<EmoteBubble emote="shout" />)).toBe("");
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

  const accessory = (kind: string, key: string, price: number, owned = false) =>
    item(`${kind}:${key}`, { kind, character: "", slot_key: key, name: key, price, owned }) as ReturnType<typeof item>;

  it("moves on to the cheapest hat, frame or emote once the characters and skins are theirs", () => {
    const shop = state({ character: "fox", skin: null }, [
      skin("char:fox", 100, true),
      skin("skin:fox:rare", 150, true),
      accessory("hat", "crown", 600),
      accessory("frame", "bronze", 150),
      accessory("emote", "gg", 120, true),
    ]);
    expect(nextGoal(shop)?.key).toBe("frame:bronze");
  });

  it("still puts a skin before a cheaper hat", () => {
    const shop = state({ character: "fox", skin: null }, [skin("char:fox", 100, true), skin("skin:fox:rare", 150), accessory("emote", "gg", 120)]);
    expect(nextGoal(shop)?.key).toBe("skin:fox:rare");
  });

  describe("the card after a game", () => {
    const card = (items: ReturnType<typeof item>[]) =>
      renderToStaticMarkup(<NextLookCard shop={{ ...state({ character: "fox", skin: null }, items), can_claim_starter: false }} />);

    it("draws a hat on what they wear, and leads to the locker, where it is sold", () => {
      const html = card([skin("char:fox", 100, true), accessory("hat", "crown", 600)]);
      expect(html).not.toContain("You own the whole shop");
      expect(html).toContain('aria-label="Ember with Crown"');
      expect(html).toContain('href="/live/locker"');
      expect(html).not.toContain('href="/live/shop"');
    });

    it("draws a skin on its own character, and leads to the shop", () => {
      const html = card([skin("char:fox", 100, true), skin("skin:fox:rare", 150)]);
      expect(html).toContain('aria-label="Sunset Ember"');
      expect(html).toContain('href="/live/shop"');
    });

    it("says the shop is theirs only when nothing is left", () => {
      expect(card([skin("char:fox", 100, true), accessory("hat", "crown", 600, true)])).toContain("You own the whole shop");
    });
  });

  it("says roughly how many games a price is", () => {
    expect(gamesToGo(40)).toBe("about one game");
    expect(gamesToGo(180)).toBe("about two games");
    expect(gamesToGo(900)).toBe("about 9 games");
  });
});
