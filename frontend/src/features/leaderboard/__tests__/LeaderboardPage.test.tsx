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

import type { LeaderboardResponse, LeaderboardFilters } from "../leaderboardApi";

const useLeaderboard = vi.fn();
const useLeaderboardFilters = vi.fn();

vi.mock("../leaderboardHooks", () => ({
  useLeaderboard: (...a: unknown[]) => useLeaderboard(...a),
  useLeaderboardFilters: (...a: unknown[]) => useLeaderboardFilters(...a),
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
  scope_note: "All the XP earned across the whole school.",
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
    { value: "WEEK", label: "This week" },
  ],
  my_branch: { id: 1, name: "Chilonzor", region: "Tashkent" },
};

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined, isPending: false, isError: false, isFetching: false,
    refetch: vi.fn(), ...overrides,
  };
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
      data: { ...BOARD, scope_note: "Midterm XP isn't counted — a midterm belongs to the school." },
    }));
    await render();

    expect(host.textContent).toContain(
      "Midterm XP isn't counted — a midterm belongs to the school.",
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
});
