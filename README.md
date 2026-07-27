# Workspace Boilerplate

This repository is a workspace-level command and worktree toolkit for a two-repo web application: one Nest backend repo and one Vite frontend repo. The root directory coordinates scaffolding, configuration, installs, git workflows, deploy targets, and worktree helpers.

## Prerequisites

- Node.js and npm
- Git
- PowerShell if you use the scripts in `worktrees/scripts`

Do not start by running `npm install` in the workspace root. Start with `npm run config:workspace`; it creates and installs the child applications.

## Step 1: Copy This Boilerplate

Copy this folder to the new project location, then open a shell in the copied workspace root.

```powershell
Copy-Item -LiteralPath "C:\Projects\[BOILERPLATE WEB APP]" -Destination "C:\Projects\My Web App" -Recurse
Set-Location -LiteralPath "C:\Projects\My Web App"
```

The default repo folders are:

- `[app]-backend`
- `[app]-frontend`

The config command replaces these placeholders with `<project-name>-backend` and `<project-name>-frontend`. You can also place existing npm repos in the workspace; pass their paths when running the config command.

## Step 2: Scaffold And Configure The Apps

Run the config command from the workspace root:

```powershell
npm run config:workspace
```

The command prompts for:

- The project name, which is normalized to a package-safe slug
- The frontend development port
- The backend development port

For empty placeholders or missing repos, the command:

- Runs `npm create vite@latest <project-slug>-frontend -- --template react-ts --no-interactive`
- Installs the Vite dependencies and initializes its Git repo
- Runs `nest new <project-slug>-backend` through `npx @nestjs/cli@latest`, using npm and strict TypeScript
- Initializes the Nest Git repo
- Preserves any existing `.env`, `.env.dev`, and `.env.prod` placeholder files

If valid npm repos already exist, the command keeps their application code and updates the folder/package names only when they still use `[app]` placeholders.

This updates `config/workspace-config.json` with:

- The project name and slug
- The absolute project root
- The backend repo path
- The frontend repo path
- The worktree root
- Default `.env.dev` and `.env.prod` paths for both repos
- Blank `.env.dev` and `.env.prod` files when those files do not already exist
- A `dev` deploy target using the selected ports, plus the default `prod` target using `8000`/`8073`

If your repos are not in the default folders, pass them explicitly:

```powershell
npm run config:workspace -- --backend .\apps\backend --frontend .\apps\frontend
```

For automation, provide every value and disable prompts:

```powershell
npm run config:workspace -- --project-name "My Web App" --frontend-port 5173 --backend-port 5000 --non-interactive
```

To preview the config and scaffold commands without writing or creating anything:

```powershell
npm run config:workspace -- --dry-run
```

Deployment validates both child `package.json` files and required npm scripts before starting processes, preventing npm from walking up and accidentally using the workspace root package.

## Step 3: Fill In Environment Files

The config command creates these files when they do not already exist:

- Backend dev: `[backend-path]/.env.dev`
- Backend prod: `[backend-path]/.env.prod`
- Frontend dev: `[frontend-path]/.env.dev`
- Frontend prod: `[frontend-path]/.env.prod`

Existing files are never overwritten. Add the variables your apps need to the blank files. The deploy command can also inject port-related values from `deploy.envOverrides` in `config/workspace-config.json`.

## Step 4: Install Dependencies When Needed

Newly scaffolded apps are installed automatically. To reinstall both repos later, run:

```powershell
npm run install
```

This runs `npm install` inside the configured backend and frontend directories. You can also install inside each repo manually if you prefer.

## Step 5: Verify The Workspace

Run:

```powershell
npm run verify:workspace
```

Expected early warnings are:

- `git.targets` is empty
- `git.groups` is empty

Those are normal until you configure git workflows. The config command creates default `dev` and `prod` deploy targets that you can customize.

## Step 6: Configure Git And Deploy Targets

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

`npm run deploy` copies each selected env profile to `.env`, applies configured overrides, exports those values to the matching child process, starts the backend, waits for its selected port to accept connections, and then starts the frontend. Stopping the root deploy command stops both process trees.

For a complete reference, compare against:

- `config/workspace-config.example.json`
- `worktrees/config/worktree-config.example.json`

## Common Commands

- `npm run config:workspace`
- `npm run config:workspace -- --project-name "<name>" --frontend-port <port> --backend-port <port> --non-interactive`
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
