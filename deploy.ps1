param(
  [string]$VaultPath,
  [switch]$Build,
  [switch]$Verbose
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg){ Write-Host "[deploy] $msg" -ForegroundColor Cyan }
function Write-Warn($msg){ Write-Host "[deploy] $msg" -ForegroundColor Yellow }
function Write-Err($msg){ Write-Host "[deploy] $msg" -ForegroundColor Red }

if (-not $VaultPath -or $VaultPath.Trim() -eq '') {
  $VaultPath = $env:RIVE_VAULT
}

if (-not $VaultPath -or -not (Test-Path $VaultPath)) {
  Write-Err "Vault path not supplied or does not exist. Provide -VaultPath or set RIVE_VAULT environment variable."
  Write-Host "Example: powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -VaultPath 'C:\\Notes\\MyVault' -Build"
  exit 1
}

$pluginId = 'obsidian-rive-plugin'
$pluginTarget = Join-Path $VaultPath ".obsidian/plugins/$pluginId"

if (-not (Test-Path $pluginTarget)) {
  Write-Info "Creating plugin directory: $pluginTarget"
  New-Item -ItemType Directory -Force -Path $pluginTarget | Out-Null
}

if ($Build) {
  Write-Info "Running production build (npm run build)"
  npm run build | Write-Host
}

$files = @('manifest.json','main.js','styles.css')
foreach ($f in $files) {
  if (-not (Test-Path $f)) {
    Write-Err "Required file missing: $f. Did the build succeed?"
    exit 1
  }
}

foreach ($f in $files) {
  $dest = Join-Path $pluginTarget $f
  Copy-Item $f $dest -Force
  if ($Verbose) { Write-Info "Copied $f -> $dest" }
}

# Optional: copy versions.json if present (helps local testing of updates)
if (Test-Path 'versions.json') { Copy-Item versions.json (Join-Path $pluginTarget 'versions.json') -Force }

Write-Info "Deployment complete -> $pluginTarget"
Write-Host "Reload Obsidian (Ctrl+R) or toggle the plugin to load new code." -ForegroundColor Green
