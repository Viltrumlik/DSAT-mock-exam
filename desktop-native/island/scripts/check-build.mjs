#!/usr/bin/env node
// Post-build checks on build/island (run by `npm run build`). WebView2 serves this folder from
// https://island.mastersat.example/ with only that host, blob: and data: allowed (and the
// Desmos hosts for desmos.html), so the output must be self-contained and relative.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../build/island");
const problems = [];
const fail = (msg) => problems.push(msg);

if (!existsSync(OUT)) {
  console.error(`check-build: ${OUT} does not exist — run vite build first`);
  process.exit(1);
}

const files = readdirSync(OUT);
for (const page of ["content.html", "desmos.html"]) {
  if (!files.includes(page)) {
    fail(`${page} missing`);
    continue;
  }
  const html = readFileSync(join(OUT, page), "utf8");
  if (!/<meta http-equiv="Content-Security-Policy" content="default-src 'none';/.test(html)) fail(`${page}: no CSP meta`);
  if (html.includes("<!--island:csp-->")) fail(`${page}: CSP placeholder left in`);
  for (const m of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
    const url = m[1];
    if (!url.startsWith("./")) fail(`${page}: non-relative asset URL ${url}`);
  }
  if (/src="\.\/src\//.test(html)) fail(`${page}: still points at source files`);
  // Desmos's calculator.js evaluates generated code; without 'unsafe-eval' it never loads and
  // native silently swaps in its own calculator for both tabs (2026-10-12). Question content
  // must never get eval.
  const scriptSrc = (html.match(/script-src([^;"]*)/) ?? [])[1] ?? "";
  if (page === "desmos.html" && !scriptSrc.includes("'unsafe-eval'")) fail("desmos.html: CSP script-src must allow 'unsafe-eval' (Desmos needs it)");
  if (page === "content.html" && scriptSrc.includes("'unsafe-eval'")) fail("content.html: CSP must not allow 'unsafe-eval'");
}

// The dev harness never ships.
if (files.includes("dev.html")) fail("dev.html is in the build (dev only)");

const js = files.filter((f) => f.endsWith(".js"));
const css = files.filter((f) => f.endsWith(".css"));
if (js.length === 0) fail("no JavaScript emitted");
if (css.length === 0) fail("no CSS emitted");

for (const f of js) {
  const src = readFileSync(join(OUT, f), "utf8");
  // React must never reach the island (the website's MathText.tsx is shimmed).
  if (src.includes("react.transitional.element") || src.includes("__CLIENT_INTERNALS") || src.includes("react-dom")) {
    fail(`${f}: React leaked into the bundle`);
  }
  // No dev server or network code.
  if (src.includes("new WebSocket") || src.includes("/@vite/client")) fail(`${f}: dev-server code in the bundle`);
  if (/(?<![.\w$])fetch\((?!\)\{)/.test(src) || src.includes("XMLHttpRequest")) fail(`${f}: network call in the bundle`);
  if (src.includes("__DESMOS_API_KEY__") || src.includes("__ISLAND_BUILD__")) fail(`${f}: unreplaced build constant`);
  if (src.includes("process.env")) fail(`${f}: process.env left in the bundle`);
  if (src.includes("FakeNative") || src.includes("ms-island harness")) fail(`${f}: dev harness code in the bundle`);
}

for (const f of css) {
  const src = readFileSync(join(OUT, f), "utf8");
  for (const m of src.matchAll(/url\(([^)]+)\)/g)) {
    const url = m[1].replace(/["']/g, "");
    // font-src 'self' (content CSP): an inlined font would be blocked at runtime.
    if (url.startsWith("data:font") || url.startsWith("data:application/font")) fail(`${f}: font inlined as a data: URL (the CSP blocks it)`);
    if (url.startsWith("data:")) continue;
    if (/^(?:https?:)?\/\//.test(url) || url.startsWith("/")) fail(`${f}: non-relative url(${url})`);
    if (!existsSync(join(OUT, url.replace(/^\.\//, "").split(/[?#]/)[0]))) fail(`${f}: url(${url}) not in the build`);
  }
}

const content = readFileSync(join(OUT, "content.html"), "utf8");
if (!content.includes("img-src blob: data:")) fail("content.html: CSP must allow only blob:/data: images");
if (content.includes("desmos.com")) fail("content.html: the content island must not allow Desmos hosts");
const desmosJs = js.map((f) => readFileSync(join(OUT, f), "utf8")).join("\n");
if (!desmosJs.includes("www.desmos.com/api/v")) fail("desmos bundle: Desmos script URL missing");

let total = 0;
for (const f of files) total += statSync(join(OUT, f)).size;

if (problems.length) {
  console.error(`check-build: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check-build: OK — ${files.length} files, ${(total / 1024).toFixed(0)} KiB in build/island`);
