#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { isPlaceholder, loadWorkspaceConfig, repoAbsolutePath } from "./workspace-config.mjs";

function hasPackageJson(repoPath) {
  return existsSync(path.join(repoPath, "package.json"));
}

function ensureConfiguredRepo(config, repoKey) {
  const repoPath = config.repos?.[repoKey]?.path;
  if (!repoPath || isPlaceholder(repoPath)) {
    throw new Error(`repos.${repoKey}.path is missing or still a placeholder in workspace config.`);
  }
}

function runNpmInstall(repoPath) {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", "npm install"], {
            cwd: repoPath,
            stdio: "inherit",
            shell: false,
          })
        : spawn("npm", ["install"], {
            cwd: repoPath,
            stdio: "inherit",
            shell: false,
          });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm install failed with exit code ${code ?? 1} in ${repoPath}`));
      }
    });
  });
}

async function main() {
  const config = loadWorkspaceConfig({ allowPlaceholders: true });
  const repoKeys = ["frontend", "backend"];

  for (const repoKey of repoKeys) {
    ensureConfiguredRepo(config, repoKey);
  }

  for (const repoKey of repoKeys) {
    const repoPath = repoAbsolutePath(config, repoKey);

    if (!existsSync(repoPath)) {
      throw new Error(`Configured repo path does not exist for ${repoKey}: ${repoPath}`);
    }

    if (!hasPackageJson(repoPath)) {
      throw new Error(`No package.json found for ${repoKey} at configured path: ${repoPath}`);
    }

    console.log(`[install] ${repoKey}: ${repoPath}`);
    await runNpmInstall(repoPath);
  }
}

main().catch((error) => {
  console.error(`[install] Fatal: ${error.message}`);
  process.exit(1);
});
