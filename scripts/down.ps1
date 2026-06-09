<#
.SYNOPSIS
  Safe teardown: dump trashdb first, then `docker compose down`.

.DESCRIPTION
  Use this instead of `docker compose down`. All arguments are forwarded, so
  `scripts\down.ps1 -v` still wipes the volume -- but only AFTER a fresh dump is
  written to backend/storage/backups, which is exactly when a backup matters most.

.EXAMPLE
  scripts\down.ps1          # dump, then stop & remove containers (volume kept)
  scripts\down.ps1 -v       # dump, then ALSO remove the data volume
#>
[CmdletBinding()]
param(
    # Forwarded verbatim to `docker compose down` (e.g. -v, --remove-orphans).
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$DownArgs
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

# Always dump before tearing anything down.
& (Join-Path $PSScriptRoot 'backup-db.ps1')

Push-Location $repoRoot
try {
    Write-Host "down: docker compose down $($DownArgs -join ' ')"
    docker compose down @DownArgs
}
finally {
    Pop-Location
}
