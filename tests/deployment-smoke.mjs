import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { generate } from "otplib";
import { authFixture, cookieFrom, preAuthCookieFrom } from "./auth-fixture.mjs";
import { availablePort, caddyProxy } from "./caddy-proxy.mjs";
import { checkCompose } from "./compose-check.mjs";

// Real native Caddy and the production build, synthetic GET-only Firefly, fresh
// process-local temp storage on recreation. This does not emulate Docker isolation.
await checkCompose();
const root = await mkdtemp(join(tmpdir(), "ember-deployment-smoke-"));
const port = await availablePort();
let proxy, child, log = "", requests = 0, recreation = 0;
const token = "synthetic-deployment-token-no-live-access";
const upstream = createServer((req, res) => {
  requests++;
  assert.equal(req.method, "GET");
  assert.equal(req.headers.authorization, `Bearer ${token}`);
  assert.equal(new URL(req.url, "http://localhost").pathname, "/api/v1/accounts");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ data: [], meta: { pagination: { current_page: 1, total_pages: 1 } } }));
});
upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
let auth;
async function stop() {
  if (child && child.exitCode === null) { child.kill(); await once(child, "exit"); }
}
async function start() {
  const temporary = join(root, `ephemeral-${recreation++}`); await mkdir(temporary);
  log = "";
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, ...auth.env, NODE_ENV: "production", TMP: temporary, TEMP: temporary, TMPDIR: temporary,
      NEXT_TELEMETRY_DISABLED: "1", FIREFLY_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, FIREFLY_API_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  child.stdout.on("data", data => { log += data; }); child.stderr.on("data", data => { log += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("Synthetic production process exited before health became ready");
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {}
    await delay(100);
  }
  throw new Error("Synthetic production process did not become healthy");
}
const request = async (path, options) => (await proxy.request(path, options)).response;
const post = (path, fields = {}, cookie = "", origin = auth.env.EMBER_APP_URL) => request(path, {
  method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});
const passwordLogin = () => post("/api/auth/login", { username: auth.env.EMBER_AUTH_USERNAME, password: auth.password });
const code = offset => generate({ secret: auth.totpSecret, epoch: Math.floor((Date.now() + offset) / 1000) });
function secureCookie(response, name) {
  const value = response.headers.get("set-cookie");
  assert.match(value, new RegExp(name));
  for (const pattern of [/Secure/i, /HttpOnly/i, /Path=\//i]) assert.match(value, pattern);
  assert.doesNotMatch(value, /Domain=/i);
}

try {
  proxy = await caddyProxy(port); auth = authFixture(proxy.origin);
  auth.env.EMBER_AUTH_STATE_DIR = join(root, "persistent-auth");
  await start();
  const health = await proxy.request("/api/health"); assert.equal(health.response.status, 200);
  assert.deepEqual(await health.response.json(), { status: "ok" });
  assert.equal(requests, 0);
  for (const path of ["/accounts", "/api/accounts", "/api/auth/login"]) {
    const redirect = await fetch(proxy.httpOrigin + path, { redirect: "manual", method: path.endsWith("login") ? "POST" : "GET" });
    assert.equal(redirect.status, 308); assert.equal(new URL(redirect.headers.get("location")).protocol, "https:");
  }
  assert.equal(requests, 0, "HTTP must only redirect, never reach financial/authentication routes");
  assert.equal((await request("/api/accounts")).status, 401);
  assert.equal((await post("/api/auth/login", { username: auth.env.EMBER_AUTH_USERNAME, password: auth.password }, "", "https://attacker.invalid")).headers.get("location"), "/login?error=1");
  const initial = await passwordLogin(); assert.equal(initial.headers.get("location"), "/");
  secureCookie(initial, "__Host-ember-session"); const initialCookie = cookieFrom(initial); assert.ok(initialCookie);
  assert.equal((await post("/api/auth/2fa/setup", {}, initialCookie, "https://attacker.invalid")).status, 403);
  const setupResponse = await post("/api/auth/2fa/setup", {}, initialCookie); assert.equal(setupResponse.status, 200);
  const setup = await setupResponse.json(); assert.match(setup.qrCode, /^data:image\/png;base64,/); auth.totpSecret = setup.secret;
  const confirmed = await post("/api/auth/2fa/confirm", { code: await code(-30_000) }, initialCookie);
  assert.equal(confirmed.status, 200);
  assert.equal((await request("/api/auth/session", { headers: { Cookie: initialCookie } })).status, 401);
  const challenge = await passwordLogin(); assert.equal(challenge.headers.get("location"), "/login/2fa");
  secureCookie(challenge, "__Host-ember-preauth"); const preauth = preAuthCookieFrom(challenge);
  assert.equal((await request("/api/accounts", { headers: { Cookie: preauth } })).status, 401);
  const acceptedCode = await code(0);
  const signedIn = await post("/api/auth/totp", { code: acceptedCode }, preauth);
  assert.equal(signedIn.headers.get("location"), "/"); const session = cookieFrom(signedIn); assert.ok(session);
  assert.equal((await request("/api/auth/session", { headers: { Cookie: session } })).status, 204);
  const accounts = await request("/accounts", { headers: { Cookie: session } }); assert.equal(accounts.status, 200);
  const html = await accounts.text(); assert.ok(requests > 0);
  for (const secret of [token, auth.password, auth.env.EMBER_AUTH_SECRET, auth.env.EMBER_AUTH_PASSWORD_HASH, auth.totpSecret]) {
    assert.ok(!html.includes(secret)); assert.ok(!log.includes(secret));
  }
  const stateDirectory = join(auth.env.EMBER_AUTH_STATE_DIR, auth.env.EMBER_AUTH_SECRET.slice(0, 12));
  const statePath = join(stateDirectory, "auth-state.json");
  const encrypted = await readFile(statePath, "utf8"); assert.ok(!encrypted.includes(auth.totpSecret));
  await stop(); await start();
  assert.equal(await readFile(statePath, "utf8"), encrypted, "Recreation must retain encrypted enrollment and replay state");
  assert.equal((await request("/api/auth/session", { headers: { Cookie: session } })).status, 401);
  const freshChallenge = await passwordLogin(); assert.equal(freshChallenge.headers.get("location"), "/login/2fa");
  const freshPreauth = preAuthCookieFrom(freshChallenge);
  assert.equal((await post("/api/auth/totp", { code: acceptedCode }, freshPreauth)).headers.get("location"), "/login/2fa?error=1");
  while (await code(0) === acceptedCode) await delay(500);
  const freshLogin = await post("/api/auth/totp", { code: await code(0) }, freshPreauth);
  assert.equal(freshLogin.headers.get("location"), "/"); const freshSession = cookieFrom(freshLogin);
  await proxy.restart();
  const renewed = await proxy.request("/api/health"); assert.equal(renewed.fingerprint, health.fingerprint, "Caddy restart must retain its certificate state");
  assert.equal((await request("/api/auth/session", { headers: { Cookie: freshSession } })).status, 204);
  const logout = await post("/api/auth/logout", {}, freshSession); assert.equal(logout.headers.get("location"), "/login");
  assert.equal((await request("/api/auth/session", { headers: { Cookie: freshSession } })).status, 401);
  await stop();
  const reset = spawnSync(process.execPath, ["scripts/totp-admin.mjs", "reset"], {
    env: { ...process.env, EMBER_AUTH_STATE_DIR: stateDirectory }, encoding: "utf8", windowsHide: true,
  });
  assert.equal(reset.status, 0, "Packaged host-admin reset must succeed");
  await start();
  const resetLogin = await passwordLogin(); assert.equal(resetLogin.headers.get("location"), "/");
  assert.deepEqual(await (await request("/api/auth/2fa/status", { headers: { Cookie: cookieFrom(resetLogin) } })).json(), { enabled: false, activatedAt: null });
  console.log("Real Caddy deployment smoke passed: HTTPS/HTTP redirects, Secure cookies, origin checks, enrollment/challenge/logout, encrypted state and replay protection across process recreation, certificate persistence, admin reset, GET-only synthetic upstream and secret exclusion.");
} finally {
  await stop(); await proxy?.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
  assert.equal(resolve(root, ".."), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true });
}
