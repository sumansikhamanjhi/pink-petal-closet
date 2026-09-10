<#
    Pink Petal Closet - start everything.

        .\start.ps1                          start the server, open the app
        .\start.ps1 -Token "ya29...."        with a fresh Vertex token
        .\start.ps1 -Bench                   open the try-on bench instead
        .\start.ps1 -Port 8081 -NoBrowser

    WHY A TOKEN IS INVOLVED AT ALL

    Image generation is billed to Google Cloud credits through Vertex AI, and
    Vertex authenticates with a short-lived OAuth token rather than an API key.
    An AI Studio API key cannot reach those credits: a key bills against the
    Gemini API's own prepaid balance, which is a different wallet and is empty.

    A token lasts about an hour, so this script:
      - uses the Cloud CLI to mint one if gcloud is installed (nothing to do)
      - otherwise reuses the last token it was given while it is still fresh
      - and prints the two lines to run in Cloud Shell when it is not

    Everything except image generation works with no token at all, so the
    server always starts.
#>
param(
    [string]$Token = "",
    [int]$Port = 8080,
    [string]$Project = "project-fc2d87e9-a843-4152-8a2",
    [switch]$Bench,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $root "server.ps1"
if (-not (Test-Path $server)) { Write-Host "server.ps1 not found next to start.ps1" -ForegroundColor Red; exit 1 }

# The token is a credential, so it is cached outside the project folder.
$stateDir = Join-Path $env:LOCALAPPDATA "PinkPetalCloset"
$tokenFile = Join-Path $stateDir "vertex-token.txt"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

function Write-Head($text) { Write-Host ""; Write-Host $text -ForegroundColor Cyan }

# ---------------------------------------------------------------- the token
$gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue)
$tokenSource = "none"

if ($Token) {
    $Token = $Token.Trim()
    Set-Content -Path $tokenFile -Value $Token -Encoding ASCII
    $tokenSource = "given on the command line"
}
elseif ($gcloud) {
    # nothing to cache: the server re-mints from gcloud whenever one expires
    $tokenSource = "gcloud (auto-refreshing)"
}
elseif (Test-Path $tokenFile) {
    $age = (Get-Date) - (Get-Item $tokenFile).LastWriteTime
    if ($age.TotalMinutes -lt 55) {
        $Token = (Get-Content $tokenFile -Raw).Trim()
        $tokenSource = "cached, " + [math]::Round($age.TotalMinutes) + " min old"
    } else {
        $tokenSource = "cached but stale (" + [math]::Round($age.TotalMinutes) + " min)"
    }
}

# ------------------------------------------------------- stop an old server
Write-Head "Stopping any server already on port $Port"
$mine = $PID
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $mine -and $_.CommandLine -like "*server.ps1*" -and $_.CommandLine -notlike "*start.ps1*" } |
    ForEach-Object {
        Write-Host ("  stopping pid " + $_.ProcessId)
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
Start-Sleep -Milliseconds 800

# ------------------------------------------------------------- start it up
$logDir = Join-Path $root "lab\out"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "server.live.log"
$errLog = Join-Path $logDir "server.live.err.log"

# A launcher file rather than a -Command string: the project path has spaces in
# it, and quoting a long command through Start-Process is where that goes wrong.
$launcher = Join-Path $stateDir "launch-server.ps1"
$lines = @()
if ($Token -or $gcloud) { $lines += "`$env:PP_VERTEX_PROJECT = '$Project'" }
if ($Token)             { $lines += "`$env:PP_VERTEX_TOKEN   = '$Token'" }
$lines += "& '$server' -Port $Port"
Set-Content -Path $launcher -Value ($lines -join "`r`n") -Encoding UTF8

Write-Head "Starting the server"
Start-Process -FilePath "powershell.exe" `
    -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + $launcher + '"') `
    -RedirectStandardOutput $log -RedirectStandardError $errLog -WindowStyle Hidden | Out-Null

$status = $null
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 700
    try { $status = Invoke-RestMethod -Uri "http://localhost:$Port/api/tryon/status" -TimeoutSec 4; break } catch { }
}

if (-not $status) {
    Write-Host "  the server did not come up" -ForegroundColor Red
    if (Test-Path $errLog) { Get-Content $errLog | Select-Object -First 10 }
    exit 1
}

Write-Host ("  serving  http://localhost:$Port") -ForegroundColor Green
Write-Host ("  image generation: " + $status.via + $(if ($status.billing) { " (" + $status.billing + ")" } else { "" }))
Write-Host ("  token source: " + $tokenSource)

if ($status.via -ne "vertex") {
    Write-Head "Image generation is OFF. To turn it on:"
    Write-Host "  1. open  https://shell.cloud.google.com"
    Write-Host "  2. run these two lines:" -ForegroundColor Yellow
    Write-Host "       gcloud config set project $Project"
    Write-Host "       gcloud auth print-access-token"
    Write-Host "  3. re-run:" -ForegroundColor Yellow
    Write-Host "       .\start.ps1 -Token `"<paste the ya29... token>`""
    Write-Host ""
    Write-Host "  To stop doing this every hour, install the Cloud CLI once"
    Write-Host "  (https://cloud.google.com/sdk/docs/install), run 'gcloud auth login',"
    Write-Host "  and this script will mint tokens by itself."
}

if (-not $NoBrowser) {
    $url = if ($Bench) { "http://localhost:$Port/lab/tryon-bench.html" } else { "http://localhost:$Port" }
    Write-Head "Opening $url"
    Start-Process $url
}

Write-Head "Logs"
Write-Host ("  " + $log)
Write-Host "  stop the server with:  .\start.ps1 -NoBrowser -Port $Port   (it stops the old one first)"
Write-Host ""
