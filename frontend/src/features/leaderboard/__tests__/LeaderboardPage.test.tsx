/**
 * The leaderboard's four branches, and the two things it must never get wrong.
 *
 * A failed fetch must not render as an empty board — "nobody is ranked yet" and "we couldn't
 * reach the server" are opposite messages and the student can act on only one of them.
 *
 * And the `scope_note` must come from the server verbatim. It is the sentence that explains
 * why a filtered board counts less XP than the global one; paraphrasing it in the client is
 * how the two drift apart.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LeaderboardResponse, LeaderboardFilters, LeaderboardRow } from "../leaderboardApi";

const useLeaderboard = vi.fn();
const useLeaderboardFilters = vi.fn();
const useMyRewards = vi.fn();

vi.mock("../leaderboardHooks", () => ({
  useLeaderboard: (...a: unknown[]) => useLeaderboard(...a),
  useLeaderboardFilters: (...a: unknown[]) => useLeaderboardFilters(...a),
}));

// The hero's streak tile reads the viewer's rewards summary.
vi.mock("@/features/rewards/rewardsHooks", () => ({
  useMyRewards: (...a: unknown[]) => useMyRewards(...a),
}));

const { LeaderboardPage } = await import("../LeaderboardPage");

const BOARD: LeaderboardResponse = {
  scope: "GLOBAL",
  window: "ALL",
  branch_id: null,
  classroom_id: null,
  subject: null,
  level: null,
  count: 2,
  scope_note: "All the XP earned across the whole learning center.",
  rows: [
    {
      rank: 1, student_id: 7, name: "Bekzod", profile_image_url: null,
      xp: 180, awards: 4, branch: "Chilonzor", region: "Tashkent", is_me: false,
    },
    {
      rank: 2, student_id: 9, name: "Aziza Karimova", profile_image_url: null,
      xp: 105, awards: 6, branch: "Chilonzor", region: "Tashkent", is_me: true,
    },
  ],
  my: null,
};

const FILTERS: LeaderboardFilters = {
  regions: [{ id: 1, name: "Tashkent", code: "TAS" }],
  branches: [{ id: 1, name: "Chilonzor", code: "", region_id: 1 }],
  subjects: [{ value: "MATH", label: "Math" }],
  levels: [{ value: "middle", label: "Middle" }],
  windows: [
    { value: "ALL", label: "All time" },
    { value: "MONTH", label: "This month" },
  ],
  my_branch: { id: 1, name: "Chilonzor", region: "Tashkent" },
};

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined, isPending: false, isError: false, isFetching: false,
    refetch: vi.fn(), ...overrides,
  };
}

function row(rank: number, id: number, xp: number, extra: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    rank, student_id: id, name: `Student ${id}`, profile_image_url: null,
    xp, awards: 3, branch: "Chilonzor", region: "Tashkent", is_me: false, ...extra,
  };
}

function button(text: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === text);
}

function filtersToggle() {
  const toggle = [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Filters"));
  if (!toggle) throw new Error("no Filters button");
  return toggle;
}

let host: HTMLElement;
let root: Root;

async function render() {
  await act(async () => root.render(<LeaderboardPage />));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  useLeaderboardFilters.mockReturnValue(query({ data: FILTERS }));
  useMyRewards.mockReturnValue(query({ data: { current_streak: 0 } }));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("LeaderboardPage", () => {
  it("renders the ranked rows with their branch", async () => {
    useLeaderboard.mockReturnValue(query({ data: BOARD }));
    await render();

    expect(host.textContent).toContain("Bekzod");
    expect(host.textContent).toContain("Aziza Karimova");
    expect(host.textContent).toContain("Chilonzor");
    expect(host.textContent).toContain("180");
  });

  it("marks the viewer's own row", async () => {
    useLeaderboard.mockReturnValue(query({ data: BOARD }));
    await render();

    expect(host.textContent).toContain("you");
  });

  it("shows a failure as an error, never as an empty board", async () => {
    useLeaderboard.mockReturnValue(query({ isError: true }));
    await render();

    expect(host.textContent).toContain("isn't loading");
    expect(host.textContent).not.toContain("Nothing on this board yet");
  });

  it("shows an empty board as empty", async () => {
    useLeaderboard.mockReturnValue(query({ data: { ...BOARD, rows: [], count: 0 } }));
    await render();

    expect(host.textContent).toContain("Nothing on this board yet");
    expect(host.textContent).not.toContain("isn't loading");
  });

  it("renders the server's scope note verbatim", async () => {
    useLeaderboard.mockReturnValue(query({
      data: { ...BOARD, scope_note: "Midterm XP isn't counted — a midterm belongs to the learning center." },
    }));
    await render();

    expect(host.textContent).toContain(
      "Midterm XP isn't counted — a midterm belongs to the learning center.",
    );
  });

  it("hides the My Branch tab when the student has no branch", async () => {
    useLeaderboardFilters.mockReturnValue(query({ data: { ...FILTERS, my_branch: null } }));
    useLeaderboard.mockReturnValue(query({ data: BOARD }));
    await render();

    expect(host.textContent).not.toContain("My Branch");
  });

  it("labels the My Branch tab with the branch's own name", async () => {
    useLeaderboard.mockReturnValue(query({ data: BOARD }));
    await render();

    const tabs = [...host.querySelectorAll("button")].map((b) => b.textContent);
    expect(tabs.some((t) => t?.includes("Chilonzor"))).toBe(true);
  });

  it("tells a student with no XP how to appear", async () => {
    useLeaderboard.mockReturnValue(query({ data: { ...BOARD, my: null } }));
    await render();

    expect(host.textContent).toContain("Earn your first XP");
  });

  it("shows the viewer's own position when they are below the visible rows", async () => {
    useLeaderboard.mockReturnValue(query({
      data: {
        ...BOARD,
        my: {
          rank: 42, student_id: 99, name: "Aziza Karimova", profile_image_url: null,
          xp: 12, awards: 1, branch: "Chilonzor", region: "Tashkent", is_me: true,
        },
      },
    }));
    await render();

    expect(host.textContent).toContain("Your position");
    expect(host.textContent).toContain("42");
  });

  it("keeps the filters folded behind a button until it is pressed", async () => {
    useLeaderboard.mockReturnValue(query({ data: BOARD }));
    await render();

    const toggle = filtersToggle();
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Folded chips must not be reachable by Tab while they cannot be seen.
    expect(panel?.hasAttribute("inert")).toBe(true);

    await act(async () => toggle.click());

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.hasAttribute("inert")).toBe(false);
  });

  it("names an active filter on the folded bar, and resets it", async () => {
    useLeaderboard.mockReturnValue(query({ data: BOARD }));
    await render();

    await act(async () => filtersToggle().click());
    await act(async () => button("This month")?.click());

    expect(useLeaderboard).toHaveBeenLastCalledWith(expect.objectContaining({ window: "MONTH" }));
    expect(filtersToggle().textContent).toContain("1");
    expect(filtersToggle().nextElementSibling?.textContent).toContain("This month");

    await act(async () => button("Reset")?.click());

    expect(useLeaderboard).toHaveBeenLastCalledWith(expect.objectContaining({ window: "ALL" }));
    expect(button("Reset")).toBeUndefined();
  });

  it("stands the top three on a podium, with medals from rank rather than position", async () => {
    useLeaderboard.mockReturnValue(query({
      data: {
        ...BOARD,
        count: 4,
        // A shared first place: both are crowned, and third stays third.
        rows: [row(1, 1, 300), row(1, 2, 300), row(3, 3, 200), row(4, 4, 100)],
      },
    }));
    await render();

    expect(host.querySelectorAll("ol > li")).toHaveLength(3);
    expect(host.querySelectorAll("svg.lucide-crown")).toHaveLength(2);
    expect(host.textContent).toContain("Student 4");
  });

  it("names the next place to reach, and the hero agrees with the table", async () => {
    const me = row(5, 5, 180, { is_me: true });
    useLeaderboard.mockReturnValue(query({
      data: { ...BOARD, rows: [row(1, 1, 500), row(2, 2, 400), row(3, 3, 300), row(4, 4, 250), me], my: me },
    }));
    await render();

    // 250 − 180, plus one to pass rather than tie.
    expect(host.textContent).toContain("71 XP to reach #4");
    expect(host.textContent).toContain("#5");
  });

  it("sets no target for the student already at the top", async () => {
    const me = row(1, 1, 500, { is_me: true });
    useLeaderboard.mockReturnValue(query({
      data: { ...BOARD, rows: [me, row(2, 2, 400), row(3, 3, 300)], my: me },
    }));
    await render();

    expect(host.textContent).not.toContain("to reach");
  });

  it("gives the hero no rank the board did not give, and a streak only while there is one", async () => {
    useLeaderboard.mockReturnValue(query({ data: { ...BOARD, my: null } }));
    await render();

    expect(host.textContent).toContain("Your rank");
    expect(host.textContent).not.toMatch(/#\d/);
    expect(host.textContent).not.toContain("Streak");

    useMyRewards.mockReturnValue(query({ data: { current_streak: 6 } }));
    await render();

    expect(host.textContent).toContain("6 lessons");
  });
});
