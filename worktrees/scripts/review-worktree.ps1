param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Name,

    [switch]$WithServers,
    [switch]$CodeOnly,

    [ValidateSet("code", "cursor", "none")]
    [string]$Editor = "code",

    [switch]$ShowPrompt
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

$templatePath = Join-Path $ScriptRoot "..\templates\CLAUDE_INTRO.md"
$configPath = Get-WorktreeConfigPath -ScriptRoot $ScriptRoot

$combinedRoot = Resolve-ProjectPath -Config $Config -Value $Config.paths.combinedRoot
$combinedPath = Join-Path $combinedRoot $Name
$worktreeInfo = $Config.subWorktrees.$Name

$backendPort = [int]$worktreeInfo.ports.backend
$frontendPort = [int]$worktreeInfo.ports.frontend
$branchName = $worktreeInfo.branch
$parentBranch = $worktreeInfo.parentBranch
$description = if ($worktreeInfo.description) { $worktreeInfo.description } else { "(No task description set)" }

$repoPaths = @{}
foreach ($repoKey in (Get-RepoKeys -Config $Config)) {
    $dirName = if ($Config.repos.$repoKey.dirName) { $Config.repos.$repoKey.dirName } else { $repoKey }
    $repoPaths[$repoKey] = Join-Path $combinedPath $dirName
}

if (-not (Test-Path $combinedPath)) {
    Write-Host "ERROR: Combined worktree not found: $combinedPath" -ForegroundColor Red
    exit 1
}

function Get-IntroPrompt {
    if (Test-Path $templatePath) {
        $template = Get-Content $templatePath -Raw
    } else {
        $template = "# Worktree {WORKTREE_NAME}`nBranch: {BRANCH_NAME}`n"
    }

    $prompt = $template
    $prompt = $prompt -replace '\{WORKTREE_NAME\}', $Name
    $prompt = $prompt -replace '\{BRANCH_NAME\}', $branchName
    $prompt = $prompt -replace '\{PARENT_BRANCH\}', $parentBranch
    $prompt = $prompt -replace '\{BACKEND_PORT\}', [string]$backendPort
    $prompt = $prompt -replace '\{FRONTEND_PORT\}', [string]$frontendPort
    $prompt = $prompt -replace '\{BACKEND_PATH\}', $repoPaths["backend"]
    $prompt = $prompt -replace '\{FRONTEND_PATH\}', $repoPaths["frontend"]
    $prompt = $prompt -replace '\{DESCRIPTION\}', $description
    $prompt = $prompt -replace '\{CONFIG_PATH\}', $configPath
    $prompt = $prompt -replace '\{GENERATED_DATE\}', (Get-Date -Format "yyyy-MM-dd HH:mm")

    return $prompt
}

if ($Editor -ne "none" -and -not $ShowPrompt) {
    if ($Editor -eq "code") { code $combinedPath }
    elseif ($Editor -eq "cursor") { cursor $combinedPath }
}

if ($WithServers -and -not $ShowPrompt) {
    foreach ($repoKey in (Get-RepoKeys -Config $Config)) {
        $repoPath = $repoPaths[$repoKey]
        if (-not (Test-Path $repoPath)) { continue }

        $devCmd = $Config.repos.$repoKey.devCommand
        if (-not $devCmd) {
            if ($repoKey -eq "backend") { $devCmd = @("npm", "run", "start:dev") }
            else { $devCmd = @("npm", "run", "dev") }
        }

        $cmdText = ($devCmd -join " ")
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$repoPath'; Write-Host '$repoKey server for $Name' -ForegroundColor Cyan; $cmdText"
    }
}

Write-Host ""
Write-Host ("=" * 60) -ForegroundColor Yellow
Write-Host "CLAUDE CODE INTRO PROMPT" -ForegroundColor Yellow
Write-Host ("=" * 60) -ForegroundColor Yellow
Write-Host ""
Write-Host (Get-IntroPrompt)
Write-Host ""
Write-Host ("=" * 60) -ForegroundColor Yellow
