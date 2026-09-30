import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { GET } from "../src/app/api/health/route.ts";
import { validateConfig } from "../src/lib/config-validation.ts";

test("health is constant, uncached and independent of configuration and Firefly", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok" });
  const source = readFileSync("src/app/api/health/route.ts", "utf8");
  assert.doesNotMatch(source, /\bimport\b|\bfetch\(|process\.env/);
});

test("container startup rejects missing/invalid configuration without leaking its contents", () => {
  for (const url of ["", "https://private-user:private-password@private.invalid"]) {
    const child = spawnSync(process.execPath, ["scripts/start.mjs"], {
      env: { ...process.env, FIREFLY_BASE_URL: url, FIREFLY_API_TOKEN: "private-test-token" },
      encoding: "utf8", windowsHide: true,
    });
    assert.equal(child.status, 1);
    assert.equal(child.stdout, "");
    assert.equal(child.stderr.trim(), "Ember startup failed: configure valid server-side FIREFLY_BASE_URL and FIREFLY_API_TOKEN.");
  }
  assert.equal(validateConfig({ FIREFLY_BASE_URL: "http://firefly:8080/prefix", FIREFLY_API_TOKEN: "synthetic" }).baseUrl, "http://firefly:8080/prefix/");
  const authMissing = spawnSync(process.execPath, ["scripts/start.mjs"], {
    env: { ...process.env, FIREFLY_BASE_URL: "https://synthetic.invalid", FIREFLY_API_TOKEN: "private-test-token", EMBER_AUTH_SECRET: "" },
    encoding: "utf8", windowsHide: true,
  });
  assert.equal(authMissing.status, 1);
  assert.equal(authMissing.stderr.trim(), "Ember startup failed: configure valid server-side authentication settings.");
});

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test("client import graphs cannot reach configuration or server-only financial clients", () => {
  const sources = files("src").filter(path => /\.[cm]?[jt]sx?$/.test(path));
  for (const path of sources) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /NEXT_PUBLIC_[A-Z0-9_]*(?:FIREFLY|TOKEN|SECRET|PASSWORD|BASE_URL|EMBER_AUTH)/);
  }
  const visited = new Set<string>();
  function visit(path: string) {
    if (visited.has(path)) return;
    visited.add(path);
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /server-only|FIREFLY_API_TOKEN|FIREFLY_BASE_URL|config-validation|EMBER_(?:AUTH_(?:SECRET|PASSWORD_HASH)|TOTP_SECRET)|iron-session|bcryptjs|otplib/);
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
      const base = specifier.startsWith("@/") ? resolve("src", specifier.slice(2)) : resolve(dirname(path), specifier);
      const dependency = [base, base + ".ts", base + ".tsx", resolve(base, "index.ts"), resolve(base, "index.tsx")].find(file => existsSync(file) && /\.[jt]sx?$/.test(file));
      assert.ok(dependency, `Unresolved client dependency: ${specifier}`);
      visit(dependency);
    }
  }
  const clients = sources.filter(path => /^\s*["']use client["']/.test(readFileSync(path, "utf8")));
  assert.ok(clients.length > 0);
  clients.forEach(visit);
});

test("build and deployment keep runtime secrets outside the image", () => {
  const docker = readFileSync("Dockerfile", "utf8");
  assert.doesNotMatch(docker, /(?:ARG|ENV)\s+.*(?:FIREFLY_|EMBER_(?:AUTH_|TOTP_))|COPY\s+.*\.env/);
  assert.match(docker, /USER ember/);
  assert.match(docker, /--gid 1001 ember/);
  assert.match(docker, /--uid 1001 --ingroup ember ember/);
  assert.match(docker, /test -f scripts\/totp-admin\.mjs/);
  assert.match(docker, /HEALTHCHECK/);
  const ignore = readFileSync(".dockerignore", "utf8");
  assert.match(ignore, /^\*\*$/m);
  assert.match(ignore, /^\*\*\/\.env\*$/m);
  assert.match(ignore, /^!scripts\/totp-admin\.mjs$/m);
  assert.doesNotMatch(ignore, /^!(?:\.env|\.next|node_modules|\.git)/m);
  assert.match(readFileSync(".gitignore", "utf8"), /^\.env\*$/m);
  const compose = readFileSync("compose.yaml", "utf8");
  for (const setting of ["127.0.0.1", "read_only: true", "init: true", "no-new-privileges:true", "unless-stopped"]) assert.ok(compose.includes(setting));
  assert.ok(compose.includes('${EMBER_BIND_ADDRESS:-127.0.0.1}:${EMBER_PORT:-3000}:3000'));
  assert.doesNotMatch(compose, /network_mode:|internal:\s*true|ipv4_address:/);
  assert.doesNotMatch(readFileSync("next.config.ts", "utf8"), /\benv\s*:/);
});

test("auth CLI works outside the checkout with only its explicitly packaged runtime dependency", () => {
  const root = mkdtempSync(join(tmpdir(), "ember-auth-package-check-"));
  try {
    const scripts = join(root, "scripts");
    mkdirSync(scripts);
    cpSync("scripts/auth-config.mjs", join(scripts, "auth-config.mjs"));
    const run = (mode: string) => spawnSync(process.execPath, ["scripts/auth-config.mjs", mode], {
      cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, NODE_PATH: "" },
    });
    // Demonstrate the original failure before adding the dedicated runtime package.
    assert.notEqual(run("secret").status, 0);
    const dependency = dirname(fileURLToPath(import.meta.resolve("bcryptjs")));
    const metadata = JSON.parse(readFileSync(join(dependency, "package.json"), "utf8"));
    assert.deepEqual(metadata.dependencies ?? {}, {}, "Review packaging if bcrypt adds runtime dependencies");
    cpSync(dependency, join(scripts, "node_modules/bcryptjs"), { recursive: true, dereference: true });
    const first = run("secret");
    const second = run("secret");
    for (const generated of [first, second]) {
      assert.equal(generated.status, 0, "Isolated CLI must load successfully");
      assert.equal(generated.stderr, "");
      assert.ok(/^EMBER_AUTH_SECRET=[A-Za-z0-9_-]{43}\r?\n$/.test(generated.stdout), "Invalid generated secret format");
    }
    assert.ok(first.stdout !== second.stdout, "Each secret must be fresh");
    const password = run("password");
    assert.equal(password.status, 1);
    assert.ok(password.stderr.includes("interactive terminal"), "CLI loads but refuses piped passwords");
    assert.equal(password.stdout, "");
    const removedTotpCommand = run("totp");
    assert.equal(removedTotpCommand.status, 1);
    assert.match(removedTotpCommand.stderr, /password\|secret/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
