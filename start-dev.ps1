# Lab Planner & ELN Development Server Launcher

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Starting Lab Planner & ELN (FastAPI + Vite React)        " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Start FastAPI backend in background
Write-Host "`n[1/2] Launching FastAPI Backend on http://127.0.0.1:8000..." -ForegroundColor Green

# The repo is synced by OneDrive, so ./venv may contain compiled wheels built for a
# different machine's Python (e.g. cp314 wheels under a 3.12 interpreter). Accept only
# an interpreter that can actually import the backend dependencies.
function Test-BackendPython($p) {
    if (-not $p -or -not (Test-Path $p)) { return $false }
    & $p -c "import fastapi, sqlmodel" 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

$python = $env:BENCHFLOW_PYTHON
if (-not (Test-BackendPython $python)) {
    $python = $null
    foreach ($c in @(
        (Join-Path $PSScriptRoot "venv\Scripts\python.exe"),
        (Join-Path $env:USERPROFILE ".venvs\lab-planner-eln\Scripts\python.exe")
    )) {
        if (Test-BackendPython $c) { $python = $c; break }
    }
}
if (-not $python) {
    throw "No usable Python environment: the synced venv does not work with this machine's Python. Create one (python -m venv .. ; pip install -r backend/requirements.txt) outside the synced folder and set BENCHFLOW_PYTHON to its python.exe."
}
$backendProcess = Start-Process -FilePath $python -ArgumentList "run.py" -WorkingDirectory "$PSScriptRoot\backend" -PassThru

# 2. Start Vite frontend
Write-Host "[2/2] Launching Vite Frontend on http://localhost:5173..." -ForegroundColor Green
Set-Location -Path "$PSScriptRoot\frontend"
try {
    npm run dev
} finally {
    Write-Host "`nStopping backend process..." -ForegroundColor Yellow
    if ($backendProcess -and !$backendProcess.HasExited) {
        Stop-Process -Id $backendProcess.Id -Force
    }
    # A forced kill skips FastAPI's shutdown hook, so the snapshot it would have taken has to
    # happen here (app/backup.py). No-op until a backup folder is configured in Settings.
    Write-Host "Snapshotting the notebook to the backup folder..." -ForegroundColor Yellow
    Push-Location "$PSScriptRoot\backend"
    & $python -m app.backup
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARN] snapshot failed - use Settings > Personal OneDrive Backup > Back up now." -ForegroundColor Yellow
    }
    Pop-Location
}
