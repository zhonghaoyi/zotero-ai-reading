$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$ManifestPath = Join-Path $RootDir "manifest.json"
$Manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
$Version = $Manifest.version
$DistDir = Join-Path $RootDir "dist"
$XpiPath = Join-Path $DistDir "zotero-ai-reading-$Version.xpi"

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
if (Test-Path -LiteralPath $XpiPath) {
  Remove-Item -LiteralPath $XpiPath -Force
}

$Entries = @(
  @{ Source = "manifest.json"; Entry = "manifest.json" },
  @{ Source = "bootstrap.js"; Entry = "bootstrap.js" },
  @{ Source = "prefs.js"; Entry = "prefs.js" },
  @{ Source = "zotero-ai-reading.js"; Entry = "zotero-ai-reading.js" },
  @{ Source = "preferences.xhtml"; Entry = "preferences.xhtml" },
  @{ Source = "icons\icon.png"; Entry = "icons/icon.png" }
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Zip = [System.IO.Compression.ZipFile]::Open($XpiPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($Item in $Entries) {
    $SourcePath = Join-Path $RootDir $Item.Source
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $Zip,
      $SourcePath,
      $Item.Entry,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
}
finally {
  $Zip.Dispose()
}

Write-Output $XpiPath
