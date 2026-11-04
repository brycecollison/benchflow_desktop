# Build the Benchflow desktop app end to end: the UI, the exe, the portable zip, the installer.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File packaging\build.ps1
#   ... -Seed           refresh seed\ from the web app's data folder first (needs -WebRepo or the
#                       sibling checkout named in UPSTREAM.md)
#   ... -SkipTest      skip packaging/test_frozen.py (which opens a real window)
#   ... -SkipInstaller skip the Inno Setup step
#
# Needs: Node (for the UI), this repo's venv with pyinstaller, and Inno Setup 6 for the installer
# (iscc.exe on PATH, or point $env:ISCC at it).
param(
    [switch]$Seed,
    [string]$WebRepo = "",
    [switch]$SkipTest,
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$py = Join-Path $root "venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    throw "No venv at $root\venv. Create it, then: $py -m pip install -r backend\requirements.txt"
}

if ($Seed) {
    Write-Host "`n=== refresh seed\\ from the web app ===" -ForegroundColor Cyan
    $web = if ($WebRepo) { $WebRepo } else { Join-Path (Split-Path -Parent $root) "Lab Planner and ELN\Lab-Planner-ELN" }
    $webDb = Join-Path $web "backend\data\benchflow.db"
    if (-not (Test-Path $webDb)) { throw "No notebook to copy at $webDb - pass -WebRepo <path to the web checkout>" }
    New-Item -ItemType Directory -Force -Path (Join-Path $root "seed\data") | Out-Null
    Copy-Item $webDb (Join-Path $root "seed\data\benchflow.db") -Force
    $webUploads = Join-Path $web "backend\uploads"
    if (Test-Path $webUploads) {
        Remove-Item -Recurse -Force (Join-Path $root "seed\uploads") -ErrorAction SilentlyContinue
        Copy-Item $webUploads (Join-Path $root "seed\uploads") -Recurse -Force
    }
    $attachments = @(Get-ChildItem (Join-Path $root "seed\uploads") -File -ErrorAction SilentlyContinue)
    $sizeMb = [math]::Round((($attachments | Measure-Object Length -Sum).Sum) / 1MB, 1)
    Write-Host "seed now holds the notebook at $webDb plus $($attachments.Count) attachment file(s) ($sizeMb MB)"
}

Write-Host "`n=== the UI ===" -ForegroundColor Cyan
npm --prefix frontend ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
npm --prefix frontend run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }

Write-Host "`n=== the exe (onedir) ===" -ForegroundColor Cyan
& $py -m PyInstaller packaging/benchflow.spec --noconfirm
if ($LASTEXITCODE -ne 0) { throw "pyinstaller failed" }
$exe = Join-Path $root "dist\Benchflow\Benchflow.exe"
if (-not (Test-Path $exe)) { throw "No exe at $exe" }

if (-not $SkipTest) {
    Write-Host "`n=== smoke test: start it, use it, close it ===" -ForegroundColor Cyan
    & $py packaging/test_frozen.py
    if ($LASTEXITCODE -ne 0) { throw "packaging/test_frozen.py failed - do not ship this build" }
}

# One source for the version: app/sharepoint_export.py: APP_VERSION (also stamped into every
# manifest, so an installed app and its backups agree).
$version = (& $py -c "import sys; sys.path.insert(0, 'backend'); from app.sharepoint_export import APP_VERSION; print(APP_VERSION)").Trim()

Write-Host "`n=== artifacts ===" -ForegroundColor Cyan
$zip = Join-Path $root "dist\Benchflow-$version-windows-portable.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path (Join-Path $root "dist\Benchflow") -DestinationPath $zip
Write-Host "portable folder: $zip"

if (-not $SkipInstaller) {
    $iscc = if ($env:ISCC) { $env:ISCC } else { (Get-Command iscc.exe -ErrorAction SilentlyContinue).Source }
    if (-not $iscc) {
        # winget installs Inno per-user when it runs unelevated, and leaves it off PATH.
        foreach ($candidate in @(
            (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
            (Join-Path $env:LOCALAPPDATA "Inno Setup 6\ISCC.exe"))) {
            if (Test-Path $candidate) { $iscc = $candidate; break }
        }
    }
    if (-not $iscc) {
        throw "iscc.exe not found. Install Inno Setup 6, or set `$env:ISCC to it, or re-run with -SkipInstaller."
    }
    & $iscc "/DVersion=$version" "/DAppDir=$(Join-Path $root 'dist\Benchflow')" (Join-Path $root "packaging\setup.iss")
    if ($LASTEXITCODE -ne 0) { throw "iscc failed" }
    Get-ChildItem (Join-Path $root "dist\installer") | ForEach-Object { Write-Host "installer: $_" }
}

Write-Host "`nBuilt version $version." -ForegroundColor Green
# The in-app update check compares a release tag against APP_VERSION and downloads the asset whose
# name it builds from that tag, so a release without both is invisible to every installed build.
Write-Host "to release: tag this commit v$version, and attach dist\installer\Benchflow-$version-Setup.exe to that release"
