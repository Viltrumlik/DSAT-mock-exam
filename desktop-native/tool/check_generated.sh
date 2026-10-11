#!/usr/bin/env bash
# Fails if a generated file differs from what its generator produces now (hand edits or a
# forgotten regeneration). Runs offline, stdlib only. Used by CI and before every commit
# that touches contracts/v1, island/protocol/schema.json or the generators.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

python3 -I "$ROOT/tool/contracts/gen_v1_fixtures.py" "$TMP/contracts" "$TMP/v1_fixtures.g.dart" >/dev/null
diff -r "$ROOT/contracts/v1" "$TMP/contracts" -x README.md
diff "$ROOT/app/lib/core/api/fixtures/v1_fixtures.g.dart" "$TMP/v1_fixtures.g.dart"

python3 -I "$ROOT/tool/protocol/gen_protocol.py" "$TMP/protocol.ts" "$TMP/protocol.dart" >/dev/null
diff "$ROOT/island/src/protocol.ts" "$TMP/protocol.ts"
diff "$ROOT/app/lib/island/protocol.dart" "$TMP/protocol.dart"

echo "generated files are up to date"
