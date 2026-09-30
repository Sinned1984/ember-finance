import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Uses the real Compose parser, but no Docker daemon, live env file or financial data.
export async function checkCompose() {
  const binary = process.env.EMBER_COMPOSE_BINARY;
  if (!binary) throw new Error("Set EMBER_COMPOSE_BINARY to the Docker Compose executable to run configuration checks.");
  const root = await mkdtemp(join(tmpdir(), "ember-compose-check-"));
  const environment = "FIREFLY_BASE_URL=https://synthetic.invalid\nFIREFLY_API_TOKEN=synthetic-compose-token\nEMBER_APP_URL=https://finance.example.com\nEMBER_AUTH_USERNAME=synthetic-user\nEMBER_AUTH_PASSWORD_HASH='$2b$12$" + "A".repeat(53) + "'\nEMBER_AUTH_SECRET=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq\n";
  try {
    const envFile = join(root, "fixture.env");
    await writeFile(envFile, environment);
    const config = (files, extra = "", project = "ember-compose-test") => {
      const run = spawnSync(binary, ["--project-directory", resolve("."), "--project-name", project, "--env-file", envFile,
        ...files.flatMap(file => ["-f", resolve(file)]), "config", "--format", "json"], {
        env: { ...process.env, FIREFLY_BASE_URL: "https://synthetic.invalid", FIREFLY_API_TOKEN: "synthetic-compose-token",
          EMBER_APP_URL: "https://finance.example.com", EMBER_AUTH_USERNAME: "synthetic-user",
          EMBER_AUTH_PASSWORD_HASH: "$2b$12$" + "A".repeat(53), EMBER_AUTH_SECRET: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
          EMBER_BIND_ADDRESS: "127.0.0.1", EMBER_PORT: "3000", EMBER_HTTPS_BIND_ADDRESS: "0.0.0.0",
          EMBER_AUTH_STATE_VOLUME: extra || undefined }, encoding: "utf8", windowsHide: true,
      });
      return run;
    };
    const baseResult = config(["compose.yaml"]); assert.equal(baseResult.status, 0, baseResult.stderr);
    const base = JSON.parse(baseResult.stdout);
    assert.deepEqual(Object.keys(base.services), ["ember"]);
    assert.equal(base.services.ember.ports[0].host_ip, "127.0.0.1"); assert.equal(base.services.ember.ports[0].published, "3000");
    assert.equal(base.volumes["ember-auth-state"].name, "ember-compose-test_ember-auth-state");
    for (const files of [["compose.yaml", "compose.https.yaml"], ["compose.yaml", "compose.https.yaml", "compose.auth-state.yaml"]]) {
      const run = config(files, "verified-existing_auth-state"); assert.equal(run.status, 0, run.stderr);
      const data = JSON.parse(run.stdout), ember = data.services.ember, https = data.services["ember-https"];
      assert.ok(!ember.ports?.length, "Managed HTTPS must remove the private host HTTP mapping");
      assert.equal(ember.environment.EMBER_DEPLOYMENT_MODE, "standalone-https");
      assert.deepEqual(https.ports.map(port => port.published), ["80", "443"]);
      assert.deepEqual(Object.keys(https.environment), ["EMBER_APP_URL"]);
      assert.equal(https.depends_on.ember.condition, "service_healthy");
      assert.ok(https.volumes.find(volume => volume.target === "/etc/caddy/Caddyfile" && volume.read_only));
      assert.ok(!https.volumes.some(volume => volume.source === "ember-auth-state"));
      assert.equal(ember.volumes.find(volume => volume.target === "/var/lib/ember-auth").source, "ember-auth-state");
      assert.equal(data.volumes["ember-auth-state"].name, files.length === 3 ? "verified-existing_auth-state" : "ember-compose-test_ember-auth-state");
      if (files.length === 3) assert.equal(data.volumes["ember-auth-state"].external, true);
    }
    const pinned = config(["compose.yaml", "compose.auth-state.yaml"], "verified-existing_auth-state", "renamed-project");
    assert.equal(pinned.status, 0, pinned.stderr);
    assert.equal(JSON.parse(pinned.stdout).volumes["ember-auth-state"].name, "verified-existing_auth-state");
    assert.notEqual(config(["compose.yaml", "compose.auth-state.yaml"]).status, 0, "Missing migration volume must fail closed");
    const caddy = process.env.EMBER_CADDY_BINARY;
    if (!caddy) throw new Error("Set EMBER_CADDY_BINARY to run the real Caddy configuration check.");
    const adapted = spawnSync(caddy, ["adapt", "--adapter", "caddyfile", "--config", resolve("deploy/Caddyfile")], {
      env: { ...process.env, EMBER_APP_URL: "https://finance.example.com" }, encoding: "utf8", windowsHide: true,
    });
    assert.equal(adapted.status, 0, adapted.stderr);
    const json = JSON.parse(adapted.stdout);
    assert.equal(json.admin.listen, "127.0.0.1:2019");
    const route = Object.values(json.apps.http.servers)[0].routes[0];
    assert.deepEqual(route.match[0].host, ["finance.example.com"]);
    assert.equal(route.handle[0].routes[0].handle[0].upstreams[0].dial, "ember:3000");
    assert.ok(!(await readFile("compose.https.yaml", "utf8")).includes("FIREFLY_API_TOKEN"));
    console.log("Real Compose/Caddy configuration checks passed: existing mode, no raw HTTP publication in managed mode, loopback admin, unchanged/default and explicitly pinned auth volumes.");
  } finally { await rm(root, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkCompose();
