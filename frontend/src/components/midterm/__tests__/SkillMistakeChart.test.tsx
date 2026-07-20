import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import SkillMistakeChart from "../SkillMistakeChart";
import type { ErrorReportSkill } from "../errorReportApi";

const SKILLS: ErrorReportSkill[] = [
  { skill_id: 12, skill: "Nonlinear functions", domain: "Advanced Math", total: 6, wrong: 5 },
  { skill_id: 4, skill: "Linear equations in one variable", domain: "Algebra", total: 8, wrong: 3 },
  { skill_id: 9, skill: "Ratios, rates and proportions", domain: "Problem-Solving and Data Analysis", total: 4, wrong: 1 },
];

let host: HTMLElement;
let root: Root;

async function render(skills: ErrorReportSkill[]) {
  await act(async () => {
    root.render(<SkillMistakeChart skills={skills} />);
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("SkillMistakeChart", () => {
  it("draws one column per skill, in the order the API gave them", async () => {
    await render(SKILLS);
    const bars = host.querySelectorAll("path.mer-bar");
    expect(bars).toHaveLength(3);

    // Column heights must fall left-to-right: the API sorts, the chart must not re-sort.
    const heights = [...bars].map((b) => {
      const d = b.getAttribute("d") ?? "";
      const bottom = Number(d.match(/^M[\d.]+,([\d.]+)/)?.[1]);
      const top = Number(d.match(/L[\d.]+,([\d.]+)/)?.[1]);
      return bottom - top;
    });
    expect(heights[0]).toBeGreaterThan(heights[1]);
    expect(heights[1]).toBeGreaterThan(heights[2]);
  });

  it("caps the column width at 24px with a square base", async () => {
    await render(SKILLS);
    const d = host.querySelector("path.mer-bar")?.getAttribute("d") ?? "";
    const xs = [...d.matchAll(/[ML]([\d.]+),/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(24);
    expect(d.match(/Q/g)).toHaveLength(2);
  });

  it("labels every column cap with its mistake count", async () => {
    await render(SKILLS);
    const values = [...host.querySelectorAll("text.mer-value-text")].map((t) => t.textContent);
    expect(values).toEqual(["5", "3", "1"]);
  });

  it("angles the skill names at -38 degrees, anchored at their end", async () => {
    await render(SKILLS);
    const label = [...host.querySelectorAll("text.mer-axis-text")].find((t) =>
      t.getAttribute("transform")?.includes("rotate"),
    );
    expect(label?.getAttribute("transform")).toMatch(/^rotate\(-38 /);
    expect(label?.getAttribute("text-anchor")).toBe("end");
  });

  it("names the worst skills in the aria-label and mirrors the data in a table", async () => {
    await render(SKILLS);
    const svg = host.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toContain("Nonlinear functions, 5 of 6 missed");

    const rows = host.querySelectorAll("table.mer-table tbody tr");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Advanced Math");
    expect(rows[0].textContent).toContain("17%");
  });

  it("shows a tooltip with domain and accuracy for the hovered column", async () => {
    await render(SKILLS);
    expect(host.querySelector(".mer-tooltip")).toBeNull();

    const hit = host.querySelectorAll("rect.mer-hit")[1];
    await act(async () => {
      hit.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const tip = host.querySelector(".mer-tooltip");
    expect(tip?.textContent).toContain("Linear equations in one variable");
    expect(tip?.textContent).toContain("Algebra");
    expect(tip?.textContent).toContain("3 wrong of 8");
    expect(tip?.textContent).toContain("63% accuracy");
  });

  it("gives the hover a hit target wider than the 24px column", async () => {
    await render(SKILLS);
    const hit = host.querySelector("rect.mer-hit");
    expect(Number(hit?.getAttribute("width"))).toBeGreaterThan(24);
  });
});
