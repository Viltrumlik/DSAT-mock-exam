// Shared test helpers: the contracts/v1 fixtures, an in-memory host, and the island under test.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ContentIsland } from "../src/content/island";
import type { IslandQuestion, NativeToContent } from "../src/protocol";
import { PROTOCOL_VERSION, validateMessage } from "../src/protocol";
import { memoryTransport, type MemoryTransport } from "../src/transport";

const here = dirname(fileURLToPath(import.meta.url));
export const CONTRACTS = resolve(here, "../../contracts/v1");
export const EXAMPLES = resolve(here, "../protocol/examples");

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(resolve(CONTRACTS, name), "utf8")) as T;
}

export function example<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(resolve(EXAMPLES, name), "utf8")) as T;
}

export interface FixtureModule {
  /** e.g. "pastpaper_open.response.resume.json#modules[1]" */
  source: string;
  moduleId: number;
  subject: "rw" | "math";
  questions: IslandQuestion[];
}

type AnyModule = { id?: number; module_id?: number; questions?: IslandQuestion[] | null };

/** Every module of questions in contracts/v1 (deduplicated by content). */
export function fixtureModules(): FixtureModule[] {
  const out: FixtureModule[] = [];
  const seen = new Set<string>();
  const push = (source: string, moduleId: number, questions: IslandQuestion[] | null | undefined) => {
    if (!questions || questions.length === 0) return;
    const key = JSON.stringify(questions);
    if (seen.has(key)) return;
    seen.add(key);
    const subject = questions.every((q) => q.question_type === "MATH") ? "math" : "rw";
    out.push({ source, moduleId, subject, questions });
  };
  const opens = ["pastpaper_open.response.json", "pastpaper_open.response.resume.json", "pastpaper_open.response.deferred.json", "midterm_open.response.json"];
  for (const f of opens) {
    const d = fixture<{ modules: AnyModule[] }>(f);
    d.modules.forEach((m, i) => push(`${f}#modules[${i}]`, m.id ?? 0, m.questions));
  }
  for (const f of ["midterm_submit.response.json", "pastpaper_submit.response.deferred.json"]) {
    const d = fixture<{ next_module: AnyModule | null }>(f);
    if (d.next_module) push(`${f}#next_module`, d.next_module.id ?? 0, d.next_module.questions);
  }
  const result = fixture<{ content: Record<string, { questions: IslandQuestion[] | null }> }>("pastpaper_result.response.completed.json");
  for (const [mid, c] of Object.entries(result.content)) push(`pastpaper_result.response.completed.json#content.${mid}`, Number(mid), c.questions);
  return out;
}

/** Every distinct media key the fixtures name, with its PNG as base64. */
export function fixtureMedia(): Array<{ key: string; b64: string }> {
  const keys = new Set<string>();
  for (const m of fixtureModules()) {
    for (const q of m.questions) {
      if (q.question_image_key) keys.add(q.question_image_key);
      for (const o of Object.values(q.options ?? {})) if (o.image_key) keys.add(o.image_key);
    }
  }
  return [...keys].map((key) => {
    const path = resolve(CONTRACTS, "media", key);
    if (!existsSync(path)) throw new Error(`fixture media missing: ${key}`);
    return { key, b64: readFileSync(path).toString("base64") };
  });
}

export interface Harness {
  island: ContentIsland;
  transport: MemoryTransport;
  /** Deliver a native → island message (adds `v`). */
  deliver(m: Record<string, unknown>): void;
  /** Island → native messages so far (validated JSON). */
  sent(): Array<Record<string, unknown>>;
  sentOf(t: string): Array<Record<string, unknown>>;
  last(t: string): Record<string, unknown> | undefined;
  clear(): void;
  stop(): void;
}

export function mountIsland(): Harness {
  document.body.replaceChildren();
  const transport = memoryTransport();
  const island = new ContentIsland(transport, { build: "island/test" });
  island.start();
  const sent = () => transport.sent as Array<Record<string, unknown>>;
  return {
    island,
    transport,
    deliver(m) {
      transport.deliver({ v: PROTOCOL_VERSION, ...m });
    },
    sent,
    sentOf: (t) => sent().filter((m) => m.t === t),
    last: (t) => sent().filter((m) => m.t === t).at(-1),
    clear: () => transport.clear(),
    stop: () => island.stop(),
  };
}

export function init(h: Harness, over: Partial<Record<string, unknown>> = {}): void {
  h.deliver({ t: "init", mode: "exam", kind: "pastpaper", subject: "rw", overlays: "native", zoom: 1, split: 0.5, highlighterOn: false, eliminatorOn: false, calcReservePx: 0, ...over });
}

export function show(h: Harness, q: IslandQuestion, index: number, total: number, over: Partial<Record<string, unknown>> = {}): void {
  h.deliver({ t: "question.show", qid: q.id, index, total, answer: null, eliminated: [], flagged: false, annotations: { passage: [], question: [], choices: [] }, ...over });
}

/** Load a fixture module (init + media + module.load) and return its questions. */
export function loadModule(h: Harness, m: FixtureModule, initOver: Partial<Record<string, unknown>> = {}): IslandQuestion[] {
  init(h, { subject: m.subject, ...initOver });
  for (const { key, b64 } of fixtureMedia()) h.deliver({ t: "media.put", key, mime: "image/png", b64 });
  h.deliver({ t: "module.load", moduleId: m.moduleId, questions: m.questions });
  return m.questions;
}

export function rwModule(): FixtureModule {
  return fixtureModules().find((m) => m.subject === "rw")!;
}

export function mathModule(): FixtureModule {
  return fixtureModules().find((m) => m.subject === "math")!;
}

/** Every island → native message must satisfy the schema (the channel guarantees it; re-check). */
export function assertAllValid(h: Harness): void {
  for (const m of h.sent()) {
    const reason = validateMessage(m, { direction: "to_native", island: "content" });
    if (reason) throw new Error(`invalid outgoing ${String(m.t)}: ${reason}`);
  }
}

export type { NativeToContent };
