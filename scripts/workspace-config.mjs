#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(scriptDir, "..");

export function getWorkspaceConfigPath() {
  const overridePath = process.env.WORKSPACE_CONFIG_PATH;
  if (!overridePath) {
    return path.join(rootDir, "config", "workspace-config.json");
  }
  return path.isAbsolute(overridePath) ? overridePath : path.join(rootDir, overridePath);
}

function fail(message) {
  throw new Error(message);
}

export function isPlaceholder(value) {
  return typeof value === "string" && /<REQUIRED:/.test(value);
}

export function resolvePath(value) {
  if (!value) {
    return value;
  }
  return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

export function getByPath(obj, dotPath) {
  return dotPath.split(".").reduce((acc, part) => (acc == null ? undefined : acc[part]), obj);
}

export function templateValue(value, vars) {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const next = getByPath(vars, key.trim());
    return next == null ? "" : String(next);
  });
}

function validateBaseConfig(config) {
  if (!config || typeof config !== "object") fail("workspace-config.json must be an object.");
  if (!config.paths || !config.repos || !config.git || !config.deploy || !config.commands) {
    fail("workspace-config.json missing required top-level keys: paths, repos, commands, git, deploy.");
  }
}

export function loadWorkspaceConfig({ allowPlaceholders = true } = {}) {
  const configPath = getWorkspaceConfigPath();
  if (!existsSync(configPath)) {
    fail(`Missing config file: ${configPath}`);
  }

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  validateBaseConfig(config);

  if (!allowPlaceholders) {
    const required = [
      "paths.projectRoot",
      "paths.worktreesRoot",
      "repos.backend.path",
      "repos.frontend.path",
      "repos.backend.envProfiles.dev",
      "repos.backend.envProfiles.prod",
      "repos.frontend.envProfiles.dev",
      "repos.frontend.envProfiles.prod",
    ];

    for (const key of required) {
      const value = getByPath(config, key);
      if (value == null || value === "" || isPlaceholder(value)) {
        fail(`Required config value is unset: ${key}`);
      }
    }
  }

  return config;
}

export function listKeys(obj) {
  if (!obj || typeof obj !== "object") return [];
  return Object.keys(obj);
}

export function repoAbsolutePath(config, repoKey) {
  const repo = config.repos?.[repoKey];
  if (!repo) throw new Error(`Unknown repo key: ${repoKey}`);
  if (!repo.path) throw new Error(`repos.${repoKey}.path is missing`);

  if (path.isAbsolute(repo.path)) return repo.path;

  const projectRoot = config.paths.projectRoot;
  if (!projectRoot || isPlaceholder(projectRoot)) {
    throw new Error("paths.projectRoot must be set to resolve repo paths.");
  }

  return path.join(projectRoot, repo.path);
}
