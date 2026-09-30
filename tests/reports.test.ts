import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { budgetPeriod } from "../src/lib/budget-period.ts";
import { barPercent, compareDecimal, subtractDecimal } from "../src/lib/report-math.ts";
import { cashFlows, createReportReader, parseInsights, previousDifference, type ReportResult } from "../src/lib/firefly/reports.ts";
import { FireflyError } from "../src/lib/firefly/client.ts";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.FIREFLY_BASE_URL;
const originalToken = process.env.FIREFLY_API_TOKEN;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.FIREFLY_BASE_URL; else process.env.FIREFLY_BASE_URL = originalUrl;
  if (originalToken === undefined) delete process.env.FIREFLY_API_TOKEN; else process.env.FIREFLY_API_TOKEN = originalToken;
});
const entry = (difference: string, currency_id = "1", currency_code = "EUR") => ({ difference, currency_id, currency_code, difference_float: 999999 });
const success = (difference: string, kind: "income" | "expenses", id = "1", currency = "EUR"): ReportResult => ({ ok: true, rows: parseInsights([entry(difference, id, currency)], kind) });
const empty: ReportResult = { ok: true, rows: [] };
function configure() {
  process.env.FIREFLY_BASE_URL = "https://firefly.example/prefix/";
  process.env.FIREFLY_API_TOKEN = "test-secret";
}

test("insights use authoritative decimal strings, normalize expense sign, discard floating-point and private fields", () => {
  const rows = parseInsights([{ ...entry("-9007199254740993.123456789012"), private_notes: "private" }], "expenses");
  assert.equal(rows[0].amount, "9007199254740993.123456789012");
  assert.ok(!JSON.stringify(rows).includes("private"));
  assert.equal(parseInsights([entry("-0.000")], "expenses")[0].amount, "0.000");
  assert.equal(parseInsights([entry("42.123")], "income")[0].amount, "42.123");
});

test("exact net, comparison and bounded bar calculations preserve precision", () => {
  assert.equal(subtractDecimal("9007199254740993.123456", "0.000001"), "9007199254740993.123455");
  assert.equal(subtractDecimal("-0.10", "0.001"), "-0.101");
  assert.equal(subtractDecimal("1", "1.000"), "0.000");
  assert.equal(compareDecimal("10.000", "9.999999999999"), 1);
  assert.equal(barPercent("1", "3"), 33.3);
  assert.equal(barPercent("2", "1"), 100);
  assert.equal(barPercent("1", "0"), 0);
  assert.equal(barPercent("-1", "2"), 0);
});

test("empty months have no invented currency and an absent currency in a complete total is zero", () => {
  assert.deepEqual(cashFlows(empty, empty), []);
  assert.deepEqual(cashFlows(empty, success("-25.50", "expenses"))[0], { currencyId: "1", currency: "EUR", income: "0", expenses: "25.50", net: "-25.50" });
  assert.equal(cashFlows(success("20", "income"), empty)[0].net, "20");
});

test("multiple currencies never combine; failure or conflicting currency metadata is unknown, not zero", () => {
  const income = success("100", "income");
  const expense = success("-50", "expenses", "2", "USD");
  assert.deepEqual(cashFlows(income, expense).map(row => [row.currency, row.net]), [["EUR", "100"], ["USD", "-50"]]);
  assert.equal(cashFlows(income, { ok: false })[0].net, null);
  assert.equal(cashFlows(income, { ok: false })[0].expenses, null);
  assert.equal(cashFlows(income, success("-10", "expenses", "1", "USD"))[0].net, null);
});

test("previous month comparison uses matching currencies and requires complete prior totals", () => {
  const current = cashFlows(success("100", "income"), success("-30", "expenses"))[0];
  const prior = cashFlows(success("60", "income"), success("-20", "expenses"));
  assert.equal(previousDifference(current, prior, true), "30");
  assert.equal(previousDifference(current, [], true), "70");
  assert.equal(previousDifference(current, prior, false), null);
  assert.equal(previousDifference(current, [{ ...prior[0], net: null }], true), null);
});

test("uncategorized and unbudgeted amounts come from dedicated endpoints, never inferred residuals", async () => {
  configure();
  const paths: string[] = [];
  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname; paths.push(path);
    return Response.json([entry("-12.34")]);
  };
  const read = createReportReader();
  for (const kind of ["uncategorizedExpenses", "unbudgeted"] as const) {
    const result = await read(kind, budgetPeriod("2024-02"));
    assert.ok(result.ok); assert.equal(result.rows[0].amount, "12.34"); assert.equal(result.rows[0].name, null);
  }
  assert.deepEqual(paths, ["/prefix/api/v1/insight/expense/no-category", "/prefix/api/v1/insight/expense/no-budget"]);
});

test("category IDs may repeat across currencies but duplicate aggregates and malformed financial fields fail closed", () => {
  const group = { ...entry("-10"), id: "category", name: "Food" };
  assert.equal(parseInsights([group, { ...group, currency_id: "2", currency_code: "USD" }], "expenseCategories").length, 2);
  assert.throws(() => parseInsights([group, group], "expenseCategories"), FireflyError);
  for (const change of [{ difference: null }, { difference: 10 }, { difference: "NaN" }, { difference: "1e3" }, { currency_id: null }, { currency_code: "" }, { name: null }, { id: "" }]) {
    assert.throws(() => parseInsights([{ ...group, ...change }], "expenseCategories"), FireflyError);
  }
  assert.throws(() => parseInsights({ data: [] }, "income"), FireflyError);
  assert.deepEqual(parseInsights([], "income"), []);
});

test("only date-filtered GET insight endpoints are used with secure settings and render-local deduplication", async () => {
  configure(); let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++; const url = new URL(String(input));
    assert.equal(url.pathname, "/prefix/api/v1/insight/expense/total");
    assert.equal(url.searchParams.get("start"), "2024-02-01");
    assert.equal(url.searchParams.get("end"), "2024-02-29");
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined);
    assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json([entry("-20.00")]);
  };
  const period = budgetPeriod("2024-02"), read = createReportReader();
  const [a, b] = await Promise.all([read("expenses", period), read("expenses", period)]);
  assert.deepEqual(a, b); assert.equal(calls, 1);
  await createReportReader()("expenses", period); assert.equal(calls, 2);
  assert.deepEqual(await read("expenses", { ...period, end: "2024-03-01" }), { ok: false }); assert.equal(calls, 2);
});

test("transfer exclusion and split handling stay delegated to Firefly aggregates, with no transaction-group summation", async () => {
  configure(); const paths: string[] = [];
  // Firefly's verified withdrawal/deposit insight contract returns journal totals:
  // split withdrawal journals 12.50 + 7.50 = 20; income 100; transfer 500 excluded.
  // The client must consume that 20 exactly once, not re-add the split group.
  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname; paths.push(path);
    if (path.endsWith("/expense/total")) return Response.json([entry("-20.00")]);
    if (path.endsWith("/income/total")) return Response.json([entry("100.00")]);
    assert.fail("Reports must not fetch transactions or transfers to reimplement accounting");
  };
  const read = createReportReader(), period = budgetPeriod("2026-09");
  const [income, expenses] = await Promise.all([read("income", period), read("expenses", period)]);
  assert.equal(cashFlows(income, expenses)[0].net, "80.00");
  assert.equal(paths.length, 2);
});

test("one failed report does not hide other components or leak upstream details", async () => {
  configure();
  for (const status of [401, 403, 429, 500]) {
    globalThis.fetch = async input => new URL(String(input)).pathname.endsWith("/expense/total")
      ? new Response("private-secret-response", { status }) : Response.json([entry("100")]);
    const read = createReportReader();
    const [expenses, income] = await Promise.all([read("expenses", budgetPeriod()), read("income", budgetPeriod())]);
    assert.deepEqual(expenses, { ok: false }); assert.ok(income.ok);
  }
  globalThis.fetch = async () => { throw new Error("private-secret-response"); };
  assert.deepEqual(await createReportReader()("income", budgetPeriod()), { ok: false });
});
