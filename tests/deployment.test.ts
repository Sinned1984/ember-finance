import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { validateDeploymentConfig } from "../src/lib/deployment-config.ts";
import { validateAuthConfig } from "../src/lib/auth/config.ts";
import { sessionOptions } from "../src/lib/auth/session.ts";
import { preAuthOptions } from "../src/lib/auth/preauth.ts";

const env = { NODE_ENV: "production" as const, EMBER_APP_URL: "https://finance.example.com", EMBER_AUTH_USERNAME: "synthetic-admin",
  EMBER_AUTH_PASSWORD_HASH: "$2b$12$" + "A".repeat(53), EMBER_AUTH_SECRET: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq" };

test("existing reverse-proxy origins and Secure host cookies remain unchanged", () => {
  for (const origin of [env.EMBER_APP_URL, "https://finance.example.com:8443", "https://192.0.2.1"]) {
    const config = validateAuthConfig({ ...env, EMBER_APP_URL: origin });
    assert.equal(validateDeploymentConfig({ ...env, EMBER_APP_URL: origin }, config.origin), "reverse-proxy");
    assert.equal(sessionOptions(config).cookieName, "__Host-ember-session");
    assert.equal(preAuthOptions(config).cookieName, "__Host-ember-preauth");
    for (const options of [sessionOptions(config), preAuthOptions(config)]) {
      assert.equal(options.cookieOptions?.secure, true); assert.equal(options.cookieOptions?.httpOnly, true);
      assert.equal(options.cookieOptions?.path, "/"); assert.equal(options.cookieOptions?.domain, undefined);
    }
  }
  assert.throws(() => validateAuthConfig({ ...env, EMBER_APP_URL: "http://192.0.2.1" }));
});

test("managed HTTPS accepts canonical DNS origins and fails closed on unsupported deployment combinations", () => {
  const standalone = { ...env, EMBER_DEPLOYMENT_MODE: "standalone-https" };
  assert.equal(validateDeploymentConfig(standalone, env.EMBER_APP_URL), "standalone-https");
  for (const origin of ["http://finance.example.com", "https://localhost", "https://192.0.2.1", "https://[::1]",
    "https://finance.local", "https://finance.internal", "https://finance.home.arpa", "https://finance.ts.net",
    "https://finance.test", "https://finance.invalid", "https://finance.example.com:8443",
    "https://finance.example.com/path", "https://finance.example.com?x=1", "https://finance.example.com#x", "https://user:password@finance.example.com"]) {
    assert.throws(() => validateDeploymentConfig({ ...standalone, EMBER_APP_URL: origin }, origin), { message: "Invalid Ember HTTPS deployment configuration." });
  }
  for (const raw of [env.EMBER_APP_URL + "/", "https://FINANCE.example.com", env.EMBER_APP_URL + ":443", env.EMBER_APP_URL + "\n"]) {
    assert.throws(() => validateDeploymentConfig({ ...standalone, EMBER_APP_URL: raw }, env.EMBER_APP_URL));
  }
  for (const mode of ["lan-http", "http", "unknown", ""]) assert.throws(() => validateDeploymentConfig({ ...env, EMBER_DEPLOYMENT_MODE: mode }, env.EMBER_APP_URL));
});

test("invalid managed-HTTPS startup exits before creating auth state and never prints secrets", () => {
  const directory = mkdtempSync(join(tmpdir(), "ember-deployment-startup-"));
  try {
    const child = spawnSync(process.execPath, ["scripts/start.mjs"], { encoding: "utf8", windowsHide: true,
      env: { ...process.env, ...env, FIREFLY_BASE_URL: "https://synthetic.invalid", FIREFLY_API_TOKEN: "private-synthetic-token",
        EMBER_AUTH_STATE_DIR: directory, EMBER_DEPLOYMENT_MODE: "standalone-https", EMBER_APP_URL: "https://localhost" },
    });
    assert.equal(child.status, 1); assert.equal(child.stdout, "");
    assert.equal(child.stderr.trim(), "Ember startup failed: use a canonical public HTTPS hostname on port 443 for standalone-https, or reverse-proxy mode.");
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("active source and deployment identifiers use Ember while persistent ownership and volume identity stay fixed", () => {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name); return entry.isDirectory() ? walk(path) : [path];
  });
  for (const file of [...walk("src"), ...walk("scripts"), "Dockerfile", "compose.yaml", "compose.https.yaml", "compose.auth-state.yaml", ".env.example", "deploy/Caddyfile"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\bbloom\b/i, file);
  }
  const compose = readFileSync("compose.yaml", "utf8");
  assert.match(compose, /^  ember:/m); assert.doesNotMatch(compose, /^name:|container_name:/m);
  assert.match(compose, /ember-auth-state:\/var\/lib\/ember-auth/);
  assert.equal(JSON.parse(readFileSync("package.json", "utf8")).name, "ember-finance");
  const caddy = readFileSync("deploy/Caddyfile", "utf8");
  assert.match(caddy, /admin 127\.0\.0\.1:2019/); assert.match(caddy, /reverse_proxy ember:3000/);
  assert.doesNotMatch(caddy, /tls internal|skip_install_trust|trusted_proxies|header_down|header_up/);
  const external = readFileSync("compose.auth-state.yaml", "utf8");
  assert.match(external, /external: true/); assert.match(external, /EMBER_AUTH_STATE_VOLUME:\?/);
});
