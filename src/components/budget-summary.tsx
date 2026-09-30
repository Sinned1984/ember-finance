import { formatMonth } from "@/lib/format";
import Link from "next/link";
import { budgetPeriod, type BudgetPeriod } from "@/lib/budget-period";
import { getMonthlyBudgets, type BudgetRow } from "@/lib/firefly/budgets";

export async function BudgetSummary({ period = budgetPeriod() }: { period?: BudgetPeriod }) {
  let rows: BudgetRow[] | undefined;
  try { rows = (await getMonthlyBudgets(period)).filter(row => row.active); } catch { /* Isolate budget failures from the rest of Overzicht. */ }
  if (!rows) return <section className="connection-card"><p className="eyebrow">BUDGETTEN · {formatMonth(period.month)}</p><h2>Budgetten niet beschikbaar</h2><p>De budgetten kunnen nu niet worden geladen.</p><Link className="card-link" href="/budgets">Bekijk budgetten ↗</Link></section>;
  const within = rows.filter(row => row.usage?.status === "within").length;
  const close = rows.filter(row => row.usage?.status === "close").length;
  const over = rows.filter(row => row.usage?.status === "over").length;
  const unavailable = rows.filter(row => !row.usage).length;
  return <section className="connection-card"><p className="eyebrow">BUDGETTEN · {formatMonth(period.month)}</p><h2>{over ? "Een paar budgetten vragen aandacht." : rows.length ? "Je budgetten deze maand." : "Nog geen actieve budgetten."}</h2>
    {rows.length > 0 && <><div className="budget-summary-counts"><span><strong>{within}</strong>binnen budget</span><span><strong>{close}</strong>bijna bereikt</span><span><strong>{over}</strong>overschreden</span></div><p>{unavailable ? `${unavailable} budgetten zijn niet vergelijkbaar.` : "Per budget en valuta."}</p></>}
    <Link className="card-link" href={`/budgets?month=${period.month}`}>Bekijk budgetten <span aria-hidden="true">↗</span></Link></section>;
}

