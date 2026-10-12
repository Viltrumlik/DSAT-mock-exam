# desktop-native — the MasterSAT exam app for Windows

A fully native rewrite of the Windows exam app (`desktop/` is the 0.1.x Tauri app and stays
buildable until it is retired). Design: `native-rewrite/design-panel/architecture.md`
(normative) and `design_data_server.md` (data layer + server contract).

* **Flutter** draws every native pixel (`app/`).
* **Exactly two WebView2 islands**: the question card and Desmos (`island/`, hosted by
  `plugins/ms_webview2/`), talking to native only through `island/protocol/schema.json`.
* **Rust** `mastersat_native.dll` (`native/`) reuses the proof crate and `lockdown.rs`;
  its C ABI is `native/include/mastersat_native.h`.
* **Velopack** installer and updates (`packaging/`).

Ownership and conventions: [`OWNERSHIP.md`](OWNERSHIP.md).

## Layout

```
desktop-native/
  VERSION                 one version for Cargo, Flutter --build-name and Velopack -v
  .flutter-version        the pinned Flutter (CI reads it)
  app/                    Flutter project (package mastersat_app)
    lib/core/             api/ (V1Api, FixtureV1Api) models/ http/ auth/ store/ clock/ diagnostics/ theme/
    lib/exam/             session_contract.dart (ExamSession) engine/ runner/ tools/ tokens/
    lib/features/         signin/ home/ library/ results/ midterm/ settings/
    lib/island/           protocol.dart (generated) island_host.dart + hosts
    lib/native/           native_bridge.dart + FFI/fake implementations
  contracts/v1/           the /api/desktop/v1/ wire contract (fixtures + manifest + README)
  island/                 TypeScript + Vite islands; protocol/ = schema.json + examples
  native/                 Rust cdylib; include/mastersat_native.h
  plugins/ms_webview2/    patched webview_flutter_windows (texture + windowed hosts)
  packaging/              Velopack
  tool/                   env.sh, generators, test scripts
```

## Toolchain

```sh
source desktop-native/tool/env.sh     # Flutter 3.47.7 (Dart 3.13.5), side by side
flutter --version
```

Flutter lives at `/Users/macbook/development/flutter-3.47` (git tag `3.47.7`). The
system Flutter (`/usr/local/share/flutter`, 3.41.9) is untouched and must not be used here.
Rust: cargo 1.99 with the `x86_64-pc-windows-msvc` target (for `cargo check`; Windows builds
happen on CI). Node ≥ 22.18 runs the TS protocol tests with type stripping (no npm install).

## Run the tests (tier A, this Mac)

```sh
desktop-native/tool/test_all.sh
```

which runs:

| Check | Command |
|---|---|
| Generated files match their generators | `desktop-native/tool/check_generated.sh` |
| Protocol examples in TypeScript | `node --test desktop-native/island/protocol/protocol.test.ts` |
| The C header compiles | `clang -std=c99 -fsyntax-only -I desktop-native/native/include …` |
| Dart analysis | `cd desktop-native/app && flutter analyze` → `No issues found!` |
| Dart tests | `cd desktop-native/app && flutter test` → `All tests passed!` |

## Regenerating contracts

```sh
python3 -I desktop-native/tool/contracts/gen_v1_fixtures.py   # contracts/v1/** + app/lib/core/api/fixtures/v1_fixtures.g.dart
python3 -I desktop-native/tool/protocol/gen_protocol.py        # island/src/protocol.ts + app/lib/island/protocol.dart
```

Then run the tests: the round-trip test fails until the Dart models cover any new key.

## Dev loop on macOS

* **Without a server:** construct the app with `FixtureV1Api` (in-memory, stateful: open →
  start → sync → submit → result, the midterm handshake, offline and error injection),
  `FakeNativeBridge` and `FakeIslandHost`. `FakeExamSession.readingWriting()` / `.math()` /
  `.midterm()` give the runner a complete sitting.
* **Against a local fixture server:** `tool/fixture_server/` (app-core) replays the same
  `contracts/v1` JSON over HTTP; never point a dev build at `mastersat.uz`.
* `flutter run -d macos` runs the dev runner (never shipped). The island runs in WKWebView
  through the same protocol (`MacosIslandHost`); it checks flows, not looks.

## Verification tiers (architecture §9)

| Tier | Where | What it proves |
|---|---|---|
| A | Mac, `flutter test` (+ `node --test`) | Contracts, models, fake API flows, engine/outbox/clock units, widget tests and goldens for every native screen, "every button does something" |
| B | Mac, `flutter run -d macos`, `cargo test`, `cargo check --target x86_64-pc-windows-msvc` | Whole flows against the local fixture server; Win32 Rust type-checks |
| C | Mac/Linux, Playwright Chromium + vitest | The island against the website's question card over a real-question corpus; the website's annotation/offset tests |
| D | `windows-latest` CI | The real exe with real WebView2: integration journeys against a fake API, island DOM via `--remote-debugging-port`, lockdown checks, install → deep link → delta update → uninstall |
| E | The owner | Beta-channel installer + a 10-minute checklist on the oldest laptop |

Blind spots only the owner covers: real GPUs, sleep/resume, DPI changes, multi-monitor
lockdown, SmartScreen, and how the app feels.

## CI (`.github/workflows/desktop-native.yml`)

* **macOS:** generated-file drift, protocol tests, the C header, `cargo test` plus the debug
  dylib, `flutter analyze` + `flutter test` (goldens included; the FFI test must find the real
  library), the plugin, the runner's C++ rules, the island's typecheck / protocol / vitest /
  build, the Playwright picture comparison (recorded, not blocking) and, last, `npm run parity`.
  Together the island steps are `npm run check`.
* **Windows:** mastersat.uz is mapped to 0.0.0.0 first. `cargo test` (incl. `tests/windows.rs`),
  the FFI test against the debug DLL, the release DLL (`updates`, `DESKTOP_PROOF_KEY` embedded —
  a push without the secret fails), the island, `flutter build windows --release` linking the
  DLL, `packaging/prune-bundle.ps1`, S0 + S1 on that build, `vpk pack`, the size report against
  27 MB, the install/uninstall smoke test, then `flutter test --exclude-tags golden`.
* **Artifacts:** `MasterSAT-Setup`, `MasterSAT-full-nupkg`, `MasterSAT-symbols` (keep them for
  `flutter symbolize`), `s0-diagnostics` (S0/S1 JSON + screenshots, `size-report.*`,
  `s4-install.json`), `island-visual` (macOS).
