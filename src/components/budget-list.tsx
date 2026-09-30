import { formatCurrency, formatDate, formatPercentage } from "@/lib/format";
import { budgetNote } from "@/lib/presentation";
import type { BudgetRow } from "@/lib/firefly/budgets";

const labels = { within: "Binnen budget", close: "Bijna bereikt", over: "Overschreden" };
export function BudgetList({ rows }: { rows: BudgetRow[] }) {
  if (!rows.length) return <div className="empty-state"><h2>Nog geen budgetten</h2><p>Je budgetten uit Firefly III verschijnen hier.</p></div>;
  return <div className="budget-grid">{rows.map(row => <article key={row.id} className="budget-item">
    <header><div><h2>{row.name}</h2><p>{row.currency || "Valuta onbekend"}{!row.active && " · Inactief"}</p></div><span className={`budget-status ${row.usage?.status ?? "unknown"}`}>{row.usage ? labels[row.usage.status as keyof typeof labels] : "Niet vergelijkbaar"}</span></header>
    <dl className="budget-amounts"><div><dt>Budgetbedrag</dt><dd>{formatCurrency(row.limit, row.currency, row.decimals)}</dd></div><div><dt>Uitgegeven</dt><dd>{formatCurrency(row.spent, row.currency, row.decimals)}</dd></div><div><dt>Resterend</dt><dd>{formatCurrency(row.usage?.remaining ?? null, row.currency, row.decimals)}</dd></div></dl>
    {row.usage ? <><div className={`budget-progress ${row.usage.status}`} role="progressbar" aria-label={`${row.name}: verbruikt budget`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.usage.progress} aria-valuetext={row.usage.percentage === null ? "Geen percentage bij een budget van nul" : `${formatPercentage(row.usage.percentage)} gebruikt`}><span style={{ width: `${row.usage.progress}%` }} /></div><p className="budget-caption">{row.usage.percentage === null ? "Geen percentage bij een budget van nul" : `${formatPercentage(row.usage.percentage)} gebruikt`}</p></> : <p className="budget-caption">Percentage niet beschikbaar</p>}
    {row.note && <p className="budget-note">{budgetNote(row.note)}</p>}
    {row.limits.length > 0 && row.limit === null && <ul className="budget-limit-details">{row.limits.map(limit => <li key={limit.id}>{formatDate(limit.start)} – {formatDate(limit.end)}: {formatCurrency(limit.amount, limit.currency, limit.decimals)}</li>)}</ul>}
  </article>)}</div>;
}

