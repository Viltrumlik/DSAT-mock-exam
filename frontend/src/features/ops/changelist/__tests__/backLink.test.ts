/**
 * A change form remembers the changelist it came from, as Django admin's `?_changelist_filters=`:
 * the row's link carries the list's query string, and Back rebuilds the list's address from it.
 */
import { describe, expect, it } from "vitest";
import { listHrefFrom, withListFilters } from "../backLink";

describe("back to the filtered list", () => {
  it("carries the list's query string, as Django's _changelist_filters", () => {
    expect(withListFilters("/ops/students/7", "status=frozen_debt&p=2")).toBe(
      "/ops/students/7?_changelist_filters=status%3Dfrozen_debt%26p%3D2",
    );
    expect(withListFilters("/ops/students/7", "")).toBe("/ops/students/7");
  });

  it("rebuilds the list address from it", () => {
    const search = new URLSearchParams("_changelist_filters=status%3Dfrozen_debt%26p%3D2");
    expect(listHrefFrom(search, "/ops/students")).toBe("/ops/students?status=frozen_debt&p=2");
    expect(listHrefFrom(new URLSearchParams(""), "/ops/students")).toBe("/ops/students");
  });
});
