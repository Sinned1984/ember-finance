import { requireUser } from "@/lib/auth/require-user";
import { formatMonth } from "@/lib/format";
import { MonthNavigation } from "@/components/month-navigation";
import { RefreshButton } from "@/components/refresh-button";
import { CashFlowCards, ReportBreakdown, ReportUnavailable } from "@/components/report-panels";
import { budgetPeriod } from "@/lib/budget-period";
import { cashFlows, createReportReader, type ReportResult } from "@/lib/firefly/reports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rapporten · Ember Finance" };

export default async function Rapporten({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  await requireUser();
  const period = budgetPeriod((await searchParams).month);
  const prior = period.previous ? budgetPeriod(period.previous) : null;
  const read = createReportReader();
  const unavailable: ReportResult = { ok: false };
  const [income, expenses, previousIncome, previousExpenses, expenseCategories, uncategorizedExpenses, incomeCategories, uncategorizedIncome, budgets, unbudgeted] = await Promise.all([
    read("income", period), read("expenses", period),
    prior ? read("income", prior) : unavailable, prior ? read("expenses", prior) : unavailable,
    read("expenseCategories", period), read("uncategorizedExpenses", period),
    read("incomeCategories", period), read("uncategorizedIncome", period),
    read("budgets", period), read("unbudgeted", period),
  ]);
  const rows = cashFlows(income, expenses);
  const emptyMonth = [income, expenses, expenseCategories, uncategorizedExpenses, incomeCategories, uncategorizedIncome, budgets, unbudgeted]
    .every(result => result.ok && result.rows.length === 0);
  return <><header className="page-header"><div><p className="eyebrow">INZICHT IN JE FINANCIËN</p><h1>Rapporten</h1><p>Je inkomsten en uitgaven per maand.</p></div><RefreshButton /></header>
    <MonthNavigation period={period} path="/reports" />
    {!income.ok && <ReportUnavailable label="Totale inkomsten" />}
    {!expenses.ok && <ReportUnavailable label="Totale uitgaven" />}
    {!rows.length && income.ok && expenses.ok && <div className="report-panel report-empty">Geen inkomsten of uitgaven in deze maand.</div>}
    <CashFlowCards rows={rows} previous={cashFlows(previousIncome, previousExpenses)} previousComplete={previousIncome.ok && previousExpenses.ok} previousLabel={prior ? formatMonth(prior.month) : null} />
    {rows.length > 0 && <p className="report-caption">De vergelijking gaat over hele kalendermaanden. De huidige en toekomstige maanden kunnen nog onvolledig zijn.</p>}
    {!emptyMonth && <div className="report-grid">
      <ReportBreakdown title="Uitgavencategorieën" grouped={expenseCategories} unassigned={uncategorizedExpenses} fallback="Ongecategoriseerde uitgaven" tone="expense" />
      <div className="report-stack">
      <ReportBreakdown title="Inkomstencategorieën" grouped={incomeCategories} unassigned={uncategorizedIncome} fallback="Ongecategoriseerde inkomsten" tone="income" />
      <ReportBreakdown title="Uitgaven per budget" grouped={budgets} unassigned={unbudgeted} fallback="Zonder budget" tone="expense" />
      </div>
    </div>}
    <details className="info-details"><summary>Over deze cijfers</summary><p>De bedragen komen uit Firefly III. Overschrijvingen, beginsaldi en saldocorrecties tellen niet mee als inkomsten of uitgaven. Deeltransacties tellen elk één keer mee.</p><p>De netto kasstroom is je inkomen min je uitgaven. De balken vergelijken bedragen binnen dezelfde valuta. Valuta’s blijven apart; de omrekeninstelling in Firefly III kan wel invloed hebben op de aangeleverde bedragen. Er wordt niet voorspeld of omgerekend naar een volledige maand.</p></details>
  </>;
}
