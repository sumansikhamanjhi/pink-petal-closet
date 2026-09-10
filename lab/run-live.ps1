# Runs a lab page against the real server.ps1 (which owns the /api/vlm and
# /api/tryon proxies), with the lab sink server capturing results to lab/out.
param(
    [string]$Page = "lab/vlm-box-probe.html",
    [int]$AppPort = 8090,
    [int]$SinkPort = 8123,
    [int]$TimeoutSeconds = 420
)

$labDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $labDir
$outDir  = Join-Path $labDir "out"
if (Test-Path $outDir) { Remove-Item "$outDir\*" -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# the key lives in the user environment; pass it to the child explicitly
if (-not $env:GEMINI_API_KEY) {
    $env:GEMINI_API_KEY = [Environment]::GetEnvironmentVariable("GEMINI_API_KEY", "User")
}

$app = Start-Process powershell.exe -PassThru -WindowStyle Hidden `
    -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File","`"$rootDir\server.ps1`"","-Port","$AppPort") `
    -RedirectStandardOutput "$outDir\app-server.log" -RedirectStandardError "$outDir\app-server.err"
$sink = Start-Process powershell.exe -PassThru -WindowStyle Hidden `
    -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File","`"$labDir\lab-server.ps1`"","-Port","$SinkPort","-TimeoutSeconds","$TimeoutSeconds") `
    -RedirectStandardOutput "$outDir\sink.log" -RedirectStandardError "$outDir\sink.err"
Start-Sleep -Milliseconds 1800

if ($app.HasExited) {
    Write-Host "APP SERVER FAILED TO START - is port $AppPort in use?"
    Get-Content (Join-Path $outDir "app-server.err") -ErrorAction SilentlyContinue | Select-Object -First 4
    if (-not $sink.HasExited) { Stop-Process -Id $sink.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}

$chromeArgs = @(
  "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check",
  "--user-data-dir=C:\Users\suman\AppData\Local\Temp\claude\pp-live-profile",
  "http://localhost:$AppPort/$Page"
)
$browser = Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" `
    -ArgumentList $chromeArgs -PassThru

$sink | Wait-Process -Timeout $TimeoutSeconds -ErrorAction SilentlyContinue
foreach ($p in @($browser, $app, $sink)) {
    if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}

Write-Host "---- app server log (last 20) ----"
Get-Content (Join-Path $outDir "app-server.log") -ErrorAction SilentlyContinue | Select-Object -Last 20
