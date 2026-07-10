#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadWorkspaceConfig, listKeys, repoAbsolutePath, rootDir } from "./workspace-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log("Usage:");
  console.log("  npm run git:sync -- --target <targetId>");
  console.log("  npm run git:merge-dev -- --target <targetId>");
  console.log("  npm run git:merge-main -- --target <targetId>");
  console.log("  npm run git:sync-all -- --group <groupId>");
  console.log("  npm run git:list-targets");
  console.log("  npm run git:list-groups");
}

function parseArgs(argv) {
  const out = { workflow: null, target: null, group: null, listTargets: false, listGroups: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workflow") {
      out.workflow = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--target") {
      out.target = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--group") {
      out.group = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--list-targets") {
      out.listTargets = true;
    } else if (arg === "--list-groups") {
      out.listGroups = true;
    } else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return out;
}

function commandForWorkflow(workflow) {
  if (workflow === "sync") return "sync";
  if (workflow === "dev") return "dev";
  if (workflow === "main") return "main";
  return null;
}

function runNodeInRepo(repoPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, { cwd: repoPath, stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${repoPath}: command failed with exit ${code}`));
    });
  });
}

function resolveRepoKeys(repoScope) {
  const scope = repoScope || "both";
  if (scope === "backend") return ["backend"];
  if (scope === "frontend") return ["frontend"];
  if (scope === "both") return ["backend", "frontend"];
  throw new Error(`Invalid repoScope: ${scope}`);
}

function listConfigured(label, values) {
  console.log(`${label}:`);
  if (values.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const v of values) {
    console.log(`  - ${v}`);
  }
}

async function runForTarget(config, workflow, targetId) {
  const target = config.git?.targets?.[targetId];
  if (!target) {
    throw new Error(`Unknown git target '${targetId}'. Run: npm run git:list-targets`);
  }

  if (!target.branch) {
    throw new Error(`git.targets.${targetId}.branch is required`);
  }

  const repoKeys = resolveRepoKeys(target.repoScope);
  const workflowCommand = commandForWorkflow(workflow);
  if (!workflowCommand) {
    throw new Error(`Unsupported workflow: ${workflow}`);
  }

  const defaults = config.git.defaults || {};
  const sourceBranch = target.sourceBranch || (workflow === "dev" ? defaults.devSource : defaults.syncSource) || "development";
  const mainFlow = defaults.mainFlow || {};
  const devBranch = mainFlow.development || "development";
  const qaBranch = mainFlow.qa || "qa";
  const mainBranch = mainFlow.main || "main";

  for (const repoKey of repoKeys) {
    const repoPath = repoAbsolutePath(config, repoKey);
    const args = [
      path.join(rootDir, "scripts", "git-merge.mjs"),
      workflowCommand,
      target.branch,
    ];

    if (workflowCommand === "sync" || workflowCommand === "dev") {
      args.push("--source", sourceBranch);
    }
    if (workflowCommand === "main") {
      args.push("--dev", devBranch, "--qa", qaBranch, "--main", mainBranch);
    }

    console.log(`\n[git-workspace] repo=${repoKey} target=${targetId} branch=${target.branch} workflow=${workflowCommand}`);
    await runNodeInRepo(repoPath, args);
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[error] ${error.message}`);
    usage();
    process.exit(1);
  }

  const config = loadWorkspaceConfig({ allowPlaceholders: true });

  const targetIds = listKeys(config.git?.targets);
  const groupIds = listKeys(config.git?.groups);

  if (opts.listTargets) {
    listConfigured("Configured targets", targetIds);
    return;
  }

  if (opts.listGroups) {
    listConfigured("Configured groups", groupIds);
    return;
  }

  if (!opts.workflow) {
    usage();
    process.exit(1);
  }

  if (opts.workflow === "sync-all") {
    if (!opts.group) {
      throw new Error("sync-all requires --group <groupId>");
    }
    const group = config.git?.groups?.[opts.group];
    if (!Array.isArray(group) || group.length === 0) {
      throw new Error(`Unknown or empty group '${opts.group}'. Run: npm run git:list-groups`);
    }

    for (const targetId of group) {
      await runForTarget(config, "sync", targetId);
    }
    return;
  }

  if (!["sync", "dev", "main"].includes(opts.workflow)) {
    throw new Error("--workflow must be one of: sync, dev, main, sync-all");
  }

  if (!opts.target) {
    throw new Error(`${opts.workflow} requires --target <targetId>`);
  }

  await runForTarget(config, opts.workflow, opts.target);
}

main().catch((error) => {
  console.error(`[error] ${error.message}`);
  process.exit(1);
});
