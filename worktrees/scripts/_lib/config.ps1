function Get-WorktreeConfigPath {
    param([string]$ScriptRoot)

    $overridePath = $env:WORKTREE_CONFIG_PATH
    if (-not [string]::IsNullOrWhiteSpace($overridePath)) {
        if ([System.IO.Path]::IsPathRooted($overridePath)) {
            return $overridePath
        }

        $repoRoot = (Resolve-Path -LiteralPath (Join-Path $ScriptRoot "..\..")).Path
        return (Join-Path $repoRoot $overridePath)
    }

    return (Join-Path $ScriptRoot "..\config\worktree-config.json")
}

function Resolve-ProjectPath {
    param(
        [object]$Config,
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }

    if ([System.IO.Path]::IsPathRooted($Value)) {
        return $Value
    }

    return (Join-Path $Config.paths.projectRoot $Value)
}

function Resolve-WorktreesPath {
    param(
        [object]$Config,
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }

    if ([System.IO.Path]::IsPathRooted($Value)) {
        return $Value
    }

    $worktreesRoot = Resolve-ProjectPath -Config $Config -Value $Config.paths.worktreesRoot
    return (Join-Path $worktreesRoot $Value)
}

function Get-WorktreeConfig {
    param([string]$ScriptRoot)

    $configPath = Get-WorktreeConfigPath -ScriptRoot $ScriptRoot
    if (-not (Test-Path -LiteralPath $configPath)) {
        throw "Configuration file not found at $configPath"
    }

    $config = Get-Content -LiteralPath $configPath | ConvertFrom-Json

    if (-not $config.paths -or -not $config.repos -or -not $config.subWorktrees) {
        throw "worktree-config.json is missing required keys (paths, repos, subWorktrees)."
    }

    return $config
}

function Get-ObjectPropertyNames {
    param([object]$Object)

    if ($null -eq $Object) {
        return @()
    }

    return @($Object.PSObject.Properties | Select-Object -ExpandProperty Name)
}

function Get-SubWorktreeNames {
    param([object]$Config)
    return Get-ObjectPropertyNames -Object $Config.subWorktrees
}

function Get-RepoKeys {
    param([object]$Config)
    return Get-ObjectPropertyNames -Object $Config.repos
}

function Get-EnvProfileForWorktree {
    param(
        [object]$Config,
        [object]$WorktreeInfo
    )

    if ($WorktreeInfo.envProfile) {
        return $WorktreeInfo.envProfile
    }

    if ($WorktreeInfo.parentBranch -and $Config.branches.$($WorktreeInfo.parentBranch) -and $Config.branches.$($WorktreeInfo.parentBranch).envProfile) {
        return $Config.branches.$($WorktreeInfo.parentBranch).envProfile
    }

    if ($Config.defaults.defaultEnvProfile) {
        return $Config.defaults.defaultEnvProfile
    }

    return "dev"
}

function Resolve-TemplateString {
    param(
        [string]$Value,
        [hashtable]$Vars
    )

    if ($null -eq $Value) {
        return $Value
    }

    $result = $Value
    foreach ($key in $Vars.Keys) {
        $escapedKey = [regex]::Escape($key)
        $result = [regex]::Replace($result, "\$\{$escapedKey\}", [string]$Vars[$key])
    }
    return $result
}

function Set-EnvValue {
    param(
        [string]$EnvPath,
        [string]$Key,
        [string]$Value
    )

    if (-not (Test-Path $EnvPath)) {
        return
    }

    $lines = Get-Content $EnvPath
    $matched = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^\s*$([regex]::Escape($Key))\s*=") {
            $lines[$i] = "$Key=$Value"
            $matched = $true
            break
        }
    }

    if (-not $matched) {
        $lines += "$Key=$Value"
    }

    Set-Content $EnvPath $lines
}

function Apply-EnvOverrides {
    param(
        [string]$EnvPath,
        [object]$Overrides,
        [int]$BackendPort,
        [int]$FrontendPort,
        [string]$BranchName,
        [string]$ParentBranch
    )

    if ($null -eq $Overrides) {
        return
    }

    $vars = @{
        "ports.backend" = $BackendPort
        "ports.frontend" = $FrontendPort
        "branch" = $BranchName
        "parentBranch" = $ParentBranch
    }

    foreach ($prop in $Overrides.PSObject.Properties) {
        $resolved = Resolve-TemplateString -Value ([string]$prop.Value) -Vars $vars
        Set-EnvValue -EnvPath $EnvPath -Key $prop.Name -Value $resolved
    }
}
