import type { AssetAccount } from "@/lib/firefly/types";
import { formatCurrency, formatDate } from "@/lib/format";
import { TableScrollHint } from "./table-scroll-hint";

export function AccountList({ accounts }: { accounts: AssetAccount[] }) {
  if (!accounts.length) return <div className="empty-state"><span className="empty-icon" aria-hidden="true">◫</span><h3>Nog geen rekeningen</h3><p>Je vermogensrekeningen uit Firefly III verschijnen hier.</p></div>;
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="Rekeningsaldi; schuif horizontaal om alle kolommen te zien"><TableScrollHint /><table className="account-table">
    <thead><tr><th scope="col">Rekening</th><th scope="col">Status</th><th scope="col">Saldodatum</th><th scope="col">Valuta</th><th scope="col" className="amount-column">Saldo</th></tr></thead>
    <tbody>{accounts.map(account => <tr key={account.id}>
      <td><div className="account-name"><span className="account-icon" aria-hidden="true">{account.name.slice(0, 2).toUpperCase()}</span><div><h3>{account.name}</h3><p>Vermogensrekening</p></div></div></td>
      <td><span className={`status-badge ${account.active ? "active" : "inactive"}`}><span className="status-dot" />{account.active ? "Actief" : "Inactief"}</span></td>
      <td className="date-cell">{formatDate(account.balanceDate)}</td>
      <td><span className="currency-badge">{account.currency || "Niet beschikbaar"}</span></td>
      <td className="account-balance">{formatCurrency(account.balance, account.currency, account.decimals)}</td>
    </tr>)}</tbody>
  </table></div>;
}

