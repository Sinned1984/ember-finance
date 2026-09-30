// Opt-in only: node --env-file=.env tests/live-smoke.mjs
// Existing server-side clients perform GET-only reads. Never prints financial records.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { authFixture, signIn, cookieFrom } from "./auth-fixture.mjs";
import { tlsProxy } from "./tls-proxy.mjs";

const token = process.env.FIREFLY_API_TOKEN;
if (!token) throw new Error("Live test requires server environment configuration.");
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".env") || ["node_modules", "cache"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else assert.ok(!(await readFile(path)).includes(Buffer.from(token)), "Credential detected in build output");
  }
}
await scan(".next");
const reserve = createServer().listen(0, "127.0.0.1");
await once(reserve, "listening");
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const baseUrl = `http://127.0.0.1:${port}`;
const proxy = await tlsProxy(port);
const auth = authFixture(proxy?.origin || `https://localhost:${port}`);
const browserUrl = proxy?.origin || baseUrl;
let logs = "";
let browser;
let phase = "startup";
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, ...auth.env, NEXT_TELEMETRY_DISABLED: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", chunk => { logs += chunk.toString(); });
server.stderr.on("data", chunk => { logs += chunk.toString(); });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) { assert.deepEqual(await response.json(), { status: "ok" }); ready = true; break; }
    } catch {}
    await delay(100);
  }
  assert.ok(ready);
  const cookie = cookieFrom(await signIn(baseUrl, auth));
  assert.ok(cookie);
  if (process.env.EMBER_BROWSER_MODULE) {
    const { chromium } = await import(process.env.EMBER_BROWSER_MODULE);
    browser = await chromium.launch({ headless: true, ...(process.env.EMBER_BROWSER_CHANNEL ? { channel: process.env.EMBER_BROWSER_CHANNEL } : {}) });
  }
  const page = browser ? await browser.newPage({ locale: "nl-NL", ignoreHTTPSErrors: true }) : null;
  await page?.context().addCookies([{ name: "__Host-ember-session", value: cookie.slice(cookie.indexOf("=") + 1), domain: new URL(browserUrl).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
  const browserErrors = [];
  page?.on("pageerror", () => browserErrors.push("JavaScript error"));
  page?.on("request", request => {
    if (Object.values(request.headers()).some(value => value.includes(token))) browserErrors.push("Credential in request");
  });
  for (const path of ["/", "/accounts", "/transactions", "/budgets", "/subscriptions", "/reports"]) {
    phase = path;
    const response = await fetch(baseUrl + path, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(60000) });
    assert.equal(response.status, 200);
    const html = await response.text();
    phase = path + " (credential exclusion)";
    for (const secret of [token, auth.password, auth.env.EMBER_AUTH_SECRET, auth.env.EMBER_AUTH_PASSWORD_HASH]) assert.ok(!html.includes(secret));
    phase = path + " (live data availability)";
    assert.ok(!/Verbind met Firefly III|Gegevens niet beschikbaar|tijdelijk niet beschikbaar|Firefly III weigert toegang/.test(html));
    phase = path + " (cache headers)";
    assert.match(response.headers.get("cache-control"), /no-store/);
    if (page) {
      for (const width of [1440, 390]) {
        phase = `${path} (browser ${width}px)`;
        await page.setViewportSize({ width, height: 900 });
        await page.goto(browserUrl + path);
        await page.getByRole("heading", { level: 1 }).waitFor();
        phase = `${path} (overflow ${width}px)`;
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        phase = `${path} (browser credential exclusion)`;
        assert.ok(!(await page.content()).includes(token));
      }
    }
  }
  phase = "privacy";
  assert.deepEqual(browserErrors, []);
  for (const secret of [token, auth.password, auth.env.EMBER_AUTH_SECRET, auth.env.EMBER_AUTH_PASSWORD_HASH]) assert.ok(!logs.includes(secret));
  console.log(`PASS: six live production pages${browser ? " and desktop/mobile browser checks" : ""}, health, no-store and build/client/log credential scan. GET-only; no financial values printed.`);
} catch {
  console.error(`Live verification failed at ${phase}; no backend response or configuration printed.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await proxy?.close();
  if (server.exitCode === null) { server.kill(); await once(server, "exit"); }
}
