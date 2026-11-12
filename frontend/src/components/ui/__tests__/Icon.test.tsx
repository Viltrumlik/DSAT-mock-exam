/**
 * The consoles' one icon component. Every icon the redesign draws (design handoff v0.3: the
 * `i-*` classes in console.css and the Icons board) is reachable by its design name, so a board's
 * `<span class="i i-lg i-ms-freeze">` is written `<Icon name="ms-freeze" size="lg" />`.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ICON_NAMES, Icon, type IconName } from "../Icon";

function svgOf(element: React.ReactElement): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  const svgs = host.querySelectorAll("svg");
  expect(svgs).toHaveLength(1);
  return svgs[0] as SVGSVGElement;
}

const MS_ICONS: IconName[] = [
  "ms-today", "ms-seat", "ms-trial", "ms-present", "ms-absent", "ms-late",
  "ms-freeze", "ms-paid", "ms-sync", "ms-coins", "ms-support", "ms-branch",
  "ms-journal", "ms-midterm", "ms-room", "ms-examdate", "ms-classpost", "ms-story",
  "ms-question", "ms-module", "ms-fullmock", "ms-pastpaper", "ms-answerkey", "ms-review",
  "ms-import", "ms-vocab", "ms-delivered", "ms-undelivered", "ms-broadcast", "ms-appversion",
];

describe("Icon", () => {
  it("lists 111 names, including all 30 MasterSAT icons", () => {
    expect(ICON_NAMES).toHaveLength(111);
    expect(new Set(ICON_NAMES).size).toBe(111);
    for (const name of MS_ICONS) expect(ICON_NAMES).toContain(name);
    expect(ICON_NAMES.filter((n) => n.startsWith("ms-"))).toHaveLength(30);
  });

  it.each(ICON_NAMES)("renders %s as a 24-grid currentColor svg with something drawn", (name) => {
    const svg = svgOf(<Icon name={name} />);
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.children.length).toBeGreaterThan(0);
  });

  it("is hidden from screen readers without a label", () => {
    const svg = svgOf(<Icon name="search" />);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.hasAttribute("role")).toBe(false);
  });

  it("is an image named by its label", () => {
    const svg = svgOf(<Icon name="ms-freeze" label="Frozen for debt" />);
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Frozen for debt");
    expect(svg.hasAttribute("aria-hidden")).toBe(false);
  });

  it.each([
    ["sm", 16],
    ["md", 18],
    ["lg", 20],
    ["xl", 24],
  ] as const)("is %s = %ipx", (size, px) => {
    const svg = svgOf(<Icon name="ms-seat" size={size} />);
    expect(svg.getAttribute("width")).toBe(String(px));
    expect(svg.getAttribute("height")).toBe(String(px));
  });

  it("is 18px when no size is given", () => {
    expect(svgOf(<Icon name="ms-seat" />).getAttribute("width")).toBe("18");
  });

  it("strokes check, minus, more, grip and loader at 2.4 (as drawn) and the rest at 2", () => {
    for (const name of ["check", "minus", "more", "grip", "loader"] as const) {
      expect(svgOf(<Icon name={name} />).getAttribute("stroke-width")).toBe("2.4");
    }
    expect(svgOf(<Icon name="x" />).getAttribute("stroke-width")).toBe("2");
    expect(svgOf(<Icon name="ms-paid" />).getAttribute("stroke-width")).toBe("2");
  });

  it("fills the half of the midterm dial with the icon's own colour", () => {
    const svg = svgOf(<Icon name="ms-midterm" />);
    expect(svg.querySelector('[fill="currentColor"]')).not.toBeNull();
  });

  it("keeps the dashes that mark a trial student", () => {
    const svg = svgOf(<Icon name="ms-trial" />);
    expect(svg.querySelectorAll("[stroke-dasharray]")).toHaveLength(2);
  });

  it("keeps a caller's class next to its own", () => {
    const svg = svgOf(<Icon name="search" className="text-ms-fg-3" />);
    expect(svg.getAttribute("class")).toContain("text-ms-fg-3");
    expect(svg.getAttribute("class")).toContain("shrink-0");
  });

  it("only takes names it knows", () => {
    // @ts-expect-error — not an icon name: the union is the whole contract
    const unknown = <Icon name="nope" />;
    expect(unknown).toBeTruthy();
  });
});
