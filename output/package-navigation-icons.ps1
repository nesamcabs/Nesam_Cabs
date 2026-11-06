$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Join-Path $PSScriptRoot 'navigation-icons-reference-style'
$entries = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'navigation-icons-manifest.json') -Raw | ConvertFrom-Json
$rows = @()
$report = @()
foreach ($entry in $entries) {
  $folder = Join-Path $root $entry.brand
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
  $target = Join-Path $folder ($entry.icon + '.png')
  $sourcePath = ($entry.source -split ' as ')[-1]
  Copy-Item -LiteralPath $sourcePath -Destination $target
  $bitmap = [System.Drawing.Bitmap]::new($target)
  if ($bitmap.GetPixel(0,0).A -gt 1) { throw "Non-transparent corner: $target" }
  if (($bitmap.PixelFormat -band [System.Drawing.Imaging.PixelFormat]::Alpha) -eq 0) { throw "Missing alpha: $target" }
  $report += "$($entry.brand)/$($entry.icon).png : $($bitmap.Width)x$($bitmap.Height), alpha verified"
  $bitmap.Dispose()
  $rows += '<figure><img src="' + $entry.brand + '/' + $entry.icon + '.png" alt="' + $entry.icon + '"><figcaption>' + $entry.brand + ' / ' + $entry.icon + '</figcaption></figure>'
}
$html = '<!doctype html><html><meta charset="utf-8"><title>Three-brand navigation icons</title><style>body{font-family:Arial,sans-serif;background:#f5f7fa;color:#17243b;padding:32px}main{display:grid;grid-template-columns:repeat(5,minmax(100px,1fr));gap:20px}figure{margin:0;padding:16px;background:white;border-radius:16px;text-align:center}img{width:100%;aspect-ratio:1;object-fit:contain}figcaption{font-size:12px;margin-top:12px}</style><h1>Navigation icon collection</h1><p>15 transparent PNG icons. Five per brand.</p><main>' + ($rows -join '') + '</main></html>'
Set-Content -LiteralPath (Join-Path $root 'preview.html') -Value $html -Encoding UTF8
Set-Content -LiteralPath (Join-Path $root 'README.txt') -Encoding UTF8 -Value "Three-brand navigation icons`r`n`r`nFive transparent PNG icons per brand: outstation, multicity, local-rentals, airport-taxi, profile.`r`nGenerated with the built-in image generation tool using the supplied navigation reference and brand logos.`r`nOpen preview.html to view the collection. PNG files contain no labels or navigation backgrounds.`r`nKeep aspect ratio when displaying. Original resolution preserved.`r`n`r`nValidation:`r`n$($report -join "`r`n")"
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'navigation-icons-manifest.json') -Destination (Join-Path $root 'generation-prompts.json')
$zipPath = Join-Path $PSScriptRoot 'three-brands-navigation-icons.zip'
[System.IO.Compression.ZipFile]::CreateFromDirectory($root,$zipPath)
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$pngs = @($zip.Entries | Where-Object { $_.FullName.EndsWith('.png') })
if ($pngs.Count -ne 15) { throw 'ZIP must contain 15 PNGs' }
$zip.Dispose()
Write-Output ($report -join "`n")
Get-Item -LiteralPath $zipPath | Select-Object FullName,Length
