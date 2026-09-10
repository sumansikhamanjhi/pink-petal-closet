<#
  Deploys Pink Petal Closet to Cloud Run.

  The key is never baked into the image and never sent to the browser. By
  default it is stored in Secret Manager and Cloud Run injects it into the
  container as the environment variable GEMINI_API_KEY, which is what
  server/server.js reads. -PlainEnvKey skips Secret Manager and sets the
  variable directly on the service; that is simpler, and it leaves the key
  readable to anyone with `gcloud run services describe`, so it is not default.

  Nothing is built locally. `--source .` hands the directory to Cloud Build,
  which builds the container in the cloud — which is why this works on a
  machine with no Docker and no Node.

  Usage:
    .\deploy.ps1 -Project my-gcp-project -ApiKey "AIza..."
    .\deploy.ps1 -Project my-gcp-project            # reads $env:GEMINI_API_KEY
    .\deploy.ps1 -Project my-gcp-project -NoVertex  # renders via the API key
#>
param(
    [Parameter(Mandatory = $true)][string]$Project,
    [string]$Region  = "us-central1",
    [string]$Service = "pink-petal-closet",
    [string]$ApiKey  = "",
    [string]$SecretName = "gemini-api-key",
    # Renders go through Vertex AI by default, authenticating as the service
    # account with no key at all. -NoVertex renders with the API key instead.
    [switch]$NoVertex,
    [switch]$PlainEnvKey,
    # Each render is a paid call, so the ceiling is low on purpose.
    [int]$MaxInstances = 3
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Fail($msg) { Write-Host "" ; Write-Host "  $msg" -ForegroundColor Red ; exit 1 }
function Step($msg) { Write-Host "" ; Write-Host "==> $msg" -ForegroundColor Cyan }

# ---- 1. the tools ----------------------------------------------------------

# Prefer gcloud.cmd. On this machine three things answer to the name "gcloud" —
# a .ps1, a .cmd, and an extension-less shell script — and the shell script
# reaches for a system Python that is not installed. The .cmd uses the SDK's own
# bundled Python, so it is the one that actually runs.
$gcloudExe = $null
$cmdForm = Get-Command "gcloud.cmd" -ErrorAction SilentlyContinue
if ($cmdForm) {
    $gcloudExe = $cmdForm.Source
} else {
    $anyForm = Get-Command "gcloud" -ErrorAction SilentlyContinue
    if ($anyForm) { $gcloudExe = $anyForm.Source }
}
if (-not $gcloudExe) {
    Fail "gcloud is not installed. Install the Google Cloud CLI, run ``gcloud auth login``, then run this again.  https://cloud.google.com/sdk/docs/install"
}
Write-Host "  using $gcloudExe"

$account = & $gcloudExe config get-value account --quiet
if ([string]::IsNullOrWhiteSpace($account) -or $account -eq "(unset)") {
    Fail "gcloud is installed but not signed in. Run ``gcloud auth login`` first."
}
Write-Host "  signed in as $account"

if ([string]::IsNullOrWhiteSpace($ApiKey)) { $ApiKey = $env:GEMINI_API_KEY }
if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    Fail "No API key. Pass -ApiKey ""AIza..."" or set `$env:GEMINI_API_KEY. Get one at https://aistudio.google.com/apikey"
}
$ApiKey = $ApiKey.Trim()

# ---- 2. the project and its APIs ------------------------------------------

Step "Pointing gcloud at $Project"
& $gcloudExe config set project $Project --quiet
if (-not $?) { Fail "Could not select project '$Project'. Check the id with ``gcloud projects list``." }

$projectNumber = & $gcloudExe projects describe $Project --format "value(projectNumber)"
if ([string]::IsNullOrWhiteSpace($projectNumber)) { Fail "Could not read project '$Project'." }

Step "Enabling the APIs this needs (a no-op if they are already on)"
$apis = @(
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "aiplatform.googleapis.com",
    "generativelanguage.googleapis.com"
)
& $gcloudExe services enable @apis --project $Project --quiet
if (-not $?) { Fail "Could not enable the APIs. Billing must be enabled on the project, and you need the Service Usage Admin role." }

# ---- 3. the key -----------------------------------------------------------

# The Cloud Run service runs as this account unless told otherwise.
$runtimeSa = "$projectNumber-compute@developer.gserviceaccount.com"

$secretArgs = @()
if ($PlainEnvKey) {
    Step "The key will be set directly as an env var (-PlainEnvKey)"
    Write-Host "  note: readable via ``gcloud run services describe``. Drop the flag to use Secret Manager." -ForegroundColor Yellow
} else {
    Step "Putting the key in Secret Manager as '$SecretName'"
    # written without a BOM and without a trailing newline: a stray byte in an
    # API key produces a 400 that looks like a bad key
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        [System.IO.File]::WriteAllText($tmp, $ApiKey, (New-Object System.Text.UTF8Encoding($false)))

        $existing = & $gcloudExe secrets list --project $Project --filter "name:$SecretName" --format "value(name)"
        if ([string]::IsNullOrWhiteSpace($existing)) {
            & $gcloudExe secrets create $SecretName --project $Project --replication-policy automatic --data-file $tmp --quiet
            if (-not $?) { Fail "Could not create the secret '$SecretName'." }
            Write-Host "  created"
        } else {
            & $gcloudExe secrets versions add $SecretName --project $Project --data-file $tmp --quiet
            if (-not $?) { Fail "Could not add a version to the secret '$SecretName'." }
            Write-Host "  new version added"
        }
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }

    Step "Letting the service read that secret"
    & $gcloudExe secrets add-iam-policy-binding $SecretName --project $Project `
        --member "serviceAccount:$runtimeSa" --role "roles/secretmanager.secretAccessor" --quiet
    if (-not $?) { Fail "Could not grant $runtimeSa access to the secret. You need the Secret Manager Admin role." }

    $secretArgs = @("--set-secrets", "GEMINI_API_KEY=${SecretName}:latest")
}

# ---- 4. Vertex, if the renders are going through it ------------------------

$envPairs = @()
if (-not $NoVertex) {
    Step "Granting the service permission to call Vertex AI"
    # This is what makes a keyless render possible: on Cloud Run the container
    # asks the metadata server for a token for this account, so there is no
    # credential to paste, expire or rotate.
    & $gcloudExe projects add-iam-policy-binding $Project `
        --member "serviceAccount:$runtimeSa" --role "roles/aiplatform.user" --quiet --condition None
    if (-not $?) {
        Write-Host "  could not grant roles/aiplatform.user to $runtimeSa." -ForegroundColor Yellow
        Write-Host "  Renders will fail until someone with Project IAM Admin grants it, or" -ForegroundColor Yellow
        Write-Host "  redeploy with -NoVertex to render with the API key instead." -ForegroundColor Yellow
    }
    $envPairs += "PP_VERTEX_PROJECT=$Project"
    $envPairs += "PP_VERTEX_REGION=$Region"
}

# ---- 5. the account that does the building ---------------------------------

# `--source .` uploads the directory to a bucket and has Cloud Build read it
# back. Cloud Build used to do that as its own service agent; it now does it as
# the Compute Engine default account, which on a project that never used Cloud
# Build has no build permissions at all. The symptom is not a permissions
# message about the account — it is
#     could not resolve source: ... IAM permission denied
# from the *storage* API, because the first thing the build cannot do is read
# the sources it was just handed. roles/cloudbuild.builds.builder is Google's
# documented remedy and carries the source read, the log write and the
# Artifact Registry push in one.
Step "Letting the build account read the uploaded sources"
& $gcloudExe projects add-iam-policy-binding $Project `
    --member "serviceAccount:$runtimeSa" --role "roles/cloudbuild.builds.builder" --quiet --condition None
if (-not $?) {
    Fail "Could not grant roles/cloudbuild.builds.builder to $runtimeSa, which the build needs to read its own sources. This needs Project IAM Admin."
}

# ---- 6. deploy ------------------------------------------------------------

Step "Building in the cloud and deploying (first run takes a few minutes)"

$deployArgs = @(
    "run", "deploy", $Service,
    "--source", ".",
    "--project", $Project,
    "--region", $Region,
    "--platform", "managed",
    "--allow-unauthenticated",
    "--memory", "1Gi",
    "--cpu", "1",
    # a render is a long call; the default 300s is cutting it fine
    "--timeout", "600",
    "--concurrency", "20",
    "--max-instances", "$MaxInstances",
    "--quiet"
)
if ($PlainEnvKey) { $envPairs += "GEMINI_API_KEY=$ApiKey" }
if ($envPairs.Count -gt 0) { $deployArgs += @("--set-env-vars", ($envPairs -join ",")) }
$deployArgs += $secretArgs

& $gcloudExe @deployArgs
if (-not $?) { Fail "The deploy failed. The Cloud Build log linked above says why." }

# ---- 7. what came back ----------------------------------------------------

$url = & $gcloudExe run services describe $Service --project $Project --region $Region --format "value(status.url)"

Write-Host ""
Write-Host "  Deployed:  $url" -ForegroundColor Green
Write-Host ""
Write-Host "  Check it answers:" -ForegroundColor Gray
Write-Host "    $url/api/tryon/status" -ForegroundColor Gray
Write-Host "  That should report ready=true. `"via`" says which route the render takes." -ForegroundColor Gray
Write-Host ""
Write-Host "  The service is PUBLIC, so anyone with the link can press See It Worn" -ForegroundColor Yellow
Write-Host "  and spend your quota. Max instances is capped at $MaxInstances to bound that." -ForegroundColor Yellow
Write-Host "  To make it private instead:" -ForegroundColor Yellow
Write-Host "    gcloud run services update $Service --project $Project --region $Region --no-allow-unauthenticated" -ForegroundColor Gray
Write-Host ""
Write-Host "  Logs:" -ForegroundColor Gray
Write-Host "    gcloud run services logs tail $Service --project $Project --region $Region" -ForegroundColor Gray
Write-Host ""
