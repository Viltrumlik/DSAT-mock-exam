import { describe, expect, it } from "vitest";
import { PEOPLE_FILTER_KEYS, peopleQuery } from "../peopleApi";

describe("PEOPLE_FILTER_KEYS", () => {
  // Every filter the server sends must be a key the list reads, or clicking it does nothing
  // (the live "Duplicates" filter did exactly that until 2026-10-15).
  it("covers every filter the server offers", () => {
    expect(PEOPLE_FILTER_KEYS.students).toEqual(["status", "group", "teacher", "lcup", "debt", "dupes", "signin"]);
    expect(PEOPLE_FILTER_KEYS.public).toEqual(["status", "joined", "verified", "dupes", "signin"]);
    expect(PEOPLE_FILTER_KEYS.staff).toEqual(["role", "subject", "status"]);
  });

  it("sends a chosen duplicates filter to the server", () => {
    const q = peopleQuery("students", { q: "", o: "", page: 1, pageSize: 50, filters: { dupes: "yes" } });
    expect(q.dupes).toBe("yes");
  });
});
