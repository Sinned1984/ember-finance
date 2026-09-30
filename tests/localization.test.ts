import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCurrency, formatDate, formatMonth, formatPercentage, comparisonText } from "../src/lib/format.ts";
import { budgetNote, descriptionPreview, sortedSubscriptions, subscriptionFrequency } from "../src/lib/presentation.ts";
import { parseSubscriptions } from "../src/lib/firefly/subscriptions.ts";

const spaces = (value: string) => value.replace(/\u00a0/g, " ");
test("Dutch EUR display preserves positive, negative, zero and all significant decimal digits", () => {
  assert.equal(spaces(formatCurrency("4396.41", "EUR")), "€ 4.396,41");
  assert.equal(spaces(formatCurrency("3650.0700000000", "EUR", 2)), "€ 3.650,07");
  assert.equal(spaces(formatCurrency("-78.53", "EUR")), "€ −78,53");
  assert.equal(spaces(formatCurrency("78.53", "EUR", 2, true)), "€ +78,53");
  assert.equal(spaces(formatCurrency("0", "EUR")), "€ 0,00");
  assert.equal(spaces(formatCurrency("9007199254740993.12345678901234567890123456789", "EUR", 2)), "€ 9.007.199.254.740.993,12345678901234567890123456789");
});
test("non-EUR currency scales, custom currencies and missing amounts remain explicit", () => {
  assert.equal(spaces(formatCurrency("1234.5", "USD")), "US$ 1.234,50");
  assert.equal(spaces(formatCurrency("1234", "JPY")), "JP¥ 1.234");
  assert.equal(spaces(formatCurrency("1234.567", "KWD")), "KWD 1.234,567");
  assert.equal(spaces(formatCurrency("1.00000001", "BTC", 8)), "BTC 1,00000001");
  assert.equal(formatCurrency("12.34", null), "12,34 (valuta onbekend)");
  assert.equal(formatCurrency(null, "EUR"), "Niet beschikbaar");
  assert.equal(formatCurrency("12.3", "CUSTOM", 4), "CUSTOM 12,3000");
});
test("Dutch dates preserve the source calendar day across time zones and leap years", () => {
  assert.equal(formatDate("2026-09-28T23:59:00-10:00"), "28-09-2026");
  assert.equal(formatDate("2026-09-28", "long"), "28 september 2026");
  assert.equal(formatDate("2024-02-29"), "29-02-2024");
  assert.equal(formatDate("2026-02-29"), "Niet beschikbaar");
  assert.equal(formatDate(null), "Niet beschikbaar");
  assert.equal(formatMonth("2026-09"), "september 2026");
  assert.equal(formatMonth("2027-01"), "januari 2027");
});
test("Dutch percentage labels do not change budget calculations", () => {
  assert.equal(formatPercentage("85.0"), "85%");
  assert.equal(formatPercentage("100.1"), "100,1%");
  assert.equal(formatPercentage("0.01"), "0,01%");
  assert.equal(formatPercentage(null), "Niet beschikbaar");
});
test("comparison wording correctly distinguishes higher, lower, equal and unavailable", () => {
  assert.equal(spaces(comparisonText("356.29", "EUR", "augustus 2026")), "€ 356,29 hoger dan augustus 2026");
  assert.equal(spaces(comparisonText("-356.29", "EUR", "augustus 2026")), "€ 356,29 lager dan augustus 2026");
  assert.equal(comparisonText("-0.000", "EUR", "augustus 2026"), "Gelijk aan augustus 2026");
  assert.equal(comparisonText(null, "USD", "augustus 2026"), "Vergelijking niet beschikbaar");
});
test("long descriptions are abbreviated without rewriting or splitting Unicode characters", () => {
  const short = "SEPA /IBAN/ synthetic /NAME/ Winkel";
  assert.equal(descriptionPreview(short), short);
  const long = short + " 🛒".repeat(100) + " original-ending";
  const preview = descriptionPreview(long);
  assert.equal(preview, Array.from(long).slice(0, 100).join("") + "…");
  assert.ok(long.endsWith(" original-ending"));
  assert.equal(descriptionPreview("Bank\nOriginele omschrijving"), "Bank\nOriginele omschrijving");
});
function bills() {
  return parseSubscriptions({ data: [
    { id: "later", type: "bills", attributes: { name: "Monthly user name", active: true, repeat_freq: "monthly", skip: 0, next_expected_match: "2026-11-01", notes: "Do not translate Income" } },
    { id: "unknown", type: "bills", attributes: { name: "Unknown", active: true } },
    { id: "soon", type: "bills", attributes: { name: "Soon", active: true, repeat_freq: "quarterly", skip: 1, next_expected_match: "2026-10-01" } },
    { id: "inactive", type: "bills", attributes: { name: "Inactive", active: false, next_expected_match: "2026-09-29" } },
  ], meta: { pagination: { current_page: 1, total_pages: 1 } } }, "bill", 1, "2026-09-29").subscriptions;
}
test("subscription display sorting uses existing expected dates without mutating data", () => {
  const items = bills(), before = JSON.stringify(items);
  assert.deepEqual(sortedSubscriptions(items).map(item => item.id), ["soon", "later", "unknown", "inactive"]);
  assert.equal(JSON.stringify(items), before);
  assert.deepEqual(sortedSubscriptions([]), []);
});
test("only Ember-generated frequency and budget labels are translated", () => {
  const items = bills();
  assert.equal(subscriptionFrequency(items[0]), "Maandelijks");
  assert.equal(subscriptionFrequency(items[2]), "Per kwartaal · 1 keer overslaan tussen betalingen");
  assert.equal(items[0].name, "Monthly user name");
  assert.equal(items[0].notes, "Do not translate Income");
  assert.equal(subscriptionFrequency({ ...items[0], model: "recurrence", frequency: "Every Monday (supplied by Firefly)" }), "Every Monday (supplied by Firefly)");
  assert.equal(subscriptionFrequency(items[1]), "Niet beschikbaar");
  assert.equal(budgetNote("No limit set for this currency and month."), "Geen budgetbedrag ingesteld voor deze valuta en maand.");
});
