import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashSync } from "bcryptjs";
import { getIronSession, sealData } from "iron-session";
import { generate } from "otplib";
import { validateAuthConfig } from "../src/lib/auth/config.ts";
import { activeSession, createSession, revokeSession, sessionOptions, SESSION_SECONDS, type SessionData } from "../src/lib/auth/session.ts";
import { LoginThrottle, loginFields, sameOriginPost, totpField } from "../src/lib/auth/login-policy.ts";
import { activePreAuth, createPreAuth, preAuthOptions, registerPreAuthFailure, revokePreAuth, PREAUTH_MAX_ATTEMPTS, type PreAuthData } from "../src/lib/auth/preauth.ts";
import { activateTotp, beginTotpSetup, verifyTotpOnce } from "../src/lib/auth/totp.ts";
import { authStateFile, currentAuthGeneration, initializeAuthState } from "../src/lib/auth/auth-state.ts";

process.env.EMBER_AUTH_STATE_DIR = mkdtempSync(join(tmpdir(), "ember-auth-tests-"));
const env = { NODE_ENV: "production", EMBER_APP_URL: "https://ember.example.test", EMBER_AUTH_USERNAME: "fixture-admin", EMBER_AUTH_PASSWORD_HASH: hashSync("synthetic-password-only", 12), EMBER_AUTH_SECRET: randomBytes(32).toString("base64url") };
test("auth configuration fails closed and requires a strong hash, secret and production HTTPS origin", () => {
  assert.equal(validateAuthConfig(env).origin, env.EMBER_APP_URL);
  for (const bad of [{ EMBER_AUTH_SECRET: "x".repeat(43) }, { EMBER_AUTH_PASSWORD_HASH: "plaintext-password" }, { EMBER_AUTH_USERNAME: "" }, { EMBER_APP_URL: "http://localhost:3000" }, { EMBER_APP_URL: "https://user:secret@example.test" }, { EMBER_APP_URL: "https://example.test/prefix" }]) {
    assert.throws(() => validateAuthConfig({ ...env, ...bad }), { message: "Invalid Ember authentication configuration." });
  }
  assert.equal(validateAuthConfig({ ...env, NODE_ENV: "development", EMBER_APP_URL: "http://127.0.0.1:3000" }).production, false);
});

test("iron-session cookies are HttpOnly, host-only, Secure in production, Lax and bounded", async () => {
  const config = validateAuthConfig(env);
  const response = new Response();
  const session = await getIronSession<SessionData>(new Request(config.origin), response, sessionOptions(config));
  Object.assign(session, await createSession(config));
  try {
    await session.save();
    const cookie = response.headers.get("set-cookie")!;
    for (const pattern of [/^__Host-ember-session=/, /HttpOnly/i, /Secure/i, /SameSite=Lax/i, /Path=\//i, /Max-Age=28800/i]) assert.match(cookie, pattern);
    assert.doesNotMatch(cookie, /Domain=/i);
    for (const value of [env.EMBER_AUTH_PASSWORD_HASH, env.EMBER_AUTH_SECRET, env.EMBER_AUTH_USERNAME, session.id!]) assert.ok(!cookie.includes(value));
  } finally { await revokeSession(session, config); }
});

test("sessions expire strictly, credential changes invalidate them and logout defeats copied-cookie replay", async () => {
  const config = validateAuthConfig(env);
  const record = await createSession(config);
  const cookie = await sealData(record, { password: config.secret, ttl: SESSION_SECONDS });
  const request = new Request(config.origin, { headers: { Cookie: `__Host-ember-session=${cookie}` } });
  const session = await getIronSession<SessionData>(request, new Response(), sessionOptions(config));
  assert.equal(await activeSession(session, config), true);
  assert.equal(await activeSession(session, config, record.expires), false);
  assert.equal(await activeSession(session, { ...config, username: "changed" }), false);
  await revokeSession(record, config);
  assert.equal(await activeSession(session, config), false);
  assert.equal(await activeSession({ id: "../../escape", expires: Date.now() + 5000 }, config), false);
  const tampered = await getIronSession<SessionData>(new Request(config.origin, { headers: { Cookie: "__Host-ember-session=invalid" } }), new Response(), sessionOptions(config));
  assert.equal(await activeSession(tampered, config), false);
});

test("pre-authentication is short-lived, isolated from full sessions and bounded to five failures", async () => {
  const config = validateAuthConfig(env);
  const response = new Response();
  const session = await getIronSession<PreAuthData>(new Request(config.origin), response, preAuthOptions(config));
  Object.assign(session, await createPreAuth(config));
  try {
    await session.save();
    const cookie = response.headers.get("set-cookie")!;
    for (const pattern of [/^__Host-ember-preauth=/, /HttpOnly/i, /Secure/i, /SameSite=Strict/i, /Path=\//i, /Max-Age=300/i]) assert.match(cookie, pattern);
    assert.doesNotMatch(cookie, /Domain=/i);
    for (const value of [env.EMBER_AUTH_SECRET, session.id!]) assert.ok(!cookie.includes(value));
    assert.equal(await activePreAuth(session, config), true);
    for (let attempt = 1; attempt < PREAUTH_MAX_ATTEMPTS; attempt++) assert.equal(await registerPreAuthFailure(session, config), true);
    assert.equal(await registerPreAuthFailure(session, config), false);
    assert.equal(await activePreAuth(session, config), false);
  } finally { await revokePreAuth(session, config); }
});

test("TOTP enrollment is encrypted, rotates every session and rejects replayed time steps", async () => {
  const config = validateAuthConfig({ ...env, EMBER_AUTH_SECRET: randomBytes(32).toString("base64url") });
  const now = 1_800_000_000_000;
  const session = await createSession(config);
  assert.equal(await activeSession(session, config), true);
  const setup = await beginTotpSetup(config, now);
  assert.equal(setup.status, "ready");
  if (setup.status !== "ready") return;
  assert.match(setup.uri, /^otpauth:\/\/totp\//);
  const current = await generate({ secret: setup.secret, epoch: Math.floor(now / 1000) });
  assert.equal((await activateTotp(config, "000000", now)).status, "invalid");
  assert.equal((await activateTotp(config, current, now)).status, "activated");
  assert.equal(await activeSession(session, config), false, "Activation must invalidate password-only sessions");
  const encrypted = readFileSync(authStateFile(config), "utf8");
  assert.ok(!encrypted.includes(setup.secret), "Persistent state must not contain the plaintext TOTP seed");
  const future = await generate({ secret: setup.secret, epoch: Math.floor((now + 30_000) / 1000) });
  assert.equal(await verifyTotpOnce(config, future, now + 30_000), true);
  assert.equal(await verifyTotpOnce(config, future, now + 30_000), false);
  const old = await generate({ secret: setup.secret, epoch: Math.floor(now / 1000) });
  assert.equal(await verifyTotpOnce(config, old, now + 30_000), false);
});

test("pending enrollment expires and corrupted persistent state fails closed", async () => {
  const expiredConfig = validateAuthConfig({ ...env, EMBER_AUTH_SECRET: randomBytes(32).toString("base64url") });
  const setup = await beginTotpSetup(expiredConfig, 1_800_000_000_000);
  assert.equal(setup.status, "ready");
  if (setup.status === "ready") {
    const code = await generate({ secret: setup.secret, epoch: 1_800_000_000 });
    assert.equal((await activateTotp(expiredConfig, code, setup.expires + 1)).status, "expired");
  }
  const corruptConfig = validateAuthConfig({ ...env, EMBER_AUTH_SECRET: randomBytes(32).toString("base64url") });
  await initializeAuthState(corruptConfig);
  writeFileSync(authStateFile(corruptConfig), "not encrypted state", "utf8");
  await assert.rejects(currentAuthGeneration(corruptConfig), { message: "Authentication state is unavailable." });
});

test("single-instance login throttle bounds attempts and concurrent password checks without IP headers", () => {
  const throttle = new LoginThrottle();
  for (let i = 0; i < 10; i++) {
    assert.equal(throttle.reserve(1000), true);
    assert.equal(throttle.reserve(1000), false);
    throttle.release();
  }
  assert.equal(throttle.reserve(1001), false);
  assert.equal(throttle.reserve(901001), true);
});

test("auth POSTs require the configured origin, reject CSRF, bound bodies and prevent bcrypt truncation", async () => {
  const request = (body: string, origin = env.EMBER_APP_URL) => new Request(env.EMBER_APP_URL + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-Host": "attacker.invalid" }, body });
  assert.equal(sameOriginPost(request(""), env.EMBER_APP_URL), true);
  assert.equal(sameOriginPost(request("", "https://attacker.invalid"), env.EMBER_APP_URL), false);
  assert.deepEqual(await loginFields(request("username=test&password=valid")), { username: "test", password: "valid" });
  assert.equal(await loginFields(request("username=x&password=" + "a".repeat(73))), null);
  assert.equal(await loginFields(request("username=x&password=" + "a".repeat(5000))), null);
  assert.equal(await loginFields(request("username=x&username=y&password=valid")), null);
  assert.equal(await totpField(request("code=123456")), "123456");
  assert.equal(await totpField(request("code=12345")), null);
  assert.equal(await totpField(request("code=123456&code=654321")), null);
});
