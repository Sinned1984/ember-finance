import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "otplib";

// Optional browser QA against the synthetic smoke server. No runtime dependency.
export async function browserChecks({ baseUrl, setMode, token, longDescription, auth, authCookie }) {
  // The HTTP audit just used a next-step TOTP code. Do not reuse its accepted step.
  const freshTotpAfter = Date.now() + 30_000;
  const { chromium } = await import(process.env.EMBER_BROWSER_MODULE);
  const browser = await chromium.launch({ headless: true, ...(process.env.EMBER_BROWSER_CHANNEL ? { channel: process.env.EMBER_BROWSER_CHANNEL } : {}) });
  const screenshots = process.env.EMBER_SCREENSHOT_DIR || join(tmpdir(), "ember-3a-review");
  await mkdir(screenshots, { recursive: true });
  let refreshedCookie = authCookie;
  try {
    const page = await browser.newPage({ locale: "nl-NL", ignoreHTTPSErrors: true });
    await page.context().addCookies([{ name: "__Host-ember-session", value: authCookie.slice(authCookie.indexOf("=") + 1), domain: new URL(baseUrl).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error" && /content security policy|violates.*directive/i.test(message.text())) errors.push("CSP browser violation");
    });
    page.on("request", request => {
      assert.ok(!Object.values(request.headers()).some(value => value.includes(token)));
      assert.equal(new URL(request.url()).hostname, new URL(baseUrl).hostname);
    });
    setMode("visual");
    const pages = [["/", "Overzicht"], ["/accounts", "Rekeningen"], ["/transactions?month=2026-09", "Transacties"], ["/budgets?month=2026-09", "Budgetten"], ["/subscriptions", "Abonnementen"], ["/reports?month=2026-09", "Rapporten"]];
    for (const [size, width, height] of [["desktop",1440,1000], ["large",1920,1080], ["tablet",820,1180], ["mobile",390,844]]) {
      await page.setViewportSize({ width, height });
      for (const [path, title] of pages) {
        await page.goto(baseUrl + path);
        await page.getByRole("heading", { level: 1, name: title, exact: true }).waitFor();
        assert.equal(await page.locator("html").getAttribute("lang"), "nl-NL");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${title} overflow at ${width}`);
        assert.equal(await page.locator('nav[aria-label="Hoofdnavigatie"] [aria-current="page"]').innerText(), title);
        assert.ok(!(await page.locator("body").innerText()).match(/\b(Refresh|Previous|Overview|Total income|Unavailable|Soon)\b/));
        if (path.startsWith("/reports") && width >= 1440) {
          const expense = await page.locator(".report-grid > .report-panel").boundingBox();
          const income = await page.locator(".report-stack > section").first().boundingBox();
          const budget = await page.locator(".report-stack > section").last().boundingBox();
          assert.ok(income.height < expense.height);
          assert.ok(budget.y < expense.y + expense.height, "Budget card should fill the space below income");
        }
        if (path === "/subscriptions") {
          assert.match(await page.locator("tbody tr").first().innerText(), /Internet thuis/);
          assert.equal(await page.locator(".recurrences-section").count(), 0);
        }
        await page.screenshot({ path: join(screenshots, `${size}-${title}.png`), fullPage: true });
      }
    }
    // Profile settings remain usable as a focused split-pane dialog and mobile sheet.
    for (const [size, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(baseUrl + "/");
      await page.getByRole("heading", { level: 1, name: "Overzicht", exact: true }).waitFor();
      await page.locator(".workspace-label").click();
      const dialog = page.getByRole("dialog", { name: "Profielinstellingen" });
      await dialog.waitFor();
      assert.equal(await dialog.getByRole("tab", { name: "Profiel" }).getAttribute("aria-selected"), "true");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Profile dialog overflow at ${width}`);
      await page.screenshot({ path: join(screenshots, `${size}-Profielinstellingen.png`), fullPage: true });
      await dialog.getByRole("tab", { name: "Beveiliging" }).click();
      await dialog.getByRole("heading", { name: "Twee-factor-authenticatie" }).waitFor();
      assert.equal(await dialog.getByRole("tab", { name: "Beveiliging" }).getAttribute("aria-selected"), "true");
      await page.screenshot({ path: join(screenshots, `${size}-Beveiliging.png`), fullPage: true });
      await dialog.getByRole("button", { name: "Profielinstellingen sluiten" }).click();
      assert.equal(await dialog.count(), 0);
    }
    // Keyboard disclosure and whole-month table search use the full original description.
    await page.goto(baseUrl + "/transactions?month=2026-09");
    const details = page.locator(".transaction-details").first();
    await details.locator("summary").focus();
    assert.notEqual(await details.locator("summary").evaluate(el => getComputedStyle(el).outlineStyle), "none");
    await page.keyboard.press("Enter");
    assert.equal(await details.getAttribute("open"), "");
    assert.equal(await details.locator("p").innerText(), longDescription);
    await page.keyboard.press("Enter");
    assert.equal(await details.getAttribute("open"), null);
    await page.getByLabel("Zoeken in deze maand").fill("EINDE-ORIGINEEL");
    await page.getByRole("button", { name: "Zoeken", exact: true }).click();
    await page.waitForURL("**/transactions?month=2026-09&q=EINDE-ORIGINEEL");
    assert.equal(await page.locator("tbody tr").count(), 1);
    await page.getByRole("link", { name: "Zoekopdracht wissen" }).click();
    await page.waitForURL("**/transactions?month=2026-09");
    assert.equal(await page.locator("tbody tr").count(), 4);
    assert.match(await page.locator("td.transaction-withdrawal").first().innerText(), /€\s*−29,99/);
    assert.match(await page.locator("td.transaction-deposit").first().innerText(), /€\s*\+3\.000,00/);
    await page.getByRole("navigation", { name: "Transactiepagina’s" }).getByRole("link", { name: "Volgende", exact: true }).click();
    await page.waitForURL("**/transactions?month=2026-09&page=2");
    // New searches from a later normal page start on search page one, across the whole month.
    await page.getByLabel("Zoeken in deze maand").fill("Albert Heijn");
    await page.getByRole("button", { name: "Zoeken", exact: true }).click();
    await page.waitForURL("**/transactions?month=2026-09&q=Albert+Heijn");
    assert.equal(await page.locator("tbody tr").count(), 2);
    assert.ok((await page.locator("tbody").innerText()).includes("Albert Heijn pagina twee"));
    assert.ok((await page.getByRole("navigation", { name: "Transactiepagina’s" }).innerText()).includes("2 gevonden transacties in deze maand"));
    await page.getByRole("link", { name: "Vorige maand", exact: true }).click();
    await page.waitForURL("**/transactions?month=2026-08&q=Albert+Heijn");
    assert.ok((await page.locator("tbody time").first().getAttribute("datetime")).startsWith("2026-08"));
    await page.getByRole("link", { name: "Zoekopdracht wissen" }).click();
    await page.waitForURL("**/transactions?month=2026-08");
    for (const [query, count] of [["UITGAVEN", 4], ["inkomsten", 1], ["overschrijving", 1], ["Everyday account", 6],
      ["Shop", 6], ["Food", 6], ["Groceries", 5], ["29,99", 3], ["01-08-2026", 6]]) {
      await page.getByLabel("Zoeken in deze maand").fill(query);
      await page.getByRole("button", { name: "Zoeken", exact: true }).click();
      await page.waitForURL(url => url.searchParams.get("q") === query);
      assert.equal(await page.locator("tbody tr").count(), count, query);
    }
    for (const [size, width] of [["desktop", 1440], ["mobile", 390]]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(baseUrl + "/transactions?month=2026-09&q=uitgaven");
      await page.getByRole("heading", { level: 1, name: "Transacties", exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(screenshots, `search-${size}.png`), fullPage: true });
    }
    setMode("search-pagination");
    await page.goto(baseUrl + "/transactions?month=2026-09&q=Monthly+match");
    assert.equal(await page.locator("tbody tr").count(), 25);
    await page.getByRole("navigation", { name: "Transactiepagina’s" }).getByRole("link", { name: "Volgende", exact: true }).click();
    await page.waitForURL("**/transactions?month=2026-09&q=Monthly+match&page=2");
    assert.equal(await page.locator("tbody tr").count(), 6);
    await page.getByRole("link", { name: "Vorige maand", exact: true }).click();
    await page.waitForURL("**/transactions?month=2026-08&q=Monthly+match");
    assert.equal(await page.locator("tbody tr").count(), 25);
    setMode("search-limit");
    await page.goto(baseUrl + "/transactions?month=2026-09&q=Albert");
    await page.getByRole("heading", { name: "Zoekopdracht te groot" }).waitFor();
    assert.equal(await page.locator("tbody tr").count(), 0);
    setMode("visual");
    for (const [kind, name, id] of [["categories", "Food", "12"], ["budgets", "Groceries", "34"]]) {
      await page.goto(baseUrl + "/transactions?month=2026-08");
      await page.locator("tbody").getByRole("link", { name, exact: true }).first().click();
      await page.waitForURL(`**/${kind}/${id}?month=2026-08`);
      await page.getByRole("heading", { level: 1, name, exact: true }).waitFor();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: join(screenshots, `3c-${kind}-${width}.png`), fullPage: true });
      }
      await page.getByRole("link", { name: "Vorige maand", exact: true }).click();
      await page.waitForURL(`**/${kind}/${id}?month=2026-07`);
      await page.getByRole("heading", { level: 1, name, exact: true }).waitFor();
      await page.getByLabel("Kies een maand").fill("2024-02");
      await page.getByRole("button", { name: "Tonen", exact: true }).click();
      await page.waitForURL(`**/${kind}/${id}?month=2024-02`);
      await page.getByRole("navigation", { name: "Transactiepagina’s" }).getByRole("link", { name: "Volgende", exact: true }).click();
      await page.waitForURL(`**/${kind}/${id}?month=2024-02&page=2`);
    }
    await page.goto(baseUrl + "/?month=2026-08");
    await page.getByRole("link", { name: "Volgende maand", exact: true }).click();
    await page.waitForURL("**/?month=2026-09");
    await page.locator(".subscription-summary").getByText(/september 2026/i).waitFor();
    assert.ok((await page.locator(".subscription-summary").innerText()).includes("september 2026"));
    setMode("bills-complete");
    await page.goto(baseUrl + "/?month=2026-09");
    await page.getByRole("heading", { name: "Niets meer te verwachten deze maand" }).waitFor();
    setMode("bill-summary-error");
    await page.reload();
    await page.getByRole("status").filter({ hasText: "Maandbedragen zijn tijdelijk niet beschikbaar" }).waitFor();
    assert.ok(!(await page.locator(".subscription-summary").innerText()).includes("Fixture subscription"));
    assert.equal(await page.locator(".subscription-summary .bill-upcoming").count(), 0);
    setMode("search-error");
    await page.goto(baseUrl + "/transactions?month=2026-08&q=shop");
    await page.getByRole("heading", { name: "Gegevens niet beschikbaar" }).waitFor();
    setMode("detail-error");
    await page.goto(baseUrl + "/categories/12?month=2026-08");
    await page.getByRole("heading", { name: "Gegevens niet beschikbaar" }).waitFor();
    assert.ok(await page.locator("tbody tr").count() > 0);
    setMode("empty");
    for (const path of ["/categories/12?month=2026-08", "/budgets/34?month=2026-08"]) {
      await page.goto(baseUrl + path);
      await page.getByRole("heading", { name: "Geen transacties", exact: true }).waitFor();
    }
    setMode("visual");
    for (const route of ["transactions", "budgets", "reports"]) {
      await page.goto(`${baseUrl}/${route}?month=2026-12`);
      await page.getByRole("link", { name: "Volgende maand", exact: true }).click();
      await page.waitForURL(`**/${route}?month=2027-01`);
      await page.getByRole("heading", { name: "januari 2027", exact: true }).waitFor();
      await page.getByRole("link", { name: "Vorige maand", exact: true }).click();
      await page.waitForURL(`**/${route}?month=2026-12`);
      await page.getByLabel("Kies een maand").fill("2024-02");
      await page.getByRole("button", { name: "Tonen", exact: true }).click();
      await page.waitForURL(`**/${route}?month=2024-02`);
      await page.getByRole("heading", { name: "februari 2024", exact: true }).waitFor();
    }
    await page.getByText("Over deze cijfers", { exact: true }).click();
    assert.equal(await page.locator(".info-details").getAttribute("open"), "");
    await page.goto(baseUrl + "/subscriptions");
    await page.getByText("Notities", { exact: true }).first().click();
    assert.ok((await page.locator(".subscription-notes p").first().innerText()).includes("<script>unsafe()</script>"));
    // Wide tables remain locally scrollable and keyboard reachable on mobile.
    const table = page.locator(".table-scroll");
    await table.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector(".table-scroll").scrollLeft > 0);
    await page.goto(baseUrl + "/does-not-exist");
    await page.getByRole("heading", { name: "Pagina niet gevonden" }).waitFor();
    setMode("empty");
    for (const [path] of pages) {
      await page.goto(baseUrl + path);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.screenshot({ path: join(screenshots, "mobile-empty-reports.png"), fullPage: true });
    setMode("report-error");
    await page.goto(baseUrl + "/reports");
    await page.getByRole("status").filter({ hasText: "Totale uitgaven: tijdelijk niet beschikbaar" }).waitFor();
    await page.screenshot({ path: join(screenshots, "mobile-partial-report.png"), fullPage: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(baseUrl + "/login");
      await page.getByRole("heading", { level: 1, name: "Welkom terug.", exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(screenshots, `login-${width}.png`), fullPage: true });
    }
    if (baseUrl.startsWith("https:")) {
      // Real form submissions and Secure cookies over TLS; proxy does no authentication.
      await page.goto(baseUrl + "/reports");
      const copiedCookie = (await page.context().cookies()).find(cookie => cookie.name === "__Host-ember-session");
      assert.ok(copiedCookie?.httpOnly && copiedCookie.secure && copiedCookie.sameSite === "Lax");
      await page.getByRole("button", { name: "Uitloggen", exact: true }).click();
      await page.waitForURL("**/login");
      assert.equal((await page.context().cookies()).some(cookie => cookie.name === "__Host-ember-session"), false);
      await page.goto(baseUrl + "/reports");
      await page.waitForURL("**/login");
      await page.getByLabel("Gebruikersnaam", { exact: true }).fill(auth.env.EMBER_AUTH_USERNAME);
      await page.getByLabel("Wachtwoord", { exact: true }).fill("incorrect");
      await page.getByRole("button", { name: "Inloggen", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Inloggen mislukt. Controleer je gegevens." }).waitFor();
      await page.getByLabel("Gebruikersnaam", { exact: true }).fill(auth.env.EMBER_AUTH_USERNAME);
      await page.getByLabel("Wachtwoord", { exact: true }).fill(auth.password);
      await page.getByRole("button", { name: "Inloggen", exact: true }).click();
      await page.waitForURL("**/login/2fa");
      await page.getByRole("heading", { level: 1, name: "Nog één stap.", exact: true }).waitFor();
      assert.equal((await page.locator(".login-card .brand").innerText()).replaceAll(/\s/g, ""), "eEmberFINANCE");
      assert.equal(await page.locator('[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay').count(), 0);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: join(screenshots, `login-2fa-${width}.png`), fullPage: true });
      }
      if (Date.now() < freshTotpAfter) await page.waitForTimeout(freshTotpAfter - Date.now());
      const code = await generate({ secret: auth.totpSecret, epoch: Math.floor((Date.now() + 30_000) / 1000) });
      await page.getByLabel("Verificatiecode", { exact: true }).fill(code);
      await page.getByRole("button", { name: "Verifiëren", exact: true }).click();
      await page.waitForURL(baseUrl + "/");
      await page.getByRole("heading", { level: 1, name: "Overzicht", exact: true }).waitFor();
      assert.ok(!(await page.evaluate(() => document.cookie)).includes("ember-session"));
      const renewed = (await page.context().cookies()).find(cookie => cookie.name === "__Host-ember-session");
      assert.ok(renewed?.httpOnly && renewed.secure && renewed.sameSite === "Lax");
      refreshedCookie = `${renewed.name}=${renewed.value}`;
      console.log("HTTPS authentication browser checks passed: TLS-only proxy, desktop/mobile two-step login, generic failure, Secure/HttpOnly session, logout and history denial.");
    } else console.log("HTTPS login/logout browser checks skipped: configure EMBER_TEST_TLS_CERT and EMBER_TEST_TLS_KEY for a local TLS proxy.");
    assert.deepEqual(errors, []);
    console.log("Browser passed: all six pages at 390/820/1440/1920px, disclosures, full-text filtering, signs, pagination, periods, sorting, empty/error states, no overflow or credential headers.");
    console.log(`Synthetic visual review screenshots: ${screenshots}`);
  } finally { await browser.close(); }
  return refreshedCookie;
}
