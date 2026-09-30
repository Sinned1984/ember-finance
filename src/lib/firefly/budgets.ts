import "server-only";
import { readConfig } from "../env.ts";
import { budgetUsage, negateDecimal } from "../budget-math.ts";
import type { BudgetPeriod } from "../budget-period.ts";
import { FireflyError } from "./client.ts";

type Spending = { currency: string; decimals: number; sum: string };
type Budget = { id: string; name: string; active: boolean; spent: Spending[] | null };
type Limit = { id: string; currency: string; decimals: number; amount: string | null; start: string; end: string };
export type BudgetRow = { id: string; name: string; active: boolean; currency: string | null; decimals: number | null; limit: string | null; spent: string | null; usage: ReturnType<typeof budgetUsage> | null; note: string | null; limits: Limit[] };
function invalid(): never { throw new FireflyError("Firefly returned an unsupported budget response."); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function string(value: unknown) { if (typeof value !== "string" || !value) return invalid(); return value; }
function amount(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value)) return invalid();
  return value;
}
function decimals(value: unknown) { if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 30) return invalid(); return value; }
function envelope(value: unknown, page: number) {
  const root = object(value), pagination = object(object(root.meta).pagination);
  const pages = pagination.total_pages;
  if (!Array.isArray(root.data) || pagination.current_page !== page || typeof pages !== "number" || !Number.isInteger(pages) || pages < 0 || pages > 100 || (root.data.length > 0 && page > pages)) return invalid();
  return { data: root.data, pages };
}
export function parseBudgets(value: unknown, page: number) {
  const result = envelope(value, page);
  const budgets = result.data.map((entry): Budget => {
    const row = object(entry), a = object(row.attributes);
    if (row.type !== "budgets" || typeof a.active !== "boolean") return invalid();
    let spent: Spending[] | null = null;
    if (a.spent != null) {
      if (!Array.isArray(a.spent)) return invalid();
      const currencies = new Set<string>();
      spent = a.spent.map(value => {
        const s = object(value), currency = string(s.currency_code), sum = amount(s.sum);
        if (sum === null || currencies.has(currency)) return invalid();
        currencies.add(currency);
        return { currency, decimals: decimals(s.currency_decimal_places), sum };
      });
    }
    return { id: string(row.id), name: string(a.name), active: a.active, spent };
  });
  return { budgets, pages: result.pages };
}
export function parseBudgetLimits(value: unknown, budgetId: string, page = 1) {
  const result = envelope(value, page);
  const limits = result.data.map((entry): Limit => {
    const row = object(entry), a = object(row.attributes);
    if (row.type !== "budget_limits" || a.budget_id !== budgetId) return invalid();
    const start = string(a.start), end = string(a.end);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(start) || !/^\d{4}-\d{2}-\d{2}T/.test(end) || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || start.slice(0, 10) > end.slice(0, 10)) return invalid();
    const limit = amount(a.amount);
    if (limit?.startsWith("-")) return invalid();
    return { id: string(row.id), currency: string(a.currency_code), decimals: decimals(a.currency_decimal_places), amount: limit, start: start.slice(0, 10), end: end.slice(0, 10) };
  });
  return { limits, pages: result.pages };
}

export function monthlyBudgetRows(budget: Budget, limits: Limit[], period: BudgetPeriod): BudgetRow[] {
  const relevant = limits.filter(limit => limit.start <= period.end && limit.end >= period.start);
  const currencies = new Set([...relevant.map(limit => limit.currency), ...(budget.spent ?? []).map(s => s.currency)]);
  if (!currencies.size) return [{ id: budget.id, name: budget.name, active: budget.active, currency: null, decimals: null, limit: null, spent: null, usage: null, note: "No limit or spending reported for this month.", limits: [] }];
  return [...currencies].map(currency => {
    const matching = relevant.filter(limit => limit.currency === currency);
    const spending = budget.spent?.find(s => s.currency === currency);
    const spent = spending ? negateDecimal(spending.sum) : null;
    const single = matching.length === 1 ? matching[0] : null;
    const exact = single && single.start === period.start && single.end === period.end;
    const limit = exact ? single.amount : null;
    const usage = limit !== null && spent !== null ? budgetUsage(limit, spent) : null;
    const note = matching.length === 0 ? "No limit set for this currency and month."
      : !exact ? "Limits do not form one exact calendar month; monthly comparison unavailable."
      : limit === null ? "Firefly did not report a limit amount."
      : spent === null ? "Firefly did not report spending in this currency; comparison unavailable." : null;
    return { id: `${budget.id}:${currency}`, name: budget.name, active: budget.active, currency, decimals: single?.decimals ?? spending?.decimals ?? null, limit, spent, usage, note, limits: matching };
  });
}

async function read(path: string, period: BudgetPeriod, page: number, signal: AbortSignal) {
  const { baseUrl, token } = readConfig();
  const url = new URL(path, baseUrl);
  url.search = new URLSearchParams({ start: period.start, end: period.end, page: String(page), limit: "50" }).toString();
  try {
    const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store", redirect: "error", signal });
    if (!response.ok) { await response.body?.cancel(); throw new FireflyError("Firefly could not provide budget data. Check server access and try again."); }
    return await response.json() as unknown;
  } catch (error) {
    if (error instanceof FireflyError) throw error;
    throw new FireflyError("Unable to read Firefly budgets. Check the server connection and try again.");
  }
}
export async function getMonthlyBudgets(period: BudgetPeriod): Promise<BudgetRow[]> {
  const signal = AbortSignal.timeout(20_000);
  const budgets: Budget[] = [];
  const ids = new Set<string>();
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const parsed = parseBudgets(await read("api/v1/budgets", period, page, signal), page);
    if (page > 1 && pages !== parsed.pages) return invalid();
    pages = parsed.pages;
    for (const budget of parsed.budgets) { if (ids.has(budget.id)) return invalid(); ids.add(budget.id); budgets.push(budget); }
  }
  const rows: BudgetRow[] = [];
  // Bound concurrency; no upstream-provided URLs are followed.
  for (let offset = 0; offset < budgets.length; offset += 4) {
    const batch = await Promise.all(budgets.slice(offset, offset + 4).map(async budget => {
      const limits: Limit[] = [], ids = new Set<string>();
      let pages = 1;
      for (let page = 1; page <= pages; page++) {
        const parsed = parseBudgetLimits(await read(`api/v1/budgets/${encodeURIComponent(budget.id)}/limits`, period, page, signal), budget.id, page);
        if (page > 1 && pages !== parsed.pages) return invalid();
        pages = parsed.pages;
        for (const limit of parsed.limits) { if (ids.has(limit.id)) return invalid(); ids.add(limit.id); limits.push(limit); }
      }
      return monthlyBudgetRows(budget, limits, period);
    }));
    rows.push(...batch.flat());
  }
  return rows;
}

