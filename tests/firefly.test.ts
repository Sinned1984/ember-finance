import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ConfigurationError, readConfig } from "../src/lib/env.ts";
import { getAssetAccounts, parsePage } from "../src/lib/firefly/accounts.ts";
import { FireflyError } from "../src/lib/firefly/client.ts";
import { formatBalance } from "../src/lib/money.ts";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.FIREFLY_BASE_URL;
const originalToken = process.env.FIREFLY_API_TOKEN;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.FIREFLY_BASE_URL;
  else process.env.FIREFLY_BASE_URL = originalUrl;
  if (originalToken === undefined) delete process.env.FIREFLY_API_TOKEN;
  else process.env.FIREFLY_API_TOKEN = originalToken;
});

function fixture(page = 1, pages = 1) {
  return { data: [{ type: "accounts", id: String(page), attributes: {
    name: "Test checking", type: "asset", active: true, current_balance: "1234.560000000000",
    currency_code: "EUR", currency_decimal_places: 2, current_balance_date: "2026-09-28T23:59:59+02:00",
    iban: "private-field-must-not-be-returned", notes: "private-note",
  } }], meta: { pagination: { current_page: page, total_pages: pages } },
  links: { next: "https://untrusted.example/api" } };
}
function configure(url = "https://firefly.example.test/finance/") {
  process.env.FIREFLY_BASE_URL = url;
  process.env.FIREFLY_API_TOKEN = "test-only-secret";
}

test("configuration accepts HTTPS and private HTTP, preserving a subpath", () => {
  assert.equal(readConfig({ FIREFLY_BASE_URL: "https://example.test/finance", FIREFLY_API_TOKEN: "test" }).baseUrl, "https://example.test/finance/");
  assert.equal(readConfig({ FIREFLY_BASE_URL: "http://firefly:8080", FIREFLY_API_TOKEN: "test" }).baseUrl, "http://firefly:8080/");
  for (const url of ["", "file:///tmp", "https://user:password@example.test", "https://example.test/?token=secret", "https://example.test/#fragment"]) {
    assert.throws(() => readConfig({ FIREFLY_BASE_URL: url, FIREFLY_API_TOKEN: "test" }), ConfigurationError);
  }
  assert.throws(() => readConfig({ FIREFLY_BASE_URL: "https://example.test" }), ConfigurationError);
  assert.throws(() => readConfig({ FIREFLY_BASE_URL: "https://example.test", FIREFLY_API_TOKEN: "bad\ntoken" }), ConfigurationError);
});

test("all pages use GET, fixed origin/path, no cache, no redirects and server auth", async () => {
  configure();
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url.toString());
    assert.equal(url.origin, "https://firefly.example.test");
    assert.equal(url.pathname, "/finance/api/v1/accounts");
    assert.equal(url.searchParams.get("type"), "asset");
    assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-only-secret");
    return Response.json(fixture(Number(url.searchParams.get("page")), 2));
  };
  const result = await getAssetAccounts();
  assert.equal(result.length, 2);
  assert.equal(requests.length, 2);
  assert.equal(result[0].balance, "1234.560000000000");
  assert.ok(!JSON.stringify(result).includes("private"));
  assert.ok(!JSON.stringify(result).includes("test-only-secret"));
});

test("missing balance is unavailable, never zero; empty account lists work", () => {
  const value = fixture();
  Reflect.deleteProperty(value.data[0].attributes, "current_balance");
  assert.equal(parsePage(value, 1).accounts[0].balance, null);
  for (const pages of [0, 1]) assert.deepEqual(parsePage({ data: [], meta: { pagination: { current_page: 1, total_pages: pages } } }, 1).accounts, []);
});

test("invalid amounts, shapes and pagination fail closed", () => {
  for (const value of [null, {}, { data: [] }, { ...fixture(), meta: { pagination: { current_page: 1, total_pages: 101 } } }]) {
    assert.throws(() => parsePage(value, 1), FireflyError);
  }
  const value = fixture();
  value.data[0].attributes.current_balance = "not-a-number";
  assert.throws(() => parsePage(value, 1), FireflyError);
  assert.throws(() => parsePage(fixture(2), 1), FireflyError);
});

test("upstream failures and network errors never expose response bodies or secrets", async () => {
  configure();
  for (const status of [401, 403, 429, 500]) {
    globalThis.fetch = async () => new Response("private-body test-only-secret", { status });
    await assert.rejects(getAssetAccounts(), (error: Error) => error instanceof FireflyError && !/private-body|test-only-secret/.test(error.message));
  }
  for (const name of ["TypeError", "TimeoutError", "AbortError"]) {
    globalThis.fetch = async () => { throw new DOMException("test-only-secret", name); };
    await assert.rejects(getAssetAccounts(), (error: Error) => error instanceof FireflyError && !error.message.includes("test-only-secret"));
  }
  globalThis.fetch = async () => new Response("not JSON");
  await assert.rejects(getAssetAccounts(), FireflyError);
});

test("a failed later page never returns a partial account list", async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? Response.json(fixture(1, 2)) : new Response("failure", { status: 503 });
  await assert.rejects(getAssetAccounts(), FireflyError);
  assert.equal(calls, 2);
});

test("duplicate account IDs and changing pagination are rejected", async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async () => {
    const value = fixture(++calls, 2);
    value.data[0].id = "same-id";
    return Response.json(value);
  };
  await assert.rejects(getAssetAccounts(), FireflyError);
  calls = 0;
  globalThis.fetch = async () => Response.json(++calls === 1 ? fixture(1, 2) : fixture(2, 3));
  await assert.rejects(getAssetAccounts(), FireflyError);
});

test("decimal formatting preserves precision, large amounts and currency scale", () => {
  assert.equal(formatBalance("9007199254740993.120000000000", 2), "9,007,199,254,740,993.12");
  assert.equal(formatBalance("-0.00000001", 8), "−0.00000001");
  assert.equal(formatBalance("100.0000", 0), "100");
  assert.equal(formatBalance("1.234", 2), "1.234");
  assert.equal(formatBalance("0", 2), "0.00");
  assert.equal(formatBalance(null, 2), "Unavailable");
});
