# Forge installer for Windows — usage:
#   irm https://YOUR-DOMAIN/install.ps1 | iex
$ErrorActionPreference = "Stop"

Write-Host "Forge installer" -ForegroundColor DarkYellow

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js is required (v18+). Install from https://nodejs.org and re-run." -ForegroundColor Red
    exit 1
}

$repo = if ($env:FORGE_REPO) { $env:FORGE_REPO } else { "https://github.com/johnjones20902-lab/forge-cli" }
$installDir = Join-Path $env:USERPROFILE ".forge\app"

if (Test-Path $installDir) { Remove-Item -Recurse -Force $installDir }
New-Item -ItemType Directory -Force $installDir | Out-Null

if (Get-Command git -ErrorAction SilentlyContinue) {
    git clone --depth 1 $repo $installDir | Out-Null
} else {
    $zip = Join-Path $env:TEMP "forge.zip"
    Invoke-WebRequest "$repo/archive/refs/heads/main.zip" -OutFile $zip
    Expand-Archive $zip -DestinationPath $env:TEMP -Force
    Copy-Item (Join-Path $env:TEMP "forge-cli-main\*") $installDir -Recurse -Force
}

Set-Location $installDir
npm install --omit=dev --silent
npm link --silent

Write-Host "`n✔ Forge installed! Run:  forge" -ForegroundColor Green
