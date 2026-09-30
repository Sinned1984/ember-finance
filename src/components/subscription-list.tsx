import type { Subscription } from "@/lib/firefly/subscription-types";
import { formatCurrency, formatDate } from "@/lib/format";
import { sortedSubscriptions, subscriptionFrequency } from "@/lib/presentation";
import { TableScrollHint } from "./table-scroll-hint";

export function ExpectedAmount({ item }: { item: Subscription }) {
  const min = item.minimum === null ? null : formatCurrency(item.minimum, item.currency, item.decimals);
  const max = item.maximum === null ? null : formatCurrency(item.maximum, item.currency, item.decimals);
  return <>{min && max ? min === max ? min : `${min} – ${max}` : min ? `Vanaf ${min}` : max ? `Tot ${max}` : "Niet beschikbaar"}</>;
}
function Status({ item }: { item: Subscription }) {
  return <span className={`status-badge ${item.active === true ? "active" : "inactive"}`}>{item.active === true ? "Actief" : item.active === false ? "Inactief" : "Status onbekend"}</span>;
}
function Notities({ item }: { item: Subscription }) {
  return item.notes ? <details className="subscription-notes"><summary>Notities</summary><p>{item.notes}</p></details> : null;
}
export function SubscriptionList({ items, model }: { items: Subscription[]; model: "bill" | "recurrence" }) {
  if (!items.length) return <div className="empty-state"><h3>{model === "bill" ? "Nog geen abonnementen" : "Geen terugkerende transacties ingesteld."}</h3><p>Je gegevens uit Firefly III verschijnen hier.</p></div>;
  if (model === "bill") return <div className="table-scroll" role="region" aria-label="Abonnementen; schuif horizontaal om alle kolommen te zien" tabIndex={0}><TableScrollHint /><table className="account-table subscription-table"><thead><tr><th scope="col">Abonnement</th><th scope="col" className="amount-column">Verwacht bedrag</th><th scope="col">Herhaling</th><th scope="col">Volgende datum</th><th scope="col">Status</th></tr></thead><tbody>{sortedSubscriptions(items).map(item => <tr key={item.id}>
    <td className="subscription-name"><strong>{item.name}</strong><Notities item={item} /></td><td className="subscription-amount amount-column"><ExpectedAmount item={item} /></td><td>{subscriptionFrequency(item)}</td>
    <td className="date-cell">{item.active !== true ? "—" : item.nextDate ? formatDate(item.nextDate) : "Niet bekend"}{item.active === true && !item.nextDate && item.expectedDate && <small>Opgegeven verwachte datum: {formatDate(item.expectedDate)}</small>}{item.endDate && <small>Eindigt op {formatDate(item.endDate)}</small>}</td><td><Status item={item} /></td>
  </tr>)}</tbody></table></div>;
  const types = { withdrawal: "Terugkerende uitgave", deposit: "Terugkerende inkomsten", transfer: "Terugkerende overschrijving" };
  return <div className="recurrence-grid">{items.map(item => <article className="budget-item" key={item.id}><header><div><h3>{item.name}</h3><p className={`transaction-${item.kind || "unknown"}`}>{item.kind ? types[item.kind] : "Transactiesoort onbekend"}</p></div><Status item={item} /></header>
    {item.description && <p className="subscription-description">{item.description}</p>}
    <dl className="recurrence-schedule"><div><dt>Herhaling</dt><dd>{subscriptionFrequency(item)}</dd></div><div><dt>Volgende datum</dt><dd>{item.active === true ? (item.nextDate ? formatDate(item.nextDate) : "Niet bekend") : "—"}</dd></div>{item.endDate && <div><dt>Einddatum</dt><dd>{formatDate(item.endDate)}</dd></div>}</dl>
    {item.entries.length ? <ul className="recurrence-entries">{item.entries.map((entry, index) => <li key={index}><div><strong>{entry.description || "Terugkerende transactie"}</strong><p>{entry.source || "Bron onbekend"} → {entry.destination || "Bestemming onbekend"}</p><p>Categorie: {entry.category || "Niet bekend"}</p></div><span className="subscription-amount">{formatCurrency(entry.amount, entry.currency, entry.decimals)}</span></li>)}</ul> : <p className="subscription-description">Geen transactieregels beschikbaar.</p>}
    <Notities item={item} />
  </article>)}</div>;
}

