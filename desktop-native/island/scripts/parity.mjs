#!/usr/bin/env node
// Website parity guard (architecture.md §3 "Reusing website code in the island").
//
//   node scripts/parity.mjs check    exit 1 when a website source changed since its port was
//                                    reviewed (git blob hash differs), when a port lost the
//                                    header naming its source, or when runner.generated.css
//                                    is stale
//   node scripts/parity.mjs update   record the current blob hashes (after re-reviewing!)
//
// parity-manifest.json lists every website file the island imports, ports, copies CSS from,
// or runs tests from, with `git hash-object` of the reviewed version.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generate } from "./runner-css.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ISLAND = resolve(here, "..");
const MANIFEST = resolve(ISLAND, "parity-manifest.json");

export function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST, "utf8"));
}

export function repoRoot(manifest) {
  return resolve(ISLAND, manifest.repo_root);
}

export function blobOf(root, path) {
  return execFileSync("git", ["hash-object", "--", resolve(root, path)], { cwd: root, encoding: "utf8" }).trim();
}

/** Problems for the manifest as it stands (empty when everything matches). */
export function checkManifest(manifest) {
  const root = repoRoot(manifest);
  const problems = [];
  for (const s of manifest.sources) {
    const abs = resolve(root, s.path);
    if (!existsSync(abs)) {
      problems.push(`${s.path}: missing (the island ${s.use === "test" ? "runs" : s.use === "imported" ? "imports" : "ports"} it)`);
      continue;
    }
    const blob = blobOf(root, s.path);
    if (blob !== s.blob) {
      problems.push(
        `${s.path}: changed (reviewed ${s.blob.slice(0, 10)}, now ${blob.slice(0, 10)}) — re-review ${(s.island ?? []).join(", ") || "its use"}, then \`npm run parity:update\``,
      );
    }
    if (s.use === "ported") {
      for (const file of s.island ?? []) {
        const islandFile = resolve(ISLAND, file);
        if (!existsSync(islandFile)) {
          problems.push(`${file}: missing (port of ${s.path})`);
          continue;
        }
        const head = readFileSync(islandFile, "utf8").split("\n").slice(0, 30).join("\n");
        if (!head.includes(basename(s.path))) problems.push(`${file}: header no longer names its website source ${basename(s.path)}`);
      }
    }
  }
  return problems;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2] ?? "check";
  const manifest = loadManifest();
  const root = repoRoot(manifest);
  if (cmd === "update") {
    for (const s of manifest.sources) s.blob = blobOf(root, s.path);
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`parity: recorded ${manifest.sources.length} blob hashes`);
  } else if (cmd === "check") {
    const problems = checkManifest(manifest);
    const css = resolve(ISLAND, "src/content/runner.generated.css");
    const fresh = generate(readFileSync(resolve(root, "frontend/src/app/globals.css"), "utf8"));
    if (!existsSync(css) || readFileSync(css, "utf8") !== fresh) problems.push("src/content/runner.generated.css is stale — run `node scripts/runner-css.mjs`");
    if (problems.length) {
      console.error(`parity: ${problems.length} website change(s) need review`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`parity: OK — ${manifest.sources.length} website sources match their reviewed versions`);
  } else {
    console.error("usage: parity.mjs check|update");
    process.exit(2);
  }
}
