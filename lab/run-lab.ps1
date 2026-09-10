# Runs the garment isolation lab in headless Chrome and collects the results.
param(
    [int]$Port = 8123,
    [string]$Page = "lab/garment-lab.html",
    [int]$TimeoutSeconds = 420
)

$ErrorActionPreference = "Continue"
$labDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $labDir
$outDir  = Join-Path $labDir "out"
if (Test-Path $outDir) { Remove-Item "$outDir\*" -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { $chrome = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" }

$serverLog = Join-Path $outDir "server.log"
$server = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File","`"$(Join-Path $labDir lab-server.ps1)`"","-Port","$Port","-TimeoutSeconds","$TimeoutSeconds") `
    -RedirectStandardOutput $serverLog -RedirectStandardError (Join-Path $outDir "server.err.log") `
    -PassThru -WindowStyle Hidden
Start-Sleep -Milliseconds 1200

$profileDir = Join-Path $env:TEMP ("pp-lab-chrome-" + [guid]::NewGuid().ToString("N").Substring(0,8))
$chromeLog = Join-Path $outDir "chrome.log"
$args = @(
  "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--enable-logging=stderr", "--v=0", "--log-level=0",
  "--user-data-dir=$profileDir",
  "http://localhost:$Port/$Page"
)
$browser = Start-Process -FilePath $chrome -ArgumentList $args -PassThru `
    -RedirectStandardError $chromeLog -RedirectStandardOutput (Join-Path $outDir "chrome.out.log")

Write-Host "waiting for lab run (server pid $($server.Id), browser pid $($browser.Id))…"
$server | Wait-Process -Timeout $TimeoutSeconds -ErrorAction SilentlyContinue
if (-not $server.HasExited) { Write-Host "server still up -> killing"; Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 300
Get-Process -Name chrome, msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$profileDir*" } | Stop-Process -Force -ErrorAction SilentlyContinue
if (-not $browser.HasExited) { Stop-Process -Id $browser.Id -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$profileDir*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "---- server log ----"
if (Test-Path $serverLog) { Get-Content $serverLog | Select-Object -Last 40 }
Write-Host "---- outputs ----"
Get-ChildItem $outDir -Filter *.png | Select-Object Name, Length | Format-Table -AutoSize
