/**
 * PR 9b — the DataDisplay and Graphics boards: each graphic's one line, its Table view, bars that open their
 * day, a stat tile that never shows an error as a number, a header card that answers the desk's two questions,
 * a timeline whose chips filter and count, and the spot illustrations where the console is empty or done.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttendancePattern, BalanceRunway, BarChart, ScoreTrend, ShareBars, attendanceFinding, niceMax, runwayFinding, scoreFinding, type WeekdayRow } from "..";
import { AttentionList } from "../../AttentionList";
import { EmptyState, HeaderCard, StatTile, Timeline } from "../../ui";

let host: HTMLDivElement;
let root: Root;
const render = (node: React.ReactNode) => act(() => root.render(node));
const click = (el: Element) => act(() => void (el as HTMLElement).click());
const text = () => host.textContent ?? "";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const BEKZOD: WeekdayRow[] = [
  { day: "Mon", marks: ["present", "present", "present", "late", "present", "present", "present", "present", "present"] },
  { day: "Wed", marks: ["present", "present", "excused", "present", "present", "late", "present", "present", "coming"] },
  { day: "Fri", marks: ["present", "absent", "present", "absent", "absent", "present", "absent", "absent", "coming"] },
];

describe("the one line under each graphic", () => {
  it("finds the weekday that keeps being missed, out of the lessons already held", () => {
    expect(attendanceFinding(BEKZOD)).toEqual({
      line: "5 of 8 Fridays missed.",
      note: "Mondays and Wednesdays are fine — worth asking the parent about Fridays.",
    });
    expect(attendanceFinding([{ day: "Mon", marks: ["present", "late"] }]).line).toBe("No lesson missed.");
    expect(attendanceFinding([{ day: "Mon", marks: ["present", "absent", "present", "present"] }]).line).toBe("No weekday stands out.");
  });

  it("says how far the score moved and how far is left", () => {
    expect(scoreFinding([1050, 1120, 1100, 1190, 1240, 1290], 1450)).toBe("+240 in 6 mocks, 160 to go.");
    expect(scoreFinding([1300, 1460], 1450)).toBe("+160 in 2 mocks — target reached.");
    expect(scoreFinding([1200, 1170], 1450)).toBe("−30 in 2 mocks, 280 to go.");
    expect(scoreFinding([1200], null)).toBe("1 mock so far.");
    expect(scoreFinding([], 1450)).toBe("No mock yet.");
  });

  it("says when a balance runs out at the spend given", () => {
    expect(runwayFinding(182400, 22800)).toBe("Runs out in about 8 days");
    expect(runwayFinding(1000, 5000)).toBe("Runs out today");
    expect(runwayFinding(1_000_000, 1000)).toBe("Lasts more than 30 days");
    expect(runwayFinding(1000, 0)).toBe("Nothing was spent lately.");
  });

  it("rounds a chart's top to a friendly number", () => {
    expect([niceMax(37), niceMax(412), niceMax(11), niceMax(0)]).toEqual([40, 500, 20, 1]);
  });
});

describe("the graphics", () => {
  it("draws the attendance pattern with its finding, and the table says each mark in words", () => {
    render(<AttendancePattern title="Bekzod" weeks={["15 Sep", "22 Sep", "29 Sep", "6 Oct", "13 Oct", "20 Oct", "27 Oct", "3 Nov", "10 Nov"]} rows={BEKZOD} />);
    expect(text()).toContain("5 of 8 Fridays missed.");
    expect(host.querySelector('[title="Fri, 22 Sep: Absent"]')?.textContent).toBe("✕");
    const toggle = host.querySelector("button[aria-pressed]")!;
    click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const cells = [...host.querySelectorAll("tbody tr")][1].textContent;
    expect(cells).toBe("22 SepPresentPresentAbsent");
  });

  it("puts the mock totals in a table on request", () => {
    render(<ScoreTrend title="Mock scores" target={1450} points={[{ label: "Oct", total: 1240 }, { label: "Nov", total: 1290 }]} />);
    expect(text()).toContain("Target 1450");
    expect(text()).toContain("+50 in 2 mocks, 160 to go.");
    click(host.querySelector("button[aria-pressed]")!);
    expect([...host.querySelectorAll("tbody tr")].map((r) => r.textContent)).toEqual(["Oct1240", "Nov1290"]);
  });

  it("forecasts a balance without inventing its history", () => {
    render(<BalanceRunway framed={false} balance={182400} perDay={22800} today="2026-11-11" />);
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("aria-label")).toContain("runs out in about 8 days");
    expect(host.querySelector("polyline")).toBeNull(); // no history given → only the dashed forecast
    expect(text()).toContain("≈ 19 Nov");
  });

  it("opens each bar's day, with its values in the tooltip and the table", () => {
    render(
      <BarChart
        title="SMS by day"
        series={[{ label: "Delivered", tone: "primary" }, { label: "Not delivered", tone: "critical" }]}
        bars={[
          { label: "3", full: "3 Nov", href: "/ops/sms?day=2026-11-03", values: [0, 0] },
          { label: "4", full: "4 Nov", href: "/ops/sms?day=2026-11-04", values: [29, 11] },
        ]}
      />,
    );
    const links = [...host.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/ops/sms?day=2026-11-03", "/ops/sms?day=2026-11-04"]);
    expect(links[1].getAttribute("aria-label")).toBe("4 Nov: 29 delivered, 11 not delivered");
    click(host.querySelector("button[aria-pressed]")!);
    expect([...host.querySelectorAll("tbody tr")].map((r) => r.textContent)).toEqual(["3 Nov00", "4 Nov2911"]);
  });

  it("shows where a total sits, the rest as one bar", () => {
    render(<ShareBars rows={[5, 4, 3, 2, 1, 1].map((v, i) => ({ label: `G${i}`, value: v }))} />);
    expect(text()).toContain("2 more groups");
    expect(text()).toMatch(/2 more groups.*2$/);
  });
});

describe("data display", () => {
  it("a stat tile leads somewhere, and an error is never a number", () => {
    const retry = vi.fn();
    render(
      <>
        <StatTile label="Owe money" value={13} unit="students" sub="9 450 000 so'm in total" href="/ops/finance" />
        <StatTile label="Income, Nov" value={0} state="error" error="Couldn’t load from lc-up." onRetry={retry} />
      </>,
    );
    expect(host.querySelector('a[href="/ops/finance"]')?.textContent).toContain("13students9 450 000 so'm in total");
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Couldn’t load from lc-up.");
    expect(host.textContent).not.toContain("0students");
    click(alert.querySelector("button")!);
    expect(retry).toHaveBeenCalledOnce();
  });

  it("a header card answers the glance facts in a list and explains the state", () => {
    render(
      <HeaderCard
        title="Bekzod Jo'rayev"
        facts={[
          { label: "Today", value: "Came 15:02" },
          { label: "Owes", value: "750 000", unit: "so'm" },
        ]}
        notice={{ tone: "frozen", title: "Frozen for debt since 5 Nov.", body: "He can still come to lessons." }}
      />,
    );
    expect(host.querySelector("h1")?.textContent).toBe("Bekzod Jo'rayev");
    expect([...host.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Today", "Owes"]);
    expect(text()).toContain("Frozen for debt since 5 Nov.He can still come to lessons.");
  });

  it("a timeline's chips count and filter", () => {
    render(
      <Timeline
        filters={[{ id: "money", label: "Money" }, { id: "seat", label: "Seat" }]}
        events={[
          { id: 1, kind: "money", icon: "ms-paid", tone: "positive", title: "750 000 so'm paid", meta: "1 Oct" },
          { id: 2, kind: "security", icon: "key", tone: "neutral", title: "One-time password given", meta: "12 Sep" },
        ]}
      />,
    );
    const chips = [...host.querySelectorAll("button[aria-pressed]")];
    expect(chips.map((c) => c.textContent)).toEqual(["All2", "Money1", "Seat0"]);
    click(chips[1]);
    expect(host.querySelectorAll("li").length).toBe(1);
    click(chips[2]);
    expect(text()).toContain("Nothing of this kind yet.");
  });
});

describe("spot illustrations", () => {
  it("an empty state can carry one, hidden from screen readers (the words say it)", () => {
    render(<EmptyState art="magnifier" title="No students match" />);
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("viewBox")).toBe("0 0 240 160");
  });

  it("a dashboard's Needs you says All caught up with the sunrise; the bell keeps the plain line", () => {
    const done = [{ id: "x", label: "x", status: "done" as const, item: null, retry: () => {} }];
    render(<AttentionList sources={done} illustrate />);
    expect(text()).toContain("All caught up");
    expect(host.querySelector('svg[viewBox="0 0 240 160"]')).toBeTruthy();
    render(<AttentionList sources={done} />);
    expect(text()).toContain("Nothing needs you right now.");
    expect(host.querySelector('svg[viewBox="0 0 240 160"]')).toBeNull();
  });
});
