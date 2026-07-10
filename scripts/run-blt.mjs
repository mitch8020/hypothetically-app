#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { isPlaceholder, loadWorkspaceConfig, rootDir } from "./workspace-config.mjs";

function parseArgs(argv) {
  const opts = {
    target: null,
    repo: null,
    label: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      opts.target = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--repo") {
      opts.repo = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--label") {
      opts.label = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
  }

  return opts;
}

function usageAndExit() {
  console.error(
    "Usage: node scripts/run-blt.mjs --target <frontend|backend> [--repo <path>] [--label <name>]",
  );
  process.exit(1);
}

function hasPackageJson(dirPath) {
  return existsSync(path.join(dirPath, "package.json"));
}

function resolveRepoFromWorkspaceConfig(target) {
  let config;
  try {
    config = loadWorkspaceConfig({ allowPlaceholders: true });
  } catch {
    return null;
  }

  const repoPath = config?.repos?.[target]?.path;
  if (!repoPath || isPlaceholder(repoPath)) {
    return null;
  }

  if (path.isAbsolute(repoPath)) {
    return hasPackageJson(repoPath) ? repoPath : null;
  }

  const projectRoot = config?.paths?.projectRoot;
  if (projectRoot && !isPlaceholder(projectRoot)) {
    const configured = path.join(projectRoot, repoPath);
    if (hasPackageJson(configured)) {
      return configured;
    }
  }

  const local = path.resolve(rootDir, repoPath);
  return hasPackageJson(local) ? local : null;
}

function resolveRepoDir(cwd, target, repoArg) {
  if (repoArg) {
    const explicit = path.resolve(cwd, repoArg);
    if (!hasPackageJson(explicit)) {
      throw new Error(`No package.json found at ${explicit}`);
    }
    return explicit;
  }

  const configuredRepo = resolveRepoFromWorkspaceConfig(target);
  if (configuredRepo) {
    return configuredRepo;
  }

  const candidates =
    target === "frontend"
      ? ["frontend", "[app]-frontend", "taliho-v3-frontend"]
      : ["backend", "[app]-backend", "taliho-v3-backend"];

  for (const candidate of candidates) {
    const repoDir = path.resolve(cwd, candidate);
    if (hasPackageJson(repoDir)) {
      return repoDir;
    }
  }

  throw new Error(`Could not find ${target} repo from ${cwd}. Checked: ${candidates.join(", ")}`);
}

function runScript(repoDir, scriptName) {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", `npm run ${scriptName}`], {
            cwd: repoDir,
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
          })
        : spawn("npm", ["run", scriptName], {
            cwd: repoDir,
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
          });

    let output = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        output,
      });
    });
  });
}

function sumMatches(line, regex) {
  let total = 0;
  for (const match of line.matchAll(regex)) {
    total += Number(match[1]);
  }
  return total;
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function normalizeLines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith(">"));
}

function parseNumericErrorWarningCounts(lines) {
  let errors = 0;
  let warnings = 0;

  for (const line of lines) {
    const lineErrors = sumMatches(line, /\b(\d+)\s+errors?\b/gi);
    const lineWarnings = sumMatches(line, /\b(\d+)\s+warnings?\b/gi);

    errors += lineErrors > 0 ? lineErrors : sumMatches(line, /\berrors?\s*[:=]\s*(\d+)\b/gi);
    warnings += lineWarnings > 0 ? lineWarnings : sumMatches(line, /\bwarnings?\s*[:=]\s*(\d+)\b/gi);
  }

  return { errors, warnings };
}

function analyzeBuildOutput(lines, exitCode) {
  let { errors, warnings } = parseNumericErrorWarningCounts(lines);

  if (exitCode !== 0 && errors === 0) {
    errors = 1;
  }

  return { errors, warnings };
}

function analyzeLintOutput(lines, exitCode) {
  let errors = 0;
  let warnings = 0;

  for (const line of lines) {
    const eslintMatch = line.match(/\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/i);
    if (eslintMatch) {
      errors += Number(eslintMatch[1]);
      warnings += Number(eslintMatch[2]);
    }
  }

  if (errors === 0 && warnings === 0) {
    const numeric = parseNumericErrorWarningCounts(lines);
    errors = numeric.errors;
    warnings = numeric.warnings;
  }

  if (exitCode !== 0 && errors === 0) {
    errors = 1;
  }

  return { errors, warnings };
}

function analyzeTestOutput(lines, exitCode) {
  let suiteFailures = 0;
  let testFailures = 0;
  let failSuiteMarkers = 0;
  let vitestFileFailures = 0;

  for (const line of lines) {
    if (/^Test Suites:/i.test(line)) {
      suiteFailures += sumMatches(line, /\b(\d+)\s+failed\b/gi);
    }

    if (/^Tests:/i.test(line)) {
      testFailures += sumMatches(line, /\b(\d+)\s+failed\b/gi);
    }

    if (/^Failed (Test Files|Suites|Tests)\b/i.test(line) || /^Test Files\b/i.test(line)) {
      vitestFileFailures += sumMatches(line, /\b(\d+)\s+failed\b/gi);
    }

    if (/^FAIL\b/i.test(line)) {
      failSuiteMarkers += 1;
    }
  }

  let errors = Math.max(suiteFailures, testFailures, vitestFileFailures, failSuiteMarkers);
  if (exitCode !== 0 && errors === 0) {
    errors = 1;
  }

  return { errors, warnings: 0 };
}

function analyzeOutput(output, phase, exitCode) {
  const lines = normalizeLines(output);

  switch (phase) {
    case "build":
      return analyzeBuildOutput(lines, exitCode);
    case "lint":
      return analyzeLintOutput(lines, exitCode);
    case "test":
      return analyzeTestOutput(lines, exitCode);
    default: {
      const numeric = parseNumericErrorWarningCounts(lines);
      if (exitCode !== 0 && numeric.errors === 0) {
        numeric.errors = 1;
      }
      return numeric;
    }
  }
}

function printReport(label, repoDir, results) {
  const totalErrors = results.reduce((sum, result) => sum + result.errors, 0);
  const totalWarnings = results.reduce((sum, result) => sum + result.warnings, 0);
  const allPassed = results.every((result) => result.code === 0);

  console.log("\n[blt] Final Report");
  console.log(`[blt] Target: ${label}`);
  console.log(`[blt] Repo: ${repoDir}`);
  console.log("[blt] ----------------------------------------------");
  console.log("[blt] Phase   Exit  Errors  Warnings");

  for (const result of results) {
    const phase = result.phase.padEnd(7, " ");
    const exit = (result.code === 0 ? "PASS" : "FAIL").padEnd(5, " ");
    const errors = String(result.errors).padEnd(7, " ");
    const warnings = String(result.warnings).padEnd(8, " ");
    console.log(`[blt] ${phase} ${exit} ${errors} ${warnings}`);
  }

  console.log("[blt] ----------------------------------------------");
  console.log(`[blt] Total Errors: ${totalErrors}`);
  console.log(`[blt] Total Warnings: ${totalWarnings}`);
  console.log(`[blt] Overall: ${allPassed ? "PASS" : "FAIL"}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.target !== "frontend" && opts.target !== "backend") {
    usageAndExit();
  }

  const cwd = process.cwd();
  const repoDir = resolveRepoDir(cwd, opts.target, opts.repo);
  const label = opts.label ?? `${path.basename(cwd)}:${opts.target}`;
  const phases = ["build", "lint", "test"];
  const results = [];

  console.log(`[blt] Starting ${label}`);

  for (const phase of phases) {
    console.log(`\n[blt] Running ${phase}...`);
    const execution = await runScript(repoDir, phase);
    const counts = analyzeOutput(execution.output, phase, execution.code);
    results.push({
      phase,
      code: execution.code,
      errors: counts.errors,
      warnings: counts.warnings,
    });
  }

  printReport(label, repoDir, results);

  const failed = results.some((result) => result.code !== 0);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`[blt] Fatal: ${error.message}`);
  process.exit(1);
});
