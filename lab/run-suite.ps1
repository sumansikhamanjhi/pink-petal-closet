# Runs the whole regression suite, one harness at a time, and reports the total.
#
# WHY THIS EXISTS RATHER THAN A COMMAND TYPED EACH TIME. Two mistakes kept
# recurring when the sweep was assembled by hand:
#
#   1. Two sweeps running at once. Every harness uses port 8123 and writes
#      lab/out/report.json, so a second run overwrites the first's report and
#      both come back as nonsense. This refuses to start if the port is busy.
#
#   2. "0 failed" reported for a harness that never finished. A probe that
#      throws records a `fatal` and stops, so its check count is short and its
#      failure count is zero, which reads exactly like success. A dropped
#      count is the only visible symptom, and it is easy to miss in a list of
#      thirteen. This treats a fatal as a failure, and prints it.
param(
    [int]$TimeoutSeconds = 400,
    [string[]]$Pages = @(
        "lab/syntax-check.html",
        "lab/parity-probe.html",
        "lab/tags-probe.html",
        "lab/stylist-probe.html",
        "lab/dress-probe.html",
        "lab/preview-probe.html",
        "lab/quickadd-probe.html",
        "lab/apicore-probe.html",
        "lab/apicore-mutant.html",
        "lab/seed-probe.html",
        "lab/occlusion-truth.html",
        "lab/aifit-probe.html",
        "lab/fidelity-probe.html",
        "lab/display-probe.html",
        "lab/slots-probe.html",
        "lab/paint-app-probe.html",
        "lab/module-paint.html",
        "lab/occlusion-probe.html",
        "lab/path-probe.html",
        "lab/onbody-paint-probe.html",
        "lab/app-mannequin-smoke.html"
    )
)

$ErrorActionPreference = "Continue"
$labDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $labDir
Set-Location $rootDir

# Refuse to race another sweep.
$busy = $false
try { $null = Invoke-WebRequest -Uri "http://localhost:8123/" -TimeoutSec 2; $busy = $true } catch { }
if ($busy) {
    Write-Host "port 8123 is already serving - another sweep is running. Stop it first." -ForegroundColor Red
    exit 1
}

$total = 0
$bad = 0
$rows = @()

foreach ($page in $Pages) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $labDir "run-lab.ps1") `
        -Page $page -TimeoutSeconds $TimeoutSeconds 2>&1 | Out-Null

    $raw = Get-Content (Join-Path $labDir "out\report.json") -Raw -ErrorAction SilentlyContinue
    if (-not $raw) {
        $rows += "$page : NO REPORT"
        $bad++
        continue
    }
    $r = $raw | ConvertFrom-Json

    $fatal = $r.PSObject.Properties.Name -contains "fatal" -and $r.fatal
    if ($null -ne $r.passed) {
        $total += $r.passed
        $bad += $r.failed
        $line = "$page : $($r.passed) passed, $($r.failed) failed"
        if ($fatal) { $bad++; $line += "  [ABORTED]" }
        $rows += $line
        $r.checks | Where-Object { -not $_.pass } | ForEach-Object {
            $rows += "      FAIL $($_.name) [$($_.detail)]"
        }
    } else {
        $line = "$page : ok=$($r.ok)"
        if ($fatal) { $bad++; $line += "  [ABORTED]" }
        $rows += $line
    }
    if ($fatal) {
        # built outside the string: PowerShell 5.1 mis-parses a -replace with
        # quoted operands inside a $(...) subexpression in a double-quoted string
        $why = [string]$r.fatal
        $why = $why.Replace("`r", " ").Replace("`n", " ")
        $rows += ("      FATAL " + $why)
    }
}

$rows | ForEach-Object { Write-Host $_ }
Write-Host ""
if ($bad -eq 0) {
    Write-Host "TOTAL: $total checks passed, 0 failed" -ForegroundColor Green
} else {
    Write-Host "TOTAL: $total checks passed, $bad FAILED" -ForegroundColor Red
}
exit ([int]($bad -gt 0))
