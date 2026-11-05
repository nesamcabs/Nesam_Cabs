<#
  Builds a NESAM mobile app for Android and collects the artifacts.

  Why a mirror: this repository lives under a long Windows path
  ("...\Desktop\Legendary One\Nesam_Tours_And_Travels-main\..."). React Native's
  native (CMake/ninja) build appends long generated paths and exceeds the
  260-character Windows limit. The app is mirrored to a short real path
  (C:\nb\<app>) and built there; the repository copy stays the source of truth.

  Usage (from any directory):
    powershell -ExecutionPolicy Bypass -File scripts\build-mobile-android.ps1 -App customer
    powershell -ExecutionPolicy Bypass -File scripts\build-mobile-android.ps1 -App driver -Tasks assembleDebug

  Release signing: set NESAM_UPLOAD_STORE_FILE, NESAM_UPLOAD_STORE_PASSWORD,
  NESAM_UPLOAD_KEY_ALIAS and NESAM_UPLOAD_KEY_PASSWORD before running to sign
  with your upload key. Without them the release build is debug-signed
  (installable for QA, NOT accepted by Google Play).

  Optional: GOOGLE_MAPS_ANDROID_API_KEY enables the embedded map (customer).
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('customer', 'driver', 'vendor')][string]$App,
  [string[]]$Tasks = @('assembleDebug', 'assembleRelease', 'bundleRelease'),
  [string]$WorkRoot = 'C:\nb'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$source = @{ customer = 'user\app'; driver = 'driver\app'; vendor = 'vendor\app' }[$App]
$label = @{ customer = 'Customer'; driver = 'Driver'; vendor = 'Vendor' }[$App]
$work = Join-Path $WorkRoot $App
$out = Join-Path $repo "release-output\$App"

Write-Host "==> Mirroring $source to $work"
New-Item -ItemType Directory -Force -Path $work | Out-Null
# /MIR mirrors the tree; android/ is generated in the workspace by prebuild and
# kept between runs for incremental Gradle builds. Exclusions are full paths so
# only the app's own top-level folders are skipped (packages inside
# node_modules have their own dist/ folders that must be copied).
$srcPath = Join-Path $repo $source
$exclude = @('android', '.expo', 'dist', 'coverage') | ForEach-Object { Join-Path $srcPath $_ }
robocopy $srcPath $work /MIR /XD @exclude /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }

Push-Location $work
try {
  Write-Host '==> expo prebuild (android)'
  $env:CI = '1'
  npx expo prebuild --platform android --no-install
  if ($LASTEXITCODE -ne 0) { throw 'expo prebuild failed' }

  Push-Location android
  try {
    Write-Host "==> gradlew $($Tasks -join ' ')"
    .\gradlew.bat @Tasks --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Gradle build failed' }
  } finally {
    Pop-Location
  }

  New-Item -ItemType Directory -Force -Path $out | Out-Null
  $artifacts = @(
    @{ From = 'android\app\build\outputs\apk\debug\app-debug.apk'; To = "NESAM-$label-debug.apk" },
    @{ From = 'android\app\build\outputs\apk\release\app-release.apk'; To = "NESAM-$label.apk" },
    @{ From = 'android\app\build\outputs\bundle\release\app-release.aab'; To = "NESAM-$label.aab" }
  )
  foreach ($a in $artifacts) {
    $path = Join-Path $work $a.From
    if (Test-Path $path) {
      Copy-Item $path (Join-Path $out $a.To) -Force
      $size = [math]::Round((Get-Item $path).Length / 1MB, 1)
      Write-Host "    $($a.To)  ($size MB)"
    }
  }
  Write-Host "==> Artifacts in $out"
} finally {
  Pop-Location
}
