<#
.SYNOPSIS
  Run the Playwright e2e specs against an ISOLATED, disposable stack.

.DESCRIPTION
  Brings up docker-compose.e2e.yml under a separate `ladybug-e2e` Compose project
  (frontend 5174 -> backend 8001 -> mysql-e2e/ladybug_e2e in tmpfs), waits for the
  SPA to answer, runs Playwright with E2E_BASE_URL pointed at it, then tears the
  whole stack down with `down -v`. Tests register users into the throwaway
  ladybug_e2e DB, NEVER the live dev trashdb. The dev stack (if up) is untouched.

  Any arguments are forwarded to `npx playwright test` (e.g. a spec path or --headed).

.EXAMPLE
  scripts\e2e.ps1                       # full auth + feed e2e on the isolated stack
  scripts\e2e.ps1 e2e/auth.spec.ts      # one spec
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PlaywrightArgs
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$project = 'ladybug-e2e'
$composeFile = Join-Path $repoRoot 'docker-compose.e2e.yml'
$baseUrl = 'http://localhost:5174'

Push-Location $repoRoot
try {
    # The e2e backend reads backend/.env.e2e (mounted over /app/.env). It's gitignored
    # (it holds an APP_KEY), so seed it from the committed template with a fresh key.
    $envE2e = Join-Path $repoRoot 'backend\.env.e2e'
    if (-not (Test-Path $envE2e)) {
        Write-Host "e2e: creating backend/.env.e2e from template..."
        # Cryptographic RNG: the key only guards a throwaway tmpfs stack, but the
        # Get-Random pattern must not exist where it could be copied somewhere real.
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
        $rng.GetBytes($bytes)
        $rng.Dispose()
        $key = 'base64:' + [Convert]::ToBase64String($bytes)
        (Get-Content (Join-Path $repoRoot 'backend\.env.e2e.example')) `
            -replace '^APP_KEY=$', "APP_KEY=$key" |
            Set-Content -Encoding utf8 $envE2e
    }

    Write-Host "e2e: bringing up the isolated stack ($project)..."
    docker compose -p $project -f $composeFile up -d --build --wait

    # --wait only blocks on container health; the backend serves only after
    # migrate:fresh + seeding finish, and Vite only after its in-container npm
    # install. Poll BOTH (cap ~3 min each) — a spec hitting the API before
    # `artisan serve` listens fails as a connection-refused "network" error.
    $probes = @(
        @{ Name = 'backend'; Url = 'http://localhost:8001/api/health' },
        @{ Name = 'SPA'; Url = $baseUrl }
    )
    foreach ($probe in $probes) {
        Write-Host "e2e: waiting for the $($probe.Name) at $($probe.Url) ..."
        $ready = $false
        foreach ($attempt in 1..90) {
            try {
                $resp = Invoke-WebRequest -Uri $probe.Url -UseBasicParsing -TimeoutSec 3
                if ($resp.StatusCode -eq 200) { $ready = $true; break }
            }
            catch { Start-Sleep -Seconds 2 }
        }
        if (-not $ready) { throw "e2e: $($probe.Name) did not become ready at $($probe.Url)" }
    }

    # Warm the register/mail path: the stack's FIRST register renders the first
    # mail on a cold opcache over the Windows bind mount (symfony-mailer graph +
    # Blade mail views), which can take 30s+. Pay that cost here with a throwaway
    # user instead of inside the first spec's test budget. Best-effort by design.
    Write-Host "e2e: warming the register/mail path..."
    $warmBody = @{
        name                  = 'Warmup User'
        email                 = "warmup+$(Get-Random)@example.com"
        password              = 'Password1'
        password_confirmation = 'Password1'
    } | ConvertTo-Json
    try {
        Invoke-WebRequest -Uri 'http://localhost:8001/api/register' -Method Post `
            -Body $warmBody -ContentType 'application/json' `
            -Headers @{ Accept = 'application/json' } -UseBasicParsing -TimeoutSec 120 | Out-Null
    }
    catch {
        # A 500 is expected here: the stateless request dies at session handling,
        # but only AFTER rendering the register mail — the path is warmed anyway.
        Write-Host "e2e: warmup register answered an error (mail path warmed regardless)"
    }

    Write-Host "e2e: running Playwright against $baseUrl ..."
    Push-Location (Join-Path $repoRoot 'frontend')
    try {
        $env:E2E_BASE_URL = $baseUrl
        npx playwright test @PlaywrightArgs
        $exit = $LASTEXITCODE
    }
    finally {
        Pop-Location
        Remove-Item Env:\E2E_BASE_URL -ErrorAction SilentlyContinue
    }
}
finally {
    # Disposable by design: drop the whole isolated stack incl. its tmpfs DB. This is a
    # SEPARATE project from the dev stack, so `down -v` here never touches trashdb.
    Write-Host "e2e: tearing down the isolated stack..."
    docker compose -p $project -f $composeFile down -v
    Pop-Location
}

exit $exit
