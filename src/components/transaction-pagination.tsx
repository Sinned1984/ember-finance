import Link from "next/link";
import { transactionHref } from "@/lib/transaction-navigation";
import type { TransactionPage } from "@/lib/firefly/transaction-types";

export function TransactionPagination({ data, path, month, query = "" }: { data: TransactionPage; path: string; month: string; query?: string }) {
  const { page, totalPages, total } = data;
  return <nav className="pagination" aria-label="Transactiepagina’s">
    {page > 1 ? <Link className="button" href={transactionHref(path, month, page - 1, query)} prefetch={false}>Vorige</Link> : <span className="button disabled" aria-disabled="true">Vorige</span>}
    <span>{page > Math.max(1, totalPages) ? "Deze pagina bestaat niet" : `Pagina ${page} van ${Math.max(1, totalPages)}`} · {total} {query ? "gevonden transacties in deze maand" : "resultaten volgens Firefly"}</span>
    {page < totalPages ? <Link className="button" href={transactionHref(path, month, page + 1, query)} prefetch={false}>Volgende</Link> : <span className="button disabled" aria-disabled="true">Volgende</span>}
    {page > Math.max(1, totalPages) && <Link className="button" href={transactionHref(path, month, 1, query)}>Eerste pagina</Link>}
  </nav>;
}
