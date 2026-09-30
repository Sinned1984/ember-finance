import { formatDate, formatMonth } from "@/lib/format";
import Link from "next/link";
import type { BudgetPeriod } from "@/lib/budget-period";
import { transactionHref } from "@/lib/transaction-navigation";
import { AppIcon } from "./app-icon";

export function MonthNavigation({ period, path, query = "" }: { period: BudgetPeriod; path: "/" | "/budgets" | "/transactions" | "/reports" | `/categories/${string}` | `/budgets/${string}`; query?: string }) {
  const id = `${path.replaceAll("/", "-")}-month`;
  return <section className="budget-period" aria-label="Geselecteerde periode"><div><h2>{formatMonth(period.month)}</h2><p>{formatDate(period.start)} – {formatDate(period.end)}</p></div><nav aria-label="Maandnavigatie">
    {period.previous && <Link className="button month-arrow" href={transactionHref(path, period.previous, 1, query)} prefetch={false} aria-label="Vorige maand"><AppIcon name="arrow-left" /><span>Vorige</span></Link>}
    {period.next && <Link className="button month-arrow" href={transactionHref(path, period.next, 1, query)} prefetch={false} aria-label="Volgende maand"><span>Volgende</span><AppIcon name="arrow-right" /></Link>}
  </nav><form action={path} method="get">{query && <input type="hidden" name="q" value={query} />}<label htmlFor={id}><span><AppIcon name="calendar" />Kies een maand</span><input id={id} name="month" type="month" defaultValue={period.month} key={period.month} min="1900-01" max="2199-12" required /></label><button className="button" type="submit">Tonen</button></form></section>;
}

