import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { budgetPeriod } from "../src/lib/budget-period.ts";
import { budgetUsage } from "../src/lib/budget-math.ts";
import { getMonthlyBudgets, monthlyBudgetRows, parseBudgets, parseBudgetLimits } from "../src/lib/firefly/budgets.ts";
import { FireflyError } from "../src/lib/firefly/client.ts";

const period = budgetPeriod("2026-09");
const envelope = (data: unknown[], page = 1, pages = 1) => ({ data, meta: { pagination: { current_page: page, total_pages: pages } } });
const budget = (id = "1", sum = "-80.00") => ({ type: "budgets", id, attributes: { name: "Fixture budget", active: true, notes: "private-note", spent: [{ currency_code: "EUR", currency_decimal_places: 2, sum }] } });
const limit = (id = "limit1", budgetId = "1") => ({ type: "budget_limits", id, attributes: { budget_id: budgetId, currency_code: "EUR", currency_decimal_places: 2, amount: "100.00", start: "2026-09-01T00:00:00+02:00", end: "2026-09-30T23:59:59+02:00" } });
const originalFetch = globalThis.fetch;
const originalUrl = process.env.FIREFLY_BASE_URL, originalToken = process.env.FIREFLY_API_TOKEN;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.FIREFLY_BASE_URL; else process.env.FIREFLY_BASE_URL = originalUrl;
  if (originalToken === undefined) delete process.env.FIREFLY_API_TOKEN; else process.env.FIREFLY_API_TOKEN = originalToken;
});
test("monthly periods handle leap years, year boundaries and Amsterdam midnight", () => {
  assert.equal(budgetPeriod("2024-02").end, "2024-02-29");
  assert.equal(budgetPeriod("2025-02").end, "2025-02-28");
  assert.equal(budgetPeriod("2026-12").next, "2027-01");
  assert.equal(budgetPeriod("2026-01").previous, "2025-12");
  assert.equal(budgetPeriod(undefined, new Date("2026-03-31T22:30:00Z")).month, "2026-04");
  for (const value of ["2026-13", "2026-00", "2026-2", "bad", ["2026-01"]]) assert.equal(budgetPeriod(value, new Date("2026-09-15Z")).month, "2026-09");
});
test("budget parsing preserves authoritative spending and omits private metadata", () => {
  const b = parseBudgets(envelope([budget()]), 1).budgets[0];
  const l = parseBudgetLimits(envelope([limit()]), b.id).limits;
  const row = monthlyBudgetRows(b, l, period)[0];
  assert.equal(row.spent, "80.00"); assert.equal(row.limit, "100.00");
  assert.equal(row.usage?.remaining, "20.00"); assert.equal(row.usage?.percentage, "80.0");
  assert.equal(row.usage?.status, "close");
  assert.ok(!JSON.stringify(b).includes("private-note"));
});
test("derived remaining and usage use exact decimal arithmetic and handle zero limits", () => {
  assert.equal(budgetUsage("9007199254740993.123456", "9007199254740993.123455").remaining, "0.000001");
  assert.equal(budgetUsage("100", "79.99").status, "within");
  assert.equal(budgetUsage("100", "100").status, "close");
  assert.equal(budgetUsage("100", "100.01").status, "over");
  assert.equal(budgetUsage("100", "125").remaining, "-25");
  assert.equal(budgetUsage("100", "125").percentage, "125.0");
  assert.equal(budgetUsage("0", "1").percentage, null);
  assert.equal(budgetUsage("0", "1").status, "over");
  assert.equal(budgetUsage("0", "0").status, "within");
  assert.equal(budgetUsage("100", "-5").remaining, "105");
});
test("missing or empty spending is never invented as zero", () => {
  const b = parseBudgets(envelope([budget()]), 1).budgets[0];
  const l = parseBudgetLimits(envelope([limit()]), b.id).limits;
  for (const spent of [null, []]) {
    const row = monthlyBudgetRows({ ...b, spent }, l, period)[0];
    assert.equal(row.spent, null); assert.equal(row.usage, null);
  }
  const missing = limit(); Reflect.deleteProperty(missing.attributes, "amount");
  assert.equal(monthlyBudgetRows(b, parseBudgetLimits(envelope([missing]), b.id).limits, period)[0].usage, null);
  assert.equal(monthlyBudgetRows(b, [], period)[0].limit, null);
});
test("overlapping, partial and foreign-currency limits are not silently aggregated", () => {
  const b = parseBudgets(envelope([budget()]), 1).budgets[0];
  const l = parseBudgetLimits(envelope([limit()]), b.id).limits;
  assert.equal(monthlyBudgetRows(b, [...l, { ...l[0], id: "other" }], period)[0].usage, null);
  assert.equal(monthlyBudgetRows(b, [{ ...l[0], start: "2026-08-01" }], period)[0].usage, null);
  const rows = monthlyBudgetRows(b, [{ ...l[0], currency: "USD" }], period);
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.usage === null));
});
test("invalid amounts, duplicate currencies, wrong budget and bad pagination fail closed", () => {
  const bad = budget(); bad.attributes.spent[0].sum = "NaN";
  assert.throws(() => parseBudgets(envelope([bad]), 1), FireflyError);
  const duplicate = budget(); duplicate.attributes.spent.push(duplicate.attributes.spent[0]);
  assert.throws(() => parseBudgets(envelope([duplicate]), 1), FireflyError);
  assert.throws(() => parseBudgetLimits(envelope([limit()]), "other"), FireflyError);
  assert.throws(() => parseBudgets(envelope([budget()], 2), 1), FireflyError);
  assert.throws(() => parseBudgets(envelope([], 1, 101), 1), FireflyError);
});
test("retrieval paginates budgets and limits with GET, dates and secure request settings", async () => {
  process.env.FIREFLY_BASE_URL = "http://firefly:8080/prefix/"; process.env.FIREFLY_API_TOKEN = "test-secret";
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname + url.search);
    assert.equal(url.origin, "http://firefly:8080");
    assert.equal(url.searchParams.get("start"), period.start); assert.equal(url.searchParams.get("end"), period.end);
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
    assert.ok(init?.signal instanceof AbortSignal); assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
    const page = Number(url.searchParams.get("page"));
    if (url.pathname.endsWith("/budgets")) return Response.json(envelope([budget(String(page))], page, 2));
    const id = url.pathname.split("/").at(-2)!;
    return Response.json(envelope([limit(`limit${page}`, id)], page, 2));
  };
  const rows = await getMonthlyBudgets(period);
  assert.equal(rows.length, 2); assert.equal(calls.length, 6);
  assert.ok(rows.every(row => row.usage === null)); // Two overlapping limits must not be added.
});
test("partial network failures never return misleading totals or leak responses", async () => {
  process.env.FIREFLY_BASE_URL = "https://firefly.example"; process.env.FIREFLY_API_TOKEN = "test-secret";
  globalThis.fetch = async input => String(input).includes("/limits?") ? new Response("private-token", { status: 500 }) : Response.json(envelope([budget()]));
  await assert.rejects(getMonthlyBudgets(period), (e: Error) => e instanceof FireflyError && !e.message.includes("private-token"));
});
