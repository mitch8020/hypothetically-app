param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Name,

    [string]$Description = "",
    [switch]$SkipInstall,
    [switch]$FromDevelopment
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
if ($validNames.Count -eq 0) {
    Write-Host "ERROR: No subWorktrees are configured. Populate worktrees/config/worktree-config.json first." -ForegroundColor Red
    exit 1
}

if ($Name -notin $validNames) {
    Write-Host "ERROR: Unknown worktree name '$Name'" -ForegroundColor Red
    Write-Host "Valid names: $($validNames -join ', ')" -ForegroundColor Yellow
    exit 1
}

$projectRoot = Resolve-ProjectPath -Config $Config -Value $Config.paths.projectRoot
$worktreesRoot = Resolve-ProjectPath -Config $Config -Value $Config.paths.worktreesRoot
$bareRoot = Resolve-ProjectPath -Config $Config -Value $Config.paths.bareRoot
$combinedRoot = Resolve-ProjectPath -Config $Config -Value $Config.paths.combinedRoot

$worktreeInfo = $Config.subWorktrees.$Name
$branchName = $worktreeInfo.branch
$parentBranch = $worktreeInfo.parentBranch
$backendPort = [int]$worktreeInfo.ports.backend
$frontendPort = [int]$worktreeInfo.ports.frontend

$developmentBranch = $Config.defaults.developmentBranch
if (-not $developmentBranch) { $developmentBranch = "development" }

if ($FromDevelopment) {
    $sourceBranch = $developmentBranch
} else {
    $sourceBranch = $parentBranch
}

$envProfile = Get-EnvProfileForWorktree -Config $Config -WorktreeInfo $worktreeInfo
$combinedPath = Join-Path $combinedRoot $Name

if (-not (Test-Path $combinedPath)) {
    New-Item -ItemType Directory -Path $combinedPath -Force | Out-Null
}

function New-RepoWorktree {
    param(
        [string]$RepoKey,
        [object]$RepoConfig
    )

    $bareRepo = Resolve-WorktreesPath -Config $Config -Value $RepoConfig.barePath
    $repoDirName = $RepoConfig.dirName
    if (-not $repoDirName) { $repoDirName = $RepoKey }
    $worktreePath = Join-Path $combinedPath $repoDirName

    Write-Host "`n=== Setting up $RepoKey worktree for '$Name' ===" -ForegroundColor Cyan

    if (-not (Test-Path $bareRepo)) {
        Write-Host "ERROR: Bare repo not found: $bareRepo" -ForegroundColor Red
        return $false
    }

    if (Test-Path $worktreePath) {
        Write-Host "ERROR: Worktree already exists at $worktreePath" -ForegroundColor Red
        return $false
    }

    Push-Location $bareRepo
    git fetch origin
    $branchExists = git branch --list $branchName

    if ($branchExists) {
        git worktree add $worktreePath $branchName
    } else {
        git worktree add $worktreePath -b $branchName "origin/$sourceBranch"
    }
    $exitCode = $LASTEXITCODE
    Pop-Location

    if ($exitCode -ne 0) {
        Write-Host "ERROR: Failed creating worktree for $RepoKey" -ForegroundColor Red
        return $false
    }

    $envSourceRel = $RepoConfig.envProfiles.$envProfile
    if ($envSourceRel) {
        $envSource = Resolve-ProjectPath -Config $Config -Value $envSourceRel
        $envDestName = $RepoConfig.envFile
        if (-not $envDestName) { $envDestName = ".env" }
        $envDest = Join-Path $worktreePath $envDestName

        if (Test-Path $envSource) {
            Copy-Item $envSource $envDest -Force
            $overrides = $Config.envOverrides.$RepoKey
            Apply-EnvOverrides -EnvPath $envDest -Overrides $overrides -BackendPort $backendPort -FrontendPort $frontendPort -BranchName $branchName -ParentBranch $parentBranch
        } else {
            Write-Host "WARNING: Env profile not found: $envSource" -ForegroundColor Yellow
        }
    }

    if (-not $SkipInstall) {
        Push-Location $worktreePath
        npm install
        $installExit = $LASTEXITCODE
        Pop-Location
        if ($installExit -ne 0) {
            Write-Host "WARNING: npm install failed in $worktreePath" -ForegroundColor Yellow
        }
    }

    Write-Host "$RepoKey worktree ready: $worktreePath" -ForegroundColor Green
    return $true
}

$success = $true
foreach ($repoKey in (Get-RepoKeys -Config $Config)) {
    $repoConfig = $Config.repos.$repoKey
    $result = New-RepoWorktree -RepoKey $repoKey -RepoConfig $repoConfig
    if (-not $result) { $success = $false }
}

if ($Description -and $success) {
    $Config.subWorktrees.$Name.description = $Description
    $configPath = Get-WorktreeConfigPath -ScriptRoot $ScriptRoot
    $Config | ConvertTo-Json -Depth 20 | Set-Content $configPath
}

if ($success) {
    Write-Host "`n=== All done ===" -ForegroundColor Green
    Write-Host "Combined worktree path: $combinedPath" -ForegroundColor White
} else {
    Write-Host "`nSome worktree setup steps failed." -ForegroundColor Red
    exit 1
}
