import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { authFixture, auditAuthentication, signIn, cookieFrom } from "./auth-fixture.mjs";
import { tlsProxy } from "./tls-proxy.mjs";

// Entirely synthetic fixture server: never contacts the user's Firefly instance.
let mode = "accounts";
let requests = 0;
const reportRequests = [];
const insightPaths = ["income/total", "expense/total", "expense/category", "income/category", "expense/budget", "expense/no-category", "income/no-category", "expense/no-budget"].map(path => `/api/v1/insight/${path}`);
const token = "synthetic-smoke-token-never-send-to-browser";
const longDescription = "SEPA Incasso /NAME/ Voorbeeldwinkel /REMI/ " + "Originele bankomschrijving · ".repeat(30) + "EINDE-ORIGINEEL";
const upstream = createServer((req, res) => {
  requests++;
  assert.equal(req.method, "GET");
  assert.equal(req.headers.authorization, `Bearer ${token}`);
  const url = new URL(req.url, "http://localhost");
  assert.ok(["/api/v1/accounts", "/api/v1/transactions", "/api/v1/search/transactions", "/api/v1/categories/12", "/api/v1/categories/13", "/api/v1/categories/12/transactions", "/api/v1/categories/13/transactions", "/api/v1/budgets/34", "/api/v1/budgets/34/transactions", "/api/v1/budgets/34/limits", "/api/v1/summary/basic", "/api/v1/budgets", "/api/v1/budgets/budget-fixture/limits", "/api/v1/bills", "/api/v1/recurrences", ...insightPaths].includes(url.pathname));
  res.setHeader("Content-Type", "application/json");
  if (mode === "error") { res.writeHead(401); res.end(JSON.stringify({ message: token })); return; }
  if (url.pathname === "/api/v1/summary/basic") {
    if (mode === "bill-summary-error") { res.writeHead(503); res.end('{}'); return; }
    if (mode === "bill-summary-invalid") { res.end('{}'); return; }
    const paid = { key: "bills-paid-in-EUR", currency_id: "1", currency_code: "EUR", currency_decimal_places: 2, monetary_value: mode === "empty" ? "0" : "45.50" };
    const expected = { ...paid, key: "bills-unpaid-in-EUR", monetary_value: ["empty", "bills-complete"].includes(mode) ? "0" : "-22.49" };
    if (mode === "bills-paid-schedule") { paid.monetary_value = "1172.09"; res.end(JSON.stringify({ [paid.key]: paid })); return; }
    res.end(JSON.stringify({ [paid.key]: paid, [expected.key]: expected })); return;
  }
  if (/\/categories\/\d+$/.test(url.pathname)) {
    if (mode === "detail-error") { res.writeHead(503); res.end('{}'); return; }
    res.end(JSON.stringify({ data: { type: "categories", id: url.pathname.split('/').at(-1), attributes: { name: "Food", spent: mode === "empty" ? [] : [{ currency_code: "EUR", currency_decimal_places: 2, sum: "-85.00" }], earned: [], transferred: [] } } })); return;
  }
  if (url.pathname === "/api/v1/budgets/34") {
    if (mode === "detail-error") { res.writeHead(503); res.end('{}'); return; }
    res.end(JSON.stringify({ data: { type: "budgets", id: "34", attributes: { name: "Groceries", active: true, spent: mode === "empty" ? [] : [{ currency_code: "EUR", currency_decimal_places: 2, sum: "-85.00" }] } } })); return;
  }
  if (insightPaths.includes(url.pathname)) {
    reportRequests.push(url.pathname + url.search);
    assert.match(url.searchParams.get("start"), /^\d{4}-\d{2}-01$/);
    assert.match(url.searchParams.get("end"), /^\d{4}-\d{2}-\d{2}$/);
    if ((mode === "report-error" && url.pathname.endsWith("/expense/total")) || (mode === "category-error" && url.pathname.endsWith("/expense/category"))) {
      res.writeHead(503); res.end(JSON.stringify({ message: token })); return;
    }
    const expense = url.pathname.includes("/expense/");
    const total = url.pathname.endsWith("/total");
    const grouped = url.pathname.endsWith("/category") || url.pathname.endsWith("/budget");
    if (mode === "visual") {
      const currency = { currency_id: "1", currency_code: "EUR" };
      const names = ["Boodschappen", "Wonen", "Vervoer", "Uit eten", "Kleding", "Gezondheid", "Sport", "Hobby’s", "Vakantie", "Cadeaus", "Onderwijs", "Huisdieren", "Tuin", "Verzekeringen", "Overige uitgaven"];
      const data = url.pathname.endsWith("/expense/category") ? names.map((name, i) => ({ ...currency, id: String(i), name, difference: String(-20 * (i + 1)) }))
        : url.pathname.endsWith("/expense/budget") ? ["Dagelijks", "Vaste lasten", "Vrije tijd"].map((name, i) => ({ ...currency, id: String(i), name, difference: "-800.00" }))
        : [{ ...currency, difference: expense ? total ? "-2420.50" : "-20.50" : total ? "3000.00" : grouped ? "2950.00" : "50.00", ...(grouped ? { id: "salary", name: "Salaris" } : {}) }];
      res.end(JSON.stringify(data)); return;
    }
    const data = mode === "empty" ? [] : [{ currency_id: "1", currency_code: "EUR", difference: expense ? total ? "-120.50" : grouped ? "-100.00" : "-20.50" : total ? "300.00" : grouped ? "250.00" : "50.00", ...(grouped ? { id: "group-fixture", name: url.pathname.endsWith("/budget") ? "Fixture spending budget" : expense ? "Fixture expense category" : "Fixture income category" } : {}) }];
    res.end(JSON.stringify(data)); return;
  }
  if (url.pathname === "/api/v1/bills" || url.pathname === "/api/v1/recurrences") {
    if (mode === "bill-error" && url.pathname === "/api/v1/bills") { res.writeHead(503); res.end('{}'); return; }
    let data = mode === "empty" || (mode === "no-recurrences" && url.pathname === "/api/v1/recurrences") ? [] : url.pathname === "/api/v1/bills"
      ? [{ type: "bills", id: "bill-fixture", attributes: { name: "Fixture subscription", active: true, amount_min: "19.99", amount_max: "24.99", currency_code: "EUR", currency_decimal_places: 2, repeat_freq: "monthly", skip: 0, next_expected_match: url.searchParams.get("start"), notes: "Fixture notes <script>unsafe()</script>" } }]
      : [{ type: "recurrences", id: "recurrence-fixture", attributes: { title: "Fixture recurring income", type: "deposit", active: true, repetitions: [{ description: "Monthly", occurrences: ["2099-10-01"] }], transactions: [{ description: "Fixture salary", amount: "100.00", currency_code: "EUR", currency_decimal_places: 2, source_name: "Employer", destination_name: "Checking", category_name: "Income" }] } }];
    if (mode === "visual") data = url.pathname === "/api/v1/recurrences" ? [] : [
      { type: "bills", id: "later", attributes: { name: "Sportabonnement", active: true, repeat_freq: "monthly", skip: 0, amount_min: "29.99", amount_max: "29.99", currency_code: "EUR", currency_decimal_places: 2, next_expected_match: url.searchParams.get("end"), notes: "Opzeggen kan per maand." } },
      { type: "bills", id: "soon", attributes: { name: "Internet thuis", active: true, repeat_freq: "monthly", skip: 0, amount_min: "45.50", amount_max: "45.50", currency_code: "EUR", currency_decimal_places: 2, next_expected_match: url.searchParams.get("start"), notes: "Ongewijzigde notitie <script>unsafe()</script>" } },
      { type: "bills", id: "disabled", attributes: { name: "Oud abonnement", active: false, repeat_freq: "yearly", skip: 0 } },
    ];
    if (url.pathname === "/api/v1/bills") data = data.map(item => ({ ...item, attributes: { ...item.attributes,
      paid_dates: [{ transaction_journal_id: item.id + "-paid", subscription_id: item.id, date: url.searchParams.get("start") }],
      pay_dates: mode === "bills-complete" ? [] : [url.searchParams.get("end")],
    } }));
    res.end(JSON.stringify({ data, meta: { pagination: { current_page: 1, total_pages: data.length ? 1 : 0 } } }));
    return;
  }
  if (url.pathname === "/api/v1/budgets" || url.pathname.endsWith("/limits")) {
    const data = mode === "empty" ? [] : url.pathname.endsWith("/limits")
      ? [{ type: "budget_limits", id: "limit-fixture", attributes: { budget_id: url.pathname.includes("/34/") ? "34" : "budget-fixture", currency_code: "EUR", currency_decimal_places: 2, amount: "100.00", start: url.searchParams.get("start") + "T00:00:00+02:00", end: url.searchParams.get("end") + "T23:59:59+02:00" } }]
      : [{ type: "budgets", id: "budget-fixture", attributes: { name: "Fixture monthly budget", active: true, spent: [{ currency_code: "EUR", currency_decimal_places: 2, sum: "-85.00" }] } }];
    res.end(JSON.stringify({ data, meta: { pagination: { current_page: 1, total_pages: data.length ? 1 : 0 } } }));
    return;
  }
  if (url.pathname.endsWith("/transactions")) {
    const searching = url.pathname === "/api/v1/search/transactions";
    if (mode === "search-error" && searching) { res.writeHead(503); res.end('{}'); return; }
    if (searching) {
      const query = url.searchParams.get("query");
      assert.match(query, /^date_after:\d{4}-\d{2}-01 date_before:\d{4}-\d{2}-\d{2}( transaction_type:"(?:withdrawal|deposit|transfer|reconciliation|opening balance)")?$/);
      url.searchParams.set("start", query.match(/date_after:([\d-]+)/)[1]);
    }
    const page = Number(url.searchParams.get("page"));
    const data = mode === "empty" ? [] : [{ type: "transactions", id: "group-fixture", attributes: { transactions: [{ transaction_journal_id: "journal-fixture", type: page === 2 ? "transfer" : "withdrawal", date: (url.searchParams.get("start") || "2026-09-28") + "T12:00:00+02:00", description: page === 2 ? "Savings transfer" : "Grocery purchase", amount: "29.99", currency_code: "EUR", currency_decimal_places: 2, source_name: "Everyday account", destination_name: "Shop", category_name: "Food", budget_name: "Groceries" }] } }];
    if (mode === "visual" || mode === "long-description") {
      data[0].attributes.group_title = "Gesplitste aankoop";
      data[0].attributes.transactions[0].description = longDescription;
      data[0].attributes.transactions.push({ ...data[0].attributes.transactions[0], transaction_journal_id: "split-2", description: "Tweede deel", amount: "10.00" });
      data.push({ type: "transactions", id: "income", attributes: { transactions: [{ ...data[0].attributes.transactions[0], transaction_journal_id: "income-entry", type: "deposit", description: "Salaris", amount: "3000.00" }] } });
      data.push({ type: "transactions", id: "transfer", attributes: { transactions: [{ ...data[0].attributes.transactions[0], transaction_journal_id: "transfer-entry", type: "transfer", description: "Naar spaarrekening", amount: "250.00" }] } });
    }
    for (const g of data) for (const entry of g.attributes.transactions) { entry.category_id = "12"; entry.budget_id = "34"; }
    const distant = data.length ? { type: "transactions", id: "beyond-page-one", attributes: { group_title: "Gesplitst", transactions: [
      { ...data[0].attributes.transactions[0], transaction_journal_id: "distant-1", description: "Albert Heijn pagina twee", type: "withdrawal" },
      { ...data[0].attributes.transactions[0], transaction_journal_id: "distant-2", description: "Albert Heijn ander deel", type: "withdrawal", category_id: "13", budget_id: null, budget_name: null },
    ] } } : null;
    if (page === 2 && distant && !searching) data.push(distant);
    let result = data;
    if (searching) {
      const type = url.searchParams.get("query").match(/transaction_type:"([^"]+)"/)?.[1];
      result = [...data, ...(distant ? [distant] : [])].map(g => ({ ...g, attributes: { ...g.attributes,
        transactions: g.attributes.transactions.filter(t => !type || t.type === type),
      } })).filter(g => g.attributes.transactions.length);
      if (mode === "search-pagination") result = Array.from({ length: 31 }, (_, i) => ({ type: "transactions", id: String(i + 1), attributes: {
        transactions: [{ ...data[0].attributes.transactions[0], transaction_journal_id: String(i + 1), description: `Monthly match ${i + 1}` }],
      } }));
      if (mode === "search-limit") { res.end(JSON.stringify({ data: result, meta: { pagination: { current_page: page, total_pages: 101, total: 10_001 } } })); return; }
    }
    res.end(JSON.stringify({ data: result, meta: { pagination: { current_page: page, total_pages: !result.length ? 0 : searching ? 1 : 2, total: searching ? result.reduce((n, g) => n + g.attributes.transactions.length, 0) : mode === "empty" ? 0 : 26 } } }));
    return;
  }
  const data = mode === "empty" ? [] : [
    { type: "accounts", id: "fixture-1", attributes: { type: "asset", active: true, name: "Everyday account", current_balance: "1234.560000000000", currency_code: "EUR", currency_decimal_places: 2, current_balance_date: "2026-09-28T23:59:59+02:00", notes: "synthetic-private-note", iban: "synthetic-private-iban" } },
    { type: "accounts", id: "fixture-2", attributes: { type: "asset", active: false, name: "Savings account", current_balance: "9007199254740993.12", currency_code: "EUR", currency_decimal_places: 2 } },
    { type: "accounts", id: "fixture-3", attributes: { type: "asset", active: true, name: "Unreported balance", current_balance: null, currency_code: "JPY", currency_decimal_places: 0 } },
  ];
  res.end(JSON.stringify({ data, meta: { pagination: { current_page: 1, total_pages: 1 } } }));
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const reserve = createServer();
reserve.listen(0, "127.0.0.1");
await once(reserve, "listening");
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
let child;
const baseUrl = `http://127.0.0.1:${port}`;
const proxy = await tlsProxy(port);
let auth = authFixture(proxy?.origin || `https://localhost:${port}`);
let authCookie = "";
let operationalOutput = "";
async function start(configured) {
  operationalOutput = "";
  const standalone = process.env.EMBER_STANDALONE_ROOT;
  child = spawn(process.execPath, standalone ? ["scripts/start.mjs"] : ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    ...(standalone ? { cwd: standalone } : {}),
    env: { ...process.env, ...auth.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), NEXT_TELEMETRY_DISABLED: "1", FIREFLY_BASE_URL: configured ? `http://127.0.0.1:${upstream.address().port}` : "", FIREFLY_API_TOKEN: configured ? token : "" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  child.stdout.on("data", chunk => { operationalOutput += chunk.toString(); });
  child.stderr.on("data", chunk => { operationalOutput += chunk.toString(); });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) {
      assert.ok(!operationalOutput.includes(token), "Credentials appeared in operational output");
      throw new Error(`Synthetic production server failed to start: ${operationalOutput}`);
    }
    try { const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) { await response.json(); return; } } catch {}
    await delay(100);
  }
  throw new Error("Production server startup timed out");
}
async function stop() {
  if (child && child.exitCode === null) { child.kill(); await once(child, "exit"); }
}
async function readPage(path = "/") {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Cookie: authCookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-powered-by"), null);
  const html = await response.text();
  for (const privateValue of [token, auth.password, auth.env.EMBER_AUTH_PASSWORD_HASH, auth.env.EMBER_AUTH_SECRET, auth.totpSecret, "synthetic-private-note", "synthetic-private-iban"].filter(Boolean)) assert.ok(!html.includes(privateValue));
  return html;
}
try {
  if (!process.env.EMBER_STANDALONE_ROOT) {
    await start(false);
    authCookie = cookieFrom(await signIn(baseUrl, auth));
    assert.match(await readPage(), /Verbind met Firefly III/);
    assert.equal(requests, 0);
  } else {
    await start(true);
  }
  const beforeInitialHealth = requests;
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal(requests, beforeInitialHealth);
  // Methods tested only against Ember's synthetic local server, never Firefly.
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`, { method })).status, 405);
  }
  await stop();
  auth = authFixture(proxy?.origin || `https://localhost:${port}`);
  await start(true);
  authCookie = await auditAuthentication(baseUrl, auth, () => requests);
  // Exercise the exact Docker healthcheck executable against the production process.
  const healthProcess = spawn(process.execPath, ["scripts/healthcheck.mjs"], {
    env: { ...process.env, PORT: String(port) }, stdio: "ignore", windowsHide: true,
  });
  assert.equal((await once(healthProcess, "exit"))[0], 0);
  const closedHealth = spawnSync(process.execPath, ["scripts/healthcheck.mjs"], {
    env: { ...process.env, PORT: "0" }, encoding: "utf8", windowsHide: true,
  });
  assert.equal(closedHealth.status, 1);
  assert.equal(closedHealth.stdout + closedHealth.stderr, "");
  const missingPage = await fetch(`http://127.0.0.1:${port}/does-not-exist`, { headers: { Cookie: authCookie } });
  assert.equal(missingPage.status, 404);
  assert.match(await missingPage.text(), /Pagina niet gevonden/);
  const overview = await readPage();
  const forwarded = await fetch(`http://127.0.0.1:${port}/transactions?month=2024-02`, {
    headers: { Cookie: authCookie, "X-Forwarded-Host": "finance.example.test", "X-Forwarded-Proto": "https", Host: "finance.example.test" },
  });
  assert.equal(forwarded.status, 200);
  assert.equal(forwarded.headers.get("location"), null);
  assert.match(await forwarded.text(), /februari 2024/);
  const assets = [...new Set([...overview.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map(match => match[1]))];
  assert.ok(assets.some(asset => asset.endsWith(".js")) && assets.some(asset => asset.endsWith(".css")));
  for (const asset of assets) {
    const response = await fetch(new URL(asset, `http://127.0.0.1:${port}`));
    assert.equal(response.status, 200);
    const contents = await response.text();
    for (const secret of [token, auth.password, auth.env.EMBER_AUTH_SECRET, auth.env.EMBER_AUTH_PASSWORD_HASH, auth.totpSecret].filter(Boolean)) assert.ok(!contents.includes(secret));
  }
  assert.ok(overview.includes("Recente transacties") && overview.includes("Grocery purchase"));
  assert.ok(!overview.includes("Savings account") && !overview.includes("Inactief"));
  assert.match(await readPage("/transactions?page=2"), /Savings transfer/);
  const html = await readPage("/accounts");
  for (const expected of ["Everyday account", "1.234,56", "9.007.199.254.740.993,12", "Inactief", "Niet beschikbaar"]) assert.ok(html.includes(expected), expected);
  const before = requests;
  await readPage();
  assert.equal(requests, before + 8); // Includes the authoritative monthly bill summary.
  const reportStart = reportRequests.length;
  const reports = await readPage("/reports?month=2024-02");
  for (const expected of ["februari 2024", "29-02-2024", "Totale inkomsten", "Totale uitgaven", "Netto kasstroom", "179,50", "Fixture expense category", "Fixture income category", "Fixture spending budget", "Ongecategoriseerde uitgaven", "Zonder budget", "januari 2024"]) assert.ok(reports.includes(expected), expected);
  const reportCalls = reportRequests.slice(reportStart);
  assert.equal(reportCalls.length, 10);
  assert.equal(new Set(reportCalls).size, 10);
  assert.equal(reportCalls.filter(path => path.includes("start=2024-02-01") && path.includes("end=2024-02-29")).length, 8);
  assert.ok(overview.includes("Netto kasstroom") && overview.includes("Bekijk rapporten"));
  mode = "category-error";
  const partialReport = await readPage("/reports?month=2024-02");
  assert.ok(partialReport.includes("Uitgavencategorieën: tijdelijk niet beschikbaar") && partialReport.includes("Fixture income category") && partialReport.includes("179,50"));
  mode = "report-error";
  const failedTotals = await readPage("/reports");
  assert.ok(failedTotals.includes("Totale uitgaven: tijdelijk niet beschikbaar") && failedTotals.includes("Fixture expense category"));
  const isolatedOverview = await readPage();
  for (const expected of ["Maandelijkse kasstroom: tijdelijk niet beschikbaar", "Recente transacties", "Fixture subscription"]) assert.ok(isolatedOverview.includes(expected), expected);
  assert.match(await readPage("/accounts"), /Everyday account/);
  mode = "accounts";
  const budgetsHtml = await readPage("/budgets?month=2024-02");
  for (const expected of ["februari 2024", "29-02-2024", "Fixture monthly budget", "85%", "15,00", "Bijna bereikt"]) assert.ok(budgetsHtml.includes(expected), expected);
  const monthly = await readPage("/transactions?month=2024-02&page=2");
  assert.ok(monthly.includes("februari 2024") && monthly.includes("2024-02-01"));
  const search = await readPage("/transactions?month=2024-02&q=Albert+Heijn");
  for (const expected of ["Albert Heijn pagina twee", "Albert Heijn ander deel", "Deeltransactie", "/categories/12?month=2024-02", "/budgets/34?month=2024-02"]) assert.ok(search.includes(expected), expected);
  assert.ok(search.includes("gevonden transacties in deze maand"));
  for (const query of ["uitgaven", "Everyday account", "Shop", "Food", "Groceries", "29,99", "01-02-2024"]) {
    const tableSearch = await readPage(`/transactions?month=2024-02&q=${encodeURIComponent(query)}`);
    assert.ok(tableSearch.includes("Grocery purchase"), query);
    assert.ok(tableSearch.includes("gevonden transacties in deze maand"));
  }
  assert.ok((await readPage("/transactions?month=2024-02&q=unknown-search")).includes("Geen transacties"));
  mode = "search-pagination";
  const firstResults = await readPage("/transactions?month=2024-02&q=Monthly+match");
  const secondResults = await readPage("/transactions?month=2024-02&q=Monthly+match&page=2");
  assert.equal((firstResults.match(/<time dateTime=/g) || firstResults.match(/<time datetime=/g) || []).length, 25);
  assert.equal((secondResults.match(/<time dateTime=/g) || secondResults.match(/<time datetime=/g) || []).length, 6);
  assert.ok(firstResults.includes("q=Monthly+match&amp;page=2"));
  assert.ok(secondResults.includes("Monthly match 6") && !secondResults.includes("Monthly match 31"));
  mode = "search-limit";
  assert.ok((await readPage("/transactions?month=2024-02&q=Albert")).includes("Zoekopdracht te groot"));
  mode = "search-error";
  assert.ok((await readPage("/transactions?month=2024-02&q=Albert")).includes("Gegevens niet beschikbaar"));
  mode = "accounts";
  const category = await readPage("/categories/12?month=2024-02");
  for (const expected of ["Totaal uitgegeven", "85,00", "Grocery purchase", "februari 2024", "/categories/12?month=2024-01"]) assert.ok(category.includes(expected), expected);
  const budgetDetail = await readPage("/budgets/34?month=2024-02");
  for (const expected of ["Groceries", "85%", "15,00", "Grocery purchase", "/budgets/34?month=2024-01"]) assert.ok(budgetDetail.includes(expected), expected);
  mode = "bills-complete";
  assert.ok((await readPage("/?month=2024-02")).includes("Niets meer te verwachten deze maand"));
  mode = "bills-paid-schedule";
  const completedSeptember = await readPage("/?month=2026-09");
  assert.ok(completedSeptember.includes("Niets meer te verwachten deze maand"));
  assert.ok(completedSeptember.includes("1.172,09"));
  assert.ok(completedSeptember.includes("gekoppelde deeltransacties"));
  assert.ok(!completedSeptember.includes('class="bill-upcoming"'));
  for (const failure of ["bill-summary-error", "bill-summary-invalid"]) {
    mode = failure;
    const unavailable = await readPage("/?month=2026-09");
    assert.ok(unavailable.includes("Betaalstatus tijdelijk niet beschikbaar"));
    assert.ok(!unavailable.includes("Niets meer te verwachten deze maand"));
    assert.ok(!unavailable.includes("Nog te verwachten deze maand"));
    assert.ok(!unavailable.includes('class="bill-upcoming"'));
  }
  mode = "accounts";
  const subscriptions = await readPage("/subscriptions");
  for (const expected of ["Fixture subscription", "19,99", "24,99", "Terugkerende inkomsten", "Fixture salary", "Ember Finance"]) assert.ok(subscriptions.includes(expected), expected);
  assert.ok(!subscriptions.includes("<script>unsafe()"));
  mode = "no-recurrences";
  const noRecurrences = await readPage("/subscriptions");
  assert.ok(noRecurrences.includes("Geen terugkerende transacties ingesteld."));
  assert.ok(!noRecurrences.includes('class="recurrences-section"'));
  mode = "long-description";
  const expanded = await readPage("/transactions?month=2024-02");
  for (const expected of ["Volledige omschrijving", "EINDE-ORIGINEEL", "Deeltransactie", "Overschrijving", "Inkomsten", "29,99", "3.000,00"]) assert.ok(expanded.includes(expected), expected);
  if (process.env.EMBER_BROWSER_MODULE) {
    const { browserChecks } = await import("./browser-checks.mjs");
    authCookie = await browserChecks({ baseUrl: proxy?.origin || baseUrl, setMode: value => { mode = value; }, token, longDescription, auth, authCookie });
  }
  mode = "bill-error";
  const isolated = await readPage("/subscriptions");
  assert.ok(isolated.includes("Gegevens niet beschikbaar") && isolated.includes("Fixture salary"));
  assert.ok((await readPage()).includes("Recente transacties"));
  mode = "empty";
  assert.match(await readPage("/accounts"), /Nog geen rekeningen/);
  assert.match(await readPage("/transactions"), /Geen transacties/);
  assert.match(await readPage("/budgets"), /Nog geen budgetten/);
  assert.match(await readPage("/subscriptions"), /Nog geen abonnementen/);
  const emptyReports = await readPage("/reports");
  assert.match(emptyReports, /Geen inkomsten of uitgaven in deze maand/);
  assert.ok(!emptyReports.includes('class="report-grid"'));
  mode = "error";
  assert.match(await readPage(), /Firefly III weigert toegang/);
  const beforeHealth = requests;
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/api/health`)).json(), { status: "ok" });
  assert.equal(requests, beforeHealth);
  for (const secret of [token, auth.password, auth.env.EMBER_AUTH_SECRET, auth.env.EMBER_AUTH_PASSWORD_HASH, auth.totpSecret].filter(Boolean)) assert.ok(!operationalOutput.includes(secret), "Credentials appeared in operational output");
  for (let attempt = 0; attempt < 10; attempt++) await signIn(baseUrl, auth, { password: "wrong" });
  const throttled = await signIn(baseUrl, auth);
  assert.equal(cookieFrom(throttled), "");
  assert.equal(throttled.headers.get("location"), "/login?error=1");
  console.log("Production smoke passed: configuration, real HTTP GET integration with synthetic fixtures, precision, fresh reads, empty/error states, no-store and credential/private-field exclusion.");
} finally {
  await stop();
  await proxy?.close();
  upstream.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
}



