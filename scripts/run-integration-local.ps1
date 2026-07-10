[CmdletBinding()]
param(
    [ValidateSet("smoke", "full", "desktop-only", "mobile-only")]
    [string]$TestMode = "full",
    [switch]$SkipBuild,
    [switch]$KeepRunning,
    [switch]$Debug,
    [string]$WorkspaceRoot,
    [string]$BackendDir,
    [string]$FrontendDir,
    [int]$BackendPort = 3000,
    [int]$MongoPort = 27017,
    [int]$RedisPort = 6379
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-WarnLine {
    param([string]$Message)
    Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Get-WorkspaceRoot {
    param([string]$InputRoot)
    if ($InputRoot) {
        return (Resolve-Path $InputRoot).Path
    }

    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    return (Resolve-Path (Join-Path $scriptRoot "..")).Path
}

function Resolve-RepoPath {
    param(
        [string]$ExplicitPath,
        [string[]]$FallbackDirs,
        [string]$WorkspacePath,
        [string]$NameHint
    )

    if ($ExplicitPath) {
        if (-not (Test-Path -LiteralPath $ExplicitPath)) {
            throw "Configured path for $NameHint does not exist: $ExplicitPath"
        }
        return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }

    foreach ($dirName in $FallbackDirs) {
        $candidate = Join-Path $WorkspacePath $dirName
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    $repoWithPackage = Get-ChildItem -LiteralPath $WorkspacePath -Directory |
        Where-Object { $_.Name -like "*$NameHint*" -and (Test-Path (Join-Path $_.FullName "package.json")) } |
        Select-Object -First 1

    if ($repoWithPackage) {
        return $repoWithPackage.FullName
    }

    throw "Unable to resolve $NameHint directory. Provide -$($NameHint.Substring(0,1).ToUpper() + $NameHint.Substring(1))Dir explicitly."
}

function Read-PackageJson {
    param([string]$Dir)
    $pkgPath = Join-Path $Dir "package.json"
    if (-not (Test-Path -LiteralPath $pkgPath)) {
        return $null
    }
    return (Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Has-NpmScript {
    param(
        [string]$Dir,
        [string]$ScriptName
    )
    $pkg = Read-PackageJson -Dir $Dir
    if ($null -eq $pkg -or $null -eq $pkg.scripts) {
        return $false
    }
    return $pkg.scripts.PSObject.Properties.Name -contains $ScriptName
}

function Install-DependenciesIfNeeded {
    param(
        [string]$Dir,
        [string]$Label
    )

    $pkgPath = Join-Path $Dir "package.json"
    if (-not (Test-Path -LiteralPath $pkgPath)) {
        Write-WarnLine "$Label has no package.json at $Dir. Skipping install."
        return
    }

    $nodeModules = Join-Path $Dir "node_modules"
    if (Test-Path -LiteralPath $nodeModules) {
        Write-Host "$Label dependencies already installed."
        return
    }

    Push-Location $Dir
    try {
        if (Test-Path -LiteralPath (Join-Path $Dir "package-lock.json")) {
            Write-Step "Installing $Label dependencies with npm ci"
            & npm ci
        } else {
            Write-Step "Installing $Label dependencies with npm install"
            & npm install
        }
        if ($LASTEXITCODE -ne 0) {
            throw "$Label dependency install failed."
        }
    } finally {
        Pop-Location
    }
}

function Ensure-Container {
    param(
        [string]$Name,
        [string]$Image,
        [string]$PortMapping
    )

    $runningBefore = $false
    $startedByScript = $false
    $createdByScript = $false

    $runningMatch = docker ps --format "{{.Names}}" | Where-Object { $_ -eq $Name }
    if ($runningMatch) {
        $runningBefore = $true
        Write-Host "$Name already running."
        return [PSCustomObject]@{
            Name = $Name
            RunningBefore = $runningBefore
            StartedByScript = $startedByScript
            CreatedByScript = $createdByScript
        }
    }

    $existsMatch = docker ps -a --format "{{.Names}}" | Where-Object { $_ -eq $Name }
    if ($existsMatch) {
        Write-Step "Starting existing container $Name"
        & docker start $Name | Out-Null
        $startedByScript = $true
    } else {
        Write-Step "Creating container $Name ($Image)"
        & docker run -d --name $Name -p $PortMapping $Image | Out-Null
        $createdByScript = $true
        $startedByScript = $true
    }

    return [PSCustomObject]@{
        Name = $Name
        RunningBefore = $runningBefore
        StartedByScript = $startedByScript
        CreatedByScript = $createdByScript
    }
}

function Stop-OrRemoveContainer {
    param([pscustomobject]$ContainerState)

    if ($null -eq $ContainerState) {
        return
    }

    if ($ContainerState.CreatedByScript) {
        & docker rm -f $ContainerState.Name | Out-Null
        return
    }

    if ($ContainerState.StartedByScript -and -not $ContainerState.RunningBefore) {
        & docker stop $ContainerState.Name | Out-Null
    }
}

function Start-BackendProcess {
    param(
        [string]$Dir,
        [int]$Port,
        [string]$LogDir
    )

    $candidateScripts = @("start:test", "start:dev:test", "start:e2e", "start:dev", "start")
    $selectedScript = $null
    foreach ($name in $candidateScripts) {
        if (Has-NpmScript -Dir $Dir -ScriptName $name) {
            $selectedScript = $name
            break
        }
    }
    if (-not $selectedScript) {
        throw "No backend start script found. Expected one of: $($candidateScripts -join ', ')"
    }

    if (-not (Test-Path -LiteralPath $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir | Out-Null
    }
    $outLog = Join-Path $LogDir "backend.stdout.log"
    $errLog = Join-Path $LogDir "backend.stderr.log"

    Write-Step "Starting backend with npm run $selectedScript (PORT=$Port)"
    $previousPort = $env:PORT
    $env:PORT = "$Port"
    try {
        $npmCmd = (Get-Command npm -ErrorAction SilentlyContinue)
        if (-not $npmCmd) {
            throw "npm is not available in PATH."
        }

        $proc = Start-Process -FilePath $npmCmd.Source `
            -ArgumentList @("run", $selectedScript) `
            -WorkingDirectory $Dir `
            -RedirectStandardOutput $outLog `
            -RedirectStandardError $errLog `
            -PassThru
        return [PSCustomObject]@{
            Process = $proc
            Script = $selectedScript
            StdOut = $outLog
            StdErr = $errLog
        }
    } finally {
        $env:PORT = $previousPort
    }
}

function Wait-ForBackend {
    param(
        [string]$BaseUrl,
        [string[]]$CandidatePaths,
        [int]$TimeoutSeconds,
        [pscustomobject]$BackendRuntime
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($BackendRuntime.Process.HasExited) {
            $errLog = if (Test-Path $BackendRuntime.StdErr) { Get-Content $BackendRuntime.StdErr -Tail 40 } else { @() }
            $outLog = if (Test-Path $BackendRuntime.StdOut) { Get-Content $BackendRuntime.StdOut -Tail 40 } else { @() }
            throw @(
                "Backend exited before becoming healthy.",
                "STDOUT tail:",
                ($outLog -join "`n"),
                "STDERR tail:",
                ($errLog -join "`n")
            ) -join "`n"
        }

        foreach ($path in $CandidatePaths) {
            $url = "$BaseUrl$path"
            try {
                $null = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
                Write-Host "Backend responded at $url"
                return
            } catch {
                # Keep polling until timeout.
            }
        }

        Start-Sleep -Seconds 2
    }

    throw "Backend did not become reachable within $TimeoutSeconds seconds."
}

function Run-FrontendE2E {
    param(
        [string]$Dir,
        [string]$Mode,
        [string]$LogPath
    )

    if (-not (Test-Path -LiteralPath (Join-Path $Dir "package.json"))) {
        throw "Frontend package.json not found at $Dir"
    }

    $modeArgs = switch ($Mode) {
        "smoke" { @("--project=chromium") }
        "desktop-only" { @("--project=chromium") }
        "mobile-only" { @("--project=Mobile Safari", "--project=Mobile Chrome") }
        default { @("--project=chromium", "--project=Mobile Safari") }
    }

    Push-Location $Dir
    try {
        if (Has-NpmScript -Dir $Dir -ScriptName "test:e2e:$Mode") {
            Write-Step "Running frontend tests with npm run test:e2e:$Mode"
            & npm run "test:e2e:$Mode" 2>&1 | Tee-Object -FilePath $LogPath
            return $LASTEXITCODE
        }

        if (Has-NpmScript -Dir $Dir -ScriptName "test:e2e") {
            Write-Step "Running frontend tests with npm run test:e2e ($Mode)"
            & npm run test:e2e -- @modeArgs 2>&1 | Tee-Object -FilePath $LogPath
            return $LASTEXITCODE
        }

        Write-Step "No npm test:e2e script found. Falling back to npx playwright test."
        & npx playwright test @modeArgs 2>&1 | Tee-Object -FilePath $LogPath
        return $LASTEXITCODE
    } finally {
        Pop-Location
    }
}

$workspacePath = Get-WorkspaceRoot -InputRoot $WorkspaceRoot
$resolvedBackend = $null
$resolvedFrontend = $null
$mongoState = $null
$redisState = $null
$backendRuntime = $null
$finalExitCode = 1

Write-Host "Workspace root: $workspacePath"

try {
    $resolvedBackend = Resolve-RepoPath -ExplicitPath $BackendDir -FallbackDirs @("[app]-backend", "backend") -WorkspacePath $workspacePath -NameHint "backend"
    $resolvedFrontend = Resolve-RepoPath -ExplicitPath $FrontendDir -FallbackDirs @("[app]-frontend", "frontend") -WorkspacePath $workspacePath -NameHint "frontend"

    Write-Host "Backend repo:  $resolvedBackend"
    Write-Host "Frontend repo: $resolvedFrontend"
    Write-Host "Test mode:     $TestMode"

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker CLI is required but was not found in PATH."
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm is required but was not found in PATH."
    }

    Write-Step "Ensuring MongoDB and Redis containers are running"
    $mongoState = Ensure-Container -Name "boilerplate-e2e-mongo" -Image "mongo:7" -PortMapping "${MongoPort}:27017"
    $redisState = Ensure-Container -Name "boilerplate-e2e-redis" -Image "redis:7" -PortMapping "${RedisPort}:6379"

    Install-DependenciesIfNeeded -Dir $resolvedBackend -Label "Backend"
    Install-DependenciesIfNeeded -Dir $resolvedFrontend -Label "Frontend"

    if (-not $SkipBuild) {
        if (Has-NpmScript -Dir $resolvedBackend -ScriptName "build") {
            Write-Step "Building backend"
            Push-Location $resolvedBackend
            try {
                & npm run build
                if ($LASTEXITCODE -ne 0) {
                    throw "Backend build failed."
                }
            } finally {
                Pop-Location
            }
        } else {
            Write-WarnLine "Backend build script not found. Skipping build."
        }
    } else {
        Write-Host "SkipBuild enabled; backend build skipped."
    }

    $seedScripts = @("seed:test", "db:seed:test", "seed:e2e", "seed")
    $seeded = $false
    foreach ($seedScript in $seedScripts) {
        if (Has-NpmScript -Dir $resolvedBackend -ScriptName $seedScript) {
            Write-Step "Seeding backend data with npm run $seedScript"
            Push-Location $resolvedBackend
            try {
                & npm run $seedScript
                if ($LASTEXITCODE -ne 0) {
                    throw "Seeding with $seedScript failed."
                }
            } finally {
                Pop-Location
            }
            $seeded = $true
            break
        }
    }
    if (-not $seeded) {
        Write-WarnLine "No seed script found. Expected one of: $($seedScripts -join ', ')"
    }

    $logsDir = Join-Path $workspacePath "scripts\logs"
    $backendRuntime = Start-BackendProcess -Dir $resolvedBackend -Port $BackendPort -LogDir $logsDir

    Write-Step "Waiting for backend readiness on port $BackendPort"
    $healthCandidates = @("/health", "/api/health", "/healthz", "/")
    Wait-ForBackend -BaseUrl "http://localhost:$BackendPort" -CandidatePaths $healthCandidates -TimeoutSeconds 90 -BackendRuntime $backendRuntime

    if ($Debug) {
        Write-Step "Enabling Playwright debug logging"
        $env:DEBUG = "pw:api"
    }

    $e2eLog = Join-Path $logsDir "e2e-results.log"
    Write-Step "Running frontend E2E tests"
    $testExitCode = Run-FrontendE2E -Dir $resolvedFrontend -Mode $TestMode -LogPath $e2eLog
    if ($testExitCode -ne 0) {
        throw "E2E tests failed with exit code $testExitCode. See $e2eLog"
    }

    $finalExitCode = 0
    Write-Host "`nE2E run completed successfully." -ForegroundColor Green
}
catch {
    Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
    $finalExitCode = 1
}
finally {
    if ($KeepRunning) {
        Write-Host "`nKeepRunning enabled; backend and containers were left running."
        if ($backendRuntime) {
            Write-Host "Backend PID: $($backendRuntime.Process.Id)"
            Write-Host "Backend logs: $($backendRuntime.StdOut), $($backendRuntime.StdErr)"
        }
    } else {
        if ($backendRuntime -and -not $backendRuntime.Process.HasExited) {
            Write-Step "Stopping backend process"
            Stop-Process -Id $backendRuntime.Process.Id -Force
        }

        Write-Step "Cleaning up containers"
        Stop-OrRemoveContainer -ContainerState $redisState
        Stop-OrRemoveContainer -ContainerState $mongoState
    }

    exit $finalExitCode
}
