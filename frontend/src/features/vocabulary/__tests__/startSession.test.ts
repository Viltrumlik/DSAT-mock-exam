/**
 * The wire shape of `POST /api/vocabulary/sessions/`.
 *
 * The binding id is the whole point of this change, and the two halves of it
 * are equally load-bearing: a homework run must CARRY the assignment, and a
 * self-study run must carry NO `assignment_id` key at all. The server treats
 * null and absent the same way today, but "send nothing" is the contract the
 * optional field was added under, and it is what keeps this request identical
 * to the one every client shipped before the field existed.
 */
import { describe, expect, it, vi } from "vitest";

import { LAUNCH_ASSIGNMENT_PARAM, withLaunchAssignment } from "../launchContext";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("@/lib/api", () => ({
  default: { post: mocks.post },
  getCachedCsrfToken: () => null,
}));

const { vocabularyApi } = await import("../api");

/** The body the api layer actually handed to axios. */
const postedBody = () => mocks.post.mock.calls[0][1] as Record<string, unknown>;

describe("vocabularyApi.startSession — which homework the run belongs to", () => {
  it("sends the assignment a homework-launched run came from", async () => {
    mocks.post.mockReset();
    mocks.post.mockResolvedValue({ data: { id: 1 } });

    await vocabularyApi.startSession({ set_id: 7, mode: "matching", assignment_id: 42 });

    expect(postedBody()).toEqual({ set_id: 7, mode: "matching", assignment_id: 42 });
  });

  it("omits the key entirely for self-study", async () => {
    mocks.post.mockReset();
    mocks.post.mockResolvedValue({ data: { id: 1 } });

    await vocabularyApi.startSession({ set_id: 7, mode: "matching" });

    // `not.toHaveProperty`, not `toBeUndefined`: an explicit `assignment_id:
    // null` would pass the latter and is exactly what this avoids.
    expect(postedBody()).not.toHaveProperty("assignment_id");
    expect(postedBody()).toEqual({ set_id: 7, mode: "matching" });
  });
});

describe("withLaunchAssignment — carrying the launch homework through the URL", () => {
  const href = "/vocabulary/sets/7/matching";

  it("appends the assignment, respecting an existing query string", () => {
    expect(withLaunchAssignment(href, 42)).toBe(`${href}?${LAUNCH_ASSIGNMENT_PARAM}=42`);
    expect(withLaunchAssignment(`${href}?x=1`, 42)).toBe(`${href}?x=1&${LAUNCH_ASSIGNMENT_PARAM}=42`);
  });

  it("leaves a self-study link untouched", () => {
    // Every one of these reaches this helper for real: `undefined` from a hub
    // launcher, `null` from an API field that has no homework, and 0/NaN from a
    // `Number()` of a missing or mangled param.
    for (const none of [undefined, null, 0, -1, 1.5, Number.NaN]) {
      expect(withLaunchAssignment(href, none)).toBe(href);
    }
  });
});
