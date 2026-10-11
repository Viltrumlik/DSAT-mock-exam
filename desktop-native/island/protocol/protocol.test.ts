// Protocol examples validate (and invalid ones are rejected) by the generated TS validator.
// Run: node --test desktop-native/island/protocol/protocol.test.ts   (Node >= 22.18 strips types)
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  PROTOCOL_SCHEMA,
  PROTOCOL_SCHEMA_JSON,
  isAnswerChooseMessage,
  isToNativeMessage,
  isToWebMessage,
  validateMessage,
} from "../src/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "examples");

function load(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const valid = readdirSync(examples).filter((f) => f.endsWith(".json"));
const invalid = readdirSync(join(examples, "invalid")).filter((f) => f.endsWith(".json"));

test("embedded schema equals schema.json", () => {
  assert.equal(PROTOCOL_SCHEMA_JSON, readFileSync(join(here, "schema.json"), "utf8"));
});

test("every message type has at least one example", () => {
  const covered = new Set(valid.map((f) => (load(join(examples, f)) as { t: string }).t));
  for (const t of Object.keys(PROTOCOL_SCHEMA.messages)) assert.ok(covered.has(t), `no example for ${t}`);
});

for (const f of valid) {
  test(`valid: ${f}`, () => {
    const msg = load(join(examples, f)) as { t: string };
    assert.equal(validateMessage(msg), null);
    const spec = PROTOCOL_SCHEMA.messages[msg.t];
    assert.equal(validateMessage(msg, { direction: spec.direction }), null);
    const wrong = spec.direction === "to_web" ? "to_native" : "to_web";
    assert.notEqual(validateMessage(msg, { direction: wrong }), null, "direction must be enforced");
    for (const island of spec.islands) assert.equal(validateMessage(msg, { island }), null);
    if (spec.direction === "to_native") assert.ok(isToNativeMessage(msg));
    else assert.ok(isToWebMessage(msg));
  });
}

for (const f of invalid) {
  test(`invalid: ${f}`, () => {
    assert.notEqual(validateMessage(load(join(examples, "invalid", f))), null);
  });
}

test("island scoping: desmos may only send desmos/key/focus/error", () => {
  assert.equal(validateMessage({ v: 1, t: "key", key: "Escape" }, { island: "desmos" }), null);
  assert.notEqual(validateMessage({ v: 1, t: "answer.choose", qid: 1, key: "A" }, { island: "desmos" }), null);
});

test("type guards narrow", () => {
  const m: unknown = { v: 1, t: "answer.choose", qid: 7, key: "C" };
  assert.ok(isAnswerChooseMessage(m));
  if (isAnswerChooseMessage(m)) assert.equal(m.key, "C");
  assert.ok(!isAnswerChooseMessage({ v: 1, t: "flag.toggle", qid: 7 }));
});
