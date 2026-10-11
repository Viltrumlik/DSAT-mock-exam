# desktop-native/packaging

How the Windows exam app becomes an installer (architecture §6), and the S0 diagnostics CI runs
on `windows-latest`. Nothing here deploys anything.

| File | What it is |
|---|---|
| `pack.ps1` | `vpk pack -u MasterSAT.Exam -v <VERSION> -p app\build\windows\x64\runner\Release -e MasterSAT.exe --framework webview2` plus title, icon and channel. The version comes from `desktop-native/VERSION`. |
| `icon/MasterSAT.ico` | The installer and exe icon, made from `desktop/app-icon.png` (the 0.1.x app's source) by `icon/make_icon.py`. |
| `prune-bundle.ps1` | Removes files the app can never load from the built bundle: the six unused Lucide weight fonts (`Lucide100`…`Lucide600`, also dropped from `FontManifest.json`) and KaTeX's `.woff`/`.ttf` fallbacks (WebView2 always takes the `.woff2` listed first). Guarded, idempotent, and run by `pack.ps1`. |
| `ci/s0-diagnostics.ps1` | The S0 run on a CI machine. It records the screen, the WebView2 runtime and whether an interactive desktop exists. It runs the app with `--s1-harness`, then checks the runner itself. Its outputs are `s0-diagnostics.json`, `screen.png`, `mastersat-s1.json` and `island.png`. |
| `ci/size-report.ps1` | What `Setup.exe` is made of, per component (on disk and compressed inside the nupkg), against the 25 MB budget. Writes `size-report.json` / `.md` and the job summary. |
| `ci/install-smoke.ps1` | S4 smoke test: silent install, the files and registry keys it leaves (the `mastersat://` key proves the DLL's Velopack hook ran), a link through the protocol, then a silent uninstall that must keep `%LOCALAPPDATA%\MasterSAT`. Writes `s4-install.json`. |
| `s0-probe/` | A stand-in question card that speaks protocol v1. CMake installs it only when `MS_S0_PROBE=1` and there is no island build. It is never part of a release. |

## Build an installer on Windows

You need Visual Studio 2022 (Desktop C++), the Flutter version in `../.flutter-version`, the .NET 8
SDK, and `dotnet tool install -g vpk`. Rust stable and Node 24 are needed only when you build the
DLL and the island.

```powershell
# 1. mastersat_native.dll
cd desktop-native/native
# key_id:hex. A release build WITHOUT it has no proof key at all (ms_prove answers
# MS_ERR_NO_KEY); it never falls back to the development key. For a test build against a
# development server use `--features dev-key` instead — never for an installer.
$env:DESKTOP_PROOF_KEY = '<key_id:hex>'
cargo build --release --locked -p mastersat-native --target x86_64-pc-windows-msvc --features updates
$env:MS_LINK_NATIVE = 'ON'; $env:MS_NATIVE_LIB_DIR = "$PWD\target\x86_64-pc-windows-msvc\release"

# 2. the island pages (CMake copies build/island into data\island)
cd ..\island; npm ci; npm run build     # DESMOS_API_KEY = the website's NEXT_PUBLIC_DESMOS_API_KEY, if set

# 3. the app, then the installer (pack.ps1 prunes the bundle first)
cd ..\app
$v = (Get-Content ..\VERSION).Trim()
flutter build windows --release --build-name $v --dart-define=MASTERSAT_APP_VERSION=$v --split-debug-info=..\packaging\out\symbols
..\packaging\pack.ps1 -Channel beta        # -> packaging\out\MasterSAT.Exam-beta-Setup.exe
```

`vpk` must be the version of the `velopack` crate in `native/Cargo.lock` (`dotnet tool install -g vpk --version <it>`).
Keep the `symbols` folder of every shipped build: `flutter symbolize -i <trace> -d app.windows-x64.symbols` turns a
stack trace from that build back into file and line.

`MS_LINK_NATIVE` can be `AUTO`, which is the default and links the DLL when it is found; `ON`, which fails if the DLL is missing; or `OFF`. Without the DLL the exe has no Velopack hooks and no lockdown.

## What the installer does

- It installs for the current user only, into `%LocalAppData%\MasterSAT.Exam`, with no UAC prompt. If the WebView2 runtime is missing, it installs that first.
- User data lives in `%LOCALAPPDATA%\MasterSAT`: the database, images, `wv2\` (WebView2's profile) and logs. That folder is outside the install folder, so an update or uninstall never removes unsent answers.
- The installer is not signed yet (owner question Q1). Once a certificate exists, `pack.ps1 -SignParams` passes it to `vpk pack --signParams`.

## Runner behaviour (`app/windows/runner`)

- **Start-up.** `ms_startup` runs first, then the single-instance check (`Local\MasterSAT.Exam`). A second launch sends its `mastersat://` link with `WM_COPYDATA` to the window class `MasterSATWindow` and exits. The running window passes the link to Dart through `MethodChannel('mastersat/launch')`.
- **Power and clock events.** These go to Dart through `MethodChannel('mastersat/power')`.
- **The window.**
  - It has a background brush, so it never flashes white.
  - It is hidden until Flutter's first frame.
  - Its minimum size is 1000 × 640 logical pixels, and it uses per-monitor DPI v2.
  - The title bar is always light.
  - Its placement is remembered in `HKCU\Software\MasterSAT\Exam`.
