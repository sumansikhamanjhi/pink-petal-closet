# Validation harness server for the garment isolation engine.
# Serves the project root and accepts result uploads from the lab page, so a
# headless Chrome run can write its cutouts + metrics to disk.
#
#   POST /save?name=foo.png   body = base64 png       -> lab/out/foo.png
#   POST /report              body = json             -> lab/out/report.json, then exits
param(
    [int]$Port = 8123,
    [int]$TimeoutSeconds = 420
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$outDir  = Join-Path $rootDir "lab\out"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$mime = @{
    ".html"="text/html; charset=utf-8"; ".css"="text/css; charset=utf-8";
    ".js"="application/javascript; charset=utf-8"; ".json"="application/json; charset=utf-8"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg";
    ".png"="image/png"; ".webp"="image/webp"; ".svg"="image/svg+xml"; ".md"="text/markdown"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "LAB SERVER on http://localhost:$Port  (out: $outDir)"

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$done = $false

while ($listener.IsListening -and -not $done) {
    if ((Get-Date) -gt $deadline) { Write-Host "TIMEOUT waiting for report"; break }

    $ctxTask = $listener.GetContextAsync()
    while (-not $ctxTask.AsyncWaitHandle.WaitOne(500)) {
        if ((Get-Date) -gt $deadline) { break }
    }
    if (-not $ctxTask.IsCompleted) { Write-Host "TIMEOUT waiting for report"; break }
    $ctx = $ctxTask.Result

    $req = $ctx.Request
    $res = $ctx.Response
    $res.Headers.Add("Access-Control-Allow-Origin", "*")
    $res.Headers.Add("Cache-Control", "no-cache")
    $path = $req.Url.LocalPath

    try {
        if ($req.HttpMethod -eq "POST" -and $path -eq "/save") {
            $name = $req.QueryString["name"]
            if (-not $name) { $name = "unnamed.png" }
            $name = [System.IO.Path]::GetFileName($name)
            $sr = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
            $b64 = $sr.ReadToEnd()
            $sr.Close()
            $b64 = $b64 -replace '^data:image/\w+;base64,', ''
            [System.IO.File]::WriteAllBytes((Join-Path $outDir $name), [System.Convert]::FromBase64String($b64))
            Write-Host "  saved $name"
            $body = [System.Text.Encoding]::UTF8.GetBytes("ok")
            $res.ContentType = "text/plain"; $res.StatusCode = 200
            $res.OutputStream.Write($body, 0, $body.Length)
        }
        elseif ($req.HttpMethod -eq "POST" -and $path -eq "/report") {
            $sr = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
            $json = $sr.ReadToEnd()
            $sr.Close()
            [System.IO.File]::WriteAllText((Join-Path $outDir "report.json"), $json, [System.Text.Encoding]::UTF8)
            Write-Host "  REPORT received ($($json.Length) chars)"
            $body = [System.Text.Encoding]::UTF8.GetBytes("ok")
            $res.ContentType = "text/plain"; $res.StatusCode = 200
            $res.OutputStream.Write($body, 0, $body.Length)
            $done = $true
        }
        elseif ($req.HttpMethod -eq "OPTIONS") {
            $res.Headers.Add("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
            $res.Headers.Add("Access-Control-Allow-Headers", "*")
            $res.StatusCode = 204
        }
        else {
            $urlPath = if ($path -eq "/") { "/index.html" } else { $path }
            $file = Join-Path $rootDir ([Uri]::UnescapeDataString($urlPath) -replace '/', '\')
            if (Test-Path $file -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($file).ToLower()
                $ct = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
                $bytes = [System.IO.File]::ReadAllBytes($file)
                $res.ContentType = $ct; $res.StatusCode = 200
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $res.StatusCode = 404
                $body = [System.Text.Encoding]::UTF8.GetBytes("404 $urlPath")
                $res.OutputStream.Write($body, 0, $body.Length)
                Write-Host "  404 $urlPath"
            }
        }
    } catch {
        Write-Host "  ERR $path :: $_"
        try { $res.StatusCode = 500 } catch {}
    }
    try { $res.OutputStream.Close() } catch {}
}

$listener.Stop()
$listener.Close()
Write-Host "LAB SERVER stopped"
