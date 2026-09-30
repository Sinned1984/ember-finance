export type SubscriptionEntry = {
  description: string | null;
  amount: string | null;
  currency: string | null;
  decimals: number | null;
  source: string | null;
  destination: string | null;
  category: string | null;
};
export type Subscription = {
  id: string;
  model: "bill" | "recurrence";
  name: string;
  active: boolean | null;
  kind: "withdrawal" | "deposit" | "transfer" | null;
  minimum: string | null;
  maximum: string | null;
  currency: string | null;
  decimals: number | null;
  frequency: string | null;
  nextDate: string | null;
  expectedDate: string | null;
  endDate: string | null;
  notes: string | null;
  description: string | null;
  entries: SubscriptionEntry[];
};

