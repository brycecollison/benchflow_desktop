# Build the Android phone app into build\android\benchflow-companion.apk.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File mobile\build-apk.ps1
#
# packaging\build.ps1 runs this and bundles the APK into the exe (Settings > Phone sync installs it).
# Needs: Node, JDK 21 (JAVA_HOME; e.g. winget install EclipseAdoptium.Temurin.21.JDK) and the Android
# SDK (ANDROID_HOME, default %LOCALAPPDATA%\Android\Sdk; Android Studio installs it).
#
# The APK is debug-signed, with this computer's ~/.android/debug.keystore. A phone that has the app
# from a build signed on another computer refuses an in-place update (the installer says so).
$ErrorActionPreference = "Stop"
$mobile = $PSScriptRoot
$root = Split-Path -Parent $mobile

if (-not $env:ANDROID_HOME) {
    $sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
    if (-not (Test-Path $sdk)) { throw "No Android SDK. Install Android Studio, or set ANDROID_HOME to the SDK folder." }
    $env:ANDROID_HOME = $sdk
}
$java = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME "bin\java.exe" } else { (Get-Command java.exe -ErrorAction SilentlyContinue).Source }
if (-not $java -or -not (Test-Path $java)) { throw "No JDK. Install JDK 21 and set JAVA_HOME to it." }
# java prints its version on stderr, which "Stop" would turn into an error
$ErrorActionPreference = "Continue"
$versionText = (& $java -version 2>&1 | Select-Object -First 1).ToString()
$ErrorActionPreference = "Stop"
if ($versionText -notmatch '"(\d+)') { throw "Could not read the Java version from: $versionText" }
if ([int]$Matches[1] -lt 21) { throw "Java $($Matches[1]) found; the Android build needs JDK 21. Install it and set JAVA_HOME to it." }
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $java) }

Push-Location $mobile
try {
    if (-not (Test-Path node_modules)) { npm ci; if ($LASTEXITCODE -ne 0) { throw "npm ci failed" } }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "web build failed" }
    npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw "cap sync failed" }
    Push-Location android
    try {
        & .\gradlew.bat assembleDebug
        if ($LASTEXITCODE -ne 0) { throw "gradle failed" }
    } finally { Pop-Location }
} finally { Pop-Location }

$built = Join-Path $mobile "android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $built)) { throw "No APK at $built" }
$out = Join-Path $root "build\android"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item $built (Join-Path $out "benchflow-companion.apk") -Force
Write-Host "APK: $(Join-Path $out 'benchflow-companion.apk') ($([math]::Round((Get-Item (Join-Path $out 'benchflow-companion.apk')).Length / 1MB, 1)) MB)" -ForegroundColor Green
