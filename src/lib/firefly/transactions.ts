import "server-only";
import { readConfig } from "../env.ts";
import { FireflyError, getFireflyJson } from "./client.ts";
import { isFireflyId, transactionSearch } from "../transaction-navigation.ts";
import type { TransactionPage, TransactionRow } from "./transaction-types.ts";
import { budgetPeriod, type BudgetPeriod } from "../budget-period.ts";
import { matchesTransaction, transactionSearchType } from "../transaction-search.ts";

const searchPageSize = 100, maxSearchPages = 100, maxSearchRows = 10_000;
export class TransactionSearchLimitError extends FireflyError {}

function invalid(): never { throw new FireflyError("Firefly returned an unsupported transaction response."); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") return invalid();
  return value;
}
function optional(value: unknown): string | null { return value == null ? null : text(value); }
function integer(value: unknown, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) return invalid();
  return value;
}
export function parseTransactionPage(value: unknown, expectedPage: number): TransactionPage {
  const root = object(value);
  const pagination = object(object(root.meta).pagination);
  const page = integer(pagination.current_page, 1);
  const totalPages = integer(pagination.total_pages, 0);
  const total = integer(pagination.total, 0);
  if (page !== expectedPage || !Array.isArray(root.data)) return invalid();
  if (root.data.length && (page > totalPages || total === 0)) return invalid();
  const ids = new Set<string>();
  const groups = new Set<string>();
  const rows: TransactionRow[] = [];
  for (const entry of root.data) {
    const group = object(entry);
    const groupId = text(group.id);
    if (group.type !== "transactions" || !groupId || groups.has(groupId)) return invalid();
    groups.add(groupId);
    const attributes = object(group.attributes);
    const splits = attributes.transactions;
    if (!Array.isArray(splits) || !splits.length) return invalid();
    for (const value of splits) {
      const split = object(value);
      const id = text(split.transaction_journal_id);
      const type = text(split.type) as TransactionRow["type"];
      const date = text(split.date);
      const amount = text(split.amount);
      const decimals = split.currency_decimal_places == null ? null : integer(split.currency_decimal_places, 0);
      if (!id || ids.has(id) || !["withdrawal", "deposit", "transfer", "reconciliation", "opening balance"].includes(type) ||
          !/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date)) ||
          !/^-?\d+(\.\d+)?$/.test(amount) || (decimals !== null && decimals > 30)) return invalid();
      ids.add(id);
      rows.push({ id, groupId, groupTitle: optional(attributes.group_title), split: splits.length > 1,
        date, description: text(split.description), type, amount, decimals,
        currency: optional(split.currency_code), source: optional(split.source_name),
        destination: optional(split.destination_name), category: optional(split.category_name), budget: optional(split.budget_name),
        categoryId: optional(split.category_id), budgetId: optional(split.budget_id) });
    }
  }
  return { rows, page, totalPages, total };
}

export function monthlySearchQuery(query: string, period: BudgetPeriod) {
  const search = transactionSearch(query);
  if (!search.query || search.error) return invalid();
  // Official inclusive dates and, for a recognized type, an authoritative type filter.
  // Arbitrary text is matched locally, never interpolated into Firefly's query language.
  const type = transactionSearchType(query);
  return `date_after:${period.start} date_before:${period.end}${type ? ` transaction_type:"${type}"` : ""}`;
}

async function getMonthlySearchResults(period: BudgetPeriod, page: number, query: string): Promise<TransactionPage> {
  const signal = AbortSignal.timeout(15_000);
  const apiQuery = monthlySearchQuery(query, period);
  const rows = new Map<string, TransactionRow>();
  let totalPages = 1, total: number | undefined;
  for (let apiPage = 1; apiPage <= totalPages; apiPage++) {
    signal.throwIfAborted();
    const parsed = parseTransactionPage(await getFireflyJson("api/v1/search/transactions", {
      query: apiQuery, page: String(apiPage), limit: String(searchPageSize),
    }, signal, "transaction"), apiPage);
    if (parsed.totalPages > maxSearchPages || parsed.total > maxSearchRows) {
      throw new TransactionSearchLimitError("The selected month's transaction search exceeds its retrieval limit.");
    }
    if (total === undefined) { total = parsed.total; totalPages = Math.max(1, parsed.totalPages); }
    // Changed pagination, premature empty pages or an out-of-month row cannot yield partial results.
    if (parsed.total !== total || Math.max(1, parsed.totalPages) !== totalPages ||
        (total > 0 && !parsed.rows.length) || (total === 0 && totalPages > 1) || parsed.rows.length > searchPageSize ||
        parsed.rows.some(row => row.date.slice(0, 10) < period.start || row.date.slice(0, 10) > period.end)) return invalid();
    for (const row of parsed.rows) {
      const previous = rows.get(row.id);
      if (previous) {
        // Firefly paginates its collector before grouping journals. Identical overlaps may
        // occur; conflicting journal contents indicate an inconsistent read and fail closed.
        if (JSON.stringify({ ...previous, split: false }) !== JSON.stringify({ ...row, split: false })) return invalid();
        previous.split ||= row.split;
      } else rows.set(row.id, row);
    }
    if (rows.size > maxSearchRows) throw new TransactionSearchLimitError("The selected month's transaction search exceeds its retrieval limit.");
  }
  signal.throwIfAborted();
  // A split group can straddle API pages. Restore its split marker before filtering siblings.
  const groupSizes = new Map<string, number>();
  for (const row of rows.values()) groupSizes.set(row.groupId, (groupSizes.get(row.groupId) ?? 0) + 1);
  const matching = [...rows.values()].map(row => ({ ...row, split: row.split || groupSizes.get(row.groupId)! > 1 }))
    .filter(row => matchesTransaction(row, query));
  matching.sort((a, b) => {
    const date = b.date.slice(0, 10).localeCompare(a.date.slice(0, 10));
    if (date) return date;
    // Stable exact journal-ID tie break, independent of upstream page/group order.
    if (/^\d+$/.test(a.id) && /^\d+$/.test(b.id)) {
      const left = BigInt(a.id), right = BigInt(b.id);
      if (left !== right) return left > right ? -1 : 1;
    }
    return b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
  });
  return { rows: matching.slice((page - 1) * 25, page * 25), page,
    totalPages: Math.ceil(matching.length / 25), total: matching.length };
}

export async function getSelectedTransactions(period: BudgetPeriod, page = 1, selection: { query?: string; kind?: "categories" | "budgets"; id?: string } = {}): Promise<TransactionPage> {
  const verified = budgetPeriod(period.month);
  if (verified.month !== period.month || verified.start !== period.start || verified.end !== period.end || !Number.isSafeInteger(page) || page < 1 || page > 2147483647) return invalid();
  if (!selection.kind && !selection.query) return getTransactions(page, 25, period);
  if (selection.kind && (!selection.id || !isFireflyId(selection.id) || selection.query)) return invalid();
  if (!selection.kind) return getMonthlySearchResults(period, page, selection.query!);
  const path = `api/v1/${selection.kind}/${selection.id}/transactions`;
  const params = { page: String(page), limit: "25", start: period.start, end: period.end };
  const parsed = parseTransactionPage(await getFireflyJson(path, params, AbortSignal.timeout(15_000), "transaction"), page);
  // Never silently render an out-of-period upstream response.
  if (parsed.rows.some(row => row.date.slice(0, 10) < period.start || row.date.slice(0, 10) > period.end)) return invalid();
  return parsed;
}

export function transactionPageNumber(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page <= 2147483647 ? page : 1;
}

export async function getTransactions(page = 1, limit: 5 | 25 = 25, period?: BudgetPeriod): Promise<TransactionPage> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 2147483647 || ![5, 25].includes(limit)) return invalid();
  const { baseUrl, token } = readConfig();
  const url = new URL("api/v1/transactions", baseUrl);
  url.search = new URLSearchParams({ page: String(page), limit: String(limit) }).toString();
  if (period) {
    const verified = budgetPeriod(period.month);
    if (verified.month !== period.month || verified.start !== period.start || verified.end !== period.end) return invalid();
    url.searchParams.set("start", period.start);
    url.searchParams.set("end", period.end);
  }
  try {
    const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new FireflyError(response.status === 401 || response.status === 403
        ? "Firefly rejected access. Check the server API token and its permissions."
        : "Firefly could not provide transactions. Please try again later.");
    }
    return parseTransactionPage(await response.json(), page);
  } catch (error) {
    if (error instanceof FireflyError) throw error;
    throw new FireflyError("Unable to read Firefly transactions. Check the server connection and try again.");
  }
}

