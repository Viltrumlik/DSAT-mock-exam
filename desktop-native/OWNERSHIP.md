# desktop-native — who owns what

Nine workstreams build the native Windows exam app in parallel. **Edit only your own
paths; read anything.** If you need a change in someone else's path, do not make it:
describe it precisely under "Integration requests" in your report. Anyone may *append* a
dependency to `app/pubspec.yaml` (say so in your report).

| Workstream | Owns |
|---|---|
| **foundation** | `app/` scaffold (`pubspec.yaml`, `analysis_options.yaml`, placeholder `lib/main.dart`), `contracts/**`, `app/lib/core/models/**`, `app/lib/core/api/{v1_api.dart,fixture_v1_api.dart,fixtures/**}`, `app/lib/exam/{session_contract.dart,fake_exam_session.dart}`, `app/lib/island/{protocol.dart,protocol_convert.dart,island_host.dart,fake_island_host.dart}`, `app/lib/native/{native_bridge.dart,fake_native_bridge.dart}`, `island/protocol/**`, `island/src/protocol.ts`, `native/include/**`, `tool/**` (except `tool/fixture_server/**`), `OWNERSHIP.md`, `README.md`, `VERSION`, `.flutter-version`, `.gitignore`; tests `app/test/{core/models,core/api,exam/session_contract_test.dart,island,native,support}/**` |
| **hotfix** | `backend/exams/views.py`, `backend/classes/views_pastpaper_retake.py` + their tests (based on `origin/main`) |
| **server-v1** | `backend/desktop/v1/**` (new), the mount in `backend/desktop/urls.py`, the `DESKTOP_V1_ENABLED` setting, `backend/desktop` tests, the `mobile` version-policy `windows` entry, `is_native_client` accepting `windows/<semver>` |
| **rust** | `desktop/src-tauri/crates/lockdown/**` (`lockdown.rs` + its macOS half `macos.rs`), `desktop/src-tauri/src/main.rs` + `desktop/src-tauri/Cargo.toml` (switch to the crate only), `desktop-native/native/**` except `include/` (cdylib `mastersat-native`, workspace `Cargo.toml`, committed `Cargo.lock`), `app/lib/native/ffi_native_bridge.dart` |
| **app-core** | `app/lib/{main.dart,app.dart}`, `app/lib/core/api/http_v1_api.dart`, `app/lib/core/{http,auth,store,clock,diagnostics,theme}/**`, `app/lib/features/{signin,home,library,results,settings}/**`, `app/test/{core,features/{signin,home,library,results,settings}}/**` (not foundation's test folders above), `tool/fixture_server/**` |
| **exam-engine** | `app/lib/exam/engine/**`, `app/lib/features/midterm/**`, `app/test/exam/engine/**`, `app/test/features/midterm/**` |
| **runner-ui** | `app/lib/exam/{runner,tools,tokens}/**`, `app/assets/runner/**`, `app/test/exam/{runner,tools}/**` |
| **island** | `island/**` except `island/protocol/**` and `island/src/protocol.ts` (consume those as-is) |
| **windows-host** | `plugins/ms_webview2/**`, `app/lib/island/{texture_island_host.dart,windows_island_host*.dart,macos_island_host.dart,island_host_factory.dart,s1_harness.dart}`, `app/windows/**`, `app/macos/**` (dev runner tweaks only), `packaging/**`, `.github/workflows/desktop-native.yml`, the CI test glue `app/test/{flutter_test_config.dart,ci_golden_tolerance.dart}`; tests `app/test/windows_host/**` |

## Contracts (foundation) — build against these, never around them

| Seam | File(s) | Rule |
|---|---|---|
| Server wire format | `contracts/v1/*.json` + `manifest.json` + `README.md` | THE contract. Server tests and Dart tests load the same files. Change only through `tool/contracts/gen_v1_fixtures.py` (foundation). |
| Dart wire models | `app/lib/core/models/` | Hand-written `fromJson`/`toJson`; the round-trip test proves they cover every fixture key. |
| Server surface | `app/lib/core/api/v1_api.dart` | `V1Api` (one method per endpoint), `ApiError` / `UpdateRequired` / `NetworkError`, `IdempotencyKeys`, `V1Paths`, `V1Headers`. `HttpV1Api` (app-core) and `FixtureV1Api` implement it. |
| Engine ↔ runner | `app/lib/exam/session_contract.dart` | `ExamSession`. The engine implements it; the runner only renders it. `FakeExamSession` for runner work. |
| Native ↔ web | `island/protocol/schema.json` | Generated `island/src/protocol.ts` and `app/lib/island/protocol.dart` (`tool/protocol/gen_protocol.py`). Never hand-edit the generated files. |
| Island hosting | `app/lib/island/island_host.dart` | `IslandHost`, `IslandEvent`s, `IslandHostFactory`. `FakeIslandHost` for tests. |
| Native library | `native/include/mastersat_native.h` | The C ABI. Rust implements it exactly; `NativeBridge` mirrors it; `FakeNativeBridge` for tests. |

## Conventions

* **Flutter SDK:** `source desktop-native/tool/env.sh` (Flutter 3.47.7 at
  `/Users/macbook/development/flutter-3.47`; CI reads `.flutter-version`). Never
  `/usr/local/bin/flutter` (3.41.9).
* **Green before every commit:** `flutter analyze` prints `No issues found!` and
  `flutter test` ends with `All tests passed!`. `tool/test_all.sh` runs everything foundation
  ships (generator drift, TS protocol tests, header compile, analyze, tests).
* **No codegen at build time** (no `build_runner` outputs committed by hand; drift's
  generated `*.g.dart` is fine if produced by `build_runner` and committed).
* **Student-facing copy:** English, the website's wording, growth-oriented; MasterSAT is
  "a learning center" (never "school").
* **No browser habits:** no right-click menu, no selectable chrome, no reload keys, no
  hover-lift, no hand cursor, no white flash.
* **Never call the production API** from tests or dev; use `FixtureV1Api` or the local
  fixture server.
* **Commits:** author `Viltrumlik <viltrumlik@gmail.com>`; message ends with a blank line and
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push only your own branch:
  `git push github-ssh HEAD:refs/heads/<your-branch>`.
* **No build outputs or secrets in git** (`desktop-native/.gitignore`).
