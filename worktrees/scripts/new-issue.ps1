param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$IssueName,

    [switch]$SkipInstall,
    [switch]$BackendOnly,
    [switch]$FrontendOnly
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

$mainBranch = if ($Config.defaults.mainBranch) { $Config.defaults.mainBranch } else { "main" }
$mainWorktreeName = if ($Config.defaults.mainWorktreeName) { $Config.defaults.mainWorktreeName } else { "main" }

$backendRoot = Resolve-ProjectPath -Config $Config -Value $Config.paths.issueBackendRoot
$frontendRoot = Resolve-ProjectPath -Config $Config -Value $Config.paths.issueFrontendRoot

function New-IssueRepoWorktree {
    param(
        [string]$RepoKey,
        [object]$RepoConfig,
        [string]$IssueRoot
    )

    $bareRepo = Resolve-WorktreesPath -Config $Config -Value $RepoConfig.barePath
    $worktreePath = Join-Path $IssueRoot $IssueName
    $mainWorktreePath = Join-Path $IssueRoot $mainWorktreeName

    Write-Host "`n=== Setting up issue worktree for $RepoKey ===" -ForegroundColor Cyan

    if (-not (Test-Path $bareRepo)) {
        Write-Host "ERROR: Bare repo not found: $bareRepo" -ForegroundColor Red
        return $false
    }

    if (Test-Path $worktreePath) {
        Write-Host "ERROR: Worktree already exists: $worktreePath" -ForegroundColor Red
        return $false
    }

    if (-not (Test-Path $IssueRoot)) {
        New-Item -ItemType Directory -Path $IssueRoot -Force | Out-Null
    }

    Push-Location $bareRepo
    git fetch origin
    git worktree add $worktreePath -b $IssueName "origin/$mainBranch"
    $exitCode = $LASTEXITCODE
    Pop-Location

    if ($exitCode -ne 0) {
        Write-Host "ERROR: Failed creating issue worktree for $RepoKey" -ForegroundColor Red
        return $false
    }

    $envName = if ($RepoConfig.envFile) { $RepoConfig.envFile } else { ".env" }
    $sourceEnv = Join-Path $mainWorktreePath $envName
    $destEnv = Join-Path $worktreePath $envName

    if (Test-Path $sourceEnv) {
        Copy-Item $sourceEnv $destEnv -Force
    }

    if (-not $SkipInstall) {
        Push-Location $worktreePath
        npm install
        Pop-Location
    }

    Write-Host "$RepoKey issue worktree ready: $worktreePath" -ForegroundColor Green
    return $true
}

$allOk = $true
if (-not $FrontendOnly -and $Config.repos.backend) {
    $ok = New-IssueRepoWorktree -RepoKey "backend" -RepoConfig $Config.repos.backend -IssueRoot $backendRoot
    if (-not $ok) { $allOk = $false }
}

if (-not $BackendOnly -and $Config.repos.frontend) {
    $ok = New-IssueRepoWorktree -RepoKey "frontend" -RepoConfig $Config.repos.frontend -IssueRoot $frontendRoot
    if (-not $ok) { $allOk = $false }
}

if ($allOk) {
    Write-Host "`nIssue worktree creation complete." -ForegroundColor Green
} else {
    Write-Host "`nSome issue worktree operations failed." -ForegroundColor Red
    exit 1
}
