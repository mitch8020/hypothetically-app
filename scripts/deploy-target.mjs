#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
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

function deepValue(vars, key) {
  return key.split(".").reduce((acc, part) => (acc == null ? undefined : acc[part]), vars);
}

function applyTemplate(input, vars) {
  return String(input).replace(/\$\{([^}]+)\}/g, (_, key) => {
    const v = deepValue(vars, key.trim());
    return v == null ? "" : String(v);
  });
}

function spawnCommand(args, cwd, env = process.env) {
  const [cmd, ...rest] = args;
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", `${cmd} ${rest.join(" ")}`], {
      cwd,
      env,
      stdio: "inherit",
      shell: false,
    });
  }
  return spawn(cmd, rest, { cwd, env, stdio: "inherit", shell: false });
}

function runStep(args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(args, cwd, env);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cwd}: ${args.join(" ")} failed (exit ${code})`));
    });
  });
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;

    const finish = (connected) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };

    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function waitForBackend(child, { hosts, port, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error("Backend exited before it accepted connections.");
    }

    for (const host of hosts) {
      if (await canConnect(host, port)) {
        console.log(`[deploy] backend ready at ${host}:${port}`);
        return;
      }
    }

    await delay(100);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for backend on ${hosts.join(" or ")}:${port}.`,
  );
}

function normalizeSteps(steps, vars) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return [];
  }
  return steps.map((step) => step.map((part) => applyTemplate(part, vars)));
}

function parseEnv(content) {
  const values = {};

  for (const rawLine of content.replace(/\r\n/g, "\n").split("\n")) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trimStart();

    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith("\"") && value.endsWith("\""))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return parseEnv(readFileSync(filePath, "utf8"));
}

function buildRuntimeEnv({ baseEnvPath, profileEnvPath, overrides, vars }) {
  const renderedOverrides = Object.fromEntries(
    Object.entries(overrides).map(([key, value]) => [
      key,
      applyTemplate(value, vars),
    ]),
  );

  return {
    ...process.env,
    ...readEnvFile(baseEnvPath),
    ...readEnvFile(profileEnvPath),
    ...renderedOverrides,
  };
}

function readRepoPackage(repoKey, repoPath) {
  const packagePath = path.join(repoPath, "package.json");
  if (!existsSync(packagePath)) {
    throw new Error(
      `Configured ${repoKey} path is not an npm repo because package.json is missing: ${repoPath}. `
      + "Create or clone the app, then rerun npm run config:workspace.",
    );
  }

  try {
    return {
      packagePath,
      value: JSON.parse(readFileSync(packagePath, "utf8")),
    };
  } catch (error) {
    throw new Error(`Invalid package.json for ${repoKey} at ${packagePath}: ${error.message}`);
  }
}

function validateNpmScripts(repoKey, packageJson, steps) {
  const scripts = packageJson.value.scripts || {};

  for (const step of steps) {
    const command = path.basename(String(step[0] || "")).toLowerCase();
    if (command !== "npm" && command !== "npm.cmd") continue;

    const runIndex = step.indexOf("run");
    if (runIndex < 0 || !step[runIndex + 1]) continue;

    const scriptName = step[runIndex + 1];
    if (!Object.prototype.hasOwnProperty.call(scripts, scriptName)) {
      const available = Object.keys(scripts);
      throw new Error(
        `Missing npm script '${scriptName}' for ${repoKey} in ${packageJson.packagePath}. `
        + `Available scripts: ${available.length > 0 ? available.join(", ") : "(none)"}.`,
      );
    }
  }
}

async function runServiceSteps(name, cwd, steps, dryRun, env) {
  if (steps.length === 0) return;
  if (dryRun) {
    for (const step of steps) {
      console.log(`[dry-run] (${name}) ${step.join(" ")}`);
    }
    return;
  }

  for (const step of steps) {
    await runStep(step, cwd, env);
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
    const packageJson = readRepoPackage(repoKey, repoPath);

    serviceState[repoKey] = {
      repoPath,
      profileSrc,
      envDest,
      packageJson,
      runtimeEnv: process.env,
    };
  }

  console.log(`[deploy] target=${opts.target} scope=${repoScope} env=${envProfile} ports=${target.ports.backend}/${target.ports.frontend}`);

  if (branch) {
    for (const repoKey of repoKeys) {
      ensureBranch(serviceState[repoKey].repoPath, branch, opts.dryRun);
    }
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
    validateNpmScripts(repoKey, serviceState[repoKey].packageJson, stepsByRepo[repoKey]);
  }

  for (const repoKey of repoKeys) {
    const state = serviceState[repoKey];
    if (!existsSync(state.profileSrc)) {
      throw new Error(`Missing env profile for ${repoKey}: ${state.profileSrc}`);
    }

    if (opts.dryRun) {
      console.log(
        `[dry-run] read ${state.envDest} and ${state.profileSrc}; environment files remain unchanged`,
      );
      continue;
    }

    const overrides = config.deploy?.envOverrides?.[repoKey] || {};
    state.runtimeEnv = buildRuntimeEnv({
      baseEnvPath: state.envDest,
      profileEnvPath: state.profileSrc,
      overrides,
      vars,
    });
  }

  if (repoKeys.length === 1) {
    const only = repoKeys[0];
    await runServiceSteps(
      only,
      serviceState[only].repoPath,
      stepsByRepo[only],
      opts.dryRun,
      serviceState[only].runtimeEnv,
    );
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
    await runServiceSteps(
      repoKey,
      serviceState[repoKey].repoPath,
      pre[repoKey],
      opts.dryRun,
      serviceState[repoKey].runtimeEnv,
    );
  }

  if (opts.dryRun) {
    for (const repoKey of repoKeys) {
      if (start[repoKey]) {
        console.log(`[dry-run] (${repoKey}) ${start[repoKey].join(" ")}`);
      }
    }
    return;
  }

  const children = [];
  let stopping = false;
  const shutdown = (reason) => {
    if (stopping) return;
    stopping = true;
    if (reason) console.error(reason);
    for (const { child } of children) {
      if (child.killed || child.exitCode != null || child.signalCode != null) continue;
      if (process.platform === "win32" && child.pid) {
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        child.kill("SIGINT");
      }
    }
  };

  process.on("SIGINT", () => shutdown("\nReceived SIGINT. Stopping services..."));
  process.on("SIGTERM", () => shutdown("\nReceived SIGTERM. Stopping services..."));

  const startService = (repoKey) => {
    const child = spawnCommand(
      start[repoKey],
      serviceState[repoKey].repoPath,
      serviceState[repoKey].runtimeEnv,
    );
    const exit = new Promise((resolve) => {
      child.on("close", (code, signal) => resolve({ repoKey, code, signal }));
    });
    const service = { repoKey, child, exit };
    children.push(service);
    return service;
  };

  const backend = startService("backend");
  const readiness = target.readiness?.backend || {};
  const readinessHosts = readiness.host
    ? [readiness.host]
    : Array.isArray(readiness.hosts) && readiness.hosts.length > 0
      ? readiness.hosts
      : ["127.0.0.1", "::1"];
  const readinessTimeoutMs = readiness.timeoutMs ?? 60_000;

  try {
    await waitForBackend(backend.child, {
      hosts: readinessHosts,
      port: target.ports.backend,
      timeoutMs: readinessTimeoutMs,
    });
  } catch (error) {
    shutdown(error.message);
    throw error;
  }

  startService("frontend");
  const firstExit = await Promise.race(children.map(({ exit }) => exit));
  if (!stopping) shutdown(`${firstExit.repoKey} exited. Stopping remaining services...`);
  process.exit(firstExit.code ?? 0);
}

main().catch((error) => {
  console.error(`[error] ${error.message}`);
  process.exit(1);
});
