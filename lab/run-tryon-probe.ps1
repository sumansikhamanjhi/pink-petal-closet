# Drives the AI try-on path end to end. The app is served by server.ps1 (which
# owns the /api/tryon proxy) and the probe page posts its findings to the lab
# sink server, so results land in lab/out just like every other harness.
param(
    [int]$AppPort = 8090,
    [int]$SinkPort = 8123,
    [switch]$Live,                 # by default the proxy runs in mock mode
    [int]$TimeoutSeconds = 300
)

$labDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $labDir
$outDir  = Join-Path $labDir "out"
if (Test-Path $outDir) { Remove-Item "$outDir\*" -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if ($Live) { $env:PP_TRYON_MOCK = $null } else { $env:PP_TRYON_MOCK = "1" }

$app = Start-Process powershell.exe -PassThru -WindowStyle Hidden `
    -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File","`"$rootDir\server.ps1`"","-Port","$AppPort") `
    -RedirectStandardOutput "$outDir\app-server.log" -RedirectStandardError "$outDir\app-server.err"
$sink = Start-Process powershell.exe -PassThru -WindowStyle Hidden `
    -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File","`"$labDir\lab-server.ps1`"","-Port","$SinkPort","-TimeoutSeconds","$TimeoutSeconds") `
    -RedirectStandardOutput "$outDir\sink.log" -RedirectStandardError "$outDir\sink.err"
Start-Sleep -Milliseconds 1800

if ($app.HasExited) {
    Write-Host "APP SERVER FAILED TO START - is port $AppPort already in use?"
    Get-Content (Join-Path $outDir "app-server.err") -ErrorAction SilentlyContinue | Select-Object -First 4
    if (-not $sink.HasExited) { Stop-Process -Id $sink.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}

$chromeArgs = @(
  "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check",
  "--user-data-dir=C:\Users\suman\AppData\Local\Temp\claude\pp-tryon-profile",
  "http://localhost:$AppPort/lab/tryon-probe.html"
)
$browser = Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" `
    -ArgumentList $chromeArgs -PassThru

$sink | Wait-Process -Timeout $TimeoutSeconds -ErrorAction SilentlyContinue

foreach ($p in @($browser, $app, $sink)) {
    if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}

Write-Host "---- app server log ----"
Get-Content (Join-Path $outDir "app-server.log") -ErrorAction SilentlyContinue | Select-Object -Last 25
