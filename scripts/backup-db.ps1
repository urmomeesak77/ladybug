<#
.SYNOPSIS
  Dump the dev MySQL `trashdb` to a timestamped .sql file, then prune to the
  most recent 10. Safe to call any time; if the mysql container is not running
  there is nothing to back up, so it warns and exits 0 (never blocks teardown).

.NOTES
  Used by scripts/down.ps1 (manual teardown) and by the Claude Code PreToolUse
  hook (scripts/hook-predown-backup.ps1) so every `docker compose down`,
  including `down -v`, is preceded by a fresh dump.
#>
[CmdletBinding()]
param(
    # How many dumps to keep; older ones are deleted.
    [int]$Keep = 10,

    # Where dumps are written. Defaults to the LADYBUG_BACKUP_DIR env var, else
    # C:\docker_permanent\ladybug-backups -- OUTSIDE the repo, so dumps survive
    # `git clean` or deleting the project folder, not just Docker teardown.
    [string]$BackupDir
)

$ErrorActionPreference = 'Stop'

# scripts/ lives directly under the repo root; compose runs from the root.
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $BackupDir) {
    $BackupDir = if ($env:LADYBUG_BACKUP_DIR) { $env:LADYBUG_BACKUP_DIR } else { 'C:\docker_permanent\ladybug-backups' }
}
$backupsDir = $BackupDir

Push-Location $repoRoot
try {
    # Nothing to dump if the database container is not currently running.
    $running = docker compose ps --services --status running 2>$null
    if ($running -notcontains 'mysql') {
        Write-Warning 'backup-db: mysql service is not running; skipping dump.'
        return
    }

    if (-not (Test-Path $backupsDir)) {
        New-Item -ItemType Directory -Path $backupsDir -Force | Out-Null
    }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $outFile = Join-Path $backupsDir "trashdb_$stamp.sql"

    # cmd's `>` writes the process's raw UTF-8 bytes; PowerShell's `>` would
    # re-encode to UTF-16 and corrupt the dump. -T disables the TTY so output
    # stays byte-clean. --single-transaction gives a consistent InnoDB snapshot.
    $dump = 'docker compose exec -T mysql mysqldump -uroot -proot --single-transaction --no-tablespaces --databases trashdb'
    cmd /c "$dump > `"$outFile`""

    $size = (Get-Item $outFile).Length
    if ($LASTEXITCODE -ne 0 -or $size -lt 1024) {
        throw "backup-db: dump failed (exit $LASTEXITCODE, size $size bytes): $outFile"
    }
    Write-Host ("backup-db: wrote {0} ({1:N0} bytes)" -f $outFile, $size)

    # Retention: keep the newest $Keep dumps, delete the rest.
    Get-ChildItem $backupsDir -Filter 'trashdb_*.sql' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $Keep |
        ForEach-Object {
            Write-Host "backup-db: pruning old dump $($_.Name)"
            Remove-Item $_.FullName -Force
        }
}
finally {
    Pop-Location
}
