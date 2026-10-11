#!/usr/bin/env bash
# Tier A on this Mac: everything foundation ships, in one command.
#   desktop-native/tool/test_all.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=env.sh
source "$ROOT/tool/env.sh"

"$ROOT/tool/check_generated.sh"
node --test "$ROOT/island/protocol/protocol.test.ts"
clang -std=c99 -Wall -Wextra -Werror -pedantic -fsyntax-only -I "$ROOT/native/include" -x c - <<<'#include "mastersat_native.h"
int main(void){return MS_OK;}'
( cd "$ROOT/app" && flutter analyze && flutter test )
