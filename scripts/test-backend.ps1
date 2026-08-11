<#
.SYNOPSIS
  Run the backend PHPUnit suite off a container-local mirror instead of the
  Windows bind mount.

.DESCRIPTION
  Same suite, same image, same phpunit.xml as `docker compose exec backend php
  artisan test` — but the code is mirrored into a named volume first, so PHPUnit
  reads it from the container's own filesystem. The full suite drops from ~5:04 to
  ~0:38 (1097 tests, measured 2026-08-11); see scripts/test-backend.sh for why.

  The mirror is incremental: vendor/ is re-copied only when composer.lock moves, so
  the first run pays ~2.5 min and later runs pay ~3s of sync. Nothing is written
  back to the checkout — backend/ is mounted read-only.

  Any arguments are forwarded to PHPUnit. The mirror is throwaway, so anything you
  want to KEEP must be written to /out, which is backend/ on the host.

.EXAMPLE
  scripts\test-backend.ps1                              # whole suite
  scripts\test-backend.ps1 --filter AuthControllerTest  # one class
  scripts\test-backend.ps1 --coverage-clover=/out/coverage.clover   # the CI gate's artifact
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PhpunitArgs
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$image = 'ladybug-php'
$volume = 'ladybug-backend-tests'

# The image the dev stack already builds (php 8.3 + gd/gifsicle/imagemagick/ffmpeg
# + pcov). Build it here if the stack has never been brought up.
docker image inspect $image *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "test-backend: building the $image image (first run)..."
    docker compose -f (Join-Path $repoRoot 'docker-compose.yml') build backend
}

# /src is read-only so the sync path provably cannot write back into the checkout;
# /out is the same directory mounted writable, purely so artifacts PHPUnit is asked
# to produce (clover, junit) survive the throwaway mirror. Both coverage.clover and
# coverage.xml are already gitignored.
docker run --rm `
    -v "$repoRoot\backend:/src:ro" `
    -v "$repoRoot\backend:/out" `
    -v "${volume}:/work" `
    -v "$repoRoot\scripts\test-backend.sh:/run.sh:ro" `
    -w /work `
    $image sh /run.sh @PhpunitArgs

exit $LASTEXITCODE
