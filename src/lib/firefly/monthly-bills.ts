import "server-only";
import { budgetPeriod, type BudgetPeriod } from "../budget-period.ts";
import { FireflyError, getFireflyJson } from "./client.ts";
import { parseSubscriptions } from "./subscriptions.ts";
import type { Subscription } from "./subscription-types.ts";

function invalid(): never { throw new FireflyError("Firefly returned incomplete monthly subscription data."); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function day(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)) return invalid();
  const date = value.slice(0, 10), parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || !Number.isFinite(Date.parse(value))) return invalid();
  return date;
}
export type MonthlyBill = { item: Subscription; matched: number | null; expected: string[] | null };
export type BillTotal = { kind: "paid" | "expected"; currency: string; currencyId: string; decimals: number; amount: string };

export function parseMonthlyBills(value: unknown, page: number, period: BudgetPeriod) {
  const parsed = parseSubscriptions(value, "bill", page, period.start);
  const raw = object(value).data as unknown[];
  const journals = new Set<string>();
  const bills = parsed.subscriptions.map((item, index): MonthlyBill => {
    const a = object(object(raw[index]).attributes);
    let matched: number | null = null, expected: string[] | null = null;
    if (a.paid_dates != null) {
      if (!Array.isArray(a.paid_dates)) return invalid();
      matched = a.paid_dates.length;
      for (const value of a.paid_dates) {
        const match = object(value), date = day(match.date);
        if (typeof match.transaction_journal_id !== "string" || !match.transaction_journal_id || journals.has(match.transaction_journal_id) || match.subscription_id !== item.id || date < period.start || date > period.end) return invalid();
        journals.add(match.transaction_journal_id);
      }
    }
    if (a.pay_dates != null) {
      if (!Array.isArray(a.pay_dates)) return invalid();
      // Firefly can include its first next date OUTSIDE the requested range. Bound presentation.
      // Scheduled dates can remain after an early matched payment; they are not unpaid status.
      expected = [...new Set(a.pay_dates.map(day))].filter(date => date >= period.start && date <= period.end && (!item.endDate || date <= item.endDate)).sort();
    }
    return { item, matched, expected: item.active === false ? [] : expected };
  });
  return { bills, pages: parsed.pages };
}

export function parseBillTotals(value: unknown): BillTotal[] {
  const root = object(value), rows: BillTotal[] = [], seen = new Set<string>();
  for (const [key, value] of Object.entries(root)) {
    if (!/^bills-(paid|unpaid)-in-/.test(key)) continue;
    const a = object(value), kind = key.startsWith("bills-paid-") ? "paid" : "expected";
    if (typeof a.currency_id !== "string" || !a.currency_id || typeof a.currency_code !== "string" || !a.currency_code || key !== `bills-${kind === "paid" ? "paid" : "unpaid"}-in-${a.currency_code}` || a.key !== key || typeof a.currency_decimal_places !== "number" || !Number.isInteger(a.currency_decimal_places) || a.currency_decimal_places < 0 || a.currency_decimal_places > 30 || typeof a.monetary_value !== "string" || !/^-?\d+(\.\d+)?$/.test(a.monetary_value)) return invalid();
    const identity = `${kind}:${a.currency_id}`;
    if (seen.has(identity)) return invalid();
    seen.add(identity);
    // Firefly's unpaid summary is a negative outflow estimate. Normalize only its sign.
    rows.push({ kind, currencyId: a.currency_id, currency: a.currency_code, decimals: a.currency_decimal_places, amount: kind === "expected" ? a.monetary_value.replace(/^-/, "") : a.monetary_value });
  }
  if (!rows.length) return invalid();
  return rows;
}

export function monthlyBillState(bills: MonthlyBill[] | null, totals: BillTotal[] | null) {
  const active = bills?.filter(b => b.item.active === true) ?? [];
  const complete = bills !== null && bills.every(b => b.item.active !== null && (b.item.active === false || (b.matched !== null && b.expected !== null)));
  // Only a successfully parsed summary establishes monthly status. Missing unpaid entries
  // in that summary mean no outstanding estimate; schedules must never override it.
  const status = !totals?.length ? "unavailable" : totals.some(t => t.kind === "expected" && !/^0+(\.0+)?$/.test(t.amount)) ? "outstanding" : "paid";
  const upcoming = status === "outstanding" ? active.flatMap(b => (b.expected ?? []).map(date => ({ item: b.item, date }))).sort((a, b) => a.date.localeCompare(b.date)) : [];
  return { active, upcoming, complete, status, nothingExpected: status === "paid",
    matched: complete ? active.reduce((count, b) => count + b.matched!, 0) : null };
}

export async function getMonthlyBills(period: BudgetPeriod) {
  const verified = budgetPeriod(period.month);
  if (verified.month !== period.month || verified.start !== period.start || verified.end !== period.end) return invalid();
  const query = { start: period.start, end: period.end };
  const [list, summary] = await Promise.allSettled([
    (async () => {
      const bills: MonthlyBill[] = [], ids = new Set<string>(), signal = AbortSignal.timeout(15_000);
      let pages = 1;
      for (let page = 1; page <= pages; page++) {
        const parsed = parseMonthlyBills(await getFireflyJson("api/v1/bills", { ...query, page: String(page), limit: "50" }, signal, "subscription"), page, period);
        if (page > 1 && pages !== parsed.pages) return invalid();
        pages = parsed.pages;
        for (const bill of parsed.bills) { if (ids.has(bill.item.id)) return invalid(); ids.add(bill.item.id); bills.push(bill); }
      }
      return bills;
    })(),
    getFireflyJson("api/v1/summary/basic", query, AbortSignal.timeout(15_000), "subscription").then(parseBillTotals),
  ]);
  return { bills: list.status === "fulfilled" ? list.value : null, totals: summary.status === "fulfilled" ? summary.value : null };
}
