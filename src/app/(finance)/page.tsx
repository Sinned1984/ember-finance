import { requireUser } from "@/lib/auth/require-user";
import { budgetPeriod } from "@/lib/budget-period";
import { MonthNavigation } from "@/components/month-navigation";
import { SubscriptionSummary } from "@/components/subscription-summary";
import { ReportSummary } from "@/components/report-summary";
import { BudgetSummary } from "@/components/budget-summary";
import Link from "next/link";
import { TransactionTable } from "@/components/transaction-table";
import { DataNotice, dataErrorMessage } from "@/components/data-notice";
import { getTransactions } from "@/lib/firefly/transactions";
import { RefreshButton } from "@/components/refresh-button";
import { ConfigurationError } from "@/lib/env";
import { getAssetAccounts } from "@/lib/firefly/accounts";
import type { AssetAccount } from "@/lib/firefly/types";

export const dynamic = "force-dynamic";

export default async function Overzicht({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  await requireUser();
  const period = budgetPeriod((await searchParams).month);
  let accounts: AssetAccount[] | undefined;
  let issue: { title: string; message: string } | undefined;
  try {
    accounts = (await getAssetAccounts()).filter(account => account.active);
  } catch (error) {
    issue = {
      title: error instanceof ConfigurationError ? "Verbind met Firefly III" : "Rekeningen niet beschikbaar",
      message: dataErrorMessage(error),
    };
  }
  let recent;
  let transactionError: unknown;
  try { recent = await getTransactions(1, 5); } catch (error) { transactionError = error; }
  return <>
    <header className="page-header"><div><p className="eyebrow">JE FINANCIËN IN ÉÉN OOGOPSLAG</p><h1>Overzicht</h1><p>Rust en overzicht in je dagelijkse financiën.</p></div><RefreshButton /></header>
    <div className="overview-accounts"><Link href="/accounts">{accounts ? `${accounts.length} actieve rekeningen` : "Bekijk rekeningen"} <span aria-hidden="true">↗</span></Link></div>
    <MonthNavigation period={period} path="/" />
    <div className="dashboard-grid">
      <SubscriptionSummary period={period} />
      <BudgetSummary period={period} />
    </div>
    <ReportSummary period={period} />
    {issue && <div className="notice" role="status"><h3>{issue.title}</h3><p>{issue.message}</p><RefreshButton label="Opnieuw proberen" /></div>}
    <section className="accounts-panel" aria-labelledby="recent-heading">
      <div className="panel-header"><div><h2 id="recent-heading">Recente transacties</h2><p>De laatste bij- en afschrijvingen.</p></div><Link className="button" href="/transactions">Bekijk alle ↗</Link></div>
      {recent ? <TransactionTable rows={recent.rows} /> : <DataNotice error={transactionError} />}
      <div className="panel-footer">De laatste vijf transacties, met gesplitste bedragen apart weergegeven.</div>
    </section>
    <footer className="page-footer"><span>Ember Finance</span><span>Je gegevens blijven bij je eigen Firefly III.</span></footer>
  </>;
}





