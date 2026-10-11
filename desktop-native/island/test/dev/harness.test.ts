// End to end in jsdom: the content island and the dev harness's FakeNative talking through an
// asynchronous transport (as WebView2 is), over the contracts/v1 fixtures.
import { afterEach, describe, expect, it } from "vitest";

import { ContentIsland } from "../../src/content/island";
import { FakeNative, type DevModule } from "../../src/dev/fakeNative";
import { DEV_FIXTURE_FILES, devModulesFrom, mediaKeysOf } from "../../src/dev/fixtures";
import type { IslandTransport } from "../../src/transport";
import { fixture, fixtureMedia } from "../helpers";

const flush = () => new Promise((r) => setTimeout(r, 0));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let island: ContentIsland | null = null;
afterEach(() => {
  island?.stop();
  island = null;
  document.body.replaceChildren();
});

function modules(): DevModule[] {
  const files: Record<string, Record<string, unknown>> = {};
  for (const f of DEV_FIXTURE_FILES) files[f] = fixture(f);
  return devModulesFrom(files);
}

async function connect(module: DevModule) {
  const islandSinks = new Set<(d: unknown) => void>();
  const traffic: Array<{ direction: string; t: unknown; problem: string | null }> = [];
  const media = fixtureMedia().map((m) => ({ ...m, mime: "image/png" as const }));
  const native = new FakeNative((m) => queueMicrotask(() => islandSinks.forEach((s) => s(clone(m)))), media, {
    onTraffic: (direction, m, problem) => traffic.push({ direction, t: m.t, problem }),
  });
  native.load(module);
  const transport: IslandTransport = {
    name: "memory",
    send: (m) => queueMicrotask(() => native.receive(clone(m))),
    listen: (cb) => {
      islandSinks.add(cb);
      return () => islandSinks.delete(cb);
    },
  };
  island = new ContentIsland(transport, { build: "island/test" });
  island.start();
  await flush();
  return { native, island, traffic };
}

const choice = (key: string) => [...document.querySelectorAll<HTMLButtonElement>("#ts-choices button[aria-pressed]")].find((b) => b.firstElementChild?.textContent === key)!;

describe("dev fixtures", () => {
  it("offers every fixture module, with the resume bundle's saved answers, flags and highlights", () => {
    const all = modules();
    expect(all.length).toBeGreaterThanOrEqual(7);
    const resume = all.find((m) => m.source === "pastpaper_open.response.resume.json#modules[0]")!;
    expect(resume.subject).toBe("rw");
    expect(resume.answers).toEqual({ 2001: "B", 2002: "A", 2004: "B" });
    expect(resume.flagged).toEqual([2003]);
    expect(resume.annotations[2001]?.passage).toHaveLength(2);
    const review = all.find((m) => m.source.startsWith("pastpaper_result"))!;
    expect(review.review[1001]).toEqual({ correct: "B", studentAnswer: "B", isCorrect: true });
    expect(mediaKeysOf(all).length).toBeGreaterThan(0);
  });
});

describe("island ⇄ FakeNative", () => {
  it("handshake: ready → init, media, module.load, question.show; all traffic on-schema", async () => {
    const { native, traffic } = await connect(modules()[0]);
    expect(native.ready).toBe(true);
    expect(traffic.map((x) => x.t)).toEqual(expect.arrayContaining(["ready", "init", "media.put", "module.load", "question.show", "module.loaded", "question.shown"]));
    expect(traffic.filter((x) => x.problem)).toEqual([]);
    expect(native.timings.map((t) => t.kind)).toEqual(["module.loaded", "question.shown"]);
    // The resume bundle's saved answer and highlights are on screen.
    expect(choice("B").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll("#ts-passage mark.ts-annot").length).toBeGreaterThan(0);
  });

  it("a click is accepted by native and echoed; keys from the island navigate and answer", async () => {
    const { native, traffic } = await connect(modules()[0]);
    const q = native.current!;
    choice("C").click();
    await flush();
    expect(native.answers.get(q.id)).toBe("C");
    expect(choice("C").getAttribute("aria-pressed")).toBe("true");

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    await flush();
    expect(native.index).toBe(1);
    expect(document.querySelector("span.bg-\\[\\#151515\\]")!.textContent).toBe("2");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true, cancelable: true }));
    await flush();
    expect(native.answers.get(native.current!.id)).toBe("D");
    expect(choice("D").getAttribute("aria-pressed")).toBe("true");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true }));
    await flush();
    expect(native.flagged.has(native.current!.id)).toBe(true);
    expect(traffic.filter((x) => x.problem)).toEqual([]);
  });

  it("a highlight made in the island is stored by native and comes back on return", async () => {
    const { native } = await connect(modules()[1]); // the second R&W module: no saved marks
    native.setView({ highlighterOn: true });
    await flush();
    const passage = document.querySelector<HTMLElement>("#ts-passage")!;
    const text = passage.querySelector("p")?.firstChild ?? passage.querySelector("div")!.firstChild!;
    const words = (text as Text).data.slice(0, 8);
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 8);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    passage.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await flush();
    const qid = native.current!.id;
    expect(native.annotations.get(qid)?.passage).toEqual([{ start: 0, end: 8, kind: "highlight", color: "yellow" }]);
    native.next();
    await flush();
    native.back();
    await flush();
    expect(document.querySelector("#ts-passage mark.ts-annot")?.textContent).toBe(words);
  });

  it("review mode shows the result's correct answers", async () => {
    const review = modules().find((m) => m.source.startsWith("pastpaper_result") && m.questions.some((q) => !q.is_math_input))!;
    const { native } = await connect(review);
    native.setView({ mode: "review" });
    await flush();
    const q = native.current!;
    const info = review.review[q.id];
    expect(choice(info.correct).className).toContain("border-emerald-500");
  });
});
