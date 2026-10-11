// The content island's protocol in both directions (architecture.md §2.7, protocol/schema.json):
// what native sends is applied, what the student does is painted at once and reported, every
// outgoing message satisfies the schema, and anything malformed is dropped and reported.
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContentIsland, FAILED_QUESTION_TEXT, Pending, SPLIT_MAX, SPLIT_MIN } from "../../src/content/island";
import type { IslandQuestion } from "../../src/protocol";
import { assertAllValid, fixtureMedia, init, loadModule, mathModule, mountIsland, rwModule, show, type Harness } from "../helpers";

let h: Harness;
afterEach(() => {
  if (h) assertAllValid(h);
  h?.stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const $ = <T extends Element = HTMLElement>(sel: string) => h.island.main.querySelector<T & Element>(sel) as unknown as T;
const choiceButtons = () => [...h.island.main.querySelectorAll<HTMLButtonElement>("#ts-choices button[aria-pressed]")];
const choice = (key: string) => choiceButtons().find((b) => b.firstElementChild?.textContent === key)!;
const buttonByText = (text: string) => [...h.island.main.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
const flagButton = () => [...h.island.main.querySelectorAll<HTMLButtonElement>("button")].find((b) => /Mark(ed)? for Review/.test(b.textContent ?? ""))!;
const eliminatorToggle = () => buttonByText("ABC")!;

function rw(): IslandQuestion[] {
  h = mountIsland();
  return loadModule(h, rwModule());
}

function math(): IslandQuestion[] {
  h = mountIsland();
  return loadModule(h, mathModule());
}

describe("handshake and validation", () => {
  it("announces itself with ready{build, protocol:1} as soon as it starts", () => {
    h = mountIsland();
    expect(h.sent()[0]).toEqual({ v: 1, t: "ready", build: "island/test", protocol: 1 });
  });

  it("accepts a JSON string as well as an object (both hosts' encodings)", () => {
    h = mountIsland();
    h.transport.deliver(JSON.stringify({ v: 1, t: "init", mode: "exam", kind: "midterm", subject: "math", overlays: "native", zoom: 1.2, split: 0.5, highlighterOn: false, eliminatorOn: true, calcReservePx: 0 }));
    expect(h.island.settings.kind).toBe("midterm");
    expect(h.island.view.zoom).toBe(1.2);
    expect(h.island.view.eliminatorOn).toBe(true);
  });

  it.each([
    ["wrong version", { v: 2, t: "init" }],
    ["unknown type", { v: 1, t: "navigate", url: "https://example.com" }],
    ["a Desmos message", { v: 1, t: "desmos.init", mode: "graphing" }],
    ["a to-native message", { v: 1, t: "answer.choose", qid: 1, key: "A" }],
    ["a missing field", { v: 1, t: "question.show", qid: 1 }],
    ["a wrong field type", { v: 1, t: "view.set", zoom: "big" }],
    ["not JSON", "{oops"],
    ["not an object", 42],
  ])("drops %s and reports error{where:'protocol.in'}", (_name, raw) => {
    h = mountIsland();
    h.clear();
    h.transport.deliver(raw);
    expect(h.island.channel.stats.dropped).toBe(1);
    expect(h.sent()).toHaveLength(1);
    expect(h.sent()[0]).toMatchObject({ t: "error", where: "protocol.in" });
  });

  it("refuses to send a message that breaks the schema, and says so", () => {
    h = mountIsland();
    h.clear();
    const ok = h.island.channel.send({ t: "answer.choose", qid: "seven", key: "A" } as never);
    expect(ok).toBe(false);
    expect(h.sentOf("answer.choose")).toHaveLength(0);
    expect(h.last("error")).toMatchObject({ where: "protocol.out" });
    expect(h.island.channel.stats.refused).toBe(1);
  });

  it("a handler that throws is reported, and the island keeps working", () => {
    const qs = rw();
    vi.spyOn(h.island.media, "put").mockImplementationOnce(() => {
      throw new Error("decoder exploded");
    });
    h.clear();
    h.deliver({ t: "media.put", key: "x.png", mime: "image/png", b64: "AAAA" });
    expect(h.last("error")).toMatchObject({ where: "handle media.put", message: "Error: decoder exploded" });
    show(h, qs[0], 0, qs.length);
    expect(h.last("question.shown")).toMatchObject({ qid: qs[0].id });
  });
});

describe("module.load and question.show", () => {
  it("builds every question once, reports module.loaded{ms, failed:[]} and leaves no prerender behind", () => {
    const qs = rw();
    const loaded = h.last("module.loaded")!;
    expect(loaded).toMatchObject({ moduleId: rwModule().moduleId, failed: [] });
    expect(loaded.ms).toBeGreaterThanOrEqual(0);
    for (const q of qs) expect(h.island.card(q.id)).toBeDefined();
    expect(document.querySelector('[data-island="prerender"]')!.childElementCount).toBe(0);
  });

  it("a question that cannot be built still shows (with an apology) and is listed in failed", () => {
    const m = rwModule();
    const target = m.questions[2].id;
    const proto = ContentIsland.prototype as unknown as { buildCard: (q: IslandQuestion, twoPane: boolean) => unknown };
    const original = proto.buildCard;
    vi.spyOn(proto, "buildCard").mockImplementation(function (this: unknown, q: IslandQuestion, twoPane: boolean) {
      if (q.id === target && q.question_text !== FAILED_QUESTION_TEXT) throw new Error("bad content");
      return original.call(this, q, twoPane);
    });
    h = mountIsland();
    loadModule(h, m);
    expect(h.last("module.loaded")!.failed).toEqual([target]);
    show(h, m.questions[2], 2, m.questions.length);
    expect($("#ts-passage").textContent).toContain("didn’t display correctly");
    // The choices are intact: the student can still answer.
    choice("A").click();
    expect(h.last("answer.choose")).toEqual({ v: 1, t: "answer.choose", qid: target, key: "A" });
  });

  it("question.show swaps the card without rebuilding it, and reports question.shown{qid, ms}", () => {
    const qs = rw();
    show(h, qs[0], 0, qs.length);
    const first = h.island.main.firstElementChild;
    show(h, qs[1], 1, qs.length);
    expect(h.last("question.shown")).toMatchObject({ qid: qs[1].id });
    expect(typeof h.last("question.shown")!.ms).toBe("number");
    show(h, qs[0], 0, qs.length);
    expect(h.island.main.firstElementChild).toBe(first); // the same nodes, swapped back in
    expect($("span.bg-\\[\\#151515\\]").textContent).toBe("1");
  });

  it("the number block shows index + 1 from question.show", () => {
    const qs = rw();
    show(h, qs[3], 3, qs.length);
    expect($("span.bg-\\[\\#151515\\]").textContent).toBe("4");
  });

  it("an unknown question is an error, not a crash", () => {
    rw();
    h.clear();
    h.deliver({ t: "question.show", qid: 999999, index: 0, total: 1, answer: null, eliminated: [], flagged: false, annotations: { passage: [], question: [], choices: [] } });
    expect(h.last("error")).toMatchObject({ where: "question.show" });
    expect(h.sentOf("question.shown")).toHaveLength(0);
  });

  it("question.show restores the answer, eliminations and flag it carries", () => {
    const qs = rw();
    h.deliver({ t: "view.set", eliminatorOn: true });
    show(h, qs[0], 0, qs.length, { answer: "B", eliminated: ["D"], flagged: true });
    expect(choice("B").getAttribute("aria-pressed")).toBe("true");
    expect(choice("D").className).toContain("cursor-not-allowed");
    expect(flagButton().textContent).toBe("Marked for Review");
  });

  it("images arriving after module.load are bound to the questions already built", () => {
    h = mountIsland();
    const m = rwModule();
    init(h, { subject: "rw" });
    h.deliver({ t: "module.load", moduleId: m.moduleId, questions: m.questions });
    const q = m.questions.find((x) => x.question_image_key)!;
    show(h, q, m.questions.indexOf(q), m.questions.length);
    const img = h.island.main.querySelector("img")!;
    expect(img.getAttribute("src")).toBeNull();
    const media = fixtureMedia().find((x) => x.key === q.question_image_key)!;
    h.deliver({ t: "media.put", key: media.key, mime: "image/png", b64: media.b64 });
    // A blob: URL where the runtime has createObjectURL (WebView2, Node), data: otherwise.
    expect(img.getAttribute("src")).toMatch(/^(blob:|data:image\/png;base64,)/);
    expect(img.getAttribute("src")).toBe(h.island.media.url(media.key));
  });

  it("a new module replaces the old one's cards", () => {
    const qs = rw();
    const m2 = mathModule();
    init(h, { subject: "math" });
    h.deliver({ t: "module.load", moduleId: m2.moduleId, questions: m2.questions });
    expect(h.island.card(qs[0].id)).toBeUndefined();
    expect(h.island.card(m2.questions[0].id)).toBeDefined();
    expect(h.island.moduleId).toBe(m2.moduleId);
  });
});

describe("answering: painted at once, reported, native authoritative", () => {
  it("a click paints the choice and sends answer.choose", () => {
    const qs = rw();
    show(h, qs[0], 0, qs.length);
    h.clear();
    choice("C").click();
    expect(choice("C").getAttribute("aria-pressed")).toBe("true");
    expect(choice("C").className).toContain("border-[#2b47c9]");
    expect(h.sent()).toEqual([{ v: 1, t: "answer.choose", qid: qs[0].id, key: "C" }]);
    choice("C").click(); // the same choice again: nothing new
    expect(h.sentOf("answer.choose")).toHaveLength(1);
  });

  it("echoes of the island's own clicks never bounce the answer back", () => {
    const qs = rw();
    show(h, qs[0], 0, qs.length);
    choice("B").click();
    choice("C").click();
    h.deliver({ t: "state.patch", qid: qs[0].id, answer: "B" }); // late echo of the first click
    expect(choice("C").getAttribute("aria-pressed")).toBe("true");
    h.deliver({ t: "state.patch", qid: qs[0].id, answer: "C" });
    expect(choice("C").getAttribute("aria-pressed")).toBe("true");
  });

  it("native can override: a state.patch the island never sent is applied", () => {
    const qs = rw();
    show(h, qs[0], 0, qs.length);
    choice("B").click();
    h.deliver({ t: "state.patch", qid: qs[0].id, answer: "D", flagged: true });
    expect(choice("D").getAttribute("aria-pressed")).toBe("true");
    expect(choice("B").getAttribute("aria-pressed")).toBe("false");
    expect(flagButton().textContent).toBe("Marked for Review");
    h.deliver({ t: "state.patch", qid: qs[0].id, answer: "" });
    expect(choiceButtons().every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("Mark for Review toggles at once and sends flag.toggle", () => {
    const qs = rw();
    show(h, qs[0], 0, qs.length);
    h.clear();
    flagButton().click();
    expect(flagButton().textContent).toBe("Marked for Review");
    expect(flagButton().className).toContain("text-[#b0122a]");
    expect(h.sent()).toEqual([{ v: 1, t: "flag.toggle", qid: qs[0].id }]);
    h.deliver({ t: "state.patch", qid: qs[0].id, flagged: true });
    expect(flagButton().textContent).toBe("Marked for Review");
  });

  it("the ABC toggle sends eliminator.toggle; eliminating crosses out, Undo restores", () => {
    const qs = rw();
    show(h, qs[0], 0, qs.length);
    h.clear();
    eliminatorToggle().click();
    expect(eliminatorToggle().getAttribute("aria-pressed")).toBe("true");
    expect(h.sent()).toEqual([{ v: 1, t: "eliminator.toggle" }]);
    h.deliver({ t: "view.set", eliminatorOn: true }); // native's echo
    expect(eliminatorToggle().getAttribute("aria-pressed")).toBe("true");

    h.island.main.querySelector<HTMLButtonElement>('button[aria-label="Eliminate C"]')!.click();
    expect(h.last("answer.eliminate")).toEqual({ v: 1, t: "answer.eliminate", qid: qs[0].id, key: "C", on: true });
    expect(choice("C").querySelector('[aria-hidden="true"]')).not.toBeNull(); // the line through it
    // A crossed-out choice cannot be chosen.
    choice("C").click();
    expect(h.sentOf("answer.choose")).toHaveLength(0);
    buttonByText("Undo")!.click();
    expect(h.last("answer.eliminate")).toEqual({ v: 1, t: "answer.eliminate", qid: qs[0].id, key: "C", on: false });
    expect(choice("C").querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("eliminating the chosen answer also clears it (the website's toggleEliminate)", () => {
    const qs = rw();
    h.deliver({ t: "view.set", eliminatorOn: true });
    show(h, qs[0], 0, qs.length, { answer: "A" });
    h.island.main.querySelector<HTMLButtonElement>('button[aria-label="Eliminate A"]')!.click();
    expect(choice("A").getAttribute("aria-pressed")).toBe("false");
    // Native's echoes (eliminated, then the cleared answer) change nothing on screen.
    h.deliver({ t: "state.patch", qid: qs[0].id, eliminated: ["A"], answer: "" });
    expect(choice("A").getAttribute("aria-pressed")).toBe("false");
    expect(choice("A").className).toContain("cursor-not-allowed");
  });

  it("the grid-in input filters to ^[-0-9./]*$, at most 5 characters, and sends answer.input", () => {
    const qs = math();
    const i = qs.findIndex((q) => q.is_math_input);
    show(h, qs[i], i, qs.length);
    const input = h.island.main.querySelector("input")!;
    const type = (v: string) => {
      input.value = v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    h.clear();
    type("7/2");
    expect(h.sent()).toEqual([{ v: 1, t: "answer.input", qid: qs[i].id, value: "7/2" }]);
    type("7/2x");
    expect(input.value).toBe("7/2");
    type("-1.255");
    expect(input.value).toBe("-1.25");
    expect(h.last("answer.input")!.value).toBe("-1.25");
    type("");
    expect(h.last("answer.input")!.value).toBe("");
    expect(h.sentOf("answer.input").map((m) => m.value)).toEqual(["7/2", "-1.25", ""]);
    // "Recorded:" shows the fraction stacked.
    type("3/4");
    expect(h.island.main.textContent).toContain("Recorded:");
  });

  it("a grid-in answer from native fills the input without disturbing typing", () => {
    const qs = math();
    const i = qs.findIndex((q) => q.is_math_input);
    show(h, qs[i], i, qs.length, { answer: "12" });
    const input = h.island.main.querySelector("input")!;
    expect(input.value).toBe("12");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    for (const v of ["3", "34", "345"]) {
      input.value = v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // Native's echoes trail the keystrokes: none of them may rewind the input.
    h.deliver({ t: "state.patch", qid: qs[i].id, answer: "" });
    h.deliver({ t: "state.patch", qid: qs[i].id, answer: "3" });
    expect(input.value).toBe("345");
    h.deliver({ t: "state.patch", qid: qs[i].id, answer: "34" });
    expect(input.value).toBe("345");
    h.deliver({ t: "state.patch", qid: qs[i].id, answer: "345" });
    expect(input.value).toBe("345");
    // A value native decides on its own (say, a restore) is adopted.
    h.deliver({ t: "state.patch", qid: qs[i].id, answer: "9" });
    expect(input.value).toBe("9");
  });

  it("inputLocked ignores every click and keystroke until it is lifted", () => {
    const qs = rw();
    show(h, qs[0], 0, qs.length);
    h.deliver({ t: "view.set", inputLocked: true });
    h.clear();
    choice("A").click();
    flagButton().click();
    eliminatorToggle().click();
    expect(h.sent()).toEqual([]);
    expect(choice("A").getAttribute("aria-pressed")).toBe("false");
    h.deliver({ t: "view.set", inputLocked: false });
    choice("A").click();
    expect(h.sentOf("answer.choose")).toHaveLength(1);
  });

  it("inputLocked takes focus out of the grid-in input", () => {
    const qs = math();
    const i = qs.findIndex((q) => q.is_math_input);
    show(h, qs[i], i, qs.length);
    const input = h.island.main.querySelector("input")!;
    input.focus();
    expect(document.activeElement).toBe(input);
    h.deliver({ t: "view.set", inputLocked: true });
    expect(document.activeElement).not.toBe(input);
    expect(input.readOnly).toBe(true);
  });
});

describe("view.set", () => {
  it("zoom scales the passage, stem and choices like the website", () => {
    const qs = rw();
    show(h, qs[0], 0, qs.length);
    h.deliver({ t: "view.set", zoom: 1.5 });
    const passagePane = h.island.main.firstElementChild as HTMLElement;
    expect(passagePane.style.fontSize).toBe(`${17 * 1.5}px`);
    expect((h.island.main.lastElementChild as HTMLElement).style.fontSize).toBe(`${15 * 1.5}px`);
  });

  it("split sets the pane widths; highlighterOn adds .ts-annotating", () => {
    const qs = rw();
    show(h, qs[0], 0, qs.length);
    h.deliver({ t: "view.set", split: 0.6, highlighterOn: true });
    expect((h.island.main.firstElementChild as HTMLElement).style.width).toBe("60%");
    expect((h.island.main.lastElementChild as HTMLElement).style.width).toBe("40%");
    expect(h.island.main.classList.contains("ts-annotating")).toBe(true);
    h.deliver({ t: "view.set", highlighterOn: false });
    expect(h.island.main.classList.contains("ts-annotating")).toBe(false);
  });

  it("calcReservePx pads a Math multiple-choice card, never a grid-in", () => {
    const qs = math();
    h.deliver({ t: "view.set", calcReservePx: 500 });
    const mc = qs.findIndex((q) => !q.is_math_input);
    show(h, qs[mc], mc, qs.length);
    expect((h.island.main.lastElementChild as HTMLElement).style.paddingLeft).toBe("500px");
    const spr = qs.findIndex((q) => q.is_math_input);
    show(h, qs[spr], spr, qs.length);
    expect((h.island.main.lastElementChild as HTMLElement).style.paddingLeft).toBe("");
  });
});

describe("the divider drag", () => {
  it("drags within 28–72 % and reports split.changed once, on release", () => {
    const qs = rw();
    show(h, qs[0], 0, qs.length);
    vi.spyOn(h.island.main, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
    const divider = h.island.main.querySelector('[role="separator"]')!;
    h.clear();
    divider.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 500 }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 950 }));
    expect(h.island.view.split).toBe(SPLIT_MAX);
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50 }));
    expect(h.island.view.split).toBe(SPLIT_MIN);
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 615 }));
    expect(h.sentOf("split.changed")).toHaveLength(0);
    window.dispatchEvent(new MouseEvent("mouseup", {}));
    expect(h.sent()).toEqual([{ v: 1, t: "split.changed", split: 0.615 }]);
    expect((h.island.main.firstElementChild as HTMLElement).style.width).toBe("61.5%");
    expect(document.body.getAttribute("style")).toBeNull();
  });
});

describe("keys, focus", () => {
  const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e;
  };

  it("forwards only ←, →, a–d, m, r, ? and Escape, never with Ctrl/Alt/Meta", () => {
    const qs = rw();
    show(h, qs[0], 0, qs.length);
    h.clear();
    for (const k of ["ArrowLeft", "ArrowRight", "a", "B", "c", "d", "m", "R", "?", "Escape", "x", "Enter", "Tab", "1"]) press(k);
    press("a", { ctrlKey: true });
    press("b", { altKey: true });
    press("c", { metaKey: true });
    expect(h.sentOf("key").map((m) => m.key)).toEqual(["ArrowLeft", "ArrowRight", "a", "b", "c", "d", "m", "r", "?", "Escape"]);
  });

  it("never forwards while the grid-in input has focus — not even Escape", () => {
    const qs = math();
    const i = qs.findIndex((q) => q.is_math_input);
    show(h, qs[i], i, qs.length);
    const input = h.island.main.querySelector("input")!;
    h.clear();
    for (const k of ["a", "ArrowLeft", "Escape", "?"]) press(k, {}, input);
    expect(h.sentOf("key")).toEqual([]);
  });

  it("swallows browser keys (reload, find, print, zoom, history) and forwards none of them", () => {
    rw();
    h.clear();
    const prevented = [press("F5"), press("r", { ctrlKey: true }), press("f", { ctrlKey: true }), press("p", { ctrlKey: true }), press("+", { ctrlKey: true }), press("ArrowLeft", { altKey: true }), press("F12"), press("F7"), press("Backspace")];
    expect(prevented.every((e) => e.defaultPrevented)).toBe(true);
    expect(h.sentOf("key")).toEqual([]);
  });

  it("reports focus{inIsland} on window focus and blur, once per change", () => {
    rw();
    h.clear();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("blur"));
    expect(h.sent()).toEqual([
      { v: 1, t: "focus", inIsland: true },
      { v: 1, t: "focus", inIsland: false },
    ]);
  });

  it("focus.release blurs whatever had focus", () => {
    const qs = math();
    const i = qs.findIndex((q) => q.is_math_input);
    show(h, qs[i], i, qs.length);
    const input = h.island.main.querySelector("input")!;
    input.focus();
    h.deliver({ t: "focus.release" });
    expect(document.activeElement).toBe(document.body);
  });
});

describe("review mode", () => {
  function review(q: IslandQuestion, info: { correct: string; studentAnswer: string | null; isCorrect: boolean }, extra: Partial<IslandQuestion> = {}) {
    h = mountIsland();
    const m = q.is_math_input || q.question_type === "MATH" ? mathModule() : rwModule();
    init(h, { mode: "review", subject: m.subject });
    const questions = m.questions.map((x) => (x.id === q.id ? { ...x, ...extra } : x));
    h.deliver({ t: "module.load", moduleId: m.moduleId, questions });
    h.deliver({ t: "question.show", qid: q.id, index: 0, total: questions.length, answer: info.studentAnswer, eliminated: [], flagged: false, annotations: { passage: [], question: [], choices: [] }, review: info });
  }

  it("marks the correct choice green and a wrong pick red, read-only", () => {
    const q = rwModule().questions[0];
    review(q, { correct: "B", studentAnswer: "C", isCorrect: false });
    expect(choice("B").className).toContain("border-emerald-500");
    expect(choice("C").className).toContain("border-red-400");
    expect(choice("A").className).toContain("border-[#c8ccd4]");
    expect(choice("C").getAttribute("aria-pressed")).toBe("true");
    h.clear();
    choice("A").click();
    flagButton().click();
    expect(h.sent()).toEqual([]);
    expect(eliminatorToggle().style.visibility).toBe("hidden");
  });

  it("shows the explanation when the question carries one", () => {
    const q = rwModule().questions[0];
    review(q, { correct: "A", studentAnswer: "A", isCorrect: true }, { explanation: "Choice A is right because **the passage** says so." });
    const block = h.island.main.querySelector('[data-island="review"]')!;
    expect(block.textContent).toContain("Explanation");
    expect(block.querySelector("b")?.textContent).toBe("the passage");
  });

  it("a grid-in shows Your Answer / Correct Answer(s) instead of the input", () => {
    const q = mathModule().questions.find((x) => x.is_math_input)!;
    review(q, { correct: "2, 2.0", studentAnswer: "3", isCorrect: false });
    expect(h.island.main.querySelector("input")).toBeNull();
    const block = h.island.main.querySelector('[data-island="review"]')!;
    expect(block.textContent).toContain("Your Answer");
    expect(block.textContent).toContain("3");
    expect(block.textContent).toContain("Correct Answer(s)");
    expect(block.textContent).toContain("2, 2.0");
  });
});

describe("Pending (echo bookkeeping)", () => {
  it("applies an echo only when nothing newer is in flight", () => {
    const p = new Pending<string>();
    p.push("B");
    p.push("C");
    expect(p.echo("B")).toBe(false);
    expect(p.echo("C")).toBe(true);
    expect(p.size).toBe(0);
  });

  it("an echo the island never sent overrides and clears the queue", () => {
    const p = new Pending<string[]>();
    p.push(["A"]);
    expect(p.echo(["Z"])).toBe(true);
    expect(p.size).toBe(0);
  });
});
