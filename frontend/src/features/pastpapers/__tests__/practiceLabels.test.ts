import { describe, expect, it } from "vitest";
import { levelLabel, sectionTitle } from "../pastpaperLabels";
import type { PastpaperSection } from "@/lib/api";

const base: PastpaperSection = {
  id: 1, title: "Algebra focus", practice_date: null, subject: "MATH", label: "", form_type: "INTERNATIONAL",
  collection_name: "", is_published: true, modules: [],
};

describe("practice test labels", () => {
  it("names a numbered practice test by its number", () => {
    expect(sectionTitle({ ...base, is_practice_test: true, practice_number: 3 })).toBe("Practice Test 3");
  });
  it("falls back to the title for a past paper or an unnumbered draft", () => {
    expect(sectionTitle(base)).toBe("Algebra focus");
    expect(sectionTitle({ ...base, is_practice_test: true, practice_number: null })).toBe("Algebra focus");
  });
  it("labels levels, blank = all levels", () => {
    expect(levelLabel("")).toBe("All levels");
    expect(levelLabel("middle")).toBe("Middle");
  });
});
