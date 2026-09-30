import { formatCurrency, formatDate } from "./format.ts";
import type { TransactionRow } from "./firefly/transaction-types.ts";

export const transactionTypeLabels = {
  withdrawal: "Uitgaven", deposit: "Inkomsten", transfer: "Overschrijving",
  reconciliation: "Saldocorrectie", "opening balance": "Beginsaldo",
};

const typeTerms: Record<string, TransactionRow["type"]> = {
  uitgave: "withdrawal", uitgaven: "withdrawal", withdrawal: "withdrawal", expense: "withdrawal",
  inkomen: "deposit", inkomsten: "deposit", deposit: "deposit", income: "deposit",
  overschrijving: "transfer", overschrijvingen: "transfer", transfer: "transfer",
  saldocorrectie: "reconciliation", reconciliation: "reconciliation",
  beginsaldo: "opening balance", "opening balance": "opening balance",
};
const normalize = (text: string) => text.toLocaleLowerCase("nl-NL").replace(/\s+/gu, " ").trim();

export function transactionSearchType(query: string): TransactionRow["type"] | undefined {
  const term = normalize(query);
  return Object.hasOwn(typeTerms, term) ? typeTerms[term] : undefined;
}

// Shared with the table: signs and precision are presentation of Firefly's type/amount.
export function transactionAmountLabel(row: TransactionRow): string {
  const amount = row.type === "withdrawal" ? `-${row.amount.replace(/^-/, "")}`
    : row.type === "deposit" ? row.amount.replace(/^-/, "") : row.amount;
  return formatCurrency(amount, row.currency, row.decimals, row.type === "deposit");
}

export function matchesTransaction(row: TransactionRow, query: string): boolean {
  const term = normalize(query);
  const type = transactionSearchType(term);
  if (type) return row.type === type;
  const fields = [row.description, row.split ? row.groupTitle : null, row.source, row.destination, row.category, row.budget,
    transactionTypeLabels[row.type], formatDate(row.date)];
  if (fields.some(field => field && normalize(field).includes(term))) return true;
  const amount = normalize(transactionAmountLabel(row)).replaceAll("−", "-");
  const amountTerm = term.replaceAll("−", "-");
  // Full displayed amount or its complete numeric part; never match 57,90 in 157,90.
  // An unsigned numeric query also finds outflows; supplied signs remain meaningful.
  // Custom currency names precede the number and can themselves contain digits.
  const numeric = [...amount.matchAll(/(?:^|\s)([+-]?\d[\d.]*(?:,\d+)?)(?=\s|$)/gu)].at(-1)?.[1];
  return amountTerm === amount || amountTerm === numeric || amountTerm === numeric?.replace(/^[+-]/, "");
}
