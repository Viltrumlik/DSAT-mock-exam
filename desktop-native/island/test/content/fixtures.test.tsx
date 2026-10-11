// Every question in contracts/v1 renders, and renders the SAME DOM as the website's own React
// components (PassagePane / AnswerPane / ChoiceList / SprInput / StudentProducedResponseGuide
// composed as ExamRunnerPage's <main>), attribute for attribute, minus the island's documented
// hardening differences (ISLAND_ONLY_ATTRS). Same DOM + same CSS = the same pixels; the
// highlighter's character offsets are identical too, because the text nodes are.
import { afterEach, describe, expect, it } from "vitest";

import type { IslandQuestion } from "../../src/protocol";
import { assertAllValid, fixtureModules, loadModule, mountIsland, show, type Harness } from "../helpers";
import { describeDom, renderWebsiteCard, toWebsiteQuestion } from "../websiteRender";

const modules = fixtureModules();
let h: Harness | null = null;
afterEach(() => {
  h?.stop();
  h = null;
  document.body.replaceChildren();
});

describe("contracts/v1 question fixtures", () => {
  it("covers both subjects, grid-ins, images, tables and inline LaTeX", () => {
    const all = modules.flatMap((m) => m.questions);
    expect(modules.some((m) => m.subject === "rw")).toBe(true);
    expect(modules.some((m) => m.subject === "math")).toBe(true);
    expect(all.some((q) => q.is_math_input)).toBe(true);
    expect(all.some((q) => q.question_image_key)).toBe(true);
    expect(all.some((q) => Object.values(q.options ?? {}).some((o) => o.image_key))).toBe(true);
    expect(all.some((q) => q.question_text.includes("<table>"))).toBe(true);
    expect(all.some((q) => q.question_text.includes("$"))).toBe(true);
    expect(all.some((q) => q.question_text.includes("<u>"))).toBe(true);
  });

  for (const m of modules) {
    describe(m.source, () => {
      it("module.load builds every question with no failures and reports timing", () => {
        h = mountIsland();
        loadModule(h, m);
        const loaded = h.last("module.loaded")!;
        expect(loaded.moduleId).toBe(m.moduleId);
        expect(loaded.failed).toEqual([]);
        expect(typeof loaded.ms).toBe("number");
        assertAllValid(h);
      });

      m.questions.forEach((q: IslandQuestion, i: number) => {
        it(`question ${q.id} (${q.question_type}${q.is_math_input ? ", grid-in" : ""}) matches the website's DOM`, () => {
          h = mountIsland();
          loadModule(h, m);
          show(h, q, i, m.questions.length);
          expect(h.last("question.shown")).toMatchObject({ qid: q.id });
          const main = h.island.main;

          // Structure the highlighter and native rely on.
          if (m.subject === "rw") expect(main.querySelector("#ts-passage")).not.toBeNull();
          expect(main.querySelector("#ts-question")).not.toBeNull();
          if (q.is_math_input) {
            expect(main.querySelector("#ts-choices")).toBeNull();
            expect(main.querySelector("input")).not.toBeNull();
          } else {
            const letters = [...main.querySelectorAll("#ts-choices button[aria-pressed] > span:first-child")].map((s) => s.textContent);
            expect(letters).toEqual(Object.keys(q.options ?? { A: 0, B: 0, C: 0, D: 0 }));
          }
          if (q.question_text.includes("$") && m.subject === "math") expect(main.querySelector("#ts-question .katex")).not.toBeNull();
          // Hardening: no tooltips, no <select>, every image bound to its media.put bytes.
          expect(main.querySelector("[title]")).toBeNull();
          expect(main.querySelector("select")).toBeNull();
          for (const img of main.querySelectorAll("img")) expect(img.getAttribute("src") ?? "").toMatch(/^(blob:|data:image\/png;base64,)/);

          // DOM parity with the website's components.
          const web = renderWebsiteCard({
            question: toWebsiteQuestion(q, (key) => h!.island.media.url(key)),
            twoPane: m.subject === "rw",
            displayNumber: i + 1,
            zoom: 1,
            splitPct: 50,
            flagged: false,
            eliminationMode: false,
            answer: undefined,
            eliminated: [],
            sprGuideExpanded: true,
            calcReserve: 0,
            highlighterActive: false,
          });
          try {
            expect(describeDom(main).join("\n")).toBe(describeDom(web.main).join("\n"));
          } finally {
            web.unmount();
          }
        });
      });
    });
  }
});

describe("DOM parity in every visual state", () => {
  const rw = modules.find((m) => m.subject === "rw")!;
  const math = modules.find((m) => m.subject === "math" && m.questions.some((q) => q.is_math_input))!;

  const states: Array<{ name: string; over: Record<string, unknown>; view: Record<string, unknown>; web: Partial<Parameters<typeof renderWebsiteCard>[0]> }> = [
    { name: "answered + flagged", over: { answer: "B", flagged: true }, view: {}, web: { answer: "B", flagged: true } },
    {
      name: "eliminator on, C crossed out",
      over: { eliminated: ["C"] },
      view: { eliminatorOn: true },
      web: { eliminationMode: true, eliminated: ["C"] },
    },
    { name: "zoom 1.3, split 0.62", over: {}, view: { zoom: 1.3, split: 0.62 }, web: { zoom: 1.3, splitPct: 62 } },
    { name: "highlighter on", over: {}, view: { highlighterOn: true }, web: { highlighterActive: true } },
  ];

  for (const s of states) {
    it(`R&W: ${s.name}`, () => {
      h = mountIsland();
      loadModule(h, rw);
      if (Object.keys(s.view).length) h.deliver({ t: "view.set", ...s.view });
      const q = rw.questions[0];
      show(h, q, 0, rw.questions.length, s.over);
      const web = renderWebsiteCard({
        question: toWebsiteQuestion(q, (key) => h!.island.media.url(key)),
        twoPane: true,
        displayNumber: 1,
        zoom: 1,
        splitPct: 50,
        flagged: false,
        eliminationMode: false,
        answer: undefined,
        eliminated: [],
        sprGuideExpanded: true,
        calcReserve: 0,
        highlighterActive: false,
        ...s.web,
      });
      try {
        expect(describeDom(h.island.main).join("\n")).toBe(describeDom(web.main).join("\n"));
      } finally {
        web.unmount();
      }
    });
  }

  it("Math grid-in with a recorded fraction, directions collapsed, calculator reserve ignored", () => {
    h = mountIsland();
    loadModule(h, math, { calcReservePx: 500 });
    const i = math.questions.findIndex((q) => q.is_math_input);
    const q = math.questions[i];
    show(h, q, i, math.questions.length, { answer: "7/2" });
    // Collapse the directions column the way the student would.
    (h.island.main.querySelector('button[aria-label="Collapse directions"]') as HTMLButtonElement).click();
    const web = renderWebsiteCard({
      question: toWebsiteQuestion(q, (key) => h!.island.media.url(key)),
      twoPane: false,
      displayNumber: i + 1,
      zoom: 1,
      splitPct: 50,
      flagged: false,
      eliminationMode: false,
      answer: "7/2",
      eliminated: [],
      sprGuideExpanded: false,
      calcReserve: 500,
      highlighterActive: false,
    });
    try {
      expect(describeDom(h.island.main).join("\n")).toBe(describeDom(web.main).join("\n"));
    } finally {
      web.unmount();
    }
  });

  it("Math multiple choice with the calculator open reserves 500 px like the website", () => {
    h = mountIsland();
    loadModule(h, math, { calcReservePx: 500 });
    const i = math.questions.findIndex((q) => !q.is_math_input);
    const q = math.questions[i];
    show(h, q, i, math.questions.length);
    const web = renderWebsiteCard({
      question: toWebsiteQuestion(q, (key) => h!.island.media.url(key)),
      twoPane: false,
      displayNumber: i + 1,
      zoom: 1,
      splitPct: 50,
      flagged: false,
      eliminationMode: false,
      answer: undefined,
      eliminated: [],
      sprGuideExpanded: true,
      calcReserve: 500,
      highlighterActive: false,
    });
    try {
      expect(describeDom(h.island.main).join("\n")).toBe(describeDom(web.main).join("\n"));
    } finally {
      web.unmount();
    }
  });
});
