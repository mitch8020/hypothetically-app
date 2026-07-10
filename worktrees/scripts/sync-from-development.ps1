param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Name,

    [switch]$Rebase,
    [switch]$DryRun,
    [switch]$FromParent
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptRoot "_lib\config.ps1")

try {
    $Config = Get-WorktreeConfig -ScriptRoot $ScriptRoot
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$allNames = Get-SubWorktreeNames -Config $Config
if ($allNames.Count -eq 0) {
    Write-Host "ERROR: No subWorktrees configured." -ForegroundColor Red
    exit 1
}

if ($Name -eq "all") {
    $namesToSync = $allNames
} else {
    if ($Name -notin $allNames) {
        Write-Host "ERROR: Unknown worktree name '$Name'" -ForegroundColor Red
        Write-Host "Valid names: $($allNames -join ', '), all" -ForegroundColor Yellow
        exit 1
    }
    $namesToSync = @($Name)
}

$combinedRoot = Resolve-ProjectPath -Config $Config -Value $Config.paths.combinedRoot
$defaultSource = if ($Config.defaults.developmentBranch) { $Config.defaults.developmentBranch } else { "development" }

function Sync-Repo {
    param(
        [string]$RepoPath,
        [string]$SourceBranch,
        [switch]$UseRebase,
        [switch]$WhatIf
    )

    if (-not (Test-Path $RepoPath)) {
        Write-Host "  Missing repo path: $RepoPath" -ForegroundColor Yellow
        return $true
    }

    Push-Location $RepoPath
    $status = git status --porcelain

    if ($status) {
        Pop-Location
        Write-Host "  ERROR: Uncommitted changes in $RepoPath" -ForegroundColor Red
        return $false
    }

    if ($WhatIf) {
        Write-Host "  [DRY RUN] git fetch origin && git $(if($UseRebase){'rebase'}else{'merge'}) origin/$SourceBranch" -ForegroundColor Yellow
        Pop-Location
        return $true
    }

    git fetch origin
    if ($UseRebase) {
        git rebase "origin/$SourceBranch"
    } else {
        git merge "origin/$SourceBranch"
    }
    $exitCode = $LASTEXITCODE
    Pop-Location

    return ($exitCode -eq 0)
}

$allOk = $true
foreach ($wtName in $namesToSync) {
    $info = $Config.subWorktrees.$wtName
    $source = if ($FromParent) { $info.parentBranch } else { $defaultSource }

    Write-Host "`n=== Syncing $wtName from $source ===" -ForegroundColor Cyan

    foreach ($repoKey in (Get-RepoKeys -Config $Config)) {
        $dirName = if ($Config.repos.$repoKey.dirName) { $Config.repos.$repoKey.dirName } else { $repoKey }
        $repoPath = Join-Path (Join-Path $combinedRoot $wtName) $dirName

        Write-Host "- $repoKey" -ForegroundColor Gray
        $ok = Sync-Repo -RepoPath $repoPath -SourceBranch $source -UseRebase:$Rebase -WhatIf:$DryRun
        if (-not $ok) { $allOk = $false }
    }
}

if ($allOk) {
    Write-Host "`nSync complete." -ForegroundColor Green
} else {
    Write-Host "`nSome sync operations failed." -ForegroundColor Red
    exit 1
}
