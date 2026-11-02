/**
 * Titles and limited hats: a title shows where it was earned, only an earned one can be worn, and
 * a hat out of season says when it comes back instead of offering to sell.
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
vi.mock("next/navigation", () => ({ usePathname: () => "/live/titles", useRouter: () => ({ push: vi.fn() }) }));

const { AVATAR_CHARACTERS, LiveAvatar, TitleChip } = await import("../avatars");
const { Podium } = await import("../game");
const { Locker } = await import("../Locker");
const { Titles } = await import("../Titles");

const title = (key: string, name: string, progress: number, goal: number) => ({
  key,
  name,
  rule: `The rule of ${name}`,
  goal,
  progress,
  earned: progress >= goal,
});

const ON_SALE = { on_sale: true, days_left: 24, back_in: null };
const OFF_SEASON = { on_sale: false, days_left: null, back_in: "March" };

const limited = (key: string, name: string, season: Record<string, unknown>, owned = false) => ({
  key: `hat:${key}`,
  kind: "hat",
  character: "",
  slot_key: key,
  tier: "limited",
  name,
  price: 250,
  starter: false,
  owned,
  limited: true,
  ...season,
});

const shop = (overrides: Record<string, unknown> = {}) => ({
  balance: 420,
  today_earned: 0,
  daily_cap: 300,
  can_claim_starter: false,
  starters: [],
  look: { character: "fox", skin: null, title: "streak_master" },
  titles: [
    title("streak_master", "Streak master", 10, 10),
    title("team_captain", "Team captain", 3, 3),
    title("lightning", "Lightning", 32, 50),
    title("perfect_game", "Perfect game", 0, 1),
  ],
  items: [
    { key: "char:fox", kind: "character", character: "fox", tier: "common", name: "Ember", price: 100, starter: false, owned: true },
    limited("winter_beanie", "Winter beanie", ON_SALE),
    limited("navroz_tulips", "Navroʻz tulips", OFF_SEASON),
  ],
  ...overrides,
});

describe("the art", () => {
  it("draws the limited hats on every character", () => {
    for (const character of AVATAR_CHARACTERS) {
      for (const hat of ["winter_beanie", "navroz_tulips"]) {
        expect(renderToStaticMarkup(<LiveAvatar character={character} hat={hat} size={96} />), `${character}/${hat}`).toContain("<svg");
      }
    }
    expect(renderToStaticMarkup(<LiveAvatar character="cat" hat="winter_beanie" size={96} />)).toContain('aria-label="Mochi with Winter beanie"');
  });

  it("names every title, and draws nothing for one it does not know", () => {
    const names = {
      streak_master: "Streak master",
      team_captain: "Team captain",
      lightning: "Lightning",
      word_wise: "Word wise",
      perfect_game: "Perfect game",
    };
    for (const [key, name] of Object.entries(names)) {
      expect(renderToStaticMarkup(<TitleChip title={key} />)).toContain(name);
      expect(renderToStaticMarkup(<TitleChip title={key} tone="light" />)).toContain(name);
    }
    expect(renderToStaticMarkup(<TitleChip title="emperor" />)).toBe("");
  });
});

describe("the podium", () => {
  it("puts the title between the name and the score", () => {
    const row = { id: 1, display_name: "Aziza R", score: 4200, team: null, avatar: { character: "fox", skin: null, title: "lightning" } };
    const html = renderToStaticMarkup(<Podium rows={[row] as never} />);
    expect(html.indexOf("Aziza R")).toBeLessThan(html.indexOf("Lightning"));
    expect(html.indexOf("Lightning")).toBeLessThan(html.indexOf("4,200"));
  });
});

describe("the pages", () => {
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

  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  };
  const open = async (page: React.ReactNode, data: unknown) => {
    apiGet.mockImplementation(async (url: string) => (url.includes("shop") ? { data } : { data: { id: 1, first_name: "Ali", last_name: "Vali" } }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    await act(async () => {
      root.render(<QueryClientProvider client={client}>{page}</QueryClientProvider>);
    });
    await settle();
  };
  const text = () => (host.textContent ?? "").replace(/\s+/g, " ");
  const labelled = (label: string) => host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
  const buttonStarting = (start: string) =>
    Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith(start)) as HTMLButtonElement | undefined;
  const click = async (button: HTMLElement | null | undefined) => {
    await act(async () => button!.click());
    await settle();
  };

  describe("titles", () => {
    it("shows what is worn, how far each title has come, and which are locked", async () => {
      await open(<Titles />, shop());
      expect(text()).toContain("Wearing");
      expect(text()).toContain("They can’t be bought");
      expect(text()).toContain("The rule of Lightning");
      for (const count of ["10/10", "3/3", "32/50", "0/1"]) expect(text()).toContain(count);
      expect(host.querySelectorAll('[aria-label="Locked"]')).toHaveLength(2);
      expect(Array.from(host.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "Wear")).toHaveLength(1);
    });

    it("wears an earned title, and names no other slot", async () => {
      await open(<Titles />, shop());
      apiPost.mockResolvedValue({ data: shop({ look: { character: "fox", skin: null, title: "team_captain" } }) });
      await click(buttonStarting("Wear"));
      expect(apiPost).toHaveBeenCalledWith("/livequiz/shop/equip/", { character: "fox", skin: null, title: "team_captain" });
      expect(labelled("Take off Team captain")).toBeTruthy();
    });

    it("takes the worn title off", async () => {
      await open(<Titles />, shop());
      apiPost.mockResolvedValue({ data: shop({ look: { character: "fox", skin: null } }) });
      await click(labelled("Take off Streak master"));
      expect(apiPost).toHaveBeenCalledWith("/livequiz/shop/equip/", { character: "fox", skin: null, title: null });
      expect(text()).toContain("No title yet");
    });

    it("skips a title this build cannot draw, rather than breaking the page", async () => {
      await open(<Titles />, shop({ titles: [title("emperor", "Emperor", 1, 1)] }));
      expect(text()).toContain("They can’t be bought");
      expect(text()).not.toContain("Emperor");
    });

    it("sells the hat on sale and says when the other comes back", async () => {
      await open(<Titles />, shop());
      expect(text()).toContain("24 days left");
      expect(text()).toContain("Back in March");
      expect(labelled("Buy Navroʻz tulips for 250 gems")).toBeNull();

      apiPost.mockResolvedValue({
        data: shop({ items: [limited("winter_beanie", "Winter beanie", ON_SALE, true)] }),
      });
      await click(labelled("Buy Winter beanie for 250 gems"));
      expect(apiPost).toHaveBeenCalledWith("/livequiz/shop/buy/", { item: "hat:winter_beanie" });
      expect(text()).toContain("Owned");
      expect(labelled("Buy Winter beanie for 250 gems")).toBeNull();
    });

    it("says how far off a price is, and the button is off", async () => {
      await open(<Titles />, shop({ balance: 100 }));
      expect(labelled("Buy Winter beanie for 250 gems")?.disabled).toBe(true);
      expect(text()).toContain("150 more gems");
    });

    it("says it when the server refuses", async () => {
      await open(<Titles />, shop());
      apiPost.mockRejectedValue(new Error("nope"));
      await click(buttonStarting("Wear"));
      expect(host.querySelector('[role="alert"]')).toBeTruthy();
    });

    it("sends a student with no character to pick one", async () => {
      await open(<Titles />, shop({ look: null }));
      expect(text()).toContain("Pick your character");
    });
  });

  describe("limited hats in the locker", () => {
    it("says how long is left, and buys it like any other", async () => {
      await open(<Locker />, shop());
      expect(text()).toContain("24 days left");
      await click(labelled("Winter beanie"));
      expect(buttonStarting("Buy Winter beanie for")?.disabled).toBe(false);
    });

    it("out of season the button says when it is back and cannot be pressed", async () => {
      await open(<Locker />, shop());
      expect(text()).toContain("Back in March");
      await click(labelled("Navroʻz tulips"));
      expect(buttonStarting("Buy")).toBeUndefined();
      expect(buttonStarting("Back in March")?.disabled).toBe(true);
      expect(text()).not.toContain("more gems");
    });

    it("one already bought can still be worn out of season, and saving leaves the title alone", async () => {
      await open(<Locker />, shop({ items: [...shop().items.slice(0, 1), limited("navroz_tulips", "Navroʻz tulips", OFF_SEASON, true)] }));
      await click(labelled("Navroʻz tulips"));
      apiPost.mockResolvedValue({ data: shop() });
      await click(buttonStarting("Save look"));
      expect(apiPost).toHaveBeenCalledWith("/livequiz/shop/equip/", { character: "fox", skin: null, hat: "navroz_tulips", frame: null, emote: null });
    });

    it("shows the title worn on the stage, and leads to the titles page", async () => {
      await open(<Locker />, shop());
      expect(text()).toContain("Streak master");
      expect(Array.from(host.querySelectorAll("a")).some((a) => a.getAttribute("href") === "/live/titles")).toBe(true);
    });
  });
});
