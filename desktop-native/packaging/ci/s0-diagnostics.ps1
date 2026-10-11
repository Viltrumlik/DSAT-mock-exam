<#
.SYNOPSIS
  S0 diagnostics on a windows-latest runner (architecture §9, §10 S0).

.DESCRIPTION
  Records what tier-D checks can rely on: screen resolution, whether there is
  an interactive desktop, the WebView2 runtime version. Then launches the
  built app with --s1-harness for about -Seconds seconds, takes a full-screen
  screenshot, collects %TEMP%\mastersat-s1.json (the harness timings) and the
  island's own CapturePreview PNG, and stops the app.

  Everything lands in -OutDir: s0-diagnostics.json, screen.png,
  mastersat-s1.json, island.png, app-stdout.txt, app-stderr.txt.
  The script never fails the job because of a diagnostic: it records.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$Seconds = 20
)

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$report = [ordered]@{}

function Try-Get([scriptblock]$block) {
  try { & $block } catch { "error: $($_.Exception.Message)" }
}

# --- Machine ---------------------------------------------------------------
$report.os = Try-Get { (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber) }
$report.session = [ordered]@{
  userInteractive = [Environment]::UserInteractive
  sessionId       = (Get-Process -Id $PID).SessionId
  userName        = [Environment]::UserName
  inputDesktop    = Try-Get {
    Add-Type -Namespace S0 -Name Desk -MemberDefinition @'
[DllImport("user32.dll", SetLastError=true)] public static extern System.IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
[DllImport("user32.dll")] public static extern bool CloseDesktop(System.IntPtr h);
'@ -ErrorAction SilentlyContinue
    $h = [S0.Desk]::OpenInputDesktop(0, $false, 0x0100)
    if ($h -ne [IntPtr]::Zero) { [void][S0.Desk]::CloseDesktop($h); 'available' } else { 'none' }
  }
}
$report.video = Try-Get {
  Get-CimInstance Win32_VideoController |
    Select-Object Name, DriverVersion, CurrentHorizontalResolution, CurrentVerticalResolution, CurrentRefreshRate
}
$report.screens = Try-Get {
  [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
    [ordered]@{ name = $_.DeviceName; primary = $_.Primary; bounds = "$($_.Bounds.Width)x$($_.Bounds.Height)"; working = "$($_.WorkingArea.Width)x$($_.WorkingArea.Height)" }
  }
}
$report.virtualScreen = Try-Get {
  $v = [System.Windows.Forms.SystemInformation]::VirtualScreen
  "$($v.Width)x$($v.Height) at $($v.X),$($v.Y)"
}
# Architecture §9: try to raise the resolution (Windows Server cmdlet).
$report.setDisplayResolution = Try-Get {
  if (Get-Command Set-DisplayResolution -ErrorAction SilentlyContinue) {
    # The cmdlet prints UTF-16 text through the pipeline; keep only the outcome.
    $null = Set-DisplayResolution -Width 1920 -Height 1080 -Force -ErrorAction Stop *>&1
    Start-Sleep -Seconds 2
    $v = [System.Windows.Forms.SystemInformation]::VirtualScreen
    "ok, now $($v.Width)x$($v.Height)"
  } else { 'cmdlet not available' }
}

# --- WebView2 runtime ------------------------------------------------------
$wv2Guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$report.webview2 = [ordered]@{
  machine = Try-Get { (Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$wv2Guid" -ErrorAction Stop).pv }
  user    = Try-Get { (Get-ItemProperty "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$wv2Guid" -ErrorAction Stop).pv }
  edge    = Try-Get { (Get-Item "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" -ErrorAction Stop).VersionInfo.ProductVersion }
}

# --- The app with --s1-harness ----------------------------------------------
$s1Json = Join-Path $env:TEMP 'mastersat-s1.json'
$s1Png = Join-Path $env:TEMP 'mastersat-s1-island.png'
Remove-Item $s1Json, $s1Png -ErrorAction SilentlyContinue

$report.app = [ordered]@{ exe = $Exe; exists = (Test-Path $Exe) }
if (Test-Path $Exe) {
  $bundle = Split-Path $Exe
  $report.app.islandFiles = Try-Get { (Get-ChildItem -Recurse (Join-Path $bundle 'data\island') -File | Measure-Object).Count }
  $report.app.nativeDll = Test-Path (Join-Path $bundle 'mastersat_native.dll')
  $started = Get-Date
  $proc = Start-Process -FilePath $Exe -ArgumentList '--s1-harness' -PassThru `
    -RedirectStandardOutput (Join-Path $OutDir 'app-stdout.txt') `
    -RedirectStandardError (Join-Path $OutDir 'app-stderr.txt')
  $report.app.pid = $proc.Id

  # Wait for the harness to report (or the time budget), then screenshot.
  $deadline = $started.AddSeconds($Seconds)
  $shotAt = $started.AddSeconds([Math]::Max(5, $Seconds - 5))
  while ((Get-Date) -lt $shotAt -and -not $proc.HasExited) { Start-Sleep -Milliseconds 500 }
  $report.app.mainWindowTitle = Try-Get { (Get-Process -Id $proc.Id -ErrorAction Stop).MainWindowTitle }

  $report.screenshot = Try-Get {
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
    $path = Join-Path $OutDir 'screen.png'
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    # A black frame means no desktop to capture (or capture excluded).
    $sample = 0; $dark = 0
    for ($x = 0; $x -lt $bmp.Width; $x += [Math]::Max(1, [int]($bmp.Width / 40))) {
      for ($y = 0; $y -lt $bmp.Height; $y += [Math]::Max(1, [int]($bmp.Height / 40))) {
        $p = $bmp.GetPixel($x, $y); $sample++
        if (($p.R + $p.G + $p.B) -lt 30) { $dark++ }
      }
    }
    $g.Dispose(); $bmp.Dispose()
    [ordered]@{ path = 'screen.png'; size = "$($b.Width)x$($b.Height)"; darkFraction = [Math]::Round($dark / [Math]::Max(1, $sample), 3) }
  }

  while ((Get-Date) -lt $deadline -and -not $proc.HasExited -and -not (Test-Path $s1Json)) { Start-Sleep -Milliseconds 500 }
  Start-Sleep -Seconds 1
  $report.app.exitedEarly = $proc.HasExited
  if ($proc.HasExited) { $report.app.exitCode = $proc.ExitCode }
  else { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  $report.app.ranSeconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 1)
}

if (Test-Path $s1Json) {
  Copy-Item $s1Json (Join-Path $OutDir 'mastersat-s1.json')
  $report.s1 = Try-Get { Get-Content -Raw $s1Json | ConvertFrom-Json }
} else {
  $report.s1 = 'no mastersat-s1.json was written'
}
if (Test-Path $s1Png) { Copy-Item $s1Png (Join-Path $OutDir 'island.png') }

$json = $report | ConvertTo-Json -Depth 8
Set-Content -Path (Join-Path $OutDir 's0-diagnostics.json') -Value $json -Encoding utf8
Write-Host $json
exit 0
