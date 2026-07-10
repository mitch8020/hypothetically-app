import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  const backendPath = path.join(tempDir, "backend");
  const frontendPath = path.join(tempDir, "frontend");
  const config = structuredClone(baseConfig);
  mkdirSync(backendPath);
  mkdirSync(frontendPath);
  update(config);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  return { configPath, backendPath, frontendPath };
}

function runGenerator(fixture, { dryRun = false } = {}) {
  const args = [
    scriptPath,
    "--config",
    fixture.configPath,
    "--backend",
    fixture.backendPath,
    "--frontend",
    fixture.frontendPath,
  ];
  if (dryRun) args.push("--dry-run");

  const result = spawnSync(process.execPath, args, {
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
  const fixture = createTempConfig(t, (config) => {
    config.deploy.targets = {};
  });
  const result = runGenerator(fixture);
  const firstOutput = readFileSync(fixture.configPath, "utf8");
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

  runGenerator(fixture);
  assert.equal(readFileSync(fixture.configPath, "utf8"), firstOutput);
});

test("preserves customized targets while completing missing defaults", (t) => {
  const customTarget = {
    envProfile: "staging",
    branch: "feature/custom",
    ports: { backend: 4100, frontend: 4173 },
  };
  const fixture = createTempConfig(t, (config) => {
    config.deploy.targets = {
      dev: structuredClone(customTarget),
      review: {
        envProfile: "dev",
        ports: { backend: 5100, frontend: 5173 },
      },
    };
  });

  runGenerator(fixture);
  const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));

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
  const fixture = createTempConfig(t, (config) => {
    config.deploy.targets = {
      dev: {
        repoScope: "backend",
        ports: { backend: 4100 },
      },
    };
  });

  runGenerator(fixture);
  const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));

  assert.deepEqual(config.deploy.targets.dev, {
    repoScope: "backend",
    envProfile: "dev",
    ports: { backend: 4100, frontend: 7073 },
  });
});

test("the deploy command accepts a generated dev target", (t) => {
  const fixture = createTempConfig(t, (config) => {
    config.deploy.targets = {};
  });
  runGenerator(fixture);

  const result = runDeployTarget(fixture.configPath, "dev");
  assert.match(result.stdout, /\[deploy\] target=dev scope=both env=dev ports=7000\/7073/);
});

test("creates missing env profiles as blank files", (t) => {
  const fixture = createTempConfig(t);
  const result = runGenerator(fixture);
  const envFiles = [
    path.join(fixture.backendPath, ".env.dev"),
    path.join(fixture.backendPath, ".env.prod"),
    path.join(fixture.frontendPath, ".env.dev"),
    path.join(fixture.frontendPath, ".env.prod"),
  ];

  for (const envFile of envFiles) {
    assert.equal(statSync(envFile).size, 0);
  }
  assert.equal((result.stdout.match(/\[config\] Created /g) || []).length, 4);
});

test("preserves existing env profile contents", (t) => {
  const fixture = createTempConfig(t);
  const existingEnvPath = path.join(fixture.backendPath, ".env.dev");
  writeFileSync(existingEnvPath, "SECRET=keep-me\n");

  const result = runGenerator(fixture);

  assert.equal(readFileSync(existingEnvPath, "utf8"), "SECRET=keep-me\n");
  assert.match(result.stdout, /\[config\] Kept .*backend[\\/]\.env\.dev/);
});

test("dry-run reports env files without creating them", (t) => {
  const fixture = createTempConfig(t);
  const originalConfig = readFileSync(fixture.configPath, "utf8");

  const result = runGenerator(fixture, { dryRun: true });

  assert.equal(readFileSync(fixture.configPath, "utf8"), originalConfig);
  assert.equal(existsSync(path.join(fixture.backendPath, ".env.dev")), false);
  assert.equal(existsSync(path.join(fixture.backendPath, ".env.prod")), false);
  assert.equal(existsSync(path.join(fixture.frontendPath, ".env.dev")), false);
  assert.equal(existsSync(path.join(fixture.frontendPath, ".env.prod")), false);
  assert.equal((result.stdout.match(/\[config\] Would create /g) || []).length, 4);
});
