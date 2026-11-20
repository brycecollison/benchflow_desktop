# Install the Benchflow phone app on an Android phone plugged in over USB (USB debugging on).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-android.ps1
#   ... -Build     build the APK first (mobile\build-apk.ps1; needs JDK 21 and the Android SDK)
#   ... -Serial ID only this phone, when more than one is plugged in (adb devices)
#
# Builds the APK when there is none yet. Downloads Google's adb the first time if this computer has none.
# An installed Benchflow does the same from Settings > Phone sync, or: Benchflow.exe --install-android
param(
    [switch]$Build,
    [string]$Serial = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$py = Join-Path $root "venv\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "No venv at $root\venv. Create it, then: $py -m pip install -r backend\requirements.txt" }

$apk = Join-Path $root "build\android\benchflow-companion.apk"
if ($Build -or -not (Test-Path $apk)) {
    & (Join-Path $root "mobile\build-apk.ps1")
    if ($LASTEXITCODE -ne 0) { throw "APK build failed" }
}

Set-Location (Join-Path $root "backend")
$argList = @("-m", "app.mobile_sync.android")
if ($Serial) { $argList += @("--serial", $Serial) }
& $py @argList
exit $LASTEXITCODE
