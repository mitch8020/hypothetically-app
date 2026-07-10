#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
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
  --backend <path>          Backend repo path, absolute or relative to workspace root.
  --frontend <path>         Frontend repo path, absolute or relative to workspace root.
  --worktrees-root <path>   Worktrees root path relative to project root. Defaults to worktrees.
  --config <path>           Config file path. Defaults to WORKSPACE_CONFIG_PATH or config/workspace-config.json.
  --dry-run                 Print the config that would be written without changing the file.
  -h, --help                Show this help.
`);
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    repos: {},
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else if (arg === "--backend" || arg === "--frontend" || arg === "--worktrees-root" || arg === "--config") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;

      if (arg === "--backend") opts.repos.backend = value;
      if (arg === "--frontend") opts.repos.frontend = value;
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
    if (existsSync(fullPath)) {
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

  if (rootMatches.length === 1) {
    return rootMatches[0].fullPath;
  }

  const nestedMatches = ["apps", "packages", "services"].flatMap((container) =>
    readDirectories(path.join(rootDir, container))
      .filter((entry) => entry.name.toLowerCase().includes(roleLower))
      .map((entry) => entry.fullPath),
  );

  if (nestedMatches.length === 1) {
    return nestedMatches[0];
  }

  if (rootMatches.length > 1 || nestedMatches.length > 1) {
    const matches = [...rootMatches.map((entry) => entry.fullPath), ...nestedMatches].map(configPathFor);
    throw new Error(`Multiple ${role} directories found: ${matches.join(", ")}. Pass --${role} <path>.`);
  }

  return null;
}

function resolveRepo(role, config, explicitPath) {
  if (explicitPath) {
    const fullPath = resolveFromRoot(explicitPath);
    if (!existsSync(fullPath)) {
      throw new Error(`Configured ${role} path does not exist: ${explicitPath}`);
    }
    return fullPath;
  }

  const currentPath = config.repos?.[role]?.path;
  if (currentPath && !isPlaceholder(currentPath)) {
    const fullPath = resolveFromRoot(currentPath);
    if (existsSync(fullPath)) {
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

  throw new Error(`Unable to resolve ${role} directory. Pass --${role} <path>.`);
}

function profilePath(repoRelPath, profile) {
  return slash(path.posix.join(repoRelPath, `.env.${profile}`));
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
  config.paths ??= {};
  config.repos ??= {};
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

  const backendPath = resolveRepo("backend", config, options.repos.backend);
  const frontendPath = resolveRepo("frontend", config, options.repos.frontend);
  const backendRelPath = configPathFor(backendPath);
  const frontendRelPath = configPathFor(frontendPath);

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

  const envFiles = [
    path.join(backendPath, ".env.dev"),
    path.join(backendPath, ".env.prod"),
    path.join(frontendPath, ".env.dev"),
    path.join(frontendPath, ".env.prod"),
  ];
  const envFileStates = envFiles.map((filePath) => envFileState(filePath));
  const nextJson = `${JSON.stringify(config, null, 2)}\n`;

  if (options.dryRun) {
    console.log(nextJson);
  } else {
    writeFileSync(configPath, nextJson);
    console.log(`[config] Updated ${configPathFor(configPath)}`);
  }

  for (const [index, filePath] of envFiles.entries()) {
    const displayPath = configPathFor(filePath);
    if (options.dryRun) {
      const action = envFileStates[index] === "missing" ? "create" : "keep";
      console.log(`[config] Would ${action} ${displayPath}`);
    } else {
      const created = createBlankEnvFile(filePath);
      console.log(`[config] ${created ? "Created" : "Kept"} ${displayPath}`);
    }
  }

  console.log(`[config] paths.projectRoot = ${config.paths.projectRoot}`);
  console.log(`[config] paths.worktreesRoot = ${config.paths.worktreesRoot}`);
  console.log(`[config] repos.backend.path = ${config.repos.backend.path}`);
  console.log(`[config] repos.frontend.path = ${config.repos.frontend.path}`);
  console.log(`[config] deploy.targets = ${Object.keys(config.deploy.targets).join(", ")}`);
} catch (error) {
  console.error(`[config] Fatal: ${error.message}`);
  process.exit(1);
}
