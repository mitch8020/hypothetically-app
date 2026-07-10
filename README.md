# Workspace Boilerplate

This repository is a workspace-level command and worktree toolkit for a two-repo web application: one backend repo and one frontend repo. The root directory is not the app itself. It coordinates configuration, installs, git workflows, deploy targets, and worktree helpers for the app repos you place inside it.

## Prerequisites

- Node.js and npm
- Git
- PowerShell if you use the scripts in `worktrees/scripts`
- A backend npm project and a frontend npm project, either existing repos or new repos you scaffold

Do not start by running `npm install` in the workspace root. The root `install` script installs dependencies inside the configured backend and frontend repos, so those repos and `config/workspace-config.json` need to exist first.

## Step 1: Copy This Boilerplate

Copy this folder to the new project location, then open a shell in the copied workspace root.

```powershell
Copy-Item -LiteralPath "C:\Projects\[BOILERPLATE WEB APP]" -Destination "C:\Projects\My Web App" -Recurse
Set-Location -LiteralPath "C:\Projects\My Web App"
```

The default repo folders are:

- `[app]-backend`
- `[app]-frontend`

You can keep those names, rename them, or use a layout like `apps/backend` and `apps/frontend`. If you rename them, pass the paths when you generate the workspace config in Step 4.

## Step 2: Instantiate The Backend Repo

Use one of these options.

Option A, clone an existing backend repo:

```powershell
git clone <backend-repo-url> "[app]-backend"
```

Option B, create a new backend repo in the placeholder folder:

```powershell
Set-Location -LiteralPath ".\[app]-backend"
git init
npm init -y
Set-Location -LiteralPath ".."
```

The default workspace commands expect the backend `package.json` to provide:

- `npm run start:dev`
- `npm run build`
- `npm run start:prod`

If your backend uses different script names, update `commands.backend` in `config/workspace-config.json` after Step 4.

## Step 3: Instantiate The Frontend Repo

Use one of these options.

Option A, clone an existing frontend repo:

```powershell
git clone <frontend-repo-url> "[app]-frontend"
```

Option B, create a new frontend repo in the placeholder folder:

```powershell
Set-Location -LiteralPath ".\[app]-frontend"
git init
npm init -y
Set-Location -LiteralPath ".."
```

The default workspace commands expect the frontend `package.json` to provide:

- `npm run dev`
- `npm run build`
- `npm run start`

If your frontend uses different script names, update `commands.frontend` in `config/workspace-config.json` after Step 4.

## Step 4: Generate The Workspace Config

Run the config command from the workspace root:

```powershell
npm run config:workspace
```

This updates `config/workspace-config.json` with:

- The absolute project root
- The backend repo path
- The frontend repo path
- The worktree root
- Default `.env.dev` and `.env.prod` paths for both repos
- Default `dev` and `prod` deploy targets, using ports `7000`/`7073` and `8000`/`8073`

If your repos are not in the default folders, pass them explicitly:

```powershell
npm run config:workspace -- --backend .\apps\backend --frontend .\apps\frontend
```

To preview the generated config without writing it:

```powershell
npm run config:workspace -- --dry-run
```

## Step 5: Create Environment Files

The generated config points to these default files:

- Backend dev: `[backend-path]/.env.dev`
- Backend prod: `[backend-path]/.env.prod`
- Frontend dev: `[frontend-path]/.env.dev`
- Frontend prod: `[frontend-path]/.env.prod`

Create the files your apps need. The deploy command can also inject port-related values from `deploy.envOverrides` in `config/workspace-config.json`.

## Step 6: Install Dependencies

After the config points to real repos, install dependencies for both app repos:

```powershell
npm run install
```

This runs `npm install` inside the configured backend and frontend directories. You can also install inside each repo manually if you prefer.

## Step 7: Verify The Workspace

Run:

```powershell
npm run verify:workspace
```

Expected early warnings are:

- `git.targets` is empty
- `git.groups` is empty

Those are normal until you configure git workflows. The config command creates default `dev` and `prod` deploy targets that you can customize.

## Step 8: Configure Git And Deploy Targets

Edit `config/workspace-config.json` when you are ready to use workspace git or deploy commands.

Use `git.targets` for named branch workflows:

```json
{
  "git": {
    "targets": {
      "development": {
        "branch": "development",
        "repoScope": "both",
        "sourceBranch": "main"
      }
    },
    "groups": {
      "all": ["development"]
    }
  }
}
```

Use `deploy.targets` to customize local run targets. The generated config starts with `dev` and `prod`; additional targets follow the same shape:

```json
{
  "deploy": {
    "targets": {
      "local_dev": {
        "gitTarget": "development",
        "envProfile": "dev",
        "ports": {
          "backend": 7000,
          "frontend": 7073
        }
      }
    }
  }
}
```

For a complete reference, compare against:

- `config/workspace-config.example.json`
- `worktrees/config/worktree-config.example.json`

## Common Commands

- `npm run config:workspace`
- `npm run config:workspace -- --dry-run`
- `npm run install`
- `npm run verify:workspace`
- `npm run verify:workspace:examples`
- `npm run verify:workspace:all`
- `npm run git:list-targets`
- `npm run git:list-groups`
- `npm run git:sync -- --target <targetId>`
- `npm run git:merge-dev -- --target <targetId>`
- `npm run git:merge-main -- --target <targetId>`
- `npm run git:sync-all -- --group <groupId>`
- `npm run deploy` (runs the generated `dev` target)
- `npm run deploy -- --target <deployTargetId> [--dry-run]`
- `npm run blt:backend [-- --repo <path>]`
- `npm run blt:frontend [-- --repo <path>]`

## Config Overrides For Testing

Use environment overrides to test scripts against alternate config files without editing active templates:

- `WORKSPACE_CONFIG_PATH` for Node scripts, for example `config/workspace-config.example.json`
- `WORKTREE_CONFIG_PATH` for PowerShell worktree scripts, for example `worktrees/config/worktree-config.example.json`

Example:

```powershell
$env:WORKSPACE_CONFIG_PATH = "config/workspace-config.example.json"
node scripts/git-workspace.mjs --list-targets

$env:WORKTREE_CONFIG_PATH = "worktrees/config/worktree-config.example.json"
.\worktrees\scripts\list-worktrees.ps1
```

## Worktree Toolkit

Scripts are in `worktrees/scripts`:

- `new-sub-worktree.ps1`
- `cleanup-sub-worktree.ps1`
- `list-worktrees.ps1`
- `review-worktree.ps1`
- `sync-from-development.ps1`
- `new-issue.ps1`
- `cleanup-issue.ps1`

## Notes

- `config/workspace-config.json` is the active project config.
- `config/workspace-config.example.json` is only a worked example.
- No project-specific branch names are hardcoded in root npm scripts.
- Target and group naming is fully user-defined via config.
- `.claude` workflow content is intentionally left unchanged by templating updates.
