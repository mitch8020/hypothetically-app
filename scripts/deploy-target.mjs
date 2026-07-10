#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadWorkspaceConfig, repoAbsolutePath, rootDir, templateValue } from "./workspace-config.mjs";

function usage() {
  console.log("Usage: npm run deploy -- --target <deployTargetId> [--dry-run]");
}

function parseArgs(argv) {
  const out = { target: null, dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      out.target = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!out.target) {
    throw new Error("Missing --target <deployTargetId>");
  }

  return out;
}

function runGit(args, cwd, inherit = false) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    throw new Error(`git ${args.join(" ")} failed in ${cwd}${stderr ? `: ${stderr}` : ""}`);
  }

  return (result.stdout || "").trim();
}

function ensureBranch(repoPath, branch, dryRun) {
  if (!branch) return;
  const current = runGit(["branch", "--show-current"], repoPath);
  if (current === branch) {
    console.log(`[git] ${path.basename(repoPath)} already on ${branch}`);
    return;
  }

  console.log(`[git] ${path.basename(repoPath)} switching ${current || "(detached)"} -> ${branch}`);
  if (!dryRun) {
    runGit(["checkout", branch], repoPath, true);
  }
}

function upsertEnv(content, key, value) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const matcher = new RegExp(`^\\s*${key}\\s*=`);
  const line = `${key}=${value}`;
  const idx = lines.findIndex((entry) => matcher.test(entry));

  if (idx >= 0) lines[idx] = line;
  else lines.push(line);

  return `${lines.filter((entry, i, arr) => !(i === arr.length - 1 && entry === "")).join("\n")}\n`;
}

function deepValue(vars, key) {
  return key.split(".").reduce((acc, part) => (acc == null ? undefined : acc[part]), vars);
}

function applyTemplate(input, vars) {
  return String(input).replace(/\$\{([^}]+)\}/g, (_, key) => {
    const v = deepValue(vars, key.trim());
    return v == null ? "" : String(v);
  });
}

function spawnCommand(args, cwd) {
  const [cmd, ...rest] = args;
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", `${cmd} ${rest.join(" ")}`], {
      cwd,
      stdio: "inherit",
      shell: false,
    });
  }
  return spawn(cmd, rest, { cwd, stdio: "inherit", shell: false });
}

function runStep(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(args, cwd);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cwd}: ${args.join(" ")} failed (exit ${code})`));
    });
  });
}

function normalizeSteps(steps, vars) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return [];
  }
  return steps.map((step) => step.map((part) => applyTemplate(part, vars)));
}

async function runServiceSteps(name, cwd, steps, dryRun) {
  if (steps.length === 0) return;
  if (dryRun) {
    for (const step of steps) {
      console.log(`[dry-run] (${name}) ${step.join(" ")}`);
    }
    return;
  }

  for (const step of steps) {
    await runStep(step, cwd);
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

  const config = loadWorkspaceConfig({ allowPlaceholders: false });
  const target = config.deploy?.targets?.[opts.target];
  if (!target) {
    throw new Error(`Unknown deploy target '${opts.target}'. Define deploy.targets.${opts.target} in config/workspace-config.json`);
  }

  const gitTarget = target.gitTarget ? config.git?.targets?.[target.gitTarget] : null;
  const branch = target.branch || gitTarget?.branch || null;
  const repoScope = target.repoScope || gitTarget?.repoScope || "both";
  const envProfile = target.envProfile || "dev";

  if (!target.ports?.backend || !target.ports?.frontend) {
    throw new Error(`deploy.targets.${opts.target}.ports.backend and ports.frontend are required`);
  }

  const vars = {
    target: { id: opts.target },
    branch,
    envProfile,
    ports: {
      backend: target.ports.backend,
      frontend: target.ports.frontend,
    },
  };

  const repoKeys = repoScope === "backend" ? ["backend"] : repoScope === "frontend" ? ["frontend"] : ["backend", "frontend"];

  const serviceState = {};
  for (const repoKey of repoKeys) {
    const repoPath = target.paths?.[repoKey]
      ? (path.isAbsolute(target.paths[repoKey]) ? target.paths[repoKey] : path.join(config.paths.projectRoot, target.paths[repoKey]))
      : repoAbsolutePath(config, repoKey);

    if (!existsSync(repoPath)) {
      throw new Error(`Repo path does not exist for ${repoKey}: ${repoPath}`);
    }

    const repoConfig = config.repos[repoKey];
    const envProfilePath = repoConfig.envProfiles?.[envProfile];
    if (!envProfilePath) {
      throw new Error(`repos.${repoKey}.envProfiles.${envProfile} is required`);
    }

    const profileSrc = path.isAbsolute(envProfilePath) ? envProfilePath : path.join(config.paths.projectRoot, envProfilePath);
    const envDest = path.join(repoPath, repoConfig.envFile || ".env");

    serviceState[repoKey] = { repoPath, profileSrc, envDest };
  }

  console.log(`[deploy] target=${opts.target} scope=${repoScope} env=${envProfile} ports=${target.ports.backend}/${target.ports.frontend}`);

  if (branch) {
    for (const repoKey of repoKeys) {
      ensureBranch(serviceState[repoKey].repoPath, branch, opts.dryRun);
    }
  }

  for (const repoKey of repoKeys) {
    const state = serviceState[repoKey];
    if (!existsSync(state.profileSrc)) {
      throw new Error(`Missing env profile for ${repoKey}: ${state.profileSrc}`);
    }

    if (opts.dryRun) {
      console.log(`[dry-run] copy ${state.profileSrc} -> ${state.envDest}`);
      continue;
    }

    copyFileSync(state.profileSrc, state.envDest);

    const overrides = config.deploy?.envOverrides?.[repoKey] || {};
    let envContent = readFileSync(state.envDest, "utf8");
    for (const [key, value] of Object.entries(overrides)) {
      envContent = upsertEnv(envContent, key, applyTemplate(value, vars));
    }
    writeFileSync(state.envDest, envContent, "utf8");
  }

  const defaultProfiles = {
    backend: target.commandProfiles?.backend || envProfile,
    frontend: target.commandProfiles?.frontend || envProfile,
  };

  const stepsByRepo = {};
  for (const repoKey of repoKeys) {
    const profile = defaultProfiles[repoKey];
    const steps = config.commands?.[repoKey]?.[profile];
    if (!steps) {
      throw new Error(`commands.${repoKey}.${profile} is required for deploy target '${opts.target}'`);
    }
    stepsByRepo[repoKey] = normalizeSteps(steps, vars);
  }

  if (repoKeys.length === 1) {
    const only = repoKeys[0];
    await runServiceSteps(only, serviceState[only].repoPath, stepsByRepo[only], opts.dryRun);
    return;
  }

  const pre = {};
  const start = {};
  for (const repoKey of repoKeys) {
    const steps = stepsByRepo[repoKey];
    pre[repoKey] = steps.slice(0, -1);
    start[repoKey] = steps[steps.length - 1];
  }

  for (const repoKey of repoKeys) {
    await runServiceSteps(repoKey, serviceState[repoKey].repoPath, pre[repoKey], opts.dryRun);
  }

  if (opts.dryRun) {
    for (const repoKey of repoKeys) {
      if (start[repoKey]) {
        console.log(`[dry-run] (${repoKey}) ${start[repoKey].join(" ")}`);
      }
    }
    return;
  }

  const children = repoKeys.map((repoKey) => ({
    repoKey,
    child: spawnCommand(start[repoKey], serviceState[repoKey].repoPath),
  }));

  let stopping = false;
  const shutdown = (reason) => {
    if (stopping) return;
    stopping = true;
    if (reason) console.error(reason);
    for (const { child } of children) {
      if (!child.killed) child.kill("SIGINT");
    }
  };

  process.on("SIGINT", () => shutdown("\nReceived SIGINT. Stopping services..."));
  process.on("SIGTERM", () => shutdown("\nReceived SIGTERM. Stopping services..."));

  const exits = children.map(({ repoKey, child }) =>
    new Promise((resolve) => {
      child.on("close", (code, signal) => resolve({ repoKey, code, signal }));
    })
  );

  const firstExit = await Promise.race(exits);
  if (!stopping) shutdown(`${firstExit.repoKey} exited. Stopping remaining services...`);
  process.exit(firstExit.code ?? 0);
}

main().catch((error) => {
  console.error(`[error] ${error.message}`);
  process.exit(1);
});
