import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashSync } from "bcryptjs";
import { sealData } from "iron-session";
import { generate } from "otplib";

export function authFixture(origin) {
  const password = "synthetic-auth-password-" + randomBytes(8).toString("hex");
  return { password, totpSecret: null, env: {
    EMBER_APP_URL: origin,
    EMBER_AUTH_USERNAME: "synthetic-admin",
    EMBER_AUTH_PASSWORD_HASH: hashSync(password, 12),
    EMBER_AUTH_SECRET: randomBytes(32).toString("base64url"),
    EMBER_AUTH_STATE_DIR: join(tmpdir(), "ember-auth-fixture-" + randomUUID()),
  } };
}

export async function beginSignIn(baseUrl, fixture, fields = {}) {
  return fetch(baseUrl + "/api/auth/login", {
    method: "POST", redirect: "manual",
    headers: { Origin: fixture.env.EMBER_APP_URL, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: fixture.env.EMBER_AUTH_USERNAME, password: fixture.password, ...fields }),
  });
}
export function cookieNamed(response, name) {
  const header = response.headers.get("set-cookie") ?? "";
  return header.match(new RegExp(`(?:^|,\\s*)(${name}=[^;,\\s]+)`))?.[1] ?? "";
}
export const cookieFrom = response => cookieNamed(response, "__Host-ember-session") || cookieNamed(response, "ember-session");
export const preAuthCookieFrom = response => cookieNamed(response, "__Host-ember-preauth") || cookieNamed(response, "ember-preauth");

export async function submitTotp(baseUrl, fixture, preAuthCookie, { code, epochOffset = 0 } = {}) {
  if (!code && !fixture.totpSecret) throw new Error("Synthetic fixture has not enrolled TOTP.");
  const token = code ?? await generate({ secret: fixture.totpSecret, epoch: Math.floor((Date.now() + epochOffset) / 1000) });
  return fetch(baseUrl + "/api/auth/totp", {
    method: "POST", redirect: "manual",
    headers: { Cookie: preAuthCookie, Origin: fixture.env.EMBER_APP_URL, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: token }),
  });
}

export async function signIn(baseUrl, fixture, fields = {}, totp = {}) {
  const primary = await beginSignIn(baseUrl, fixture, fields);
  if (primary.headers.get("location") !== "/login/2fa") return primary;
  return submitTotp(baseUrl, fixture, preAuthCookieFrom(primary), totp);
}

export async function auditAuthentication(baseUrl, fixture, upstreamCount) {
  const before = upstreamCount();
  const paths = ["/", "/accounts", "/transactions?month=2024-02", "/transactions?month=2026-08&q=shop", "/categories/12?month=2026-08", "/budgets/34?month=2026-08", "/?month=2026-08", "/budgets", "/subscriptions", "/reports"];
  for (const path of paths) {
    for (const headers of [{}, { RSC: "1", "Next-Router-Prefetch": "1" }, { "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy", "X-Forwarded-For": "127.0.0.1", "X-Forwarded-Host": "trusted.invalid", "X-Forwarded-Proto": "https" }]) {
      const response = await fetch(baseUrl + path, { headers, redirect: "manual" });
      assert.equal(response.status, 303);
      assert.equal(new URL(response.headers.get("location"), fixture.env.EMBER_APP_URL).href, fixture.env.EMBER_APP_URL + "/login");
      assert.ok(["", "/login", fixture.env.EMBER_APP_URL + "/login"].includes(await response.text()));
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
  }
  for (const path of ["/api/accounts", "/api/transactions", "/api/budgets", "/api/subscriptions", "/api/reports", "/api/auth/session", "/api/health/private", "/api/auth/login/private"]) {
    assert.equal((await fetch(baseUrl + path, { redirect: "manual" })).status, 401);
  }
  for (const path of ["/accounts.json", "/%61ccounts", "/reports?_rsc=fixture", "/_next/image?url=%2Faccounts&w=640&q=75"]) {
    assert.equal((await fetch(baseUrl + path, { redirect: "manual" })).status, 303);
  }
  const login = await fetch(baseUrl + "/login");
  assert.equal(login.status, 200);
  const html = await login.text();
  assert.match(html, /Welkom terug/);
  assert.doesNotMatch(html, /Everyday account|Grocery purchase|Firefly/i);
  assert.match(login.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await (await fetch(baseUrl + "/api/health")).json(), { status: "ok" });
  for (const fields of [{ username: "wrong" }, { password: "wrong" }]) {
    const failed = await signIn(baseUrl, fixture, fields);
    assert.equal(failed.headers.get("location"), "/login?error=1");
    assert.equal(cookieFrom(failed), "");
  }
  for (const origin of [null, "https://attacker.invalid"]) {
    const response = await fetch(baseUrl + "/api/auth/login", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(origin ? { Origin: origin } : {}) }, body: new URLSearchParams({ username: fixture.env.EMBER_AUTH_USERNAME, password: fixture.password }) });
    assert.equal(response.headers.get("location"), "/login?error=1");
  }
  assert.equal(upstreamCount(), before, "Anonymous/login requests must never retrieve Firefly data");
  const passwordOnly = await beginSignIn(baseUrl, fixture);
  assert.equal(passwordOnly.headers.get("location"), "/");
  const passwordOnlyCookie = cookieFrom(passwordOnly);
  assert.ok(passwordOnlyCookie);
  assert.equal(preAuthCookieFrom(passwordOnly), "");
  const initialStatus = await fetch(baseUrl + "/api/auth/2fa/status", { headers: { Cookie: passwordOnlyCookie } });
  assert.equal(initialStatus.status, 200);
  assert.deepEqual(await initialStatus.json(), { enabled: false, activatedAt: null });
  assert.equal((await fetch(baseUrl + "/api/auth/2fa/status")).status, 401);
  const csrfSetup = await fetch(baseUrl + "/api/auth/2fa/setup", { method: "POST", headers: { Cookie: passwordOnlyCookie, Origin: "https://attacker.invalid", "Content-Type": "application/x-www-form-urlencoded" }, body: "" });
  assert.equal(csrfSetup.status, 403);
  const setupResponse = await fetch(baseUrl + "/api/auth/2fa/setup", { method: "POST", headers: { Cookie: passwordOnlyCookie, Origin: fixture.env.EMBER_APP_URL, "Content-Type": "application/x-www-form-urlencoded" }, body: "" });
  assert.equal(setupResponse.status, 200);
  const setup = await setupResponse.json();
  assert.match(setup.qrCode, /^data:image\/png;base64,/);
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.ok(Number.isSafeInteger(setup.expires) && setup.expires > Date.now());
  fixture.totpSecret = setup.secret;
  const invalidEnrollment = await fetch(baseUrl + "/api/auth/2fa/confirm", { method: "POST", headers: { Cookie: passwordOnlyCookie, Origin: fixture.env.EMBER_APP_URL, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: "12345" }) });
  assert.equal(invalidEnrollment.status, 400);
  const enrollmentCode = await generate({ secret: fixture.totpSecret, epoch: Math.floor((Date.now() - 30_000) / 1000) });
  const enrollment = await fetch(baseUrl + "/api/auth/2fa/confirm", { method: "POST", headers: { Cookie: passwordOnlyCookie, Origin: fixture.env.EMBER_APP_URL, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: enrollmentCode }) });
  assert.equal(enrollment.status, 200);
  assert.deepEqual(await enrollment.json(), { activated: true });
  assert.match(enrollment.headers.get("set-cookie"), /Max-Age=0/i);
  assert.equal((await fetch(baseUrl + "/api/auth/session", { headers: { Cookie: passwordOnlyCookie } })).status, 401);

  const primary = await beginSignIn(baseUrl, fixture);
  assert.equal(primary.headers.get("location"), "/login/2fa");
  assert.equal(cookieFrom(primary), "");
  const preAuthCookie = preAuthCookieFrom(primary);
  assert.ok(preAuthCookie);
  const preAuthHeader = primary.headers.get("set-cookie");
  for (const pattern of [/HttpOnly/i, /Secure/i, /SameSite=Strict/i, /Max-Age=300/i, /^__Host-ember-preauth=/]) assert.match(preAuthHeader, pattern);
  assert.equal((await fetch(baseUrl + "/accounts", { headers: { Cookie: preAuthCookie }, redirect: "manual" })).status, 303);
  const twoFactorPage = await fetch(baseUrl + "/login/2fa", { headers: { Cookie: preAuthCookie } });
  assert.equal(twoFactorPage.status, 200);
  assert.match(await twoFactorPage.text(), /Nog één stap/);
  const invalidTotp = await submitTotp(baseUrl, fixture, preAuthCookie, { code: "12345" });
  assert.equal(invalidTotp.headers.get("location"), "/login/2fa?error=1");
  assert.equal(cookieFrom(invalidTotp), "");
  const authenticated = await submitTotp(baseUrl, fixture, preAuthCookie);
  assert.equal(authenticated.headers.get("location"), "/");
  const setCookie = authenticated.headers.get("set-cookie");
  for (const pattern of [/HttpOnly/i, /Secure/i, /SameSite=Lax/i, /Max-Age=28800/i, /(?:^|,\s*)__Host-ember-session=/]) assert.match(setCookie, pattern);
  const cookie = cookieFrom(authenticated);
  assert.equal((await fetch(baseUrl + "/api/auth/session", { headers: { Cookie: cookie } })).status, 204);
  const csrfLogout = await fetch(baseUrl + "/api/auth/logout", { method: "POST", headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(csrfLogout.status, 403);
  assert.equal((await fetch(baseUrl + "/api/auth/logout", { headers: { Cookie: cookie }, redirect: "manual" })).status, 405);
  const logout = await fetch(baseUrl + "/api/auth/logout", { method: "POST", redirect: "manual", headers: { Cookie: cookie, Origin: fixture.env.EMBER_APP_URL, "Content-Type": "application/x-www-form-urlencoded" }, body: "" });
  assert.equal(logout.headers.get("location"), "/login");
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/i);
  const expired = await sealData({ id: randomUUID(), expires: Date.now() - 1000 }, { password: fixture.env.EMBER_AUTH_SECRET, ttl: 28800 });
  const unregistered = await sealData({ id: randomUUID(), expires: Date.now() + 60000 }, { password: fixture.env.EMBER_AUTH_SECRET, ttl: 28800 });
  for (const denied of [cookie, "__Host-ember-session=tampered", `__Host-ember-session=${expired}`, `__Host-ember-session=${unregistered}`]) {
    assert.equal((await fetch(baseUrl + "/accounts", { headers: { Cookie: denied }, redirect: "manual" })).status, 303);
  }
  assert.equal(upstreamCount(), before);
  return cookieFrom(await signIn(baseUrl, fixture, {}, { epochOffset: 30_000 }));
}
