import "server-only";
import { FireflyError, getAccountPage } from "./client.ts";
import type { AssetAccount } from "./types.ts";

function invalid(): never { throw new FireflyError("Firefly returned an unsupported account response."); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return invalid();
  return value;
}

export function parsePage(value: unknown, expectedPage: number) {
  const root = object(value);
  const pagination = object(object(root.meta).pagination);
  const pages = pagination.total_pages;
  if (!Array.isArray(root.data) || pagination.current_page !== expectedPage ||
      typeof pages !== "number" || !Number.isSafeInteger(pages) || pages < 0 || pages > 100 ||
      (pages < expectedPage && !(pages === 0 && expectedPage === 1 && root.data.length === 0))) return invalid();
  const accounts = root.data.map((entry): AssetAccount => {
    const row = object(entry);
    const a = object(row.attributes);
    if (row.type !== "accounts" || typeof row.id !== "string" || !row.id ||
        typeof a.name !== "string" || !a.name || a.type !== "asset" || typeof a.active !== "boolean") return invalid();
    const balance = optionalString(a.current_balance);
    const currency = optionalString(a.currency_code);
    const balanceDate = optionalString(a.current_balance_date);
    const decimals = a.currency_decimal_places ?? null;
    if (balance !== null && !/^-?\d+(\.\d+)?$/.test(balance)) return invalid();
    if (decimals !== null && (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 30)) return invalid();
    return { id: row.id, name: a.name, active: a.active, balance, currency, decimals: decimals as number | null, balanceDate };
  });
  return { accounts, pages };
}

export async function getAssetAccounts(): Promise<AssetAccount[]> {
  const signal = AbortSignal.timeout(15_000);
  const accounts: AssetAccount[] = [];
  const ids = new Set<string>();
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    const result = parsePage(await getAccountPage(page, signal), page);
    if (page > 1 && result.pages !== totalPages) throw new FireflyError("The account list changed while loading. Please reload.");
    totalPages = result.pages;
    for (const account of result.accounts) {
      if (ids.has(account.id)) return invalid();
      ids.add(account.id);
      accounts.push(account);
    }
  }
  return accounts;
}

