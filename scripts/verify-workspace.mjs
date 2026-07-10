#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { rootDir, loadWorkspaceConfig, isPlaceholder, repoAbsolutePath } from "./workspace-config.mjs";

const failures = [];
const warnings = [];

function check(condition, failMessage) {
  if (!condition) failures.push(failMessage);
}

function warn(condition, warnMessage) {
  if (!condition) warnings.push(warnMessage);
}

function parseArgs(argv) {
  const opts = {
    examplesOnly: false,
    withExamples: false,
  };

  for (const arg of argv) {
    if (arg === "--examples-only") {
      opts.examplesOnly = true;
    } else if (arg === "--with-examples") {
      opts.withExamples = true;
    } else if (arg === "-h" || arg === "--help") {
      console.log("Usage: node scripts/verify-workspace.mjs [--examples-only|--with-examples]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (opts.examplesOnly && opts.withExamples) {
    throw new Error("Use only one mode flag: --examples-only or --with-examples");
  }

  return opts;
}

function safeReadJson(relPath) {
  const fullPath = path.join(rootDir, relPath);
  if (!existsSync(fullPath)) {
    failures.push(`Missing required file: ${relPath}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(fullPath, "utf8"));
  } catch (error) {
    failures.push(`Invalid JSON in ${relPath}: ${error.message}`);
    return null;
  }
}

function hasTopLevelKeys(obj, keys, relPath) {
  for (const key of keys) {
    check(obj && Object.prototype.hasOwnProperty.call(obj, key), `Missing required key '${key}' in ${relPath}`);
  }
}

function runAgnosticChecks(relPaths, label) {
  const bannedPatterns = [
    { regex: /\btaliho\b/i, name: "taliho" },
    { regex: /(owner\/jp|sub\/jp|\bjp[0-9]+\b|\bnotjp[0-9]*\b)/i, name: "jp/notjp naming" },
    { regex: /C:\\\\Projects\\\\Taliho Web App|C:\\Projects\\Taliho Web App|C:\/Projects\/Taliho Web App/i, name: "hardcoded Taliho path" },
  ];

  for (const relPath of relPaths) {
    const fullPath = path.join(rootDir, relPath);
    if (!existsSync(fullPath)) {
      continue;
    }
    const text = readFileSync(fullPath, "utf8");
    for (const { regex, name } of bannedPatterns) {
      check(!regex.test(text), `${label}: forbidden ${name} content found in ${relPath}`);
    }
  }
}

function runTemplateChecks() {
  const requiredFiles = [
  "package.json",
  "config/workspace-config.json",
  "scripts/populate-workspace-config.mjs",
  "scripts/workspace-config.mjs",
  "scripts/git-merge.mjs",
  "scripts/git-workspace.mjs",
  "scripts/deploy-target.mjs",
  "worktrees/config/worktree-config.json",
  "worktrees/scripts/new-sub-worktree.ps1",
  "worktrees/scripts/cleanup-sub-worktree.ps1",
  "worktrees/scripts/list-worktrees.ps1",
  "worktrees/scripts/review-worktree.ps1",
  "worktrees/scripts/sync-from-development.ps1",
  "worktrees/scripts/new-issue.ps1",
  "worktrees/scripts/cleanup-issue.ps1",
  "worktrees/templates/CLAUDE_INTRO.md",
  "worktrees/config/worktree-config.schema.json",
  ];

  for (const rel of requiredFiles) {
    check(existsSync(path.join(rootDir, rel)), `Missing required file: ${rel}`);
  }

  runAgnosticChecks(
    [
      "config/workspace-config.json",
      "worktrees/config/worktree-config.json",
      "worktrees/config/worktree-config.schema.json",
    ],
    "template",
  );

  let config = null;
  try {
    config = loadWorkspaceConfig({ allowPlaceholders: true });
  } catch (error) {
    failures.push(error.message);
  }

  if (config) {
    const required = [
      ["paths.projectRoot", config.paths?.projectRoot],
      ["paths.worktreesRoot", config.paths?.worktreesRoot],
      ["repos.backend.path", config.repos?.backend?.path],
      ["repos.frontend.path", config.repos?.frontend?.path],
      ["repos.backend.envProfiles.dev", config.repos?.backend?.envProfiles?.dev],
      ["repos.backend.envProfiles.prod", config.repos?.backend?.envProfiles?.prod],
      ["repos.frontend.envProfiles.dev", config.repos?.frontend?.envProfiles?.dev],
      ["repos.frontend.envProfiles.prod", config.repos?.frontend?.envProfiles?.prod],
    ];

    for (const [key, value] of required) {
      check(value != null && value !== "", `Missing required config value: ${key}`);
      if (value != null && value !== "" && isPlaceholder(value)) {
        warnings.push(`Placeholder still set: ${key}`);
      }
    }

    const pkgPath = path.join(rootDir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const scriptText = JSON.stringify(pkg.scripts || {});
      check(!/jp|notjp/i.test(scriptText), "package.json scripts must not include jp/notjp references.");
    }

    const targetIds = Object.keys(config.git?.targets || {});
    warn(targetIds.length > 0, "No git targets configured yet (git.targets is empty).");

    const groupIds = Object.keys(config.git?.groups || {});
    warn(groupIds.length > 0, "No git groups configured yet (git.groups is empty).");

    const deployTargetIds = Object.keys(config.deploy?.targets || {});
    warn(deployTargetIds.length > 0, "No deploy targets configured yet (deploy.targets is empty).");

    if (config.paths?.projectRoot && !isPlaceholder(config.paths.projectRoot)) {
      for (const repoKey of ["backend", "frontend"]) {
        try {
          const repoPath = repoAbsolutePath(config, repoKey);
          warn(existsSync(repoPath), `Repo path does not currently exist: ${repoPath}`);
        } catch (error) {
          failures.push(error.message);
        }
      }
    }    
  }
}

function runExampleChecks() {
  const workspaceExamplePath = "config/workspace-config.example.json";
  const worktreeExamplePath = "worktrees/config/worktree-config.example.json";

  const workspaceExample = safeReadJson(workspaceExamplePath);
  if (workspaceExample) {
    hasTopLevelKeys(
      workspaceExample,
      ["version", "paths", "repos", "commands", "git", "deploy", "worktrees"],
      workspaceExamplePath,
    );
  }

  const worktreeExample = safeReadJson(worktreeExamplePath);
  if (worktreeExample) {
    hasTopLevelKeys(
      worktreeExample,
      ["version", "paths", "defaults", "repos", "branches", "subWorktrees", "envOverrides"],
      worktreeExamplePath,
    );
  }

  runAgnosticChecks([workspaceExamplePath, worktreeExamplePath], "example");
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`[error] ${error.message}`);
  process.exit(1);
}

if (options.examplesOnly) {
  runExampleChecks();
} else if (options.withExamples) {
  runTemplateChecks();
  runExampleChecks();
} else {
  runTemplateChecks();
}

if (failures.length > 0) {
  console.error("Workspace verification failed:");
  for (const msg of failures) console.error(`- ${msg}`);
  if (warnings.length > 0) {
    console.error("Warnings:");
    for (const msg of warnings) console.error(`- ${msg}`);
  }
  process.exit(1);
}

console.log("Workspace verification passed.");
if (warnings.length > 0) {
  console.log("Warnings:");
  for (const msg of warnings) console.log(`- ${msg}`);
}
