# desktop-native/packaging

How the Windows exam app becomes an installer (architecture §6), and the S0 diagnostics CI runs
on `windows-latest`. Nothing here deploys anything.

| File | What it is |
|---|---|
| `pack.ps1` | `vpk pack -u MasterSAT.Exam -v <VERSION> -p app\build\windows\x64\runner\Release -e MasterSAT.exe --framework webview2` plus title, icon and channel. The version comes from `desktop-native/VERSION`. |
| `icon/MasterSAT.ico` | The installer and exe icon, made from `desktop/app-icon.png` (the 0.1.x app's source) by `icon/make_icon.py`. |
| `ci/s0-diagnostics.ps1` | The S0 run on a CI machine. It records the screen, the WebView2 runtime and whether an interactive desktop exists. It runs the app with `--s1-harness`, then checks the runner itself. Its outputs are `s0-diagnostics.json`, `screen.png`, `mastersat-s1.json` and `island.png`. |
| `s0-probe/` | A stand-in question card that speaks protocol v1. CMake installs it only when `MS_S0_PROBE=1` and there is no island build. It is never part of a release. |

## Build an installer on Windows

You need Visual Studio 2022 (Desktop C++), the Flutter version in `../.flutter-version`, the .NET 8
SDK, and `dotnet tool install -g vpk`. Rust stable and Node 24 are needed only when you build the
DLL and the island.

```powershell
# 1. mastersat_native.dll (optional until the rust workstream is merged)
cd desktop-native/native
$env:DESKTOP_PROOF_KEY = '<key_id:hex>'   # without it the DLL cannot sign lockdown proofs
cargo build --release --locked -p mastersat-native --target x86_64-pc-windows-msvc
$env:MS_LINK_NATIVE = 'ON'; $env:MS_NATIVE_LIB_DIR = "$PWD\target\x86_64-pc-windows-msvc\release"

# 2. the island pages (CMake copies build/island into data\island)
cd ..\island; npm ci; npm run build

# 3. the app, then the installer
cd ..\app; flutter build windows --release --build-name (Get-Content ..\VERSION)
..\packaging\pack.ps1 -Channel beta        # -> packaging\out\MasterSAT.Exam-beta-Setup.exe
```

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
