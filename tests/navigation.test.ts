import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { budgetPeriod } from "../src/lib/budget-period.ts";
import { transactionHref, transactionSearch } from "../src/lib/transaction-navigation.ts";
import { getSelectedTransactions, monthlySearchQuery } from "../src/lib/firefly/transactions.ts";
import { getCategoryDetail, getBudgetDetail, parseCategory } from "../src/lib/firefly/details.ts";
import { getMonthlyBills, monthlyBillState, parseBillTotals, parseMonthlyBills } from "../src/lib/firefly/monthly-bills.ts";
import { FireflyError } from "../src/lib/firefly/client.ts";

const period = budgetPeriod("2026-08");
const originalFetch = globalThis.fetch, originalUrl = process.env.FIREFLY_BASE_URL, originalToken = process.env.FIREFLY_API_TOKEN;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.FIREFLY_BASE_URL; else process.env.FIREFLY_BASE_URL = originalUrl;
  if (originalToken === undefined) delete process.env.FIREFLY_API_TOKEN; else process.env.FIREFLY_API_TOKEN = originalToken;
});
const envelope = (data: unknown[], page = 1, total = data.length, pages = 1) => ({ data, meta: { pagination: { current_page: page, total_pages: pages, total } } });
const split = (id: string, description = "Albert Heijn") => ({ transaction_journal_id: id, type: "withdrawal", date: "2026-08-01T00:00:00+02:00", description, amount: "1.23000001", currency_code: "EUR", currency_decimal_places: 2, category_id: "12", category_name: "Boodschappen", budget_id: "34", budget_name: "Boodschappen" });
const group = (id: string) => ({ type: "transactions", id, attributes: { group_title: "Gesplitst", transactions: [split(id + "a"), { ...split(id + "b"), category_id: "13", budget_id: null, budget_name: null, amount: "2.00" }] } });
function mock(handler: (url: URL) => unknown) {
  process.env.FIREFLY_BASE_URL = "https://fixture.invalid/prefix/"; process.env.FIREFLY_API_TOKEN = "synthetic-secret";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://fixture.invalid"); assert.ok(url.pathname.startsWith("/prefix/api/v1/"));
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-secret"); assert.ok(init?.signal);
    return Response.json(handler(url));
  };
}

test("whole-month table search finds split rows beyond the first Firefly search page", async () => {
  const calls: string[] = [];
  mock(url => {
    calls.push(url.pathname);
    const page = Number(url.searchParams.get("page"));
    if (url.pathname.endsWith("/search/transactions")) {
      assert.equal(url.searchParams.get("query"), 'date_after:2026-08-01 date_before:2026-08-31');
      assert.equal(url.searchParams.get("limit"), "100");
      return envelope([page === 1 ? { ...group("first-page"), attributes: { transactions: [split("unrelated", "Other")] } } : group("beyond-page-one")], page, 3, 2);
    }
    return envelope([group(page === 2 ? "beyond-page-one" : "first-page")], page, 26, 2);
  });
  assert.equal((await getSelectedTransactions(period)).rows[0].groupId, "first-page");
  assert.equal((await getSelectedTransactions(period, 2)).rows[0].groupId, "beyond-page-one");
  const found = await getSelectedTransactions(period, 1, { query: "Albert Heijn" });
  assert.equal(found.rows[0].groupId, "beyond-page-one"); assert.equal(found.rows.length, 2);
  assert.equal(found.rows.find(r => r.id.endsWith("a"))?.categoryId, "12"); assert.equal(found.rows.find(r => r.id.endsWith("b"))?.categoryId, "13");
  assert.equal(found.rows.find(r => r.id.endsWith("b"))?.budgetId, null); assert.ok(found.rows.every(r => r.split));
  assert.equal(found.total, 2); assert.equal(calls.filter(p => p.endsWith("/search/transactions")).length, 2);
});

test("search result pagination preserves month/query and clear/change links reset page", async () => {
  assert.equal(transactionHref("/transactions", period.month, 2, "Albert Heijn"), "/transactions?month=2026-08&q=Albert+Heijn&page=2");
  assert.equal(transactionHref("/transactions", period.month, 1, "new"), "/transactions?month=2026-08&q=new");
  assert.equal(transactionHref("/transactions", period.month), "/transactions?month=2026-08");
  mock(url => {
    assert.equal(url.searchParams.get("page"), "1"); assert.equal(url.searchParams.get("limit"), "100");
    assert.ok(url.searchParams.get("query")?.includes("2026-08-31"));
    return envelope(Array.from({ length: 15 }, (_, i) => group(String(i))), 1, 30, 1);
  });
  assert.equal((await getSelectedTransactions(period, 2, { query: "Albert" })).page, 2);
});

test("search text never reaches Firefly operators; invalid input and out-of-month data fail closed", async () => {
  const query = 'shop" date_after:1900-01-01 ( OR )';
  assert.equal(monthlySearchQuery(query, period), 'date_after:2026-08-01 date_before:2026-08-31');
  for (const q of ["x\\", "x\ny", "x".repeat(201), ["a", "b"]]) assert.ok(transactionSearch(q).error);
  assert.equal(transactionSearch("  shop  ").query, "shop");
  assert.throws(() => monthlySearchQuery("x\\", period), FireflyError);
  mock(() => { const g = group("outside"); g.attributes.transactions[0].date = "2026-09-01T00:00:00Z"; return envelope([g]); });
  await assert.rejects(getSelectedTransactions(period, 1, { query: "shop" }), FireflyError);
  const leap = budgetPeriod("2024-02");
  assert.ok(monthlySearchQuery("shop", leap).includes("date_before:2024-02-29"));
});

const category = (spent: unknown = [{ currency_code: "EUR", currency_decimal_places: 2, sum: "-9007199254740993.123456" }]) => ({ data: { type: "categories", id: "12", attributes: { name: "Boodschappen", spent, earned: [{ currency_code: "USD", currency_decimal_places: 2, sum: "12.30" }], transferred: [{ currency_code: "EUR", currency_decimal_places: 2, sum: "50.00" }] } } });
test("category identity and authoritative spending/income/transfers remain distinct and currency safe", async () => {
  mock(url => { assert.equal(url.pathname, "/prefix/api/v1/categories/12"); assert.equal(url.searchParams.get("start"), period.start); assert.equal(url.searchParams.get("end"), period.end); return category(); });
  const c = await getCategoryDetail("12", period);
  assert.equal(c.spent?.[0].amount, "9007199254740993.123456"); assert.equal(c.earned?.[0].currency, "USD"); assert.equal(c.transferred?.[0].amount, "50.00");
  assert.throws(() => parseCategory(category(), "34"), FireflyError);
  assert.deepEqual(parseCategory(category([]), "12").spent, []);
  assert.equal(parseCategory(category(null), "12").spent, null);
  await assert.rejects(getCategoryDetail("../budgets", period), FireflyError);
});

test("category/budget transaction endpoints use stable IDs, period and server pagination", async () => {
  for (const [kind, id] of [["categories", "12"], ["budgets", "34"]] as const) {
    mock(url => {
      assert.equal(url.pathname, `/prefix/api/v1/${kind}/${id}/transactions`);
      assert.equal(url.searchParams.get("start"), period.start); assert.equal(url.searchParams.get("end"), period.end);
      return envelope([group("split")], Number(url.searchParams.get("page")), 26, 2);
    });
    const result = await getSelectedTransactions(period, 2, { kind, id });
    assert.equal(result.rows.length, 2); assert.equal(result.page, 2); assert.equal(result.rows[0].amount, "1.23000001");
    const href = transactionHref(`/${kind}/${id}`, period.previous!);
    assert.equal(href, `/${kind}/${id}?month=2026-07`);
  }
  mock(() => envelope([], 1, 0, 0));
  assert.equal((await getSelectedTransactions(period, 1, { kind: "categories", id: "12" })).total, 0);
  assert.equal((await getSelectedTransactions(period, 1, { kind: "budgets", id: "34" })).rows.length, 0);
});

const budget = { data: { type: "budgets", id: "34", attributes: { name: "Boodschappen", active: true, spent: [{ currency_code: "EUR", currency_decimal_places: 2, sum: "-80.000001" }] } } };
const limit = { type: "budget_limits", id: "1", attributes: { budget_id: "34", currency_code: "EUR", currency_decimal_places: 2, amount: "100.000002", start: "2026-08-01T00:00:00+02:00", end: "2026-08-31T23:59:59+02:00" } };
test("budget detail reuses authoritative spending/limits and exact remaining/percentage logic", async () => {
  mock(url => { assert.equal(url.searchParams.get("start"), period.start); assert.equal(url.searchParams.get("end"), period.end); return url.pathname.endsWith("/limits") ? envelope([limit]) : budget; });
  const result = await getBudgetDetail("34", period);
  assert.equal(result.rows[0].usage?.remaining, "20.000001"); assert.equal(result.rows[0].usage?.percentage, "79.9");
  assert.equal(result.rows[0].spent, "80.000001");
});
test("budget without limits, empty spending and other currencies never fabricate comparisons", async () => {
  mock(url => url.pathname.endsWith("/limits") ? envelope([]) : budget);
  assert.equal((await getBudgetDetail("34", period)).rows[0].limit, null);
  mock(url => url.pathname.endsWith("/limits") ? envelope([{ ...limit, attributes: { ...limit.attributes, currency_code: "USD" } }]) : budget);
  const rows = (await getBudgetDetail("34", period)).rows;
  assert.equal(rows.length, 2); assert.ok(rows.every(r => r.usage === null));
  mock(url => url.pathname.endsWith("/limits") ? envelope([]) : { data: { ...budget.data, attributes: { ...budget.data.attributes, spent: [] } } });
  assert.equal((await getBudgetDetail("34", period)).rows[0].spent, null);
});
test("budget limit pagination is bounded and incomplete later pages fail safely", async () => {
  mock(url => url.pathname.endsWith("/limits") ? envelope([{ ...limit, id: url.searchParams.get("page")! }], Number(url.searchParams.get("page")), 2, 2) : budget);
  assert.equal((await getBudgetDetail("34", period)).rows[0].limits.length, 2);
  mock(url => url.pathname.endsWith("/limits") ? envelope([limit], 1, 1, 101) : budget);
  await assert.rejects(getBudgetDetail("34", period), FireflyError);
});

const bill = (id = "1", overrides = {}) => ({ type: "bills", id, attributes: { name: "Internet", active: true, amount_min: "10.00", amount_max: "20.00", currency_code: "EUR", currency_decimal_places: 2, repeat_freq: "monthly", skip: 0, paid_dates: [], pay_dates: ["2026-08-31T00:00:00+02:00"], ...overrides } });
const total = (kind: "paid" | "unpaid", amount: string, currency = "EUR", id = "1") => {
  const key = `bills-${kind}-in-${currency}`;
  return { [key]: { key, currency_id: id, currency_code: currency, currency_decimal_places: 2, monetary_value: amount, value_parsed: "untrusted formatted value" } };
};
const paid = { transaction_journal_id: "55", transaction_group_id: "5", subscription_id: "1", date: "2026-08-05T00:00:00+02:00" };
test("bill matching uses paid_dates and pay_dates, never whether the expected date is past", () => {
  const bills = parseMonthlyBills(envelope([bill("1", { paid_dates: [paid], pay_dates: ["2026-08-01", "2026-08-31", "2026-09-30"] })]), 1, period).bills;
  assert.equal(bills[0].matched, 1); assert.deepEqual(bills[0].expected, ["2026-08-01", "2026-08-31"]);
  assert.equal(bills[0].item.minimum, "10.00"); assert.equal(bills[0].item.maximum, "20.00");
  const state = monthlyBillState(bills, parseBillTotals(total("unpaid", "-30.00")));
  assert.equal(state.upcoming.length, 2); assert.equal(state.nothingExpected, false);
});
test("August completed summary stays authoritative; out-of-month next date is ignored", () => {
  const bills = parseMonthlyBills(envelope([bill("1", { paid_dates: [paid], pay_dates: ["2026-09-01"] })]), 1, period).bills;
  const state = monthlyBillState(bills, parseBillTotals({ ...total("paid", "12.50"), ...total("unpaid", "0") }));
  assert.equal(state.matched, 1); assert.equal(state.nothingExpected, true);
  assert.equal(monthlyBillState(bills, null).nothingExpected, false);
  assert.equal(monthlyBillState(bills, parseBillTotals(total("paid", "12.50"))).status, "paid");
});

test("September 2026 paid summary overrides residual in-month schedules of four matched bills", () => {
  const september = budgetPeriod("2026-09");
  const bills = parseMonthlyBills(envelope([1, 2, 3, 4].map(n => bill(String(n), {
    paid_dates: [{ ...paid, transaction_journal_id: String(n), subscription_id: String(n), date: "2026-09-05" }],
    pay_dates: ["2026-09-30"],
  }))), 1, september).bills;
  const totals = parseBillTotals(total("paid", "1172.09"));
  const state = monthlyBillState(bills, totals);
  assert.equal(state.status, "paid"); assert.equal(state.nothingExpected, true);
  assert.equal(state.matched, 4); assert.deepEqual(state.upcoming, []);
  assert.equal(totals[0].amount, "1172.09");
  assert.ok(bills.every(b => b.matched === 1 && b.expected?.[0] === "2026-09-30"));
  assert.equal(monthlyBillState(null, totals).status, "paid");
});

test("only summary establishes status regardless of schedules or currency", () => {
  const bills = parseMonthlyBills(envelope([bill("1", { paid_dates: [paid] })]), 1, period).bills;
  for (const totals of [null, []]) {
    const state = monthlyBillState(bills, totals);
    assert.equal(state.status, "unavailable"); assert.equal(state.nothingExpected, false);
    assert.equal(state.matched, 1); assert.deepEqual(state.upcoming, []);
  }
  const totals = parseBillTotals({ ...total("paid", "10"), ...total("unpaid", "0"), ...total("unpaid", "-1", "USD", "2") });
  assert.equal(monthlyBillState([], totals).status, "outstanding");
});
test("empty/inactive bills do not create upcoming obligations; missing fields stay unknown", () => {
  const totals = parseBillTotals(total("unpaid", "0"));
  assert.equal(monthlyBillState([], totals).nothingExpected, true);
  const inactive = parseMonthlyBills(envelope([bill("1", { active: false })]), 1, period).bills;
  assert.equal(monthlyBillState(inactive, totals).upcoming.length, 0);
  const missing = parseMonthlyBills(envelope([bill("1", { paid_dates: null, pay_dates: null })]), 1, period).bills;
  assert.equal(monthlyBillState(missing, totals).complete, false);
  assert.equal(monthlyBillState(missing, totals).matched, null);
  assert.equal(monthlyBillState(missing, totals).nothingExpected, true);
});
test("bill totals preserve Firefly estimates, currencies and decimal strings without averaging locally", () => {
  const totals = parseBillTotals({ ...total("paid", "9007199254740993.123456"), ...total("unpaid", "-15.50"), ...total("unpaid", "-10.00", "USD", "2") });
  assert.equal(totals.length, 3); assert.equal(totals[0].amount, "9007199254740993.123456");
  assert.equal(totals[1].amount, "15.50"); assert.equal(totals[2].currency, "USD");
  const fixed = parseMonthlyBills(envelope([bill("1", { amount_max: "10.00" })]), 1, period).bills[0];
  assert.equal(fixed.item.minimum, fixed.item.maximum);
  assert.throws(() => parseBillTotals({}), FireflyError);
});
test("malformed/duplicate bill matches and out-of-month paid data cannot claim completion", () => {
  for (const paid_dates of [[paid, paid], [{ ...paid, subscription_id: "2" }], [{ ...paid, date: "2026-09-01" }]]) {
    assert.throws(() => parseMonthlyBills(envelope([bill("1", { paid_dates })]), 1, period), FireflyError);
  }
  assert.throws(() => parseMonthlyBills(envelope([bill("1", { pay_dates: ["2026-02-30"] })]), 1, period), FireflyError);
});
test("monthly bills paginate bounded GETs and isolate summary failures from schedules", async () => {
  mock(url => {
    assert.equal(url.searchParams.get("start"), period.start); assert.equal(url.searchParams.get("end"), period.end);
    if (url.pathname.endsWith("/summary/basic")) return total("unpaid", "-30");
    const page = Number(url.searchParams.get("page"));
    return envelope([bill(String(page))], page, 2, 2);
  });
  let data = await getMonthlyBills(period); assert.equal(data.bills?.length, 2); assert.equal(data.totals?.[0].amount, "30");
  mock(url => url.pathname.endsWith("/summary/basic") ? {} : envelope([bill()]));
  data = await getMonthlyBills(period); assert.equal(data.bills?.length, 1); assert.equal(data.totals, null);
  assert.equal(monthlyBillState(data.bills, data.totals).status, "unavailable");
  mock(url => url.pathname.endsWith("/summary/basic") ? total("paid", "invalid") : envelope([bill()]));
  data = await getMonthlyBills(period);
  assert.equal(monthlyBillState(data.bills, data.totals).status, "unavailable");
  mock(url => url.pathname.endsWith("/summary/basic") ? total("paid", "1") : {});
  data = await getMonthlyBills(period); assert.equal(data.bills, null); assert.equal(data.totals?.length, 1);
});

