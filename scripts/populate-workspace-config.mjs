#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { getWorkspaceConfigPath, isPlaceholder, rootDir } from "./workspace-config.mjs";

const repoDefaults = {
  backend: ["[app]-backend", "backend", "apps/backend", "packages/backend", "services/backend"],
  frontend: ["[app]-frontend", "frontend", "apps/frontend", "packages/frontend", "services/frontend"],
};

const deployTargetDefaults = {
  dev: {
    envProfile: "dev",
    ports: {
      backend: 7000,
      frontend: 7073,
    },
  },
  prod: {
    envProfile: "prod",
    ports: {
      backend: 8000,
      frontend: 8073,
    },
  },
};

const ignoredRootDirs = new Set([
  ".claude",
  ".git",
  "config",
  "node_modules",
  "scripts",
  "worktrees",
]);

function usage() {
  console.log(`Usage: node scripts/populate-workspace-config.mjs [options]

Options:
  --project-name <name>     Project name used for repo folders and package names.
  --backend <path>          Backend repo path, absolute or relative to workspace root.
  --frontend <path>         Frontend repo path, absolute or relative to workspace root.
  --backend-port <port>     Backend port for the dev deploy target.
  --frontend-port <port>    Frontend port for the dev deploy target.
  --worktrees-root <path>   Worktrees root path relative to project root. Defaults to worktrees.
  --config <path>           Config file path. Defaults to WORKSPACE_CONFIG_PATH or config/workspace-config.json.
  --non-interactive         Use existing or inferred values instead of prompting.
  --dry-run                 Print the config that would be written without changing the file.
  -h, --help                Show this help.
`);
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    nonInteractive: false,
    repos: {},
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--non-interactive") {
      opts.nonInteractive = true;
    } else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else if (
      arg === "--project-name"
      || arg === "--backend"
      || arg === "--frontend"
      || arg === "--backend-port"
      || arg === "--frontend-port"
      || arg === "--worktrees-root"
      || arg === "--config"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;

      if (arg === "--project-name") opts.projectName = value;
      if (arg === "--backend") opts.repos.backend = value;
      if (arg === "--frontend") opts.repos.frontend = value;
      if (arg === "--backend-port") opts.backendPort = value;
      if (arg === "--frontend-port") opts.frontendPort = value;
      if (arg === "--worktrees-root") opts.worktreesRoot = value;
      if (arg === "--config") opts.configPath = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

function slash(value) {
  return value.replace(/\\/g, "/");
}

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(rootDir, value);
}

function configPathFor(value) {
  const resolved = resolveFromRoot(value);
  const rel = path.relative(rootDir, resolved);
  if (!rel || rel === "") return ".";
  if (rel.startsWith("..") || path.isAbsolute(rel)) return slash(resolved);
  return slash(rel);
}

function hasPackageJson(dirPath) {
  return existsSync(path.join(dirPath, "package.json"));
}

function readPackageJson(repoPath, role) {
  const packagePath = path.join(repoPath, "package.json");
  if (!existsSync(packagePath)) {
    throw new Error(
      `Scaffolding did not create a package.json for ${role}: ${configPathFor(repoPath)}.`,
    );
  }

  try {
    return {
      packagePath,
      value: JSON.parse(readFileSync(packagePath, "utf8")),
    };
  } catch (error) {
    throw new Error(`Invalid package.json for ${role} at ${configPathFor(packagePath)}: ${error.message}`);
  }
}

function projectSlug(value) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new Error("Project name must contain at least one letter or number.");
  }

  return slug;
}

function parsePort(value, label) {
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a whole number from 1 to 65535.`);
  }

  const port = Number(normalized);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be a whole number from 1 to 65535.`);
  }

  return port;
}

function inferProjectName(config) {
  if (config.project?.name) return config.project.name;

  for (const role of ["backend", "frontend"]) {
    const repoPath = config.repos?.[role]?.path;
    if (!repoPath || isPlaceholder(repoPath)) continue;
    const basename = path.basename(repoPath);
    const suffix = `-${role}`;
    if (basename.toLowerCase().endsWith(suffix)) {
      const prefix = basename.slice(0, -suffix.length);
      if (prefix && prefix.toLowerCase() !== "[app]") return prefix;
    }
  }

  return path.basename(rootDir);
}

async function promptForSetup(options, config) {
  const defaults = {
    projectName: inferProjectName(config),
    backendPort: config.deploy.targets.dev.ports.backend,
    frontendPort: config.deploy.targets.dev.ports.frontend,
  };

  const values = {
    projectName: options.projectName,
    backendPort: options.backendPort,
    frontendPort: options.frontendPort,
  };

  if (!options.nonInteractive && Object.values(values).some((value) => value == null)) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (values.projectName == null) {
        const answer = (await prompt.question(`Project name [${defaults.projectName}]: `)).trim();
        values.projectName = answer || defaults.projectName;
      }
      if (values.frontendPort == null) {
        const answer = (await prompt.question(`Frontend dev port [${defaults.frontendPort}]: `)).trim();
        values.frontendPort = answer || defaults.frontendPort;
      }
      if (values.backendPort == null) {
        const answer = (await prompt.question(`Backend dev port [${defaults.backendPort}]: `)).trim();
        values.backendPort = answer || defaults.backendPort;
      }
    } finally {
      prompt.close();
    }
  }

  values.projectName ??= defaults.projectName;
  values.backendPort ??= defaults.backendPort;
  values.frontendPort ??= defaults.frontendPort;

  const setup = {
    projectName: String(values.projectName).trim(),
    projectSlug: projectSlug(String(values.projectName).trim()),
    backendPort: parsePort(values.backendPort, "Backend port"),
    frontendPort: parsePort(values.frontendPort, "Frontend port"),
  };

  if (setup.backendPort === setup.frontendPort) {
    throw new Error("Backend and frontend ports must be different.");
  }

  return setup;
}

function readDirectories(dirPath) {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(dirPath, entry.name),
    }));
}

function firstExisting(defaults) {
  for (const relPath of defaults) {
    const fullPath = path.join(rootDir, relPath);
    if (existsSync(fullPath) && hasPackageJson(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

function findNamedRepo(role) {
  const roleLower = role.toLowerCase();
  const rootMatches = readDirectories(rootDir)
    .filter((entry) => !ignoredRootDirs.has(entry.name))
    .filter((entry) => entry.name.toLowerCase().includes(roleLower))
    .sort((a, b) => {
      const packageDelta = Number(hasPackageJson(b.fullPath)) - Number(hasPackageJson(a.fullPath));
      return packageDelta || a.name.localeCompare(b.name);
    });

  const nestedMatches = ["apps", "packages", "services"].flatMap((container) =>
    readDirectories(path.join(rootDir, container))
      .filter((entry) => entry.name.toLowerCase().includes(roleLower))
      .map((entry) => entry.fullPath),
  );
  const allMatches = [...rootMatches.map((entry) => entry.fullPath), ...nestedMatches];
  const packageMatches = allMatches.filter((entry) => hasPackageJson(entry));
  const matches = packageMatches.length > 0 ? packageMatches : allMatches;

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    const displayMatches = matches.map(configPathFor);
    throw new Error(`Multiple ${role} directories found: ${displayMatches.join(", ")}. Pass --${role} <path>.`);
  }

  return null;
}

function resolveRepo(role, config, explicitPath) {
  if (explicitPath) {
    return resolveFromRoot(explicitPath);
  }

  const currentPath = config.repos?.[role]?.path;
  let configuredFallback = null;
  if (currentPath && !isPlaceholder(currentPath)) {
    const fullPath = resolveFromRoot(currentPath);
    configuredFallback = fullPath;
    if (existsSync(fullPath) && hasPackageJson(fullPath)) {
      return fullPath;
    }
  }

  const defaultPath = firstExisting(repoDefaults[role]);
  if (defaultPath) {
    return defaultPath;
  }

  const namedPath = findNamedRepo(role);
  if (namedPath) {
    return namedPath;
  }

  return configuredFallback || path.join(rootDir, repoDefaults[role][0]);
}

function profilePath(repoRelPath, profile) {
  return slash(path.posix.join(repoRelPath, `.env.${profile}`));
}

function plannedRepoPath(role, repoPath, slug) {
  if (path.basename(repoPath).toLowerCase() !== `[app]-${role}`) {
    return repoPath;
  }
  return path.join(path.dirname(repoPath), `${slug}-${role}`);
}

function planRepo(role, repoPath, slug) {
  const targetPath = plannedRepoPath(role, repoPath, slug);
  const packageJson = hasPackageJson(repoPath) ? readPackageJson(repoPath, role) : null;

  if (targetPath !== repoPath && existsSync(targetPath)) {
    throw new Error(
      `Cannot create ${configPathFor(targetPath)} because the destination already exists.`,
    );
  }

  if (!packageJson && targetPath === repoPath && existsSync(repoPath)) {
    throw new Error(
      `Cannot scaffold ${role} into the existing non-repo directory ${configPathFor(repoPath)}. `
      + `Use the [app]-${role} placeholder or pass an unused --${role} path.`,
    );
  }

  if (!packageJson && existsSync(repoPath)) {
    const allowed = new Set([".env", ".env.dev", ".env.prod"]);
    const unexpected = readdirSync(repoPath).filter((entry) => !allowed.has(entry));
    if (unexpected.length > 0) {
      throw new Error(
        `Cannot replace incomplete ${role} placeholder ${configPathFor(repoPath)} because it contains: `
        + `${unexpected.join(", ")}.`,
      );
    }
  }

  return {
    role,
    sourcePath: repoPath,
    targetPath,
    packageJson,
    scaffold: packageJson == null,
  };
}

function commandDisplay(command, args) {
  return [command, ...args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`[config] Running (${configPathFor(cwd)}) ${commandDisplay(command, args)}`);
    const child = process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", commandDisplay(command, args)], {
          cwd,
          stdio: "inherit",
          shell: false,
        })
      : spawn(command, args, {
          cwd,
          stdio: "inherit",
          shell: false,
        });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${commandDisplay(command, args)} failed with exit code ${code ?? 1}.`));
    });
  });
}

function scaffoldCommands(plan) {
  const parentPath = path.dirname(plan.targetPath);
  const folderName = path.basename(plan.targetPath);

  if (plan.role === "frontend") {
    return [
      {
        command: "npm",
        args: [
          "create",
          "vite@latest",
          folderName,
          "--",
          "--template",
          "react-ts",
          "--no-interactive",
        ],
        cwd: parentPath,
      },
      { command: "npm", args: ["install"], cwd: plan.targetPath },
      { command: "git", args: ["init"], cwd: plan.targetPath },
    ];
  }

  return [
    {
      command: "npx",
      args: [
        "--yes",
        "@nestjs/cli@latest",
        "new",
        folderName,
        "--package-manager",
        "npm",
        "--strict",
      ],
      cwd: parentPath,
    },
    { command: "git", args: ["init"], cwd: plan.targetPath },
  ];
}

function transferPlaceholderEnvFiles(plan) {
  if (plan.sourcePath === plan.targetPath || !existsSync(plan.sourcePath)) return;

  for (const name of [".env", ".env.dev", ".env.prod"]) {
    const source = path.join(plan.sourcePath, name);
    if (!existsSync(source)) continue;
    const target = path.join(plan.targetPath, name);
    if (existsSync(target)) {
      throw new Error(`Scaffold unexpectedly created ${configPathFor(target)}; refusing to overwrite it.`);
    }
    renameSync(source, target);
  }

  if (readdirSync(plan.sourcePath).length === 0) {
    rmdirSync(plan.sourcePath);
    console.log(`[config] Removed empty placeholder ${configPathFor(plan.sourcePath)}`);
  }
}

async function applyRepoPlan(plan, packageName, dryRun) {
  if (plan.scaffold) {
    const commands = scaffoldCommands(plan);
    for (const { command, args, cwd } of commands) {
      if (dryRun) {
        console.log(`[config] Would run (${configPathFor(cwd)}) ${commandDisplay(command, args)}`);
      } else {
        if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });
        await runCommand(command, args, cwd);
      }
    }

    if (!dryRun) {
      transferPlaceholderEnvFiles(plan);
      plan.packageJson = readPackageJson(plan.targetPath, plan.role);
    }
  }

  if (plan.targetPath !== plan.sourcePath) {
    if (!plan.scaffold) {
      console.log(
        `[config] ${dryRun ? "Would rename" : "Renamed"} `
        + `${configPathFor(plan.sourcePath)} -> ${configPathFor(plan.targetPath)}`,
      );
      if (!dryRun) renameSync(plan.sourcePath, plan.targetPath);
    }
  }

  const packagePath = path.join(plan.targetPath, "package.json");
  if (dryRun && plan.scaffold) {
    console.log(`[config] Would set ${configPathFor(packagePath)} name = ${packageName}`);
  } else if (plan.packageJson.value.name !== packageName) {
    console.log(
      `[config] ${dryRun ? "Would set" : "Set"} ${configPathFor(packagePath)} name = ${packageName}`,
    );
    if (!dryRun) {
      const nextPackage = { ...plan.packageJson.value, name: packageName };
      writeFileSync(packagePath, `${JSON.stringify(nextPackage, null, 2)}\n`);
    }
  }
}

function envFileState(filePath) {
  if (!existsSync(filePath)) return "missing";
  if (!statSync(filePath).isFile()) {
    throw new Error(`Required env path is not a file: ${configPathFor(filePath)}`);
  }
  return "existing";
}

function createBlankEnvFile(filePath) {
  if (envFileState(filePath) === "existing") return false;

  try {
    writeFileSync(filePath, "", { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST" && envFileState(filePath) === "existing") return false;
    throw error;
  }
}

function ensureConfigShape(config) {
  config.project ??= {};
  config.paths ??= {};
  config.repos ??= {};
  config.commands ??= {};
  config.commands.frontend ??= {};
  config.deploy ??= {};
  config.deploy.targets ??= {};

  for (const repoKey of ["backend", "frontend"]) {
    config.repos[repoKey] ??= {};
    config.repos[repoKey].envFile ??= ".env";
    config.repos[repoKey].envProfiles ??= {};
  }

  for (const [targetId, defaults] of Object.entries(deployTargetDefaults)) {
    const target = config.deploy.targets[targetId] ??= {};
    target.envProfile ??= defaults.envProfile;
    target.ports ??= {};
    target.ports.backend ??= defaults.ports.backend;
    target.ports.frontend ??= defaults.ports.frontend;
  }

  const legacyFrontendDev = [["npm", "run", "dev"]];
  const portAwareFrontendDev = [[
    "npm",
    "run",
    "dev",
    "--",
    "--strictPort",
    "--port",
    "${ports.frontend}",
  ]];
  if (
    config.commands.frontend.dev == null
    || JSON.stringify(config.commands.frontend.dev) === JSON.stringify(legacyFrontendDev)
  ) {
    config.commands.frontend.dev = portAwareFrontendDev;
  }

  const legacyFrontendProd = [
    ["npm", "run", "build"],
    ["npm", "run", "start"],
  ];
  const viteFrontendProd = [
    ["npm", "run", "build"],
    [
      "npm",
      "run",
      "preview",
      "--",
      "--strictPort",
      "--port",
      "${ports.frontend}",
    ],
  ];
  if (
    config.commands.frontend.prod == null
    || JSON.stringify(config.commands.frontend.prod) === JSON.stringify(legacyFrontendProd)
  ) {
    config.commands.frontend.prod = viteFrontendProd;
  }
}

function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}`);
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`[config] ${error.message}`);
  console.error("[config] Run with --help for usage.");
  process.exit(1);
}

try {
  const configPath = options.configPath ? resolveFromRoot(options.configPath) : getWorkspaceConfigPath();
  const config = loadConfig(configPath);
  ensureConfigShape(config);
  const setup = await promptForSetup(options, config);

  const backendPath = resolveRepo("backend", config, options.repos.backend);
  const frontendPath = resolveRepo("frontend", config, options.repos.frontend);
  const repoPlans = {
    backend: planRepo("backend", backendPath, setup.projectSlug),
    frontend: planRepo("frontend", frontendPath, setup.projectSlug),
  };
  const backendRelPath = configPathFor(repoPlans.backend.targetPath);
  const frontendRelPath = configPathFor(repoPlans.frontend.targetPath);

  config.project.name = setup.projectName;
  config.project.slug = setup.projectSlug;
  config.paths.projectRoot = slash(rootDir);
  config.paths.worktreesRoot = options.worktreesRoot ? configPathFor(options.worktreesRoot) : (
    config.paths.worktreesRoot && !isPlaceholder(config.paths.worktreesRoot)
      ? config.paths.worktreesRoot
      : "worktrees"
  );

  config.repos.backend.path = backendRelPath;
  config.repos.backend.envProfiles.dev = profilePath(backendRelPath, "dev");
  config.repos.backend.envProfiles.prod = profilePath(backendRelPath, "prod");

  config.repos.frontend.path = frontendRelPath;
  config.repos.frontend.envProfiles.dev = profilePath(frontendRelPath, "dev");
  config.repos.frontend.envProfiles.prod = profilePath(frontendRelPath, "prod");

  config.deploy.targets.dev.ports.backend = setup.backendPort;
  config.deploy.targets.dev.ports.frontend = setup.frontendPort;

  const envFiles = [
    { plan: repoPlans.backend, name: ".env.dev" },
    { plan: repoPlans.backend, name: ".env.prod" },
    { plan: repoPlans.frontend, name: ".env.dev" },
    { plan: repoPlans.frontend, name: ".env.prod" },
  ];
  const envFileStates = envFiles.map(({ plan, name }) => envFileState(path.join(plan.sourcePath, name)));
  const nextJson = `${JSON.stringify(config, null, 2)}\n`;

  for (const role of ["frontend", "backend"]) {
    const plan = repoPlans[role];
    await applyRepoPlan(plan, `${setup.projectSlug}-${plan.role}`, options.dryRun);
  }

  if (options.dryRun) {
    console.log(nextJson);
  } else {
    writeFileSync(configPath, nextJson);
    console.log(`[config] Updated ${configPathFor(configPath)}`);
  }

  for (const [index, { plan, name }] of envFiles.entries()) {
    const filePath = path.join(plan.targetPath, name);
    const displayPath = configPathFor(filePath);
    if (options.dryRun) {
      const action = envFileStates[index] === "missing" ? "create" : "keep";
      console.log(`[config] Would ${action} ${displayPath}`);
    } else {
      const created = createBlankEnvFile(filePath);
      console.log(`[config] ${created ? "Created" : "Kept"} ${displayPath}`);
    }
  }

  console.log(`[config] project.name = ${config.project.name}`);
  console.log(`[config] project.slug = ${config.project.slug}`);
  console.log(`[config] paths.projectRoot = ${config.paths.projectRoot}`);
  console.log(`[config] paths.worktreesRoot = ${config.paths.worktreesRoot}`);
  console.log(`[config] repos.backend.path = ${config.repos.backend.path}`);
  console.log(`[config] repos.frontend.path = ${config.repos.frontend.path}`);
  console.log(`[config] deploy.targets.dev.ports = ${setup.backendPort}/${setup.frontendPort}`);
  console.log(`[config] deploy.targets = ${Object.keys(config.deploy.targets).join(", ")}`);
} catch (error) {
  console.error(`[config] Fatal: ${error.message}`);
  process.exit(1);
}
