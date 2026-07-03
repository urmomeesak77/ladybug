<#
.SYNOPSIS
  Safe teardown: dump the dev MySQL database first, then `docker compose down`.

.DESCRIPTION
  Use this instead of `docker compose down`. A fresh dump is always written
  first, to <LADYBUG_DATA_ROOT>\ladybug-backups (default
  C:\docker_permanent\ladybug-backups; override via LADYBUG_BACKUP_DIR). All
  arguments are forwarded to `docker compose down`. Note the MySQL datadir is
  a host bind-mount, so even `down -v` does NOT wipe the database -- `-v` only
  removes Docker-managed volumes (e.g. the frontend's anonymous node_modules
  volume). The pre-down dump is kept anyway as a cheap logical backup.

.EXAMPLE
  scripts\down.ps1          # dump, then stop & remove containers
  scripts\down.ps1 -v       # dump, then also remove Docker-managed volumes
                            # (the bind-mounted DB datadir is untouched)
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
