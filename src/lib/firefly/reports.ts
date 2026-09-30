import "server-only";
import { budgetPeriod, type BudgetPeriod } from "../budget-period.ts";
import { subtractDecimal } from "../report-math.ts";
import { FireflyError, getFireflyJson } from "./client.ts";

const endpoints = {
  expenses: "expense/total", income: "income/total",
  expenseCategories: "expense/category", uncategorizedExpenses: "expense/no-category",
  incomeCategories: "income/category", uncategorizedIncome: "income/no-category",
  budgets: "expense/budget", unbudgeted: "expense/no-budget",
} as const;
export type ReportKind = keyof typeof endpoints;
export type Insight = { currencyId: string; currency: string; amount: string; id: string | null; name: string | null };
export type ReportResult = { ok: true; rows: Insight[] } | { ok: false };
export type CashFlow = { currencyId: string; currency: string; income: string | null; expenses: string | null; net: string | null };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function parseInsights(value: unknown, kind: ReportKind): Insight[] {
  const invalid = () => new FireflyError("Firefly returned incomplete report data. Please try again later.");
  if (!Array.isArray(value)) throw invalid();
  const grouped = ["expenseCategories", "incomeCategories", "budgets"].includes(kind);
  const expense = endpoints[kind].startsWith("expense/");
  const seen = new Set<string>();
  const currencies = new Map<string, string>();
  return value.map(entry => {
    if (!record(entry) || !text(entry.currency_id) || !text(entry.currency_code)
      || typeof entry.difference !== "string" || entry.difference.length > 200
      || !/^-?\d+(\.\d+)?$/.test(entry.difference)
      || (grouped && (!text(entry.id) || !text(entry.name)))) throw invalid();
    const key = JSON.stringify([entry.currency_id, grouped ? entry.id : null]);
    if (seen.has(key) || (currencies.has(entry.currency_id) && currencies.get(entry.currency_id) !== entry.currency_code)) throw invalid();
    seen.add(key); currencies.set(entry.currency_id, entry.currency_code);
    return { currencyId: entry.currency_id, currency: entry.currency_code,
      amount: expense ? subtractDecimal("0", entry.difference) : entry.difference,
      id: grouped ? entry.id as string : null, name: grouped ? entry.name as string : null };
  });
}

// A reader belongs to ONE render. Promises are reused here, never cached persistently.
// Insight endpoints return full date-filtered aggregates, with no pagination.
export function createReportReader() {
  const reads = new Map<string, Promise<ReportResult>>();
  return (kind: ReportKind, period: BudgetPeriod): Promise<ReportResult> => {
    const key = `${kind}:${period.month}:${period.start}:${period.end}`;
    let result = reads.get(key);
    if (!result) {
      result = (async (): Promise<ReportResult> => {
        try {
          const verified = budgetPeriod(period.month);
          if (verified.month !== period.month || verified.start !== period.start || verified.end !== period.end) throw new FireflyError("Invalid report period.");
          const value = await getFireflyJson(`api/v1/insight/${endpoints[kind]}`, { start: period.start, end: period.end }, AbortSignal.timeout(15_000), "report");
          return { ok: true, rows: parseInsights(value, kind) };
        } catch { return { ok: false }; }
      })();
      reads.set(key, result);
    }
    return result;
  };
}

// An absent currency in a successful complete aggregate means no activity.
// A failed endpoint means unknown, never zero. Match both currency ID and code.
export function cashFlows(income: ReportResult, expenses: ReportResult): CashFlow[] {
  const currencyKey = (row: Insight) => JSON.stringify([row.currencyId, row.currency]);
  const incoming = new Map(income.ok ? income.rows.map(row => [currencyKey(row), row]) : []);
  const outgoing = new Map(expenses.ok ? expenses.rows.map(row => [currencyKey(row), row]) : []);
  return [...new Set([...incoming.keys(), ...outgoing.keys()])].map(key => {
    const row = incoming.get(key) ?? outgoing.get(key)!;
    // Conflicting metadata cannot safely be interpreted as an absent currency.
    const conflict = income.ok && expenses.ok && [...income.rows, ...expenses.rows].some(other => other.currencyId === row.currencyId && other.currency !== row.currency);
    const received = income.ok && !conflict ? incoming.get(key)?.amount ?? "0" : null;
    const spent = expenses.ok && !conflict ? outgoing.get(key)?.amount ?? "0" : null;
    return { currencyId: row.currencyId, currency: row.currency, income: received, expenses: spent,
      net: received !== null && spent !== null ? subtractDecimal(received, spent) : null };
  });
}

export function previousDifference(current: CashFlow, previous: CashFlow[], previousComplete: boolean): string | null {
  if (!previousComplete || current.net === null) return null;
  if (previous.some(row => row.currencyId === current.currencyId && row.currency !== current.currency)) return null;
  const prior = previous.find(row => row.currencyId === current.currencyId && row.currency === current.currency);
  return prior?.net === null ? null : subtractDecimal(current.net, prior?.net ?? "0");
}
