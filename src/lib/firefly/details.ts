import "server-only";
import { budgetPeriod, type BudgetPeriod } from "../budget-period.ts";
import { isFireflyId } from "../transaction-navigation.ts";
import { negateDecimal } from "../budget-math.ts";
import { FireflyError, getFireflyJson } from "./client.ts";
import { monthlyBudgetRows, parseBudgets, parseBudgetLimits } from "./budgets.ts";

function invalid(): never { throw new FireflyError("Firefly returned unsupported detail data."); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function parameters(id: string, period: BudgetPeriod) {
  const verified = budgetPeriod(period.month);
  if (!isFireflyId(id) || verified.month !== period.month || verified.start !== period.start || verified.end !== period.end) return invalid();
  return { start: period.start, end: period.end };
}
export type CategoryAmount = { currency: string; decimals: number; amount: string };
export function parseCategory(value: unknown, id: string) {
  const data = object(object(value).data), a = object(data.attributes);
  if (data.id !== id || data.type !== "categories" || typeof a.name !== "string" || !a.name) return invalid();
  const amounts = (value: unknown, expense = false): CategoryAmount[] | null => {
    if (value == null) return null;
    if (!Array.isArray(value)) return invalid();
    const seen = new Set<string>();
    return value.map(entry => {
      const s = object(entry);
      if (typeof s.currency_code !== "string" || !s.currency_code || seen.has(s.currency_code) || typeof s.sum !== "string" || !/^-?\d+(\.\d+)?$/.test(s.sum) || typeof s.currency_decimal_places !== "number" || !Number.isInteger(s.currency_decimal_places) || s.currency_decimal_places < 0 || s.currency_decimal_places > 30) return invalid();
      seen.add(s.currency_code);
      return { currency: s.currency_code, decimals: s.currency_decimal_places, amount: expense ? negateDecimal(s.sum) : s.sum };
    });
  };
  return { id, name: a.name, spent: amounts(a.spent, true), earned: amounts(a.earned), transferred: amounts(a.transferred) };
}
export async function getCategoryDetail(id: string, period: BudgetPeriod) {
  return parseCategory(await getFireflyJson(`api/v1/categories/${id}`, parameters(id, period), AbortSignal.timeout(15_000), "category"), id);
}

export async function getBudgetDetail(id: string, period: BudgetPeriod) {
  const query = parameters(id, period), signal = AbortSignal.timeout(20_000);
  const value = object(await getFireflyJson(`api/v1/budgets/${id}`, query, signal, "budget"));
  const budget = parseBudgets({ data: [value.data], meta: { pagination: { current_page: 1, total_pages: 1 } } }, 1).budgets[0];
  if (budget.id !== id) return invalid();
  const limits: ReturnType<typeof parseBudgetLimits>["limits"] = [], ids = new Set<string>();
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const result = parseBudgetLimits(await getFireflyJson(`api/v1/budgets/${id}/limits`, { ...query, page: String(page), limit: "50" }, signal, "budget"), id, page);
    if (page > 1 && pages !== result.pages) return invalid();
    pages = result.pages;
    for (const limit of result.limits) { if (ids.has(limit.id)) return invalid(); ids.add(limit.id); limits.push(limit); }
  }
  return { name: budget.name, rows: monthlyBudgetRows(budget, limits, period) };
}
