import { formatCurrency, formatDate, formatMonth } from "@/lib/format";
import Link from "next/link";
import { budgetPeriod, type BudgetPeriod } from "@/lib/budget-period";
import { getMonthlyBills, monthlyBillState } from "@/lib/firefly/monthly-bills";
import { ExpectedAmount } from "./subscription-list";

export async function SubscriptionSummary({ period = budgetPeriod() }: { period?: BudgetPeriod }) {
  let data: Awaited<ReturnType<typeof getMonthlyBills>> = { bills: null, totals: null };
  try { data = await getMonthlyBills(period); } catch { /* Independent of other dashboard sections. */ }
  const { bills, totals } = data, state = monthlyBillState(bills, totals);
  return <section className="intro subscription-summary"><span className="eyebrow">ABONNEMENTEN · {formatMonth(period.month)}</span>
    <h2>{state.status === "unavailable" ? "Betaalstatus tijdelijk niet beschikbaar" : state.status === "outstanding" ? "Nog te verwachten deze maand" : bills?.length === 0 ? "Geen abonnementen" : state.complete && !state.active.length ? "Geen actieve abonnementen" : "Niets meer te verwachten deze maand"}</h2>
    {totals ? <dl className="bill-totals">{totals.map(row => <div key={`${row.kind}:${row.currencyId}`}><dt>{row.kind === "paid" ? "Betaald / gekoppeld" : "Nog verwacht · raming Firefly"} <small>{row.currency}</small></dt><dd>{formatCurrency(row.amount, row.currency, row.decimals)}</dd></div>)}</dl> : <p role="status">Maandbedragen zijn tijdelijk niet beschikbaar.</p>}
    {state.matched !== null && <p>{state.matched} gekoppelde deeltransacties bij actieve abonnementen.</p>}
    {state.upcoming.length > 0 && <><p>Geplande betaalmomenten · kunnen al gekoppeld zijn</p><ul className="bill-upcoming">{state.upcoming.slice(0, 3).map(({ item, date }) => <li key={`${item.id}:${date}`}><div><strong>{item.name}</strong><span>{formatDate(date)}</span></div><ExpectedAmount item={item} /></li>)}</ul></>}
    {state.upcoming.length > 3 && <p>En {state.upcoming.length - 3} andere geplande betaalmomenten.</p>}
    {!state.complete && <p role="status">De koppelingsgegevens zijn niet volledig beschikbaar.</p>}
    <details className="info-details"><summary>Over deze bedragen</summary><p>Firefly bepaalt de koppelingen en verwachte betaalmomenten. De raming gebruikt gemiddelde bedragen en is geen exact te betalen totaal. Bandbreedtes staan per abonnement vermeld. Totalen betreffen actieve abonnementen en volgen Firefly’s valuta-instellingen. Gekoppeld betekent geregistreerd in Firefly, geen bankbevestiging.</p></details>
    <Link className="card-link" href="/subscriptions">Bekijk abonnementen ↗</Link>
  </section>;
}
