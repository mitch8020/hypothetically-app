import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, "..");
const scriptPath = path.join(scriptsDir, "populate-workspace-config.mjs");
const deployScriptPath = path.join(scriptsDir, "deploy-target.mjs");
const baseConfig = JSON.parse(readFileSync(path.join(rootDir, "config", "workspace-config.json"), "utf8"));

function createTempConfig(t, update = () => {}) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "workspace-config-"));
  const configPath = path.join(tempDir, "workspace-config.json");
  const config = structuredClone(baseConfig);
  update(config);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  return configPath;
}

function runGenerator(configPath) {
  const result = spawnSync(process.execPath, [scriptPath, "--config", configPath], {
    cwd: rootDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function runDeployTarget(configPath, targetId) {
  const result = spawnSync(process.execPath, [deployScriptPath, "--target", targetId, "--dry-run"], {
    cwd: rootDir,
    encoding: "utf8",
    env: { ...process.env, WORKSPACE_CONFIG_PATH: configPath },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

test("creates dev and prod deploy targets and remains idempotent", (t) => {
  const configPath = createTempConfig(t, (config) => {
    config.deploy.targets = {};
  });
  const result = runGenerator(configPath);
  const firstOutput = readFileSync(configPath, "utf8");
  const config = JSON.parse(firstOutput);

  assert.deepEqual(config.deploy.targets, {
    dev: {
      envProfile: "dev",
      ports: { backend: 7000, frontend: 7073 },
    },
    prod: {
      envProfile: "prod",
      ports: { backend: 8000, frontend: 8073 },
    },
  });
  assert.match(result.stdout, /\[config\] deploy\.targets = dev, prod/);

  runGenerator(configPath);
  assert.equal(readFileSync(configPath, "utf8"), firstOutput);
});

test("preserves customized targets while completing missing defaults", (t) => {
  const customTarget = {
    envProfile: "staging",
    branch: "feature/custom",
    ports: { backend: 4100, frontend: 4173 },
  };
  const configPath = createTempConfig(t, (config) => {
    config.deploy.targets = {
      dev: structuredClone(customTarget),
      review: {
        envProfile: "dev",
        ports: { backend: 5100, frontend: 5173 },
      },
    };
  });

  runGenerator(configPath);
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  assert.deepEqual(config.deploy.targets.dev, customTarget);
  assert.deepEqual(config.deploy.targets.review, {
    envProfile: "dev",
    ports: { backend: 5100, frontend: 5173 },
  });
  assert.deepEqual(config.deploy.targets.prod, {
    envProfile: "prod",
    ports: { backend: 8000, frontend: 8073 },
  });
});

test("fills missing fields without overwriting partial target values", (t) => {
  const configPath = createTempConfig(t, (config) => {
    config.deploy.targets = {
      dev: {
        repoScope: "backend",
        ports: { backend: 4100 },
      },
    };
  });

  runGenerator(configPath);
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  assert.deepEqual(config.deploy.targets.dev, {
    repoScope: "backend",
    envProfile: "dev",
    ports: { backend: 4100, frontend: 7073 },
  });
});

test("the deploy command accepts a generated dev target", (t) => {
  const configPath = createTempConfig(t, (config) => {
    config.deploy.targets = {};
  });
  runGenerator(configPath);

  const tempDir = path.dirname(configPath);
  const backendEnvPath = path.join(tempDir, "backend.env.dev");
  const frontendEnvPath = path.join(tempDir, "frontend.env.dev");
  writeFileSync(backendEnvPath, "BACKEND=true\n");
  writeFileSync(frontendEnvPath, "FRONTEND=true\n");

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.repos.backend.envProfiles.dev = backendEnvPath;
  config.repos.frontend.envProfiles.dev = frontendEnvPath;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = runDeployTarget(configPath, "dev");
  assert.match(result.stdout, /\[deploy\] target=dev scope=both env=dev ports=7000\/7073/);
});
