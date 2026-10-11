<#
.SYNOPSIS
  What the installer is made of, against the 25 MB budget (architecture §10, S4).

.DESCRIPTION
  Reads the app bundle (flutter build windows output) and the Velopack output, and reports
  per component:
    * bytes on disk in the bundle (what the student's disk holds);
    * bytes inside the full .nupkg (each zip entry's compressed size, lib/app/<path>);
  plus the Setup.exe itself and its fixed Velopack part (Setup.exe minus the embedded nupkg).

  Components: Flutter engine (flutter_windows.dll + icudtl.dat), the Dart app (data/app.so),
  Flutter assets (data/flutter_assets), the island (data/island), mastersat_native.dll, the
  WebView2 plugin (ms_webview2_plugin.dll + WebView2Loader.dll), SQLite (sqlite3.dll), other
  plugins, the runner (MasterSAT.exe), and anything else.

  Writes size-report.json and size-report.md into -OutDir and appends the table to
  $GITHUB_STEP_SUMMARY when it exists. With -Enforce, exits 1 when Setup.exe is over budget.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BundleDir,
  [Parameter(Mandatory = $true)][string]$VelopackDir,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [long]$BudgetBytes = 25000000,
  [switch]$Enforce
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$BundleDir = (Resolve-Path $BundleDir).Path
$setup = Get-ChildItem $VelopackDir -Filter '*-Setup.exe' | Select-Object -First 1
$nupkg = Get-ChildItem $VelopackDir -Filter '*-full.nupkg' | Select-Object -First 1
if (-not $setup -or -not $nupkg) { throw "No Setup.exe / full.nupkg in $VelopackDir" }

# Bundle-relative path (forward slashes) -> component name.
function Get-Component([string]$rel) {
  $r = $rel.ToLowerInvariant()
  switch -Regex ($r) {
    '^flutter_windows\.dll$' { return 'Flutter engine' }
    '^data/icudtl\.dat$' { return 'Flutter engine' }
    '^data/app\.so$' { return 'Dart app (AOT)' }
    '^data/flutter_assets/' { return 'Flutter assets' }
    '^data/island/' { return 'Island (data\island)' }
    '^mastersat_native\.dll$' { return 'mastersat_native.dll' }
    '^ms_webview2_plugin\.dll$' { return 'WebView2 plugin' }
    '^webview2loader\.dll$' { return 'WebView2 plugin' }
    '^sqlite3\.dll$' { return 'SQLite (sqlite3.dll)' }
    '^[^/]+_plugin\.dll$' { return 'Other plugins' }
    '^dartjni\.dll$' { return 'Other plugins' }
    '^mastersat\.exe$' { return 'Runner (MasterSAT.exe)' }
    default { return 'Other' }
  }
}

$rows = [ordered]@{}
function Add-Row([string]$component, [string]$field, [long]$bytes, [string]$file) {
  if (-not $rows.Contains($component)) {
    $rows[$component] = [ordered]@{ component = $component; diskBytes = [long]0; nupkgBytes = [long]0; files = 0 }
  }
  $rows[$component][$field] += $bytes
  if ($field -eq 'diskBytes') { $rows[$component].files += 1 }
}

# --- On disk ---------------------------------------------------------------
$diskTotal = [long]0
Get-ChildItem -Recurse -File $BundleDir | ForEach-Object {
  $rel = $_.FullName.Substring($BundleDir.Length).TrimStart('\', '/').Replace('\', '/')
  Add-Row (Get-Component $rel) 'diskBytes' $_.Length $rel
  $diskTotal += $_.Length
}

# --- Inside the nupkg (compressed) ------------------------------------------
$nupkgApp = [long]0
$nupkgMeta = [long]0
$largest = @()
$zip = [System.IO.Compression.ZipFile]::OpenRead($nupkg.FullName)
try {
  foreach ($e in $zip.Entries) {
    $name = [Uri]::UnescapeDataString($e.FullName).Replace('\', '/')
    if ($name -match '^lib/app/(.+)$') {
      $rel = $Matches[1]
      Add-Row (Get-Component $rel) 'nupkgBytes' $e.CompressedLength $rel
      $nupkgApp += $e.CompressedLength
      $largest += [pscustomobject]@{ path = $rel; bytes = $e.Length; compressed = $e.CompressedLength }
    } else {
      $nupkgMeta += $e.CompressedLength
    }
  }
} finally { $zip.Dispose() }

$setupBytes = $setup.Length
$nupkgBytes = $nupkg.Length
$report = [ordered]@{
  setupExe          = $setup.Name
  setupBytes        = $setupBytes
  budgetBytes       = $BudgetBytes
  underBudget       = $setupBytes -le $BudgetBytes
  headroomBytes     = $BudgetBytes - $setupBytes
  nupkg             = $nupkg.Name
  nupkgBytes        = $nupkgBytes
  # Setup.exe = Velopack's setup program + the embedded full nupkg.
  velopackSetupBytes = $setupBytes - $nupkgBytes
  nupkgAppBytes     = $nupkgApp
  # zip directory, nuspec, Velopack metadata (everything outside lib/app/).
  nupkgOverheadBytes = $nupkgBytes - $nupkgApp
  bundleDiskBytes   = $diskTotal
  components        = @($rows.Values | Sort-Object { -$_.nupkgBytes })
  largestFiles      = @($largest | Sort-Object compressed -Descending | Select-Object -First 15)
}
$report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $OutDir 'size-report.json')

function Mb([long]$b) { '{0:N2} MB' -f ($b / 1e6) }
$md = New-Object System.Collections.Generic.List[string]
$verdict = if ($report.underBudget) { "under budget by $(Mb $report.headroomBytes)" } else { "**OVER budget by $(Mb (-$report.headroomBytes))**" }
$md.Add("### Installer size: $($setup.Name) = $('{0:N0}' -f $setupBytes) bytes ($(Mb $setupBytes)), $verdict (budget $(Mb $BudgetBytes))")
$md.Add('')
$md.Add('| Component | On disk | In the installer (compressed) | Files |')
$md.Add('|---|---:|---:|---:|')
foreach ($r in $report.components) {
  $md.Add("| $($r.component) | $('{0:N0}' -f $r.diskBytes) | $('{0:N0}' -f $r.nupkgBytes) | $($r.files) |")
}
$md.Add("| nupkg metadata + zip directory | | $('{0:N0}' -f $report.nupkgOverheadBytes) | |")
$md.Add("| Velopack setup program (Setup.exe minus nupkg) | | $('{0:N0}' -f $report.velopackSetupBytes) | |")
$md.Add("| **Setup.exe** | $('{0:N0}' -f $diskTotal) | **$('{0:N0}' -f $setupBytes)** | |")
$md.Add('')
$md.Add('Largest files (compressed in the nupkg):')
$md.Add('')
$md.Add('| File | On disk | Compressed |')
$md.Add('|---|---:|---:|')
foreach ($f in $report.largestFiles) { $md.Add("| $($f.path) | $('{0:N0}' -f $f.bytes) | $('{0:N0}' -f $f.compressed) |") }
$text = $md -join "`n"
Set-Content -Encoding utf8 (Join-Path $OutDir 'size-report.md') $text
Write-Host $text
if ($env:GITHUB_STEP_SUMMARY) { Add-Content -Encoding utf8 $env:GITHUB_STEP_SUMMARY ($text + "`n") }

if (-not $report.underBudget) {
  $msg = "Setup.exe is $('{0:N0}' -f $setupBytes) bytes, over the $('{0:N0}' -f $BudgetBytes)-byte budget"
  if ($Enforce) { Write-Host "::error::$msg"; exit 1 } else { Write-Host "::warning::$msg" }
}
exit 0
