import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above every import and const, so the spy must be hoisted with it.
const { adminListSets } = vi.hoisted(() => ({ adminListSets: vi.fn() }));
vi.mock("@/lib/api", () => ({ default: {}, assessmentsAdminApi: { adminListSets } }));

import { assessmentsAdminApi } from "../api";

/** A fake of the endpoint: `total` sets, newest first, pages capped at 200 like `max_limit`. */
function serve(total: number) {
  adminListSets.mockImplementation(async (params: { limit: number; offset: number; subject?: string }) => {
    const limit = Math.min(params.limit, 200);
    const ids = Array.from({ length: total }, (_, i) => total - i);
    const results = ids.slice(params.offset, params.offset + limit).map((id) => ({ id, title: `Set ${id}` }));
    const more = params.offset + limit < total;
    return { count: total, next: more ? `next?offset=${params.offset + limit}` : null, previous: null, results };
  });
}

describe("assessmentsAdminApi.listAllSets", () => {
  // Braces matter: mockReset() returns the mock, and a function returned from beforeEach is run
  // by vitest as a teardown — with no arguments.
  beforeEach(() => {
    adminListSets.mockReset();
  });

  it("reads past the 200 cap: 276 sets come back as 276, the oldest included", async () => {
    serve(276);
    const all = await assessmentsAdminApi.listAllSets();
    expect(all.results).toHaveLength(276);
    expect(all.count).toBe(276);
    expect(all.results.map((s) => s.id)).toContain(1);
    expect(adminListSets).toHaveBeenCalledTimes(2);
    expect(adminListSets.mock.calls.map((c) => c[0].offset)).toEqual([0, 200]);
  });

  it("stops after one request when everything fits", async () => {
    serve(120);
    const all = await assessmentsAdminApi.listAllSets({ subject: "math" });
    expect(all.results).toHaveLength(120);
    expect(adminListSets).toHaveBeenCalledTimes(1);
    expect(adminListSets.mock.calls[0][0]).toMatchObject({ subject: "math", limit: 200, offset: 0 });
  });

  it("stops on an empty page even if the server still says there is a next one", async () => {
    adminListSets.mockResolvedValue({ count: 999, next: "next", previous: null, results: [] });
    const all = await assessmentsAdminApi.listAllSets();
    expect(all.results).toHaveLength(0);
    expect(adminListSets).toHaveBeenCalledTimes(1);
  });
});
