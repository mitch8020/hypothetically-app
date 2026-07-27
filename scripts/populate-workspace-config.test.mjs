import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, "..");
const scriptPath = path.join(scriptsDir, "populate-workspace-config.mjs");
const deployScriptPath = path.join(scriptsDir, "deploy-target.mjs");
const baseConfig = JSON.parse(readFileSync(path.join(rootDir, "config", "workspace-config.json"), "utf8"));

function createTempConfig(
  t,
  update = () => {},
  repoNames = { backend: "backend", frontend: "frontend" },
) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "workspace-config-"));
  const configPath = path.join(tempDir, "workspace-config.json");
  const backendPath = path.join(tempDir, repoNames.backend);
  const frontendPath = path.join(tempDir, repoNames.frontend);
  const config = structuredClone(baseConfig);
  mkdirSync(backendPath);
  mkdirSync(frontendPath);
  writeFileSync(
    path.join(backendPath, "package.json"),
    `${JSON.stringify({
      name: "app-backend",
      private: true,
      scripts: {
        "start:dev": "node server.mjs",
        build: "node --check server.mjs",
        "start:prod": "node server.mjs",
      },
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(frontendPath, "package.json"),
    `${JSON.stringify({
      name: "app-frontend",
      private: true,
      scripts: {
        dev: "node server.mjs",
        build: "node --check server.mjs",
        preview: "node server.mjs",
      },
    }, null, 2)}\n`,
  );
  update(config);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));
  return { tempDir, configPath, backendPath, frontendPath };
}

function runGenerator(
  fixture,
  {
    dryRun = false,
    nonInteractive = true,
    extraArgs = [],
    input,
  } = {},
) {
  const args = [
    scriptPath,
    "--config",
    fixture.configPath,
    "--backend",
    fixture.backendPath,
    "--frontend",
    fixture.frontendPath,
  ];
  if (nonInteractive) args.push("--non-interactive");
  if (dryRun) args.push("--dry-run");
  args.push(...extraArgs);

  const result = spawnSync(process.execPath, args, {
    cwd: rootDir,
    encoding: "utf8",
    input,
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

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForJson(url, output, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      return await response.json();
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || "unknown error"}\n${output()}`);
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

test("prompts for project name and stores the selected dev ports", (t) => {
  const fixture = createTempConfig(t);
  const result = runGenerator(fixture, {
    nonInteractive: false,
    input: "Prompted Project\n",
    extraArgs: [
      "--backend-port",
      "4310",
      "--frontend-port",
      "4373",
    ],
  });
  const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));

  assert.match(result.stdout, /Project name \[/);
  assert.equal(config.project.name, "Prompted Project");
  assert.equal(config.project.slug, "prompted-project");
  assert.deepEqual(config.deploy.targets.dev.ports, {
    backend: 4310,
    frontend: 4373,
  });
});

test("prompts for missing frontend and backend ports", (t) => {
  const frontendFixture = createTempConfig(t);
  const frontendResult = runGenerator(frontendFixture, {
    nonInteractive: false,
    input: "4673\n",
    extraArgs: [
      "--project-name",
      "Port Prompt Project",
      "--backend-port",
      "4610",
    ],
  });
  const frontendConfig = JSON.parse(readFileSync(frontendFixture.configPath, "utf8"));

  assert.match(frontendResult.stdout, /Frontend dev port \[/);
  assert.equal(frontendConfig.deploy.targets.dev.ports.frontend, 4673);

  const backendFixture = createTempConfig(t);
  const backendResult = runGenerator(backendFixture, {
    nonInteractive: false,
    input: "4710\n",
    extraArgs: [
      "--project-name",
      "Port Prompt Project",
      "--frontend-port",
      "4773",
    ],
  });
  const backendConfig = JSON.parse(readFileSync(backendFixture.configPath, "utf8"));

  assert.match(backendResult.stdout, /Backend dev port \[/);
  assert.equal(backendConfig.deploy.targets.dev.ports.backend, 4710);
});

test("renames placeholder repo folders and npm packages from the project name", (t) => {
  const fixture = createTempConfig(
    t,
    () => {},
    { backend: "[app]-backend", frontend: "[app]-frontend" },
  );
  const result = runGenerator(fixture, {
    extraArgs: [
      "--project-name",
      "Hypothetical Project",
      "--backend-port",
      "4410",
      "--frontend-port",
      "4473",
    ],
  });
  const backendPath = path.join(fixture.tempDir, "hypothetical-project-backend");
  const frontendPath = path.join(fixture.tempDir, "hypothetical-project-frontend");
  const config = JSON.parse(readFileSync(fixture.configPath, "utf8"));
  const backendPackage = JSON.parse(readFileSync(path.join(backendPath, "package.json"), "utf8"));
  const frontendPackage = JSON.parse(readFileSync(path.join(frontendPath, "package.json"), "utf8"));

  assert.match(result.stdout, /\[config\] Renamed .*hypothetical-project-backend/);
  assert.match(result.stdout, /\[config\] Renamed .*hypothetical-project-frontend/);
  assert.equal(existsSync(fixture.backendPath), false);
  assert.equal(existsSync(fixture.frontendPath), false);
  assert.equal(backendPackage.name, "hypothetical-project-backend");
  assert.equal(frontendPackage.name, "hypothetical-project-frontend");
  assert.equal(config.repos.backend.path.replace(/\\/g, "/"), backendPath.replace(/\\/g, "/"));
  assert.equal(config.repos.frontend.path.replace(/\\/g, "/"), frontendPath.replace(/\\/g, "/"));
  assert.deepEqual(config.commands.frontend.dev, [[
    "npm",
    "run",
    "dev",
    "--",
    "--strictPort",
    "--port",
    "${ports.frontend}",
  ]]);
});

test("dry-run plans Vite and Nest scaffolding for empty placeholder repos", (t) => {
  const fixture = createTempConfig(
    t,
    () => {},
    { backend: "[app]-backend", frontend: "[app]-frontend" },
  );
  rmSync(path.join(fixture.backendPath, "package.json"));
  rmSync(path.join(fixture.frontendPath, "package.json"));
  const originalConfig = readFileSync(fixture.configPath, "utf8");

  const result = runGenerator(fixture, {
    dryRun: true,
    extraArgs: [
      "--project-name",
      "Scaffold Project",
      "--backend-port",
      "4510",
      "--frontend-port",
      "4573",
    ],
  });

  assert.match(
    result.stdout,
    /npm create vite@latest scaffold-project-frontend -- --template react-ts --no-interactive/,
  );
  assert.match(
    result.stdout,
    /npx --yes @nestjs\/cli@latest new scaffold-project-backend --package-manager npm --strict/,
  );
  assert.equal(readFileSync(fixture.configPath, "utf8"), originalConfig);
  assert.equal(existsSync(path.join(fixture.tempDir, "scaffold-project-frontend")), false);
  assert.equal(existsSync(path.join(fixture.tempDir, "scaffold-project-backend")), false);
});

test("deploy rejects an empty placeholder directory instead of using the root package", (t) => {
  const fixture = createTempConfig(t);
  runGenerator(fixture);
  rmSync(path.join(fixture.backendPath, "package.json"));

  const result = spawnSync(process.execPath, [deployScriptPath, "--target", "dev", "--dry-run"], {
    cwd: rootDir,
    encoding: "utf8",
    env: { ...process.env, WORKSPACE_CONFIG_PATH: fixture.configPath },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Configured backend path is not an npm repo because package\.json is missing/);
  assert.doesNotMatch(result.stderr, /Missing script/);
});

test("deploy starts backend and frontend together on their selected ports", { timeout: 15_000 }, async (t) => {
  const fixture = createTempConfig(t);
  const backendPort = await availablePort();
  const frontendPort = await availablePort();
  const serverSource = (role) => `import { createServer } from "node:http";

const role = "${role}";
const port = Number(process.env.PORT);
const server = createServer((_request, response) => {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ role, port }));
});
server.listen(port, "127.0.0.1", () => console.log(\`[fixture] \${role} listening on \${port}\`));
setTimeout(() => server.close(), 4000);
`;
  writeFileSync(path.join(fixture.backendPath, "server.mjs"), serverSource("backend"));
  writeFileSync(path.join(fixture.frontendPath, "server.mjs"), serverSource("frontend"));

  runGenerator(fixture, {
    extraArgs: [
      "--project-name",
      "Live Deploy Fixture",
      "--backend-port",
      String(backendPort),
      "--frontend-port",
      String(frontendPort),
    ],
  });

  const child = spawn(process.execPath, [deployScriptPath, "--target", "dev"], {
    cwd: rootDir,
    env: { ...process.env, WORKSPACE_CONFIG_PATH: fixture.configPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const close = new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  t.after(() => {
    if (!child.killed) child.kill("SIGINT");
  });

  const [backend, frontend] = await Promise.all([
    waitForJson(`http://127.0.0.1:${backendPort}`, () => output),
    waitForJson(`http://127.0.0.1:${frontendPort}`, () => output),
  ]);
  assert.deepEqual(backend, { role: "backend", port: backendPort });
  assert.deepEqual(frontend, { role: "frontend", port: frontendPort });

  const exit = await close;
  assert.equal(exit.code, 0, output);
  assert.match(output, new RegExp(`backend listening on ${backendPort}`));
  assert.match(output, new RegExp(`frontend listening on ${frontendPort}`));
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
