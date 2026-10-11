// Tier C picture comparison, step 1 of 2 (architecture.md §3 "Picture comparisons", §9).
//
// For every case below this writes, into test-artifacts/visual/cases.json:
//   * `messages`: what native sends the content island for that screen (init, media.put …,
//     module.load, question.show) — scripts/visual.mjs replays them into the BUILT island,
//     loaded from https://island.mastersat.example/ under its real CSP, in Chromium;
//   * `website`: the WEBSITE's own React components (../../frontend/src, via @website) rendered
//     over the same fixture question, composed as ExamRunnerPage's <main> — the reference,
//     which scripts/visual.mjs shows with the website's own globals.css compiled by Tailwind
//     over the whole frontend source, exactly as the website's build does.
//
// Run with `npm run visual` (this file alone: vitest run --config vitest.visual.config.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { IslandAnnotationSet, IslandQuestion } from "../src/protocol";
import { applyAnnotations, type Annotation } from "../src/website";
import { fixtureMedia, fixtureModules, type FixtureModule } from "../test/helpers";
import { renderWebsiteCard, toWebsiteQuestion, type WebsiteCardProps } from "../test/websiteRender";

const here = dirname(fileURLToPath(import.meta.url));
export const VISUAL_OUT = resolve(here, "../test-artifacts/visual");

interface VisualCase {
  name: string;
  /** What the screenshot shows (for the report). */
  about: string;
  module: (m: FixtureModule) => boolean;
  qid: number;
  init?: Partial<{ zoom: number; split: number; highlighterOn: boolean; eliminatorOn: boolean; calcReservePx: number }>;
  show?: Partial<{ answer: string | null; eliminated: string[]; flagged: boolean; annotations: IslandAnnotationSet }>;
  /** Island-side clicks after question.show (scripts/visual.mjs performs them). */
  actions?: Array<"collapse-spr">;
  web?: Partial<WebsiteCardProps>;
}

const rwModule = (m: FixtureModule) => m.source === "pastpaper_open.response.resume.json#modules[0]";
const mathModule = (m: FixtureModule) => m.source === "pastpaper_open.response.json#modules[0]";
const mathModule2 = (m: FixtureModule) => m.source === "pastpaper_open.response.json#modules[1]";

const passageMarks: Annotation[] = [
  { start: 4, end: 31, kind: "highlight", color: "yellow" },
  { start: 60, end: 92, kind: "highlight", color: "blue" },
  { start: 70, end: 120, kind: "underline", underline: "dashed" },
  { start: 150, end: 178, kind: "highlight", color: "pink" },
  { start: 150, end: 178, kind: "underline", underline: "solid" },
];
const questionMarks: Annotation[] = [{ start: 0, end: 12, kind: "underline", underline: "dotted" }];
const choiceMarks: Annotation[] = [{ start: 2, end: 14, kind: "highlight", color: "yellow" }];

export const CASES: VisualCase[] = [
  { name: "rw-passage", about: "R&W: passage + divider + header band + choices, nothing chosen", module: rwModule, qid: 2001 },
  {
    name: "rw-answered-eliminator",
    about: "R&W with <u>: B chosen, flagged, eliminator on, C crossed out (Undo shown)",
    module: rwModule,
    qid: 2003,
    init: { eliminatorOn: true },
    show: { answer: "B", flagged: true, eliminated: ["C"] },
    web: { answer: "B", flagged: true, eliminationMode: true, eliminated: ["C"] },
  },
  {
    name: "rw-table-zoom",
    about: "R&W table passage at zoom 1.2 with the divider dragged to 60 %",
    module: rwModule,
    qid: 2004,
    init: { zoom: 1.2, split: 0.6 },
    web: { zoom: 1.2, splitPct: 60 },
  },
  {
    name: "rw-annotated",
    about: "R&W with highlighter on: yellow/blue/pink highlights, dashed/solid/dotted underlines in all three regions",
    module: rwModule,
    qid: 2002,
    init: { highlighterOn: true },
    show: { annotations: { passage: passageMarks, question: questionMarks, choices: choiceMarks } },
    web: { highlighterActive: true },
  },
  { name: "rw-figure", about: "R&W passage with a figure", module: rwModule, qid: 2006 },
  { name: "math-mc-figure", about: "Math multiple choice with inline LaTeX and a figure", module: mathModule, qid: 1004 },
  { name: "math-table", about: "Math stem with a table and LaTeX", module: mathModule, qid: 1003 },
  {
    name: "math-option-images",
    about: "Math with image options, A chosen",
    module: mathModule,
    qid: 1006,
    show: { answer: "A" },
    web: { answer: "A" },
  },
  {
    name: "math-spr",
    about: "Math grid-in: directions column expanded, 7/2 recorded as a stacked fraction",
    module: mathModule,
    qid: 1002,
    show: { answer: "7/2" },
    web: { answer: "7/2" },
  },
  {
    name: "math-spr-collapsed",
    about: "Math grid-in with the directions column collapsed to its rail, -1.25 typed",
    module: mathModule2,
    qid: 1011,
    show: { answer: "-1.25" },
    actions: ["collapse-spr"],
    web: { answer: "-1.25", sprGuideExpanded: false },
  },
  {
    name: "math-calc-reserve",
    about: "Math multiple choice with the calculator open (500 px reserved on the left)",
    module: mathModule,
    qid: 1001,
    init: { calcReservePx: 500 },
    web: { calcReserve: 500 },
  },
];

const EMPTY_SET: IslandAnnotationSet = { passage: [], question: [], choices: [] };

describe("visual cases", () => {
  const modules = fixtureModules();
  const media = fixtureMedia();
  const dataUrl = new Map(media.map((m) => [m.key, `data:image/png;base64,${m.b64}`]));

  it("exports every case", () => {
    const out: unknown[] = [];
    for (const c of CASES) {
      const m = modules.find(c.module);
      expect(m, `${c.name}: module`).toBeDefined();
      const index = m!.questions.findIndex((q: IslandQuestion) => q.id === c.qid);
      expect(index, `${c.name}: question ${c.qid}`).toBeGreaterThanOrEqual(0);
      const q = m!.questions[index];
      const init = {
        t: "init",
        mode: "exam",
        kind: "pastpaper",
        subject: m!.subject,
        overlays: "native",
        zoom: 1,
        split: 0.5,
        highlighterOn: false,
        eliminatorOn: false,
        calcReservePx: 0,
        ...c.init,
      };
      const annotations = c.show?.annotations ?? EMPTY_SET;
      const show = {
        t: "question.show",
        qid: q.id,
        index,
        total: m!.questions.length,
        answer: null,
        eliminated: [],
        flagged: false,
        ...c.show,
        annotations,
      };
      const messages = [
        init,
        ...media.map(({ key, b64 }) => ({ t: "media.put", key, mime: "image/png", b64 })),
        { t: "module.load", moduleId: m!.moduleId, questions: m!.questions },
        show,
      ];

      const web = renderWebsiteCard({
        question: toWebsiteQuestion(q, (key) => dataUrl.get(key)),
        twoPane: m!.subject === "rw",
        displayNumber: index + 1,
        zoom: 1,
        splitPct: 50,
        flagged: false,
        eliminationMode: false,
        answer: undefined,
        eliminated: [],
        sprGuideExpanded: true,
        calcReserve: 0,
        highlighterActive: false,
        ...c.web,
      });
      try {
        // The website's useAnnotator paints each region with applyAnnotations after mount.
        for (const [key, id] of [["passage", "#ts-passage"], ["question", "#ts-question"], ["choices", "#ts-choices"]] as const) {
          const list = annotations[key];
          const el = web.main.querySelector<HTMLElement>(id);
          if (el && list.length) applyAnnotations(el, list.map((a) => ({ ...a })));
        }
        out.push({ name: c.name, about: c.about, qid: q.id, subject: m!.subject, messages, actions: c.actions ?? [], website: web.main.outerHTML });
      } finally {
        web.unmount();
      }
    }
    mkdirSync(VISUAL_OUT, { recursive: true });
    writeFileSync(resolve(VISUAL_OUT, "cases.json"), JSON.stringify({ generated: new Date().toISOString(), cases: out }));
    expect(out).toHaveLength(CASES.length);
  });
});
