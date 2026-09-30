import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { budgetPeriod } from "@/lib/budget-period";
import { isFireflyId, transactionHref } from "@/lib/transaction-navigation";
import { getBudgetDetail, getCategoryDetail, type CategoryAmount } from "@/lib/firefly/details";
import { getSelectedTransactions, transactionPageNumber } from "@/lib/firefly/transactions";
import { formatCurrency } from "@/lib/format";
import { BudgetList } from "./budget-list";
import { MonthNavigation } from "./month-navigation";
import { TransactionTable } from "./transaction-table";
import { TransactionPagination } from "./transaction-pagination";
import { DataNotice } from "./data-notice";
import { RefreshButton } from "./refresh-button";

function CategoryTotal({ title, rows }: { title: string; rows: CategoryAmount[] | null }) {
  return <section className="report-panel"><h2>{title}</h2>{rows === null ? <p>Bedrag niet beschikbaar</p> : rows.length === 0 ? <p>Geen activiteit gemeld</p> : rows.map(row => <p className="detail-amount" key={row.currency}>{formatCurrency(row.amount, row.currency, row.decimals)} <small>{row.currency}</small></p>)}</section>;
}

export async function FinancialDetail({ kind, params, searchParams }: { kind: "categories" | "budgets"; params: Promise<{ id: string }>; searchParams: Promise<{ month?: string | string[]; page?: string | string[] }> }) {
  await requireUser();
  const { id } = await params;
  if (!isFireflyId(id)) notFound();
  const search = await searchParams, period = budgetPeriod(search.month), page = transactionPageNumber(search.page);
  const path = `/${kind}/${id}` as `/categories/${string}` | `/budgets/${string}`;
  const [detail, transactions] = await Promise.allSettled([
    kind === "categories" ? getCategoryDetail(id, period) : getBudgetDetail(id, period),
    getSelectedTransactions(period, page, { kind, id }),
  ]);
  const data = detail.status === "fulfilled" ? detail.value : null;
  return <>
    <header className="page-header"><div><p className="eyebrow">{kind === "categories" ? "CATEGORIE" : "BUDGET"}</p><h1>{data?.name ?? (kind === "categories" ? "Categorie" : "Budget")}</h1><Link className="card-link" href={transactionHref("/transactions", period.month)}>← Terug naar transacties</Link></div><RefreshButton /></header>
    <MonthNavigation path={path} period={period} />
    {!data ? <DataNotice error={detail.status === "rejected" ? detail.reason : undefined} /> : "rows" in data ? <BudgetList rows={data.rows} /> : <div className="detail-totals">
      <CategoryTotal title="Totaal uitgegeven" rows={data.spent} /><CategoryTotal title="Totale inkomsten" rows={data.earned} /><CategoryTotal title="Overschrijvingen" rows={data.transferred} />
    </div>}
    <section className="accounts-panel"><div className="panel-header"><div><h2>Transacties deze maand</h2><p>De selectie en bedragen komen rechtstreeks uit Firefly III.</p></div></div>
      {transactions.status === "fulfilled" ? <><TransactionTable rows={transactions.value.rows} month={period.month} /><div className="panel-footer">Firefly kan alleen de bijpassende delen van een gesplitste transactie teruggeven. Bedragen hierboven zijn volledige maandtotalen, geen som van deze pagina.</div><TransactionPagination data={transactions.value} path={path} month={period.month} /></> : <DataNotice error={transactions.reason} />}
    </section>
  </>;
}
