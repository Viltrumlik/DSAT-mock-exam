#!/usr/bin/env node
// Bundle audit for Next 16 (no app-build-manifest.json / no stdout size table).
// Parses prerendered .next/server/app/*.html for static/chunks/*.js references,
// sizes them on disk, computes a shared baseline (chunks common to all routes)
// and per-route First Load JS. Also reports which chunks contain recharts.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const NEXT = join(root, ".next");
const SERVER_APP = join(NEXT, "server", "app");
const STATIC_CHUNKS = join(NEXT, "static", "chunks");

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function sizeOf(chunkRef) {
  // chunkRef like "static/chunks/abc.js"
  const p = join(NEXT, chunkRef);
  try { return statSync(p).size; } catch { return 0; }
}

const CHUNK_RE = /static\/chunks\/[A-Za-z0-9_./-]+?\.js/g;

// Map route -> set of chunk refs
const htmlFiles = walk(SERVER_APP).filter((f) => f.endsWith(".html"));
const routes = {};
for (const f of htmlFiles) {
  const html = readFileSync(f, "utf8");
  const refs = new Set();
  let m;
  while ((m = CHUNK_RE.exec(html))) refs.add(m[0]);
  const route = "/" + relative(SERVER_APP, f).replace(/\.html$/, "");
  routes[route] = refs;
}

// Shared baseline = chunks present in EVERY route
const routeNames = Object.keys(routes);
let shared = null;
for (const r of routeNames) {
  if (shared === null) shared = new Set(routes[r]);
  else shared = new Set([...shared].filter((c) => routes[r].has(c)));
}
shared = shared || new Set();
const sharedSize = [...shared].reduce((s, c) => s + sizeOf(c), 0);

// Identify recharts-bearing chunks by scanning chunk file contents
const allChunkFiles = existsSync(STATIC_CHUNKS)
  ? walk(STATIC_CHUNKS).filter((f) => f.endsWith(".js"))
  : [];
const rechartsChunks = [];
for (const f of allChunkFiles) {
  let txt = "";
  try { txt = readFileSync(f, "utf8"); } catch { continue; }
  // recharts fingerprints (library-internal strings unlikely elsewhere)
  if (txt.includes("recharts") || /generateCategoricalChart|ResponsiveContainer/.test(txt)) {
    rechartsChunks.push({ ref: "static/chunks/" + relative(STATIC_CHUNKS, f), size: statSync(f).size });
  }
}

const kb = (b) => (b / 1024).toFixed(0) + "K";
const mb = (b) => (b / 1024 / 1024).toFixed(2) + "MB";

console.log("=== SHARED BASELINE (chunks in every route) ===");
console.log(`  ${shared.size} chunks, ${mb(sharedSize)}`);

console.log("\n=== RECHARTS CHUNKS (contain recharts code) ===");
if (!rechartsChunks.length) console.log("  (none)");
for (const c of rechartsChunks.sort((a, b) => b.size - a.size)) {
  // which routes load it
  const loaders = routeNames.filter((r) => routes[r].has(c.ref));
  console.log(`  ${c.ref}  ${kb(c.size)}  ← ${loaders.length} route(s): ${loaders.join(", ") || "(async/none-prerendered)"}`);
}
console.log(`  recharts chunk count = ${rechartsChunks.length}`);

console.log("\n=== PER-ROUTE FIRST LOAD JS (uncompressed) ===");
const rows = routeNames.map((r) => {
  const total = [...routes[r]].reduce((s, c) => s + sizeOf(c), 0);
  const loadsRecharts = [...routes[r]].some((c) => rechartsChunks.find((x) => x.ref === c));
  return { r, total, loadsRecharts };
}).sort((a, b) => b.total - a.total);
for (const row of rows) {
  console.log(`  ${mb(row.total).padStart(8)}  ${row.loadsRecharts ? "[recharts] " : "           "}${row.r}`);
}
