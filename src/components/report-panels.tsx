import type { CashFlow, Insight, ReportResult } from "@/lib/firefly/reports";
import { previousDifference } from "@/lib/firefly/reports";
import { barPercent, compareDecimal } from "@/lib/report-math";
import { formatCurrency, comparisonText } from "@/lib/format";


export function ReportUnavailable({ label }: { label: string }) {
  return <p className="report-unavailable" role="status">{`${label}: tijdelijk niet beschikbaar. Probeer te vernieuwen.`}</p>;
}

export function CashFlowCards({ rows, previous, previousComplete, previousLabel }: {
  rows: CashFlow[]; previous: CashFlow[]; previousComplete: boolean; previousLabel: string | null;
}) {
  return <div className="report-currencies">{rows.map(row => {
    const change = previousDifference(row, previous, previousComplete);
    return <section className="report-currency" key={`${row.currencyId}:${row.currency}`} aria-label={`${row.currency}: kasstroom`}>
      <h2>{row.currency} <span>Kasstroom</span></h2>
      <dl className="report-totals">
        <div><dt>Totale inkomsten</dt><dd className="transaction-deposit">{formatCurrency(row.income, row.currency)}</dd></div>
        <div><dt>Totale uitgaven</dt><dd className="transaction-withdrawal">{formatCurrency(row.expenses, row.currency)}</dd></div>
        <div><dt>Netto kasstroom</dt><dd>{formatCurrency(row.net, row.currency)}</dd><small>Inkomsten min uitgaven</small></div>
      </dl>
      {previousLabel && <p className="report-comparison">{comparisonText(change, row.currency, previousLabel)}</p>}
    </section>;
  })}</div>;
}

export function ReportBreakdown({ title, grouped, unassigned, fallback, tone }: {
  title: string; grouped: ReportResult; unassigned: ReportResult; fallback: string; tone: "expense" | "income";
}) {
  const rows = [...(grouped.ok ? grouped.rows : []), ...(unassigned.ok ? unassigned.rows.map(row => ({ ...row, name: fallback })) : [])];
  const currencies = new Map<string, Insight[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.currencyId, row.currency]);
    const entries = currencies.get(key) ?? [];
    entries.push(row); currencies.set(key, entries);
  }
  return <section className={`report-panel report-${tone}`}>
    <h2>{title}</h2><p className="report-caption">Hoogste bedragen eerst</p>
    {!grouped.ok && <ReportUnavailable label={title} />}
    {!unassigned.ok && <ReportUnavailable label={fallback} />}
    {!rows.length && grouped.ok && unassigned.ok && <p className="report-empty">Geen gegevens voor deze maand.</p>}
    {[...currencies.entries()].map(([key, entries]) => {
      const sorted = [...entries].sort((a, b) => compareDecimal(b.amount, a.amount));
      return <div key={key} className="report-breakdown"><h3>{entries[0].currency}</h3>
        <ul>{sorted.map(row => <li key={row.id ?? "unassigned"}><div className="report-row"><span>{row.name}</span><strong>{formatCurrency(row.amount, row.currency)}</strong></div>
          <div className="report-bar" aria-hidden="true"><span style={{ width: `${barPercent(row.amount, sorted[0].amount)}%` }} /></div>
        </li>)}</ul>
      </div>;
    })}
  </section>;
}
