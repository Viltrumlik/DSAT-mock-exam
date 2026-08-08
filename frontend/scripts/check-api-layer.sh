#!/usr/bin/env bash
#
# Every request must go through the axios instance in `lib/api.ts`, which owns the base URL,
# the auth header and the refresh retry. A hand-written "/api/…" string bypasses all three.
#
# This lived inline in two workflows and drifted: `ci_pr_fast.yml` was fixed while
# `ci_merge_full.yml` kept a copy that called `rg`, which is not on the runner image — so the
# merge gate exited 127 on every push and the check never ran anywhere. One script, called
# from both, is the only version that cannot drift again. It also runs locally.
#
# Exemptions, and why each one cannot use the axios instance:
#   lib/api.ts                     — is the axios instance
#   lib/openapi-types.ts           — generated from the schema
#   lib/openapiClient.gen.ts       — generated from the schema
#   lib/auth/authClientTelemetry.ts— flushes on tab close via sendBeacon / keepalive fetch
#   features/*/api.ts              — the per-feature API layer, which calls lib/api.ts
set -uo pipefail

cd "$(dirname "$0")/.."

EXEMPT='^src/(lib/api\.ts|lib/openapi-types\.ts|lib/openapiClient\.gen\.ts|lib/auth/authClientTelemetry\.ts|features/[^:]*/api\.ts):'

offenders=$(
  grep -rn '"/api/' src \
    --include='*.ts' --include='*.tsx' \
    --exclude-dir=node_modules \
    | grep -vE "$EXEMPT" || true
)

if [ -n "$offenders" ]; then
  echo "$offenders"
  echo ""
  echo "::error::Direct \"/api/ string outside the API layer — call it through lib/api.ts."
  exit 1
fi

echo "No direct \"/api/ strings outside the API layer."
