export type TransactionRow = {
  id: string;
  groupId: string;
  groupTitle: string | null;
  split: boolean;
  date: string;
  description: string;
  type: "withdrawal" | "deposit" | "transfer" | "reconciliation" | "opening balance";
  amount: string;
  currency: string | null;
  decimals: number | null;
  source: string | null;
  destination: string | null;
  category: string | null;
  budget: string | null;
  categoryId: string | null;
  budgetId: string | null;
};
export type TransactionPage = { rows: TransactionRow[]; page: number; totalPages: number; total: number };

