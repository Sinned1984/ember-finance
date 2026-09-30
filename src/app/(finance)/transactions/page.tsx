import { requireUser } from "@/lib/auth/require-user";
import { MonthNavigation } from "@/components/month-navigation";
import { budgetPeriod } from "@/lib/budget-period";
import Link from "next/link";
import { getSelectedTransactions, transactionPageNumber, TransactionSearchLimitError } from "@/lib/firefly/transactions";
import { TransactionTable } from "@/components/transaction-table";
import { TransactionPagination } from "@/components/transaction-pagination";
import { transactionHref, transactionSearch } from "@/lib/transaction-navigation";
import { DataNotice } from "@/components/data-notice";
import { RefreshButton } from "@/components/refresh-button";
import { AppIcon } from "@/components/app-icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Transacties · Ember Finance" };

export default async function Transacties({ searchParams }: { searchParams: Promise<{ page?: string | string[]; month?: string | string[]; q?: string | string[] }> }) {
  await requireUser();
  const params = await searchParams;
  const page = transactionPageNumber(params.page), period = budgetPeriod(params.month);
  const { query, error } = transactionSearch(params.q);
  let data, failure: unknown;
  if (!error) try { data = await getSelectedTransactions(period, page, { query }); } catch (e) { failure = e; }
  return <>
    <header className="page-header"><div><p className="eyebrow">JE GELD IN BEWEGING</p><h1>Transacties</h1><p>Je inkomsten, uitgaven en overschrijvingen per maand.</p></div><RefreshButton /></header>
    <MonthNavigation period={period} path="/transactions" query={error ? "" : query} />
    <form className="transaction-toolbar" action="/transactions" method="get">
      <input type="hidden" name="month" value={period.month} />
      <label htmlFor="transaction-search">Zoeken in deze maand<span className="search-field"><AppIcon name="search" /><input id="transaction-search" name="q" type="search" defaultValue={query} key={query} maxLength={200} placeholder="Zoek op omschrijving, soort, rekening, bedrag…" aria-describedby="search-scope" /></span></label>
      <button className="button search-submit" type="submit"><AppIcon name="search" />Zoeken</button>
      {query && <Link className="button" prefetch={false} href={transactionHref("/transactions", period.month)}>Zoekopdracht wissen</Link>}
      <p id="search-scope">Doorzoek alle transacties in de geselecteerde maand op datum, omschrijving, bedrag, soort, rekening, categorie of budget. Ook buiten deze pagina.</p>
    </form>
    {error ? <div className="notice" role="alert"><p>{error}</p></div> : data ? <>
      <TransactionTable rows={data.rows} month={period.month} />
      <div className="panel-footer">Nieuwste eerst · Deeltransacties behouden hun eigen bedragen en indeling. {query ? "Pagina’s tonen de zoekresultaten uit de volledige geselecteerde maand." : "Firefly bepaalt de resultaten en paginering."}</div>
      <TransactionPagination data={data} path="/transactions" month={period.month} query={query} />
    </> : failure instanceof TransactionSearchLimitError ? <div className="notice" role="status"><h3>Zoekopdracht te groot</h3><p>Deze maand bevat te veel transacties om volledig te doorzoeken. Zoek op een soort, bijvoorbeeld uitgaven of inkomsten, of kies een andere maand.</p></div> : <DataNotice error={failure} />}
  </>;
}
