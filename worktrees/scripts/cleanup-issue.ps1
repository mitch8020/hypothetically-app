param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$IssueName,

    [switch]$KeepBranches,
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptRoot "_lib\config.ps1")

if ($BackendOnly -and $FrontendOnly) {
    Write-Host "ERROR: Cannot use -BackendOnly and -FrontendOnly together." -ForegroundColor Red
    exit 1
}

try {
    $Config = Get-WorktreeConfig -ScriptRoot $ScriptRoot
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$backendRoot = Resolve-ProjectPath -Config $Config -Value $Config.paths.issueBackendRoot
$frontendRoot = Resolve-ProjectPath -Config $Config -Value $Config.paths.issueFrontendRoot

function Cleanup-IssueRepo {
    param(
        [string]$RepoKey,
        [object]$RepoConfig,
        [string]$IssueRoot
    )

    $bareRepo = Resolve-WorktreesPath -Config $Config -Value $RepoConfig.barePath
    $worktreePath = Join-Path $IssueRoot $IssueName

    Write-Host "`n=== Cleaning issue worktree for $RepoKey ===" -ForegroundColor Cyan

    if (-not (Test-Path $worktreePath)) {
        Write-Host "No worktree at $worktreePath" -ForegroundColor Yellow
        return $true
    }

    Push-Location $worktreePath
    $status = git status --porcelain
    Pop-Location

    if ($status -and -not $Force) {
        Write-Host "ERROR: Uncommitted changes detected in $worktreePath" -ForegroundColor Red
        return $false
    }

    Push-Location $bareRepo
    git worktree remove $worktreePath --force
    $removeExit = $LASTEXITCODE

    if ($removeExit -eq 0 -and -not $KeepBranches) {
        git branch -d $IssueName 2>$null
        if ($LASTEXITCODE -ne 0) {
            git branch -D $IssueName 2>$null
        }
    }

    git worktree prune
    Pop-Location

    return ($removeExit -eq 0)
}

$allOk = $true
if (-not $FrontendOnly -and $Config.repos.backend) {
    $ok = Cleanup-IssueRepo -RepoKey "backend" -RepoConfig $Config.repos.backend -IssueRoot $backendRoot
    if (-not $ok) { $allOk = $false }
}

if (-not $BackendOnly -and $Config.repos.frontend) {
    $ok = Cleanup-IssueRepo -RepoKey "frontend" -RepoConfig $Config.repos.frontend -IssueRoot $frontendRoot
    if (-not $ok) { $allOk = $false }
}

if ($allOk) {
    Write-Host "`nIssue cleanup complete." -ForegroundColor Green
} else {
    Write-Host "`nIssue cleanup completed with errors." -ForegroundColor Red
    exit 1
}
