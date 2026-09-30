import { requireUser } from "@/lib/auth/require-user";
import { MonthNavigation } from "@/components/month-navigation";
import { budgetPeriod } from "@/lib/budget-period";
import { getMonthlyBudgets } from "@/lib/firefly/budgets";
import { BudgetList } from "@/components/budget-list";
import { DataNotice } from "@/components/data-notice";
import { RefreshButton } from "@/components/refresh-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Budgetten · Ember Finance" };
export default async function Budgetten({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  await requireUser();
  const period = budgetPeriod((await searchParams).month);
  let rows;
  let failure: unknown;
  try { rows = await getMonthlyBudgets(period); } catch (error) { failure = error; }
  return <><header className="page-header"><div><p className="eyebrow">RUIMTE OM TE PLANNEN</p><h1>Budgetten</h1><p>Je budgetten en uitgaven per maand.</p></div><RefreshButton /></header>
    <MonthNavigation period={period} path="/budgets" />
    {rows ? <BudgetList rows={rows} /> : <DataNotice error={failure} />}
    <details className="info-details"><summary>Over je budgetten</summary><p>Bij 80–100% verbruik is een budget bijna bereikt. Resterend bedrag en percentage worden alleen getoond wanneer budgetperiode en valuta overeenkomen met de gekozen maand. Verschillende valuta’s blijven apart.</p></details></>;
}


