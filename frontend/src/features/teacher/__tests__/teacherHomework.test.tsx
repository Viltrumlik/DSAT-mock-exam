/**
 * /teacher/homework, in the panel's own look.
 *
 * Two things are being held still here. The first is the four branches: a load still running, a
 * load that FAILED, a teacher with no assignments, and assignments in hand. The middle two are
 * the pair this product keeps confusing — "No assignments yet" over a 500 tells a teacher their
 * classes did nothing all week — so each one is asserted to be itself AND asserted not to be the
 * other.
 *
 * The second is the chips. A page in this repo recently lost a state by replacing two chips with
 * one verdict, and a struck-off paper read as a pass. This page shows five — three mutually
 * exclusive health cases and two independent flags — so every one of them is driven here, from a
 * model that contains all five at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const api = vi.hoisted(() => ({ list: vi.fn(), getInterventions: vi.fn(), getLeaderboard: vi.fn() }));
/** The boot state the page is asked to render against; mutable, because one case is signed out. */
const boot = vi.hoisted(() => ({ state: "AUTHENTICATED" }));

vi.mock("@/lib/api", () => ({ classesApi: api }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ bootState: boot.state }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, className, style }: { children: ReactNode; href: string; className?: string; style?: Record<string, unknown> }) => (
    <a href={href} className={className} style={style}>{children}</a>
  ),
}));

const { TeacherHomework } = await import("../TeacherHomework");
type Model = Parameters<typeof TeacherHomework>[0]["previewModel"];
type Assignment = NonNullable<Model>["assignments"][number];

/** An assignment row exactly as `useTeacherAnalytics` builds one. */
function assignment(over: Partial<Assignment> & Pick<Assignment, "id" | "title" | "classId" | "className" | "effectiveness">): Assignment {
  return {
    completionPct: 80, submitted: 8, total: 10,
    isAssessment: false, isOverdue: false, groupMean: 1300, createdMs: null,
    ...over,
  };
}

/**
 * Two classes, and one assignment per health case plus the two flags, so a single mount can be
 * asked whether each chip has somewhere to appear.
 */
const ALGEBRA_ID = 1;
const READING_ID = 2;
const MODEL: NonNullable<Model> = {
  classCount: 2,
  totalStudents: 5,
  atRiskCount: 1,
  watchCount: 1,
  classes: [
    { id: ALGEBRA_ID, name: "Algebra 2", students: 3, reviewAvg: 72, completion: 80, atRisk: 1 },
    { id: READING_ID, name: "Reading B", students: 2, reviewAvg: 84, completion: 91, atRisk: 0 },
  ],
  students: [],
  assignments: [
    assignment({ id: 101, title: "Linear equations", classId: ALGEBRA_ID, className: "Algebra 2", effectiveness: "healthy", completionPct: 92, submitted: 22, total: 24, groupMean: null }),
    assignment({ id: 102, title: "Quadratics drill", classId: ALGEBRA_ID, className: "Algebra 2", effectiveness: "challenging", completionPct: 76, submitted: 19, total: 25, groupMean: 1240 }),
    assignment({ id: 103, title: "Percentages quiz", classId: ALGEBRA_ID, className: "Algebra 2", effectiveness: "low-completion", completionPct: 41, submitted: 10, total: 24, isAssessment: true, isOverdue: true, groupMean: 1180 }),
    assignment({ id: 201, title: "Inferences set", classId: READING_ID, className: "Reading B", effectiveness: "healthy", completionPct: 88, submitted: 15, total: 17 }),
  ],
  classAvgTrend: [],
  recommendations: [],
};

let host: HTMLDivElement;
let root: Root;

async function mount(element: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(element));
}

/** Turn the event loop until `done` holds. */
async function until(done: () => boolean) {
  for (let tick = 0; tick < 50 && !done(); tick++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  if (!done()) throw new Error("never settled");
}

const text = () => host.textContent ?? "";
const alert = () => host.querySelector('[role="alert"]');
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());
function button(label: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
}
/** Every assignment card on the page, as the text inside its link. */
const cards = () => [...host.querySelectorAll("a")].map((a) => a.textContent ?? "");
/** The text of the one card whose title is `title`, or null. */
function cardFor(title: string) {
  return [...host.querySelectorAll("a")].find((a) => a.querySelector("p")?.textContent === title)?.textContent ?? null;
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  boot.state = "AUTHENTICATED";
  api.list.mockResolvedValue({ items: [] });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.resetAllMocks();
});

describe("homework — while the model is still loading", () => {
  it("shows neither assignments nor a failure, only the placeholder", async () => {
    // A promise that never settles: the pending state, held still.
    api.list.mockReturnValue(new Promise(() => {}));
    await mount(<TeacherHomework />);

    expect(alert()).toBeNull();
    expect(text()).not.toContain("No assignments yet");
    expect(text()).not.toContain("Couldn’t load");
    // The region says it is working, which is what a screen reader hears and what the shared
    // load-failure suite watches to know this page has not settled yet.
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    // And the placeholder's own shape — six card-sized blocks. A bare `[aria-hidden]` would be
    // satisfied by any decorative icon on the page and would prove nothing about this state.
    const blocks = [...host.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div')].filter((d) => d.style.height === "168px");
    expect(blocks).toHaveLength(6);
  });
});

describe("homework — when the model does not load", () => {
  it("says the request failed, and never that there are no assignments", async () => {
    api.list.mockRejectedValue(Object.assign(new Error("boom"), { response: { status: 500, data: "<!doctype html>" } }));
    await mount(<TeacherHomework />);
    await until(() => alert() != null);

    expect(text()).toContain("Couldn’t load your assignments");
    expect(text()).toContain("Your assignments and their submissions are unchanged — only this page failed to load.");
    // The whole point of the branch order.
    expect(text()).not.toContain("No assignments yet");
    expect(text()).not.toContain("No assignments match");
    // Django's HTML error page is not a reason to show anyone.
    expect(text()).not.toContain("doctype");
    expect(buttons()).toContain("Try again");
  });

  it("shows the server's reason when it gave one", async () => {
    const detail = "You do not have permission to perform this action.";
    api.list.mockRejectedValue(Object.assign(new Error("forbidden"), { response: { status: 403, data: { detail } } }));
    await mount(<TeacherHomework />);
    await until(() => alert() != null);

    expect(text()).toContain(detail);
    expect(text()).not.toContain("only this page failed to load");
  });

  it("asks again when the retry is pressed", async () => {
    api.list.mockRejectedValue(new Error("network"));
    await mount(<TeacherHomework />);
    await until(() => alert() != null);
    const before = api.list.mock.calls.length;

    await act(async () => button("Try again").click());
    await until(() => api.list.mock.calls.length > before);

    expect(api.list.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("homework — when there is nothing to show", () => {
  it("gives the reason, and is not dressed up as a failure", async () => {
    api.list.mockResolvedValue({ items: [] });
    await mount(<TeacherHomework />);
    await until(() => text().includes("No assignments yet"));

    expect(text()).toContain("Assignment health appears here once you assign work.");
    expect(alert()).toBeNull();
    expect(buttons()).not.toContain("Try again");
  });

  it("asks a signed-out reader to sign in, rather than reporting an empty week", async () => {
    boot.state = "UNAUTHENTICATED";
    await mount(<TeacherHomework />);

    expect(text()).toContain("Sign in with a teacher account");
    expect(text()).not.toContain("No assignments yet");
    expect(alert()).toBeNull();
  });
});

describe("homework — when the assignments are in hand", () => {
  it("lists every assignment with its class, and counts them under the title", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    expect(text()).toContain("4 assignments across 2 classes.");
    expect(cards().length).toBe(4);
    expect(cardFor("Linear equations")).toContain("Algebra 2");
    expect(cardFor("Inferences set")).toContain("Reading B");
    expect(text()).not.toContain("No assignments yet");
    expect(alert()).toBeNull();
  });

  it("shows each of the five chips somewhere — the three health cases and the two flags", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    // Each health case on the card that has it, so a chip cannot pass this by appearing anywhere.
    expect(cardFor("Linear equations")).toContain("Healthy");
    expect(cardFor("Quadratics drill")).toContain("Challenging");
    expect(cardFor("Percentages quiz")).toContain("Low completion");
    // And the two flags, which are not a verdict on the health chip and stand beside it.
    expect(cardFor("Percentages quiz")).toContain("Assessment");
    expect(cardFor("Percentages quiz")).toContain("Past due");
    // A healthy assignment that is neither carries neither.
    expect(cardFor("Linear equations")).not.toContain("Assessment");
    expect(cardFor("Linear equations")).not.toContain("Past due");
  });

  it("prints the turned-in count, its share, and the group mean", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    expect(cardFor("Linear equations")).toContain("22/24 · 92%");
    expect(cardFor("Quadratics drill")).toContain("1240");
  });

  it("reads a group mean nobody has yet as an em dash, never as a zero", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    // "Linear equations" has groupMean: null. A 0 here reads as a class that answered everything
    // wrong, which is the opposite of what the server said.
    expect(cardFor("Linear equations")).toContain("—");
    expect(cardFor("Linear equations")).not.toContain("Avg score0");
  });

  it("counts the two figures over all of the classes", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    const figure = (label: string) =>
      [...host.querySelectorAll("div")].find((d) => d.textContent === label)?.nextElementSibling?.textContent ?? null;
    expect(figure("Low completion")).toBe("1");
    expect(figure("Challenging")).toBe("1");
  });

  it("opens grading from the whole card, as a real link", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    // An anchor, not a click handler: cmd-click and middle-click open a second one, and the
    // keyboard reaches it at all.
    const hrefs = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toHaveLength(4);
    expect(new Set(hrefs)).toEqual(new Set(["/teacher/grading"]));
  });
});

describe("homework — the filters", () => {
  it("narrows to one class, and back to all of them", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);
    expect(cards().length).toBe(4);

    await act(async () => button("Reading B").click());
    expect(cards().length).toBe(1);
    expect(cardFor("Inferences set")).not.toBeNull();
    expect(text()).not.toContain("Linear equations");

    await act(async () => button("All classes").click());
    expect(cards().length).toBe(4);
    expect(text()).toContain("Linear equations");
  });

  it("keeps the class chips out of the way of a teacher with one class", async () => {
    const one = { ...MODEL, classCount: 1, classes: [MODEL.classes[0]], assignments: MODEL.assignments.filter((a) => a.classId === ALGEBRA_ID) };
    await mount(<TeacherHomework previewModel={one} />);

    expect(buttons()).not.toContain("All classes");
    // The health filter is still there — it is the one that means something with one class.
    expect(buttons()).toEqual(expect.arrayContaining(["All", "Needs attention", "Healthy"]));
  });

  it("shows only what needs attention, then only what is healthy", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    await act(async () => button("Needs attention").click());
    expect(cardFor("Quadratics drill")).not.toBeNull();
    expect(cardFor("Percentages quiz")).not.toBeNull();
    expect(cardFor("Linear equations")).toBeNull();

    await act(async () => button("Healthy").click());
    expect(cardFor("Linear equations")).not.toBeNull();
    expect(cardFor("Inferences set")).not.toBeNull();
    expect(cardFor("Quadratics drill")).toBeNull();
  });

  it("says a filter matched nothing in its own words, not the empty page's and not a failure's", async () => {
    await mount(<TeacherHomework previewModel={MODEL} />);

    await act(async () => button("Reading B").click());
    await act(async () => button("Needs attention").click());

    expect(text()).toContain("No assignments match");
    expect(text()).toContain("Try a different filter.");
    // Reading B's work is fine; that is not the same as having none, and not the same as a 500.
    expect(text()).not.toContain("No assignments yet");
    expect(alert()).toBeNull();
    // And the filters are still there to be undone.
    expect(buttons()).toEqual(expect.arrayContaining(["All classes", "All"]));
  });
});
