#!/usr/bin/env node
// Smoke test of the dev harness (dev.html) in real Chromium, on Vite's dev server:
//
//   npm run dev:smoke
//
// Opens the harness, waits for the island's handshake, then does what a developer would:
// answers, moves on with a key pressed inside the island, highlights with the native
// toolbar, switches to Math, and opens the calculator (Desmos is blocked here, so the
// island must report desmos.failed — the network is never used). Saves
// test-artifacts/dev-harness.png. Exit 1 on any failed step or page error.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const ISLAND = resolve(here, "..");
const OUT = resolve(ISLAND, "test-artifacts");

const server = await createServer({ configFile: resolve(ISLAND, "vite.config.ts"), root: ISLAND, logLevel: "error", server: { port: 0, host: "127.0.0.1" } });
await server.listen();
const address = server.httpServer.address();
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
const steps = [];
const step = (name, ok, detail = "") => {
  steps.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: "reduce" });
  await context.route("https://www.desmos.com/**", (route) => route.abort());
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // The blocked Desmos script is expected to fail; anything else is a real error.
    if (m.type() === "error" && !`${m.text()} ${m.location().url}`.includes("desmos.com")) errors.push(m.text());
  });
  await page.goto(`${base}/dev.html`);
  await page.waitForFunction(() => window.__harness?.native.timings.some((t) => t.kind === "question.shown"), null, { timeout: 30000 });
  const status = await page.textContent("#status");
  step("handshake: the first question is on screen", /Question 1 of \d+/.test(status ?? ""), status ?? "");

  const frame = page.frameLocator("#content");
  await frame.locator("#ts-choices button[aria-pressed]").nth(2).click();
  await page.waitForFunction(() => {
    const h = window.__harness.native;
    return h.answers.get(h.current.id) === "C";
  });
  step("a click in the island is accepted by native", true);

  await frame.locator("#ts-question").click();
  await page.frames()[1].press("body", "ArrowRight");
  await page.waitForFunction(() => window.__harness.native.index === 1);
  step("→ pressed inside the island moves to question 2", true);

  await page.click("text=Highlights");
  // view.set travels by postMessage: wait until the island has turned the highlighter on.
  await frame.locator("main.ts-annotating").waitFor();
  await page.evaluate(() => {
    const doc = document.querySelector("#content").contentDocument;
    const passage = doc.querySelector("#ts-passage");
    const walker = doc.createTreeWalker(passage, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && node.length < 12) node = walker.nextNode();
    const range = doc.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 12);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    passage.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.waitForSelector("#toolbar:not([hidden])");
  await page.click('#toolbar button[aria-label="blue highlight"]');
  await page.waitForFunction(() => {
    const h = window.__harness.native;
    return h.annotations.get(h.current.id)?.passage?.[0]?.color === "blue";
  });
  const marks = await frame.locator("#ts-passage mark.ts-annot").count();
  step("select → yellow on release → recoloured blue from the native toolbar", marks > 0, `${marks} mark(s)`);
  await page.screenshot({ path: resolve(OUT, "dev-harness.png") });

  await page.click("text=Math 301");
  await page.waitForFunction(() => window.__harness.native.module.moduleId === 301 && window.__harness.native.timings.filter((t) => t.kind === "module.loaded").length >= 2);
  const katex = await frame.locator("#ts-question .katex").count();
  step("switching to a Math module renders KaTeX", katex > 0, `${katex} formula(s)`);

  await page.click("text=Calculator");
  await page.waitForFunction(() => /failed|ready/.test(document.querySelector("#desmos-head")?.textContent ?? ""), null, { timeout: 15000 });
  const head = await page.textContent("#desmos-head");
  step("Desmos blocked → the island reports desmos.failed", /failed: (script|offline)/.test(head ?? ""), head ?? "");
  await page.screenshot({ path: resolve(OUT, "dev-harness-math.png") });

  const bad = await page.$$eval("#log .bad", (rows) => rows.map((r) => r.textContent));
  step("every message in the log is on-schema", bad.length === 0, bad.join(" | "));
  step("no page errors", errors.length === 0, errors.join(" | "));
} catch (err) {
  step("harness run", false, String(err));
} finally {
  await browser.close();
  await server.close();
}
mkdirSync(OUT, { recursive: true });
const failed = steps.filter((s) => !s.ok).length;
console.log(`dev-smoke: ${steps.length - failed}/${steps.length} steps passed; screenshots in test-artifacts/`);
process.exit(failed ? 1 : 0);
