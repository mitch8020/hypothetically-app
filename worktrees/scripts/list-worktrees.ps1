$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptRoot "_lib\config.ps1")

try {
    $Config = Get-WorktreeConfig -ScriptRoot $ScriptRoot
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$combinedRoot = Resolve-ProjectPath -Config $Config -Value $Config.paths.combinedRoot
$subNames = Get-SubWorktreeNames -Config $Config
$repoKeys = Get-RepoKeys -Config $Config
$primaryRepo = if ($repoKeys.Count -gt 0) { $repoKeys[0] } else { "backend" }
$primaryDir = if ($Config.repos.$primaryRepo.dirName) { $Config.repos.$primaryRepo.dirName } else { $primaryRepo }

Write-Host "`n=== Configured Sub-Worktrees ===" -ForegroundColor Cyan
Write-Host ""

if ($subNames.Count -eq 0) {
    Write-Host "No subWorktrees configured in worktree-config.json" -ForegroundColor Yellow
    exit 0
}

$header = "{0,-22} {1,-24} {2,-12} {3,-12} {4}" -f "Name", "Branch", "Status", "Ports", "Description"
Write-Host $header -ForegroundColor White
Write-Host ("-" * 95) -ForegroundColor Gray

foreach ($name in $subNames) {
    $info = $Config.subWorktrees.$name
    $branch = $info.branch
    $ports = "$($info.ports.backend)/$($info.ports.frontend)"
    $desc = if ($info.description) { $info.description } else { "-" }

    $probePath = Join-Path (Join-Path $combinedRoot $name) $primaryDir
    $status = if (Test-Path $probePath) { "Active" } else { "NotCreated" }

    $line = "{0,-22} {1,-24} {2,-12} {3,-12} {4}" -f $name, $branch, $status, $ports, $desc
    if ($status -eq "Active") {
        Write-Host $line -ForegroundColor Green
    } else {
        Write-Host $line -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "Commands:" -ForegroundColor Gray
Write-Host "  .\new-sub-worktree.ps1 <name> [-Description \"text\"]" -ForegroundColor Gray
Write-Host "  .\review-worktree.ps1 <name> [-WithServers]" -ForegroundColor Gray
Write-Host "  .\sync-from-development.ps1 <name|all>" -ForegroundColor Gray
Write-Host "  .\cleanup-sub-worktree.ps1 <name>" -ForegroundColor Gray
