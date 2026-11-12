/**
 * A past paper's or practice test's cover (PR 15b): its modules in the subject's colour, in order, the second a
 * shade lighter, and its length from the modules' time limits — the SAT's own when a module has none.
 */
import { describe, expect, it } from "vitest";

import type { AdminPastpaperSection } from "@/lib/api";
import { formatDuration } from "../LibraryCard";
import { sectionShape } from "../sectionParts";

function section(over: Partial<AdminPastpaperSection>): AdminPastpaperSection {
  return {
    id: 1,
    title: "",
    subject: "READING_WRITING",
    is_published: false,
    label: "",
    form_type: "INTERNATIONAL",
    collection_name: "",
    practice_date: null,
    modules: [],
    ...over,
  } as AdminPastpaperSection;
}

describe("sectionShape", () => {
  it("draws the modules in order, the second lighter, as long as their time limits", () => {
    const shape = sectionShape(
      section({
        modules: [
          { id: 21, module_order: 2, time_limit_minutes: 32 },
          { id: 20, module_order: 1, time_limit_minutes: 32 },
        ],
      }),
    );
    expect(shape.blocks.map((b) => [b.key, b.tone, !!b.second])).toEqual([
      ["20", "rw", false],
      ["21", "rw", true],
    ]);
    expect(shape.blocks[0].title).toBe("Reading & Writing · Module 1 · 32 min");
    expect(formatDuration(shape.minutes)).toBe("1:04:00");
  });

  it("falls back to the SAT's 35 minutes for a Math module with no limit", () => {
    const shape = sectionShape(section({ subject: "MATH", modules: [{ id: 5, module_order: 1, time_limit_minutes: null }] }));
    expect(shape.blocks[0].tone).toBe("math");
    expect(shape.minutes).toBe(35);
  });

  it("shows an empty outline for a section with no modules yet", () => {
    const shape = sectionShape(section({ modules: [] }));
    expect(shape.blocks).toEqual([expect.objectContaining({ fill: 0, title: "No modules yet." })]);
    expect(shape.minutes).toBe(0);
  });
});
