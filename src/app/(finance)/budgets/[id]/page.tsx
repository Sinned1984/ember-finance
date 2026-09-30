import { FinancialDetail } from "@/components/financial-detail";
export const dynamic = "force-dynamic";
export const metadata = { title: "Budget · Ember Finance" };
export default function BudgetPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string | string[]; page?: string | string[] }> }) {
  return <FinancialDetail kind="budgets" {...props} />;
}
