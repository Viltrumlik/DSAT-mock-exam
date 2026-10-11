<#
.SYNOPSIS
  S4 smoke test of the Velopack installer on a CI machine (architecture §6, §10 S4).

.DESCRIPTION
  1. Runs <id>-Setup.exe --silent: per-user install into %LOCALAPPDATA%\MasterSAT.Exam.
  2. Records what landed: the exe, mastersat_native.dll, data\island, data\app.so, Update.exe,
     the HKCU uninstall entry, the shortcuts, and HKCU\Software\Classes\mastersat — which only
     the DLL's Velopack after-install hook (ms_startup) writes, so its presence proves the hooks
     run inside the installed app.
  3. Starts the installed app (unless Velopack already did) and sends mastersat://auth?code=s4-test
     through the shell (the registered protocol): the second instance must hand it over and exit.
  4. Leaves a marker in %LOCALAPPDATA%\MasterSAT (the user-data folder), runs
     Update.exe --silent uninstall, and records that the install folder, the protocol key and
     the uninstall entry are gone while the user data stays.

  Writes s4-install.json into -OutDir and a summary line into $GITHUB_STEP_SUMMARY.
  Never fails the job: it records (the workflow step is continue-on-error as well).
  The machine's hosts file keeps the installed app away from production (see the workflow).
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$VelopackDir,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$PackId = 'MasterSAT.Exam',
  [int]$TimeoutSeconds = 240
)

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$root = Join-Path $env:LOCALAPPDATA $PackId
$userData = Join-Path $env:LOCALAPPDATA 'MasterSAT'
$protoKey = 'HKCU:\Software\Classes\mastersat'
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$PackId"
$startMenuLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'MasterSAT.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MasterSAT.lnk'

function Get-ProtocolCommand {
  (Get-ItemProperty -Path "$protoKey\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
}
function Get-InstalledApps {
  @(Get-Process -Name MasterSAT -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($root, 'OrdinalIgnoreCase') })
}

$report = [ordered]@{}
$setup = Get-ChildItem $VelopackDir -Filter '*-Setup.exe' | Select-Object -First 1
if (-not $setup) { throw "No Setup.exe in $VelopackDir" }
$report.setupExe = $setup.Name

# Earlier steps ran the app from the build folder, and its first-run housekeeping may have
# registered mastersat:// there. Start clean so the key below can only come from the install.
Remove-Item -Recurse -Force $protoKey -ErrorAction SilentlyContinue
$report.before = [ordered]@{ installed = (Test-Path $root); protocolKey = (Test-Path $protoKey) }

# --- 1. install ---------------------------------------------------------------------------
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $setup.FullName -ArgumentList '--silent', '--log', (Join-Path $OutDir 'velopack-setup.log') -PassThru
$done = $p.WaitForExit($TimeoutSeconds * 1000)
$report.install = [ordered]@{
  finished = $done
  exitCode = $(if ($done) { $p.ExitCode } else { $null })
  seconds  = [Math]::Round($sw.Elapsed.TotalSeconds, 1)
}
if (-not $done) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 5

# --- 2. what landed -----------------------------------------------------------------------
$current = Join-Path $root 'current'
$files = [ordered]@{}
foreach ($f in 'MasterSAT.exe', 'mastersat_native.dll', 'data\app.so', 'data\island\content.html', 'data\island\desmos.html') {
  $files[$f] = Test-Path (Join-Path $current $f)
}
$files['Update.exe'] = Test-Path (Join-Path $root 'Update.exe')
$entry = Get-ItemProperty -Path $uninstallKey -ErrorAction SilentlyContinue
$command = Get-ProtocolCommand
$report.installed = [ordered]@{
  root            = $root
  files           = $files
  islandFiles     = (Get-ChildItem -Recurse -File (Join-Path $current 'data\island') -ErrorAction SilentlyContinue | Measure-Object).Count
  uninstallEntry  = $(if ($entry) { [ordered]@{ DisplayName = $entry.DisplayName; DisplayVersion = $entry.DisplayVersion; UninstallString = $entry.UninstallString } } else { $null })
  startMenuLink   = Test-Path $startMenuLink
  desktopLink     = Test-Path $desktopLink
  protocolCommand = $command
  # Written only by the DLL's after-install hook (ms_startup → Velopack → register_current).
  protocolFromHook = [bool]($command -and $command.Contains($current))
}

# --- 3. the installed app running, and a link through the registered protocol ---------------
$apps = Get-InstalledApps
$report.appStartedAfterInstall = $apps.Count -gt 0
$installedExe = Join-Path $current 'MasterSAT.exe'
if ($apps.Count -eq 0 -and (Test-Path $installedExe)) {
  Start-Process -FilePath $installedExe | Out-Null
}
Add-Type -Namespace S4 -Name Win -MemberDefinition @'
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern System.IntPtr FindWindowW(string cls, System.IntPtr title);
'@ -ErrorAction SilentlyContinue
$t0 = Get-Date
$hwnd = [IntPtr]::Zero
while (((Get-Date) - $t0).TotalSeconds -lt 20 -and $hwnd -eq [IntPtr]::Zero) {
  Start-Sleep -Milliseconds 250
  $hwnd = [S4.Win]::FindWindowW('MasterSATWindow', [IntPtr]::Zero)
}
$before = (Get-InstalledApps).Count
if ($hwnd -ne [IntPtr]::Zero -and $command) {
  # The shell starts "current\MasterSAT.exe" "mastersat://..."; that second instance hands the
  # link to the running window and exits, so the count of installed processes stays the same.
  Start-Process 'mastersat://auth?code=s4-test'
  Start-Sleep -Seconds 5
  $after = (Get-InstalledApps).Count
  $report.deepLink = [ordered]@{ windowFound = $true; processesBefore = $before; processesAfter = $after; handedOver = ($before -ge 1 -and $after -eq $before) }
} else {
  $report.deepLink = [ordered]@{ windowFound = ($hwnd -ne [IntPtr]::Zero); handedOver = $false }
}
Get-InstalledApps | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

# --- 4. uninstall keeps the user data -------------------------------------------------------
New-Item -ItemType Directory -Force -Path $userData | Out-Null
$marker = Join-Path $userData 's4-uninstall-keeps-this.txt'
Set-Content -Path $marker -Value 'unsent answers live in this folder' -Encoding utf8
$update = Join-Path $root 'Update.exe'
if (Test-Path $update) {
  $sw.Restart()
  $u = Start-Process -FilePath $update -ArgumentList '--silent', 'uninstall' -PassThru
  $uDone = $u.WaitForExit($TimeoutSeconds * 1000)
  Start-Sleep -Seconds 5
  $report.uninstall = [ordered]@{
    finished          = $uDone
    exitCode          = $(if ($uDone) { $u.ExitCode } else { $null })
    seconds           = [Math]::Round($sw.Elapsed.TotalSeconds, 1)
    appRemoved        = -not (Test-Path (Join-Path $current 'MasterSAT.exe'))
    uninstallEntryGone = -not (Test-Path $uninstallKey)
    # Removed by the DLL's before-uninstall hook.
    protocolKeyGone   = -not (Test-Path $protoKey)
    startMenuLinkGone = -not (Test-Path $startMenuLink)
    userDataKept      = Test-Path $marker
  }
} else {
  $report.uninstall = 'no Update.exe: nothing was installed'
}
Remove-Item -Force $marker -ErrorAction SilentlyContinue

# --- verdict --------------------------------------------------------------------------------
$checks = [ordered]@{
  installed        = ($report.install.exitCode -eq 0) -and -not ($files.Values -contains $false)
  uninstallEntry   = $null -ne $report.installed.uninstallEntry
  protocolFromHook = $report.installed.protocolFromHook
  uninstalled      = ($report.uninstall -is [System.Collections.IDictionary]) -and $report.uninstall.appRemoved -and $report.uninstall.uninstallEntryGone
  protocolRemoved  = ($report.uninstall -is [System.Collections.IDictionary]) -and $report.uninstall.protocolKeyGone
  userDataKept     = ($report.uninstall -is [System.Collections.IDictionary]) -and $report.uninstall.userDataKept
  deepLinkHandedOver = [bool]$report.deepLink.handedOver
}
$report.checks = $checks
$json = $report | ConvertTo-Json -Depth 6
Set-Content -Path (Join-Path $OutDir 's4-install.json') -Value $json -Encoding utf8
Write-Host $json
$failed = @($checks.Keys | Where-Object { -not $checks[$_] })
$line = if ($failed.Count -eq 0) { 'S4 install smoke: all checks passed' } else { "S4 install smoke: FAILED $($failed -join ', ')" }
foreach ($k in $failed) { Write-Host "::warning::S4 install smoke: $k failed (see s4-install.json)" }
if ($env:GITHUB_STEP_SUMMARY) { Add-Content -Encoding utf8 $env:GITHUB_STEP_SUMMARY "`n### $line`n" }
exit 0
