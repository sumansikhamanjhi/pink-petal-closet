# Simple PowerShell Static File Server for Pink Petal Closet
param(
    [int]$Port = 8080
)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

Write-Host ""
Write-Host "=============================================="
Write-Host "  Pink Petal Closet - Local Dev Server"
Write-Host "  Serving at: http://localhost:$Port"
Write-Host "=============================================="
Write-Host ""

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---------------------------------------------------------------- AI try-on
# The browser never sees the API key: it posts the mannequin photo and the
# garment cutouts here, and this proxy forwards them to Gemini.
#
#   setx GEMINI_API_KEY "your-key"      (then restart the shell)
#   $env:PP_TRYON_MOCK = "1"            echo the request back, to test wiring
#   $env:PP_TRYON_MODEL = "..."         override the model name
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
<#
  Both of these are needed for the multi-megabyte image POSTs, not decoration.
  Without Expect100Continue turned off, .NET asks the endpoint for permission
  before sending the body and the upload dies with "the underlying connection
  was closed: an unexpected error occurred on a send" — which looks like a
  network fault and is really a handshake the server does not want. Raising the
  connection limit stops several garments in a batch queueing behind one socket.
#>
[Net.ServicePointManager]::Expect100Continue = $false
[Net.ServicePointManager]::DefaultConnectionLimit = 8
$tryOnKey   = $env:GEMINI_API_KEY
if (-not $tryOnKey) { $tryOnKey = $env:GOOGLE_API_KEY }
$tryOnModel = if ($env:PP_TRYON_MODEL) { $env:PP_TRYON_MODEL } else { "gemini-2.5-flash-image" }
$tryOnMock  = [bool]$env:PP_TRYON_MOCK

<#
  VERTEX AI, and why it is here as well as the API-key route.

  An AI Studio API key bills against a PREPAID balance that belongs to the
  Gemini API. Google Cloud credits — the free-trial and promotional kind — are a
  different wallet, and they do not cover that product. So a project can hold a
  large credit balance and the key on it still answers "your prepayment credits
  are depleted", which is exactly what happened here: two different keys, both
  on a credited project, both refused.

  The same Gemini image models are also served by Vertex AI, which is an
  ordinary Cloud product and IS paid for out of Cloud credits. It authenticates
  with a short-lived OAuth token instead of a key, so:

    $env:PP_VERTEX_PROJECT = "project-fc2d87e9-a843-4152-8a2"
    $env:PP_VERTEX_TOKEN   = "<paste an access token>"     # about an hour
    # or, if the Cloud CLI is installed, leave the token unset and this asks
    # gcloud for one and refreshes it on its own

  Getting a token needs no local install: open Cloud Shell in the browser and
  run `gcloud auth print-access-token`. Signing a service-account JWT here was
  the other option and was rejected — this machine has PowerShell 5.1, whose
  .NET Framework cannot import a PKCS#8 private key at all, so it would have
  meant hand-rolling ASN.1 parsing for no gain.
#>
$vertexProject = $env:PP_VERTEX_PROJECT
# us-central1, not global: the global endpoint 404s for this model, us-central1 serves it
$vertexRegion  = if ($env:PP_VERTEX_REGION) { $env:PP_VERTEX_REGION } else { "us-central1" }
$vertexModel   = if ($env:PP_VERTEX_MODEL) { $env:PP_VERTEX_MODEL } else { "gemini-2.5-flash-image" }
<#
  Asked for explicitly, because left alone the model returns a 1024x1024 square
  whatever it was given — measured against a 768x1376 mannequin, which then
  letterboxes badly in a portrait frame. imageConfig.aspectRatio is honoured:
  "9:16" comes back 768x1344, near enough the base's 0.558 to drop straight in.
#>
$vertexAspect  = if ($env:PP_VERTEX_ASPECT) { $env:PP_VERTEX_ASPECT } else { "9:16" }
$script:vertexToken = $env:PP_VERTEX_TOKEN
$vertexGcloud  = $null
if ($vertexProject -and -not $script:vertexToken) {
    $gc = Get-Command gcloud -ErrorAction SilentlyContinue
    if ($gc) { $vertexGcloud = $gc.Source }
}
$useVertex = [bool]$vertexProject -and ([bool]$script:vertexToken -or [bool]$vertexGcloud)

if ($tryOnMock)        { Write-Host "  AI try-on: MOCK mode (echoes the mannequin back)" }
elseif ($useVertex)    {
    $how = if ($vertexGcloud) { "gcloud token" } else { "pasted token" }
    Write-Host "  AI try-on: VERTEX AI ($vertexModel, $vertexRegion, $how) - billed to Cloud credits"
}
elseif ($tryOnKey)     { Write-Host "  AI try-on: Gemini API key ($tryOnModel)" }
else                   { Write-Host "  AI try-on: no key set - the app will composite locally" }

<# The Vertex host is regional except for `global`, which has no prefix. #>
function Get-VertexUri {
    if ($vertexRegion -eq "global") {
        return "https://aiplatform.googleapis.com/v1/projects/$vertexProject/locations/global/publishers/google/models/$vertexModel" + ":generateContent"
    }
    return "https://$vertexRegion-aiplatform.googleapis.com/v1/projects/$vertexProject/locations/$vertexRegion/publishers/google/models/$vertexModel" + ":generateContent"
}

<# A pasted token is used as given; a gcloud one is re-minted when refused,
   because they last about an hour and a batch run outlives that. #>
function Get-VertexToken($force) {
    if ($script:vertexToken -and -not $force) { return $script:vertexToken }
    if (-not $vertexGcloud) { return $script:vertexToken }
    try {
        $t = (& $vertexGcloud auth print-access-token 2>$null | Out-String).Trim()
        if ($t) { $script:vertexToken = $t }
    } catch { }
    return $script:vertexToken
}

function Invoke-Vertex($payload) {
    $parts = @( @{ text = $payload.prompt } )
    foreach ($img in $payload.images) {
        $parts += @{ inline_data = @{ mime_type = $img.mime; data = $img.data } }
    }
    $gen = @{ responseModalities = @("IMAGE") }
    if ($vertexAspect) { $gen.imageConfig = @{ aspectRatio = $vertexAspect } }
    $body = @{
        contents = @( @{ role = "user"; parts = $parts } )
        generationConfig = $gen
    } | ConvertTo-Json -Depth 9 -Compress

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $token = Get-VertexToken ($attempt -gt 1)
        if (-not $token) { return @{ ok = $false; error = "no Vertex access token"; detail = "set PP_VERTEX_TOKEN or install gcloud" } }
        try {
            $resp = Invoke-RestMethod -Uri (Get-VertexUri) -Method Post -Body $body `
                        -ContentType "application/json" -TimeoutSec 300 `
                        -Headers @{ Authorization = "Bearer $token" }
        } catch {
            $detail = $_.Exception.Message
            $hasBody = $false
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                $detail = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
                $hasBody = $true
            } catch {}
            # An expired token is worth one more go. So is a bare send failure
            # with no response body at all: an image POST is a few megabytes and
            # the connection does occasionally drop mid-upload, which is not a
            # reason to fail a garment the user is waiting on.
            if ($attempt -lt 3 -and -not $hasBody) { Start-Sleep -Seconds 2; continue }
            if ($attempt -lt 3 -and $vertexGcloud -and $detail -match "UNAUTHENTICATED|invalid authentication|expired") { continue }
            return @{ ok = $false; error = "vertex request failed"; detail = $detail }
        }
        foreach ($cand in @($resp.candidates)) {
            foreach ($part in @($cand.content.parts)) {
                $inline = if ($part.PSObject.Properties.Name -contains "inlineData") { $part.inlineData }
                          elseif ($part.PSObject.Properties.Name -contains "inline_data") { $part.inline_data }
                          else { $null }
                if ($inline -and $inline.data) {
                    $mime = if ($inline.mimeType) { $inline.mimeType }
                            elseif ($inline.mime_type) { $inline.mime_type }
                            else { "image/png" }
                    return @{ ok = $true; image = "data:$mime;base64," + $inline.data }
                }
            }
        }
        $text = ""
        try { $text = @($resp.candidates)[0].content.parts[0].text } catch {}
        return @{ ok = $false; error = "the model returned no image"; detail = $text }
    }
}

function Write-Json($response, $statusCode, $object) {
    $json = $object | ConvertTo-Json -Depth 6 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response.StatusCode = $statusCode
    $response.ContentType = "application/json; charset=utf-8"
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
}

# The free tier caps requests PER DAY PER MODEL, so a handful of uploads can
# exhaust one model while the next still has room. Walk the list on exhaustion.
$vlmModels = if ($env:PP_VLM_MODEL) { @($env:PP_VLM_MODEL) } else {
    @("gemini-3.6-flash", "gemini-flash-latest", "gemini-3.5-flash",
      "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3-flash-preview")
}
$vlmModel = $vlmModels[0]
if ($tryOnKey) { Write-Host "  VLM analysis: enabled ($($vlmModels -join ', '))" }

# Vision-with-text: the model looks at a photo and answers in JSON. This is a
# different quota from image generation, so it works on a free-tier key.
function Invoke-Vlm($payload) {
    $parts = @( @{ text = $payload.prompt } )
    foreach ($img in $payload.images) {
        $parts += @{ inline_data = @{ mime_type = $img.mime; data = $img.data } }
    }
    $bodyObj = @{
        contents = @( @{ parts = $parts } )
        generationConfig = @{ temperature = 0; responseMimeType = "application/json" }
    }
    $body = $bodyObj | ConvertTo-Json -Depth 10 -Compress
    # start from whichever model last worked, so an exhausted one is not retried
    # (and paid for with a wasted round trip) on every single request
    $candidates = if ($payload.model) { @($payload.model) }
                  else { @($script:vlmModel) + ($vlmModels | Where-Object { $_ -ne $script:vlmModel }) }

    $resp = $null
    $lastDetail = ""
    foreach ($model in $candidates) {
        $uri = "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=$tryOnKey"
        $perMinuteRetries = 0
        while ($true) {
            try {
                $resp = Invoke-RestMethod -TimeoutSec 120 -Method Post -ContentType "application/json" -Body $body -Uri $uri
                if ($model -ne $script:vlmModel) {
                    Write-Host "  vlm now using $model"
                    $script:vlmModel = $model
                }
                break
            } catch {
                $lastDetail = $_.Exception.Message
                try { $lastDetail = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
                # a per-DAY cap is spent for this model: move to the next one
                if ($lastDetail -match "PerDay") {
                    Write-Host "  vlm daily quota spent on $model - trying the next model"
                    break
                }
                # a per-MINUTE cap: wait it out, but only twice
                if ($lastDetail -match "RESOURCE_EXHAUSTED|rate limit" -and $perMinuteRetries -lt 2) {
                    $perMinuteRetries++
                    $waitFor = 12
                    if ($lastDetail -match '"retryDelay"\s*:\s*"(\d+)s"') { $waitFor = [int]$Matches[1] + 2 }
                    Write-Host "  vlm rate-limited on $model, waiting $waitFor s"
                    Start-Sleep -Seconds $waitFor
                    continue
                }
                break    # 404 / not available / anything else: try the next model
            }
        }
        if ($resp) { break }
    }
    if (-not $resp) {
        $friendly = if ($lastDetail -match "PerDay") {
            "every model's free daily quota is spent - try again tomorrow or enable billing"
        } else { "vlm request failed" }
        return @{ ok = $false; error = $friendly; detail = $lastDetail }
    }
    $text = ""
    try { foreach ($p in @($resp.candidates[0].content.parts)) { if ($p.text) { $text += $p.text } } } catch {}
    if (-not $text) { return @{ ok = $false; error = "the model returned no text" } }
    return @{ ok = $true; text = $text }
}

function Invoke-TryOn($payload) {
    # payload: @{ prompt = "..."; images = @(@{ mime = "image/png"; data = "<base64>" }) }
    $parts = @( @{ text = $payload.prompt } )
    foreach ($img in $payload.images) {
        $parts += @{ inline_data = @{ mime_type = $img.mime; data = $img.data } }
    }
    $uri = "https://generativelanguage.googleapis.com/v1beta/models/$tryOnModel" +
           ":generateContent?key=$tryOnKey"

    $attempt = 0
    while ($true) {
        $attempt++
        $bodyObj = @{ contents = @( @{ parts = $parts } ) }
        if ($attempt -eq 1) { $bodyObj.generationConfig = @{ responseModalities = @("IMAGE") } }
        $body = $bodyObj | ConvertTo-Json -Depth 8 -Compress
        try {
            $resp = Invoke-RestMethod -Uri $uri -Method Post -Body $body `
                        -ContentType "application/json" -TimeoutSec 180
        } catch {
            $detail = $_.Exception.Message
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                $detail = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
            } catch {}
            # some model revisions reject responseModalities — retry plainly once
            if ($attempt -eq 1 -and $detail -match "responseModalities|modalit") { continue }
            return @{ ok = $false; error = "gemini request failed"; detail = $detail }
        }

        foreach ($cand in @($resp.candidates)) {
            foreach ($part in @($cand.content.parts)) {
                $inline = if ($part.PSObject.Properties.Name -contains "inlineData") { $part.inlineData }
                          elseif ($part.PSObject.Properties.Name -contains "inline_data") { $part.inline_data }
                          else { $null }
                if ($inline -and $inline.data) {
                    $mime = if ($inline.mimeType) { $inline.mimeType }
                            elseif ($inline.mime_type) { $inline.mime_type }
                            else { "image/png" }
                    return @{ ok = $true; image = "data:$mime;base64," + $inline.data }
                }
            }
        }
        $text = ""
        try { $text = @($resp.candidates)[0].content.parts[0].text } catch {}
        return @{ ok = $false; error = "the model returned no image"; detail = $text }
    }
}

$mimeTypes = @{
    # text types declare UTF-8 explicitly: without it a browser may decode
    # emoji and dashes as Windows-1252 and render them as gibberish
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".png"  = "image/png"
    ".webp" = "image/webp"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".gif"  = "image/gif"
    ".woff" = "font/woff"
    ".woff2"= "font/woff2"
    ".md"   = "text/markdown"
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $urlPath = $request.Url.LocalPath
        if ($urlPath -eq "/") { $urlPath = "/index.html" }

        # ---- AI try-on endpoints ----
        if ($urlPath -eq "/api/tryon/status") {
            Write-Json $response 200 @{
                ready = ($tryOnMock -or $useVertex -or [bool]$tryOnKey)
                mock  = $tryOnMock
                model = $(if ($useVertex) { $vertexModel } else { $tryOnModel })
                via   = $(if ($tryOnMock) { "mock" } elseif ($useVertex) { "vertex" } elseif ($tryOnKey) { "apikey" } else { "none" })
                billing = $(if ($useVertex) { "cloud credits" } elseif ($tryOnKey) { "gemini api prepaid" } else { "" })
                vlm   = [bool]$tryOnKey
                vlmModel = $vlmModel
            }
            $response.OutputStream.Close()
            continue
        }
        if ($urlPath -eq "/api/vlm") {
            if ($request.HttpMethod -ne "POST") {
                Write-Json $response 405 @{ error = "POST only" }
                $response.OutputStream.Close()
                continue
            }
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $raw = $reader.ReadToEnd()
            $reader.Close()
            $payload = $null
            try { $payload = $raw | ConvertFrom-Json } catch {}
            if (-not $payload -or -not $payload.prompt) {
                Write-Json $response 400 @{ error = "expected { prompt, images: [{mime, data}] }" }
            } elseif (-not $tryOnKey) {
                Write-Json $response 503 @{ error = "no GEMINI_API_KEY on the server" }
            } else {
                $r = Invoke-Vlm $payload
                if ($r.ok) {
                    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] vlm ok ($($r.text.Length) chars)"
                    Write-Json $response 200 @{ text = $r.text }
                } else {
                    Write-Host "  vlm failed: $($r.error) :: $($r.detail)"
                    Write-Json $response 502 @{ error = $r.error; detail = $r.detail }
                }
            }
            $response.OutputStream.Close()
            continue
        }
        if ($urlPath -eq "/api/tryon") {
            if ($request.HttpMethod -ne "POST") {
                Write-Json $response 405 @{ error = "POST only" }
                $response.OutputStream.Close()
                continue
            }
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $raw = $reader.ReadToEnd()
            $reader.Close()
            $payload = $null
            try { $payload = $raw | ConvertFrom-Json } catch {}
            if (-not $payload -or -not $payload.images) {
                Write-Json $response 400 @{ error = "expected { prompt, images: [{mime, data}] }" }
            }
            elseif ($tryOnMock) {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] try-on MOCK ($(@($payload.images).Count) images)"
                Write-Json $response 200 @{
                    image = "data:" + @($payload.images)[0].mime + ";base64," + @($payload.images)[0].data
                    mock  = $true
                }
            }
            elseif ($useVertex) {
                # preferred when configured: Vertex is the route Cloud credits pay for
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] try-on -> VERTEX $vertexModel ($(@($payload.images).Count) images)"
                $result = Invoke-Vertex $payload
                if ($result.ok) { Write-Json $response 200 @{ image = $result.image; via = "vertex" } }
                else {
                    Write-Host "  vertex failed: $($result.error) :: $($result.detail)"
                    Write-Json $response 502 @{ error = $result.error; detail = $result.detail }
                }
            }
            elseif (-not $tryOnKey) {
                Write-Json $response 503 @{ error = "no GEMINI_API_KEY or Vertex project on the server" }
            }
            else {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] try-on -> $tryOnModel ($(@($payload.images).Count) images)"
                $result = Invoke-TryOn $payload
                if ($result.ok) { Write-Json $response 200 @{ image = $result.image; via = "apikey" } }
                else {
                    Write-Host "  try-on failed: $($result.error) :: $($result.detail)"
                    Write-Json $response 502 @{ error = $result.error; detail = $result.detail }
                }
            }
            $response.OutputStream.Close()
            continue
        }

        $filePath = Join-Path $rootDir ($urlPath -replace '/', '\')

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }

            $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $fileBytes.Length
            $response.StatusCode = 200

            # CORS headers for local dev
            $response.Headers.Add("Access-Control-Allow-Origin", "*")
            $response.Headers.Add("Cache-Control", "no-cache")

            $response.OutputStream.Write($fileBytes, 0, $fileBytes.Length)

            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 200 $urlPath ($contentType)"
        } else {
            $response.StatusCode = 404
            $errorBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
            $response.ContentType = "text/plain"
            $response.ContentLength64 = $errorBytes.Length
            $response.OutputStream.Write($errorBytes, 0, $errorBytes.Length)
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 404 $urlPath"
        }

        $response.OutputStream.Close()
    } catch {
        Write-Host "Error: $_"
    }
}
