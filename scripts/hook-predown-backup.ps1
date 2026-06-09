<#
.SYNOPSIS
  Claude Code PreToolUse hook: dump trashdb before any `docker compose down`.

.DESCRIPTION
  Reads the tool-call JSON from stdin. If the command is a compose teardown
  (`docker compose down` / `docker-compose down`, including `down -v`), it runs
  backup-db.ps1 first. Any other command is allowed untouched (exit 0). If the
  teardown's backup genuinely fails, the hook exits 2 to BLOCK the teardown so
  data is never destroyed without a fresh dump.
#>
$ErrorActionPreference = 'Stop'

$raw = [Console]::In.ReadToEnd()
try {
    $payload = $raw | ConvertFrom-Json
} catch {
    exit 0  # Not parseable as a tool call; do not interfere.
}

$cmd = $payload.tool_input.command
if (-not $cmd) { exit 0 }

# Only act on compose teardowns; allow everything else silently.
if ($cmd -notmatch 'docker[\s-]+compose\b[^\r\n]*\bdown\b') { exit 0 }

try {
    & (Join-Path $PSScriptRoot 'backup-db.ps1')
    exit 0
} catch {
    [Console]::Error.WriteLine("pre-down backup FAILED, blocking teardown: $($_.Exception.Message)")
    exit 2  # Block the docker compose down.
}
