<#
.SYNOPSIS
  Dump the dev MySQL database (name + root password read from the container's
  own env, so overrides in the root .env are respected) to a timestamped .sql
  file, then prune to the most recent 10. Safe to call any time; if the mysql
  container is not running there is nothing to back up, so it warns and exits 0
  (never blocks teardown).

.NOTES
  Used by scripts/down.ps1 (manual teardown) and by the Claude Code PreToolUse
  hook (scripts/hook-predown-backup.ps1) so every `docker compose down`,
  including `down -v`, is preceded by a fresh dump.
#>
[CmdletBinding()]
param(
    # How many dumps to keep; older ones are deleted.
    [int]$Keep = 10,

    # Where dumps are written (OUTSIDE the repo, so they survive `git clean` or
    # deleting the project folder, not just Docker teardown). Resolution order:
    #   1. -BackupDir argument
    #   2. $env:LADYBUG_BACKUP_DIR         (explicit override for dumps only)
    #   3. $env:LADYBUG_DATA_ROOT\ladybug-backups  (shared root; see .env.example)
    #   4. C:\docker_permanent\ladybug-backups     (baked-in default)
    [string]$BackupDir,

    # Filename prefix + retention glob ONLY. The database actually dumped is
    # always the container's own $MYSQL_DATABASE (see $dump below); by default
    # this prefix is read from the same place, so the filename matches the
    # contents and dumps of different databases never share a retention pool.
    # Resolution (first non-empty wins):
    #   1. -Database argument
    #   2. $env:MYSQL_DATABASE                    (process env, if exported)
    #   3. the running container's $MYSQL_DATABASE (queried after the
    #      is-running check below -- root .env is compose-only and never
    #      reaches this script's process env)
    #   4. 'trashdb' (baked-in default)
    [string]$Database
)

$ErrorActionPreference = 'Stop'

# scripts/ lives directly under the repo root; compose runs from the root.
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $BackupDir) {
    # Plain string concat (not Join-Path): Join-Path validates the drive and
    # throws DriveNotFound if LADYBUG_DATA_ROOT names an unmounted drive.
    $BackupDir =
        if ($env:LADYBUG_BACKUP_DIR) { $env:LADYBUG_BACKUP_DIR }
        elseif ($env:LADYBUG_DATA_ROOT) { "$($env:LADYBUG_DATA_ROOT.TrimEnd('/','\'))\ladybug-backups" }
        else { 'C:\docker_permanent\ladybug-backups' }
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

    # Resolve the filename prefix from the container so it matches what gets
    # dumped (see the param comment). Single-quoted so $MYSQL_DATABASE expands
    # inside the container's sh, not on the host.
    if (-not $Database) {
        if ($env:MYSQL_DATABASE) {
            $Database = $env:MYSQL_DATABASE
        } else {
            # No stderr redirect: under EAP=Stop, PS 5.1 turns redirected
            # native stderr into a terminating NativeCommandError.
            $Database = (docker compose exec -T mysql sh -c 'echo $MYSQL_DATABASE' | Out-String).Trim()
        }
        if (-not $Database) { $Database = 'trashdb' }
    }

    if (-not (Test-Path $backupsDir)) {
        New-Item -ItemType Directory -Path $backupsDir -Force | Out-Null
    }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $outFile = Join-Path $backupsDir "$($Database)_$stamp.sql"

    # cmd's `>` writes the process's raw UTF-8 bytes; PowerShell's `>` would
    # re-encode to UTF-16 and corrupt the dump. -T disables the TTY so output
    # stays byte-clean. --single-transaction gives a consistent InnoDB snapshot.
    # The dumped db name + root password are read from the container's OWN env
    # ($MYSQL_DATABASE / $MYSQL_ROOT_PASSWORD, set by the mysql image), so the
    # dump follows overrides in the root .env with no host-side plumbing.
    # Caveat: the image applies those vars only on FIRST INIT of an empty
    # datadir -- on an existing datadir a changed MYSQL_ROOT_PASSWORD is env-
    # only, the server still has the old password, and this dump fails
    # (caught by the size check below). See .env.example.
    # The sh -c script is wrapped in DOUBLE quotes with backslash-escaped inner
    # "s, not single quotes: this whole line is handed to cmd.exe, and both
    # cmd's own operator parsing and docker.exe's Windows-native argv splitting
    # only honor `"` for grouping an argument -- a single-quoted script gets
    # torn apart into separate argv elements on the way to `sh -c`, which is
    # why an earlier version of this line failed at runtime even though it
    # parsed fine. The whole $dump literal stays single-quoted PowerShell (no
    # interpolation) so $MYSQL_ROOT_PASSWORD / $MYSQL_DATABASE expand INSIDE
    # the container's sh, not on the host. -p"$VAR" (no space after -p) is the
    # mysql client's inline-password form.
    $dump = 'docker compose exec -T mysql sh -c "mysqldump -uroot -p\"$MYSQL_ROOT_PASSWORD\" --single-transaction --no-tablespaces --databases \"$MYSQL_DATABASE\""'
    cmd /c "$dump > `"$outFile`""

    $size = (Get-Item $outFile).Length
    if ($LASTEXITCODE -ne 0 -or $size -lt 1024) {
        throw "backup-db: dump failed (exit $LASTEXITCODE, size $size bytes): $outFile"
    }
    Write-Host ("backup-db: wrote {0} ({1:N0} bytes)" -f $outFile, $size)

    # Retention: keep the newest $Keep dumps, delete the rest.
    Get-ChildItem $backupsDir -Filter "$($Database)_*.sql" |
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
