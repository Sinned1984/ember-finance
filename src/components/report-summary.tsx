import { formatCurrency, formatMonth } from "@/lib/format";
import Link from "next/link";
import { budgetPeriod, type BudgetPeriod } from "@/lib/budget-period";
import { cashFlows, createReportReader } from "@/lib/firefly/reports";
import { ReportUnavailable } from "./report-panels";

export async function ReportSummary({ period = budgetPeriod() }: { period?: BudgetPeriod }) {
  const read = createReportReader();
  const [income, expenses] = await Promise.all([read("income", period), read("expenses", period)]);
  const rows = cashFlows(income, expenses);
  return <section className="report-insight" aria-label="Maandelijkse kasstroom">
    <div><p className="eyebrow">{formatMonth(period.month)}</p><h2>Netto kasstroom</h2></div>
    {!income.ok || !expenses.ok ? <ReportUnavailable label="Maandelijkse kasstroom" /> : rows.length ? <ul>{rows.map(row => <li key={`${row.currencyId}:${row.currency}`}><strong>{formatCurrency(row.net, row.currency)}</strong></li>)}</ul> : <p>Nog geen inkomsten of uitgaven.</p>}
    <Link className="button" href={`/reports?month=${period.month}`} prefetch={false}>Bekijk rapporten ↗</Link>
  </section>;
}
