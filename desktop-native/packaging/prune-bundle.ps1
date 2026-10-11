<#
.SYNOPSIS
  Removes files from the built app bundle that the app can never load (installer budget,
  architecture §10 S4: Setup.exe at most 26 MB).

.DESCRIPTION
  Run after `flutter build windows --release` and before `vpk pack` (pack.ps1 runs it too;
  it is idempotent). It prints every file it removes and the bytes saved, and it removes
  nothing at all when one of its guards fails (exit 1).

  1. Unused Lucide weights. lucide_icons_flutter declares seven font families: `Lucide` (the
     icons the app draws) and `Lucide100` ... `Lucide600`, variable-weight copies of the same
     icons, about 2.9 MB on disk and 1.4 MB in the installer. Flutter bundles every font family a
     package declares, and its icon tree shaker only shrinks families a const IconData uses, so
     unused families ship whole. This drops those six families from
     data\flutter_assets\FontManifest.json and deletes their files.
     Guard: no Dart file under -AppLibDir uses a weighted icon (`LucideIcons.<name>100` ...
     `<name>600`, with or without `Dir`) or names a `Lucide100` ... `Lucide600` family. No base
     Lucide icon name ends in those digits, so the check has no false positives.

  2. KaTeX's fallback font formats. The island ships each KaTeX font as .woff2, .woff and .ttf.
     Its CSS lists woff2 first in every @font-face, and WebView2 (Chromium) always takes woff2,
     so the .woff and .ttf copies in data\island are never requested.
     Guard: every @font-face in data\island\*.css names a .woff2 before any .woff/.ttf, and
     every removed file has a .woff2 sibling for the same KaTeX face.
#>
[CmdletBinding()]
param(
  [string]$BundleDir = (Join-Path $PSScriptRoot '..\app\build\windows\x64\runner\Release'),
  [string]$AppLibDir = (Join-Path $PSScriptRoot '..\app\lib')
)

$ErrorActionPreference = 'Stop'
$BundleDir = (Resolve-Path $BundleDir).Path
$assets = Join-Path $BundleDir 'data\flutter_assets'
$island = Join-Path $BundleDir 'data\island'
$removeFiles = New-Object System.Collections.Generic.List[string]
$problems = New-Object System.Collections.Generic.List[string]

# --- 1. Lucide weight families ---------------------------------------------------------------
$manifestPath = Join-Path $assets 'FontManifest.json'
$manifest = $null
$dropFamilies = @()
if (Test-Path $manifestPath) {
  $manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
  $dropFamilies = @($manifest | Where-Object { $_.family -match '^packages/lucide_icons_flutter/Lucide(100|200|300|400|500|600)$' })
  if ($dropFamilies.Count -gt 0) {
    if (-not (Test-Path $AppLibDir)) { $problems.Add("no Dart sources at $AppLibDir to check Lucide use against") }
    else {
      $pattern = 'LucideIcons\.[A-Za-z0-9_]+?(100|200|300|400|500|600)(Dir)?\b|[''"]Lucide(100|200|300|400|500|600)[''"]'
      $uses = @(Get-ChildItem -Recurse -File -Filter '*.dart' $AppLibDir | Select-String -Pattern $pattern)
      foreach ($u in $uses) { $problems.Add("weighted Lucide icon used at $($u.Path):$($u.LineNumber): $($u.Line.Trim())") }
    }
    foreach ($fam in $dropFamilies) {
      foreach ($f in $fam.fonts) {
        $path = Join-Path $assets ($f.asset -replace '/', '\')
        if (Test-Path $path) { $removeFiles.Add($path) }
      }
    }
  }
}

# --- 2. KaTeX .woff / .ttf ------------------------------------------------------------------------
if (Test-Path $island) {
  $css = Get-ChildItem -File -Filter '*.css' $island
  foreach ($c in $css) {
    $text = Get-Content -Raw $c.FullName
    foreach ($m in [regex]::Matches($text, '@font-face\s*\{[^}]*\}')) {
      $block = $m.Value
      $first = [regex]::Match($block, 'url\(([^)]+)\)')
      if ($block -match '\.(woff|ttf)\b' -and -not ($first.Success -and $first.Groups[1].Value -match '\.woff2')) {
        $problems.Add("$($c.Name): an @font-face does not name a .woff2 first: $($block.Substring(0, [Math]::Min(120, $block.Length)))")
      }
    }
  }
  # KaTeX_<Family>-<Style>-<hash>.<ext> (Vite's hash may itself contain '-').
  function Get-KatexFace([string]$name) { if ($name -match '^(KaTeX_[A-Za-z0-9]+-[A-Za-z]+)-') { $Matches[1] } else { $null } }
  $fonts = Get-ChildItem -File $island | Where-Object { $_.Name -like 'KaTeX_*' }
  $woff2Faces = @($fonts | Where-Object { $_.Extension -eq '.woff2' } | ForEach-Object { Get-KatexFace $_.Name })
  foreach ($f in ($fonts | Where-Object { $_.Extension -in '.woff', '.ttf' })) {
    # The face must also exist as .woff2.
    $face = Get-KatexFace $f.Name
    if (-not $face -or $woff2Faces -notcontains $face) {
      $problems.Add("$($f.Name) has no .woff2 sibling")
    } else {
      $removeFiles.Add($f.FullName)
    }
  }
}

if ($problems.Count -gt 0) {
  $problems | ForEach-Object { Write-Host "::error::prune-bundle: $_" }
  Write-Host 'prune-bundle: nothing was removed'
  exit 1
}

$saved = [long]0
foreach ($p in $removeFiles) {
  $len = (Get-Item $p).Length
  $saved += $len
  Write-Host ('prune-bundle: removed {0} ({1:N0} bytes)' -f $p.Substring($BundleDir.Length + 1), $len)
  Remove-Item -Force $p
}
if ($dropFamilies.Count -gt 0) {
  $kept = @($manifest | Where-Object { $dropFamilies.family -notcontains $_.family })
  # FontManifest.json is a JSON array; keep it one even with a single family left.
  ConvertTo-Json -InputObject $kept -Depth 6 -Compress | Set-Content -Encoding utf8NoBOM $manifestPath
  Write-Host "prune-bundle: FontManifest.json no longer lists $(($dropFamilies.family) -join ', ')"
}
if ($removeFiles.Count -eq 0) { Write-Host 'prune-bundle: nothing to remove (already pruned)' }
else { Write-Host ('prune-bundle: {0} files, {1:N0} bytes on disk' -f $removeFiles.Count, $saved) }
exit 0
