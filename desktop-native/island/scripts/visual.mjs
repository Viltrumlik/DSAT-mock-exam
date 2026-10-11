#!/usr/bin/env node
// Tier C picture comparison, step 2 of 2 (architecture.md §3 "Picture comparisons", §9).
//
//   npm run visual     vite build → visual/export.visual.tsx → this script
//
// For each case in test-artifacts/visual/cases.json, in Playwright's Chromium:
//   island   the BUILT island (build/island) served from https://island.mastersat.example/
//            — the WebView2 virtual host — under its production CSP, driven through a fake
//            window.chrome.webview exactly as native drives it (init, media.put, module.load,
//            question.show), then screenshotted;
//   website  the website's own components' markup (rendered by React from ../../frontend/src)
//            inside the same runner frame, styled by the website's OWN globals.css compiled
//            by Tailwind 4.2.1 over the whole frontend source (as the website's build does)
//            plus katex.min.css — then screenshotted.
// Both at the same viewport, device scale 1, reduced motion. The PNGs, a diff image per case
// and report.json land in test-artifacts/visual/ (gitignored).
//
// Also measured in real Chromium (the jsdom suite cannot): module.load and question.show
// timing, CSP violations, console errors, and the hardening a student would notice (context
// menu, selection outside the three regions, tooltips, <select>, hand cursor).
//
// Exit 1 when a case differs beyond the tolerance or the island misbehaves.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import { build } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const ISLAND = resolve(here, "..");
const ISLAND_BUILD = resolve(ISLAND, "build/island");
const OUT = resolve(ISLAND, "test-artifacts/visual");
const FRONTEND_SRC = resolve(ISLAND, "../../frontend/src");
const WEBSITE_SRC = resolve(OUT, "website-src");
const WEBSITE_BUILD = resolve(OUT, "website-build");

const ISLAND_ORIGIN = "https://island.mastersat.example";
const WEBSITE_ORIGIN = "https://website.mastersat.example";

/** The card region of a 1366×768 window (header and footer are Flutter), and a 1920 one. */
const VIEWPORTS = [
  { name: "1366", width: 1366, height: 600 },
  { name: "1920", width: 1920, height: 880 },
];
/** Share of pixels allowed to differ (pixelmatch, anti-aliasing excluded). */
const TOLERANCE = 0.001;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/** Console text can carry a whole data: URL; keep reports readable. */
const clip = (s) => (s.length > 240 ? `${s.slice(0, 240)}…` : s);

function fail(msg) {
  console.error(`visual: ${msg}`);
  process.exit(1);
}

/** The website's globals.css, compiled the way the website compiles it, into WEBSITE_BUILD. */
async function buildWebsiteCss() {
  mkdirSync(WEBSITE_SRC, { recursive: true });
  const globals = readFileSync(resolve(FRONTEND_SRC, "app/globals.css"), "utf8");
  if (!globals.includes('@import "tailwindcss";')) fail('frontend globals.css no longer starts with @import "tailwindcss"');
  // The website's build scans its whole project for class names; scan its whole source here.
  // (The frontend checkout has no node_modules, so `tailwindcss` resolves from the island's.)
  const source = relative(WEBSITE_SRC, FRONTEND_SRC).split("\\").join("/");
  writeFileSync(resolve(WEBSITE_SRC, "website.css"), globals.replace('@import "tailwindcss";', `@import "tailwindcss" source(none);\n@source "${source}";`));
  // layout.tsx's order: globals.css, then katex.min.css.
  writeFileSync(resolve(WEBSITE_SRC, "website.ts"), 'import "./website.css";\nimport "katex/dist/katex.min.css";\n');
  writeFileSync(
    resolve(WEBSITE_SRC, "website.html"),
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>website reference</title>' +
      '<script type="module" src="./website.ts"></script></head><body class="antialiased"></body></html>\n',
  );
  await build({
    configFile: false,
    logLevel: "warn",
    root: WEBSITE_SRC,
    base: "./",
    publicDir: false,
    plugins: [tailwindcss()],
    resolve: { dedupe: ["katex"] },
    build: { outDir: WEBSITE_BUILD, emptyOutDir: true, assetsDir: "", rollupOptions: { input: resolve(WEBSITE_SRC, "website.html") } },
  });
}

function serveFolder(folder) {
  return async (route) => {
    const url = new URL(route.request().url());
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const file = resolve(folder, path);
    if (!file.startsWith(folder) || !existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ status: 200, headers: { "content-type": MIME[extname(file)] ?? "application/octet-stream" }, body: readFileSync(file) });
  };
}

/** The fake WebView2 host: window.chrome.webview, plus __deliver / __toNative for the script. */
const FAKE_WEBVIEW = () => {
  const listeners = new Set();
  window.__toNative = [];
  window.__violations = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__violations.push(`${e.violatedDirective} ${String(e.blockedURI).slice(0, 80)}`));
  window.chrome = {
    webview: {
      postMessage(m) {
        window.__toNative.push(JSON.parse(JSON.stringify(m)));
      },
      addEventListener(type, l) {
        if (type === "message") listeners.add(l);
      },
      removeEventListener(type, l) {
        listeners.delete(l);
      },
    },
  };
  // PostWebMessageAsJson: the page receives the parsed object as event.data.
  window.__deliver = (m) => {
    for (const l of [...listeners]) l({ data: JSON.parse(JSON.stringify(m)) });
  };
};

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) =>
        img.complete
          ? null
          : new Promise((r) => {
              img.addEventListener("load", r, { once: true });
              img.addEventListener("error", r, { once: true });
            }),
      ),
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

async function islandPage(context, c, errors) {
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${clip(m.text())}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${clip(e.message)}`));
  await page.goto(`${ISLAND_ORIGIN}/content.html`);
  await page.waitForFunction(() => window.__toNative.some((m) => m.t === "ready"));
  for (const m of c.messages) await page.evaluate((msg) => window.__deliver({ v: 1, ...msg }), m);
  await page.waitForFunction((qid) => window.__toNative.some((m) => m.t === "question.shown" && m.qid === qid), c.qid);
  for (const a of c.actions) {
    if (a === "collapse-spr") await page.click('button[aria-label="Collapse directions"]');
  }
  await settle(page);
  return page;
}

async function websitePage(context, c, errors) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`website pageerror: ${clip(e.message)}`));
  await page.goto(`${WEBSITE_ORIGIN}/website.html`);
  // ExamRunnerPage's frame around the card region: div.ts-runner.flex.h-screen.flex-col.bg-white.
  await page.evaluate((html) => {
    document.body.innerHTML = `<div class="ts-runner flex h-screen flex-col bg-white">${html}</div>`;
  }, c.website);
  await settle(page);
  return page;
}

function compare(a, b, diffPath) {
  const A = PNG.sync.read(a);
  const B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) return { sizeMismatch: true, ratio: 1, pixels: A.width * A.height, exact: A.width * A.height };
  const diff = new PNG({ width: A.width, height: A.height });
  const pixels = pixelmatch(A.data, B.data, diff.data, A.width, A.height, { threshold: 0.1 });
  let exact = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) exact++;
  }
  writeFileSync(diffPath, PNG.sync.write(diff));
  return { pixels, exact, ratio: pixels / (A.width * A.height) };
}

/** Real-Chromium checks of the hardening and of question-switch speed, on one R&W case. */
async function behaviour(context, rwCase, errors) {
  const page = await islandPage(context, rwCase, errors);
  const out = await page.evaluate(async () => {
    const r = {};
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    document.querySelector("#ts-passage").dispatchEvent(ev);
    r.contextMenuBlocked = ev.defaultPrevented;
    r.userSelectOutside = getComputedStyle(document.querySelector('[data-island="content"] button')).userSelect;
    r.userSelectPassage = getComputedStyle(document.querySelector("#ts-passage")).userSelect;
    r.titles = document.querySelectorAll("[title]").length;
    r.selects = document.querySelectorAll("select").length;
    const choice = document.querySelector("#ts-choices button");
    r.choiceCursor = getComputedStyle(choice).cursor;
    const key = new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true });
    document.body.dispatchEvent(key);
    r.f5Blocked = key.defaultPrevented;
    const reload = new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(reload);
    r.ctrlRBlocked = reload.defaultPrevented;
    return r;
  });
  // Question switching: every question of the module, twice, as native's Next would.
  const timing = await page.evaluate(async (c) => {
    const load = c.messages.find((m) => m.t === "module.load");
    const show = c.messages.find((m) => m.t === "question.show");
    const ms = [];
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < load.questions.length; i++) {
        const q = load.questions[i];
        const t0 = performance.now();
        window.__deliver({ v: 1, ...show, qid: q.id, index: i });
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        ms.push({ reported: window.__toNative.filter((m) => m.t === "question.shown").at(-1).ms, toFrame: performance.now() - t0 });
      }
    }
    const loaded = window.__toNative.find((m) => m.t === "module.loaded");
    return { moduleLoadedMs: loaded.ms, failed: loaded.failed, switches: ms };
  }, rwCase);
  const violations = await page.evaluate(() => window.__violations);
  await page.close();
  const reported = timing.switches.map((s) => s.reported).sort((a, b) => a - b);
  const toFrame = timing.switches.map((s) => s.toFrame).sort((a, b) => a - b);
  const p95 = (xs) => xs[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)];
  return {
    ...out,
    moduleLoadedMs: timing.moduleLoadedMs,
    failed: timing.failed,
    questionShownMs: { p50: reported[Math.floor(reported.length / 2)], p95: p95(reported), max: reported.at(-1) },
    showToNextFrameMs: { p50: Math.round(toFrame[Math.floor(toFrame.length / 2)] * 10) / 10, p95: Math.round(p95(toFrame) * 10) / 10 },
    cspViolations: violations,
  };
}

async function main() {
  const casesFile = resolve(OUT, "cases.json");
  if (!existsSync(resolve(ISLAND_BUILD, "content.html"))) fail("build/island is missing — run `npm run build` first");
  if (!existsSync(casesFile)) fail("test-artifacts/visual/cases.json is missing — run `vitest run --config vitest.visual.config.ts`");
  const { cases } = JSON.parse(readFileSync(casesFile, "utf8"));

  await buildWebsiteCss();

  const browser = await chromium.launch({ headless: true });
  const report = { chromium: browser.version(), tolerance: TOLERANCE, viewports: VIEWPORTS, cases: [], behaviour: null, errors: [] };
  let failed = false;
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "light" });
      await context.route(`${ISLAND_ORIGIN}/**`, serveFolder(ISLAND_BUILD));
      await context.route(`${WEBSITE_ORIGIN}/**`, serveFolder(WEBSITE_BUILD));
      await context.addInitScript(FAKE_WEBVIEW);
      for (const c of cases) {
        const errors = [];
        const island = await islandPage(context, c, errors);
        const islandPng = await island.screenshot({ type: "png" });
        const violations = await island.evaluate(() => window.__violations);
        await island.close();
        const website = await websitePage(context, c, errors);
        const websitePng = await website.screenshot({ type: "png" });
        await website.close();
        const base = join(OUT, `${c.name}@${vp.name}`);
        writeFileSync(`${base}.island.png`, islandPng);
        writeFileSync(`${base}.website.png`, websitePng);
        const cmp = compare(islandPng, websitePng, `${base}.diff.png`);
        const ok = !cmp.sizeMismatch && cmp.ratio <= TOLERANCE && errors.length === 0 && violations.length === 0;
        if (!ok) failed = true;
        report.cases.push({ name: c.name, viewport: vp.name, about: c.about, ok, differingPixels: cmp.pixels, exactlyDifferentPixels: cmp.exact, ratio: cmp.ratio, errors, cspViolations: violations });
        console.log(
          `${ok ? "ok  " : "FAIL"} ${c.name}@${vp.name}: ${cmp.pixels} px differ (pixelmatch), ${cmp.exact} px not byte-identical${errors.length ? `; errors: ${errors.join(" | ")}` : ""}${violations.length ? `; CSP: ${violations.join(" | ")}` : ""}`,
        );
      }
      if (vp.name === "1366") {
        const errors = [];
        const rw = cases.find((c) => c.name === "rw-passage");
        report.behaviour = await behaviour(context, rw, errors);
        report.errors.push(...errors);
        const b = report.behaviour;
        const hardened = b.contextMenuBlocked && b.userSelectOutside === "none" && b.userSelectPassage === "text" && b.titles === 0 && b.selects === 0 && b.choiceCursor === "default" && b.f5Blocked && b.ctrlRBlocked;
        if (!hardened || b.cspViolations.length || errors.length || b.failed.length) failed = true;
        console.log(`${hardened ? "ok  " : "FAIL"} hardening in Chromium: ${JSON.stringify({ ...b, questionShownMs: undefined, showToNextFrameMs: undefined })}`);
        console.log(`info module.load ${b.moduleLoadedMs} ms; question.show reported p50 ${b.questionShownMs.p50} / p95 ${b.questionShownMs.p95} ms; to next frame p95 ${b.showToNextFrameMs.p95} ms`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`visual: ${report.cases.filter((c) => c.ok).length}/${report.cases.length} cases match; screenshots in ${relative(process.cwd(), OUT)}`);
  if (failed) process.exit(1);
}

await main();
