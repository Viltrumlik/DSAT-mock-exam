<#
.SYNOPSIS
  Builds the MasterSAT Velopack installer + update packages (architecture §6).

.DESCRIPTION
  Runs, on Windows with the .NET 8 SDK and `dotnet tool install -g vpk`:

    vpk pack -u MasterSAT.Exam -v <VERSION> -p build\windows\x64\runner\Release
             -e MasterSAT.exe --framework webview2

  The version comes from desktop-native/VERSION, the single file that also
  feeds Cargo, `flutter build windows --build-name` and the signed lockdown
  proof. Output (in -OutDir): MasterSAT.Exam-<channel>-Setup.exe,
  MasterSAT.Exam-<version>-<channel>-full.nupkg, releases.<channel>.json,
  assets.<channel>.json and a portable zip.

  The installer is per user (%LocalAppData%\MasterSAT.Exam, no UAC prompt) and
  installs the WebView2 runtime first when it is missing. User data stays in
  %LOCALAPPDATA%\MasterSAT, outside the install folder, so updates and
  uninstalls never touch unsent answers.

.PARAMETER SignParams
  Passed to `vpk pack --signParams` (signtool arguments) once a code-signing
  certificate exists (architecture §6, owner question Q1). Empty = unsigned.
#>
[CmdletBinding()]
param(
  [string]$Version = '',
  [string]$BundleDir = (Join-Path $PSScriptRoot '..\app\build\windows\x64\runner\Release'),
  [string]$OutDir = (Join-Path $PSScriptRoot 'out'),
  [ValidateSet('stable', 'beta')]
  [string]$Channel = 'stable',
  [string]$SignParams = ''
)

$ErrorActionPreference = 'Stop'

if (-not $Version) {
  $Version = (Get-Content -Raw (Join-Path $PSScriptRoot '..\VERSION')).Trim()
}
if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') {
  throw "VERSION '$Version' is not a semantic version"
}

$BundleDir = (Resolve-Path $BundleDir).Path
$exe = Join-Path $BundleDir 'MasterSAT.exe'
if (-not (Test-Path $exe)) {
  throw "No MasterSAT.exe in $BundleDir (run flutter build windows --release first)"
}
if (-not (Test-Path (Join-Path $BundleDir 'data\island'))) {
  Write-Warning 'The bundle has no data\island folder: questions will not render.'
}
if (-not (Test-Path (Join-Path $BundleDir 'mastersat_native.dll'))) {
  Write-Warning 'The bundle has no mastersat_native.dll: no Velopack hooks, no lockdown.'
}

# Drop what the app can never load (idempotent; see prune-bundle.ps1).
& (Join-Path $PSScriptRoot 'prune-bundle.ps1') -BundleDir $BundleDir
if ($LASTEXITCODE -ne 0) { throw 'prune-bundle.ps1 refused to prune this bundle' }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$icon = Join-Path $PSScriptRoot 'icon\MasterSAT.ico'

$vpkArgs = @(
  'pack',
  '--packId', 'MasterSAT.Exam',
  '--packVersion', $Version,
  '--packDir', $BundleDir,
  '--mainExe', 'MasterSAT.exe',
  '--packTitle', 'MasterSAT',
  '--packAuthors', 'MasterSAT',
  '--framework', 'webview2',
  # The app is x64 only (Flutter + mastersat_native.dll for x86_64-pc-windows-msvc); without
  # this vpk assumes x86.
  '--runtime', 'win-x64',
  '--icon', $icon,
  '--channel', $Channel,
  '--outputDir', $OutDir,
  # The Velopack hooks run inside mastersat_native.dll (ms_startup, called
  # first in wWinMain), not in the exe vpk inspects, so its heuristic check
  # for VelopackApp in the main executable cannot see them.
  '--skipVeloAppCheck'
)
if ($SignParams) {
  $vpkArgs += @('--signParams', $SignParams)
}

Write-Host "vpk $($vpkArgs -join ' ')"
& vpk @vpkArgs
if ($LASTEXITCODE -ne 0) {
  throw "vpk pack failed with exit code $LASTEXITCODE"
}

Get-ChildItem $OutDir | Format-Table Name, Length -AutoSize | Out-String | Write-Host
