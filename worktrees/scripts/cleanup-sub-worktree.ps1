param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Name,

    [switch]$KeepBranches,
    [switch]$Force
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

$validNames = Get-SubWorktreeNames -Config $Config
if ($Name -notin $validNames) {
    Write-Host "ERROR: Unknown worktree name '$Name'" -ForegroundColor Red
    Write-Host "Valid names: $($validNames -join ', ')" -ForegroundColor Yellow
    exit 1
}

$combinedRoot = Resolve-ProjectPath -Config $Config -Value $Config.paths.combinedRoot
$combinedPath = Join-Path $combinedRoot $Name
$worktreeInfo = $Config.subWorktrees.$Name
$branchName = $worktreeInfo.branch

function Remove-RepoWorktree {
    param(
        [string]$RepoKey,
        [object]$RepoConfig
    )

    $bareRepo = Resolve-WorktreesPath -Config $Config -Value $RepoConfig.barePath
    $repoDirName = $RepoConfig.dirName
    if (-not $repoDirName) { $repoDirName = $RepoKey }
    $worktreePath = Join-Path $combinedPath $repoDirName

    Write-Host "`n=== Cleaning $RepoKey ===" -ForegroundColor Cyan

    if (-not (Test-Path $worktreePath)) {
        Write-Host "No worktree found at $worktreePath" -ForegroundColor Yellow
        return $true
    }

    Push-Location $worktreePath
    $status = git status --porcelain
    Pop-Location

    if ($status -and -not $Force) {
        Write-Host "ERROR: Uncommitted changes in $worktreePath" -ForegroundColor Red
        return $false
    }

    Push-Location $bareRepo
    git worktree remove $worktreePath --force
    $removeExit = $LASTEXITCODE

    if ($removeExit -eq 0 -and -not $KeepBranches) {
        git branch -d $branchName 2>$null
        if ($LASTEXITCODE -ne 0) {
            git branch -D $branchName 2>$null
        }
    }

    git worktree prune
    Pop-Location

    return ($removeExit -eq 0)
}

$allOk = $true
foreach ($repoKey in (Get-RepoKeys -Config $Config)) {
    $repoConfig = $Config.repos.$repoKey
    if (-not (Remove-RepoWorktree -RepoKey $repoKey -RepoConfig $repoConfig)) {
        $allOk = $false
    }
}

if ((Test-Path $combinedPath) -and -not (Get-ChildItem $combinedPath -Force)) {
    Remove-Item $combinedPath -Force
}

if ($Config.subWorktrees.$Name) {
    $Config.subWorktrees.$Name.description = ""
    $configPath = Get-WorktreeConfigPath -ScriptRoot $ScriptRoot
    $Config | ConvertTo-Json -Depth 20 | Set-Content $configPath
}

if ($allOk) {
    Write-Host "`nCleanup complete." -ForegroundColor Green
} else {
    Write-Host "`nCleanup completed with warnings/errors." -ForegroundColor Yellow
    exit 1
}
