import { requireUser } from "@/lib/auth/require-user";
import { getAssetAccounts } from "@/lib/firefly/accounts";
import { AccountList } from "@/components/account-list";
import { DataNotice } from "@/components/data-notice";
import { RefreshButton } from "@/components/refresh-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rekeningen · Ember Finance" };
export default async function Rekeningen() {
  await requireUser();
  let accounts;
  let failure: unknown;
  try { accounts = await getAssetAccounts(); } catch (error) { failure = error; }
  return <><header className="page-header"><div><p className="eyebrow">ALLES OP EEN RIJ</p><h1>Rekeningen</h1><p>Je betaal-, spaar- en overige vermogensrekeningen.</p></div><RefreshButton /></header>
    {accounts ? <AccountList accounts={accounts} /> : <DataNotice error={failure} />}
    <div className="panel-footer">Saldi in de oorspronkelijke valuta. Spaargeld is niet automatisch vrij besteedbaar.</div></>;
}

