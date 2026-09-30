import Link from "next/link";
import { isFireflyId, transactionHref } from "@/lib/transaction-navigation";
import { formatDate } from "@/lib/format";
import { transactionAmountLabel, transactionTypeLabels } from "@/lib/transaction-search";
import { TransactionDescription } from "./transaction-description";
import { TableScrollHint } from "./table-scroll-hint";
import type { TransactionRow } from "@/lib/firefly/transaction-types";

export function TransactionTable({ rows, month }: { rows: TransactionRow[]; month?: string }) {
  const metadata = (name: string | null, id: string | null, kind: "categories" | "budgets", row: TransactionRow) =>
    name && id && isFireflyId(id) ? <Link className="metadata-link" prefetch={false} href={transactionHref(`/${kind}/${id}`, month ?? row.date.slice(0, 7))}>{name}</Link> : name || "—";
  return <>
    {!rows.length ? <div className="empty-state"><h3>Geen transacties</h3><p>Er zijn geen transacties voor deze selectie.</p></div> :
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Transacties; schuif horizontaal om alle kolommen te zien"><TableScrollHint /><table className="account-table transaction-table"><thead><tr>
        <th scope="col">Datum</th><th scope="col">Omschrijving</th><th scope="col" className="amount-column">Bedrag</th><th scope="col">Soort</th><th scope="col">Van rekening</th><th scope="col">Naar rekening</th><th scope="col">Categorie</th><th scope="col">Budget</th>
      </tr></thead><tbody>{rows.map(row => <tr key={row.id}>
        <td className="date-cell"><time dateTime={row.date}>{formatDate(row.date)}</time></td>
        <td className="transaction-description"><TransactionDescription text={row.description || "Transactie zonder omschrijving"} />{row.split && <div className="split-label">Deeltransactie{row.groupTitle ? <> · <TransactionDescription text={row.groupTitle} /></> : ""}</div>}</td>
        <td className={`account-balance transaction-${row.type.replace(" ", "-")}`}>{transactionAmountLabel(row)}</td>
        <td><span className={`transaction-type transaction-${row.type.replace(" ", "-")}`}>{transactionTypeLabels[row.type]}</span></td>
        <td>{row.source || "—"}</td><td>{row.destination || "—"}</td><td>{metadata(row.category, row.categoryId, "categories", row)}</td><td>{metadata(row.budget, row.budgetId, "budgets", row)}</td>
      </tr>)}</tbody></table></div>}
  </>;
}

