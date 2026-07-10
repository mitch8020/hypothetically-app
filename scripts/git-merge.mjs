#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const RESET = "\x1b[0m";
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

function step(msg) {
  console.log(`${BLUE}->${RESET} ${msg}`);
}

function ok(msg) {
  console.log(`${GREEN}[ok]${RESET} ${msg}`);
}

function warn(msg) {
  console.log(`${YELLOW}!${RESET} ${msg}`);
}

function err(msg) {
  console.error(`${RED}[x]${RESET} ${msg}`);
}

function usage() {
  console.log("Usage: node scripts/git-merge.mjs <workflow> <target-branch> [--source <branch>] [--dev <branch>] [--qa <branch>] [--main <branch>]");
  console.log("Workflows: sync | dev | main");
}

function parseArgs(argv) {
  const out = {
    workflow: argv[0] ?? null,
    targetBranch: argv[1] ?? null,
    sourceBranch: null,
    developmentBranch: "development",
    qaBranch: "qa",
    mainBranch: "main",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source") {
      out.sourceBranch = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--dev") {
      out.developmentBranch = argv[i + 1] ?? out.developmentBranch;
      i += 1;
    } else if (arg === "--qa") {
      out.qaBranch = argv[i + 1] ?? out.qaBranch;
      i += 1;
    } else if (arg === "--main") {
      out.mainBranch = argv[i + 1] ?? out.mainBranch;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["sync", "dev", "main"].includes(out.workflow)) {
    throw new Error("workflow must be one of: sync, dev, main");
  }

  if (!out.targetBranch) {
    throw new Error("target branch is required");
  }

  return out;
}

function runGit(args, allowFailure = false) {
  step(`git ${args.join(" ")}`);
  const result = spawnSync("git", args, { stdio: "inherit" });

  if (result.error) {
    err(`Failed to run git: ${result.error.message}`);
    process.exit(1);
  }

  if ((result.status ?? 1) !== 0 && !allowFailure) {
    process.exit(result.status ?? 1);
  }

  return result.status ?? 1;
}

function currentBranch() {
  const result = spawnSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return (result.stdout || "").trim();
}

function checkMergeResult(status, sourceBranch, targetBranch, workflow, branchArg) {
  if (status === 0) return;

  console.log("");
  err("Merge conflict detected");
  warn(`Merging '${sourceBranch}' into '${targetBranch}' failed`);
  console.log("Resolve conflicts, commit, then rerun:");
  console.log(`  node scripts/git-merge.mjs ${workflow} ${branchArg}`);
  warn(`Current branch: ${currentBranch() || "(unknown)"}`);
  process.exit(1);
}

function checkoutAndPull(branch) {
  runGit(["checkout", branch]);
  runGit(["pull"]);
  ok(`Updated '${branch}'`);
}

function mergeBranch(source, target, workflow, branchArg) {
  step(`Merging '${source}' into '${target}'...`);
  const status = runGit(["merge", source], true);
  checkMergeResult(status, source, target, workflow, branchArg);
  ok(`Merged '${source}' into '${target}'`);
}

function pushBranch() {
  const branch = currentBranch();
  runGit(["push"]);
  ok(`Pushed '${branch || "current branch"}'`);
}

function workflowSync(targetBranch, sourceBranch) {
  console.log(`\n[workflow] sync ${sourceBranch} -> ${targetBranch}`);
  checkoutAndPull(sourceBranch);
  checkoutAndPull(targetBranch);
  mergeBranch(sourceBranch, targetBranch, "sync", targetBranch);
  pushBranch();
  ok(`Complete: ${targetBranch} synced from ${sourceBranch}`);
}

function workflowDev(targetBranch, sourceBranch) {
  console.log(`\n[workflow] dev ${targetBranch} <-> ${sourceBranch}`);
  checkoutAndPull(sourceBranch);
  checkoutAndPull(targetBranch);
  mergeBranch(sourceBranch, targetBranch, "dev", targetBranch);
  pushBranch();

  runGit(["checkout", sourceBranch]);
  mergeBranch(targetBranch, sourceBranch, "dev", targetBranch);
  pushBranch();

  runGit(["checkout", targetBranch]);
  ok(`Complete: ${targetBranch} and ${sourceBranch} are in sync`);
}

function workflowMain(targetBranch, developmentBranch, qaBranch, mainBranch) {
  console.log(`\n[workflow] main ${developmentBranch} -> ${qaBranch} -> ${mainBranch}`);
  checkoutAndPull(developmentBranch);
  checkoutAndPull(qaBranch);
  mergeBranch(developmentBranch, qaBranch, "main", targetBranch);
  pushBranch();

  checkoutAndPull(mainBranch);
  mergeBranch(qaBranch, mainBranch, "main", targetBranch);
  pushBranch();

  runGit(["checkout", targetBranch]);
  ok(`Complete: promoted to ${mainBranch}, returned to ${targetBranch}`);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    err(error.message);
    usage();
    process.exit(1);
  }

  if (opts.workflow === "sync") {
    const source = opts.sourceBranch || opts.developmentBranch;
    workflowSync(opts.targetBranch, source);
  } else if (opts.workflow === "dev") {
    const source = opts.sourceBranch || opts.developmentBranch;
    workflowDev(opts.targetBranch, source);
  } else {
    workflowMain(opts.targetBranch, opts.developmentBranch, opts.qaBranch, opts.mainBranch);
  }
}

main();
