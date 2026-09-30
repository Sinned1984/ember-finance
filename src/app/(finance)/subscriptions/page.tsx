import { requireUser } from "@/lib/auth/require-user";
import { getSubscriptions } from "@/lib/firefly/subscriptions";
import { SubscriptionList } from "@/components/subscription-list";
import { DataNotice } from "@/components/data-notice";
import { RefreshButton } from "@/components/refresh-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Abonnementen · Ember Finance" };
export default async function Abonnementen() {
  await requireUser();
  const [bills, recurrences] = await Promise.allSettled([getSubscriptions("bill"), getSubscriptions("recurrence")]);
  return <><header className="page-header subscriptions-header"><div><p className="eyebrow">BINNENKORT VERWACHT</p><h1>Abonnementen</h1><p>Je abonnementen en terugkerende transacties op een rij.</p></div><RefreshButton /></header>
    <section aria-labelledby="subscriptions-heading"><div className="panel-header"><div><h2 id="subscriptions-heading">Abonnementen</h2><p>Verwachte bedragen en betaaldata.</p></div></div>
      {bills.status === "fulfilled" ? <SubscriptionList items={bills.value} model="bill" /> : <DataNotice error={bills.reason} />}
      <div className="panel-footer">Een verwachte datum betekent niet dat de betaling al is verwerkt.</div></section>
    {recurrences.status === "fulfilled" && !recurrences.value.length ? <p className="compact-empty">Geen terugkerende transacties ingesteld.</p> : <section className="recurrences-section" aria-labelledby="recurrences-heading"><div className="panel-header"><div><h2 id="recurrences-heading">Terugkerende transacties</h2><p>Afzonderlijke schema’s; deze kunnen overlappen met je abonnementen.</p></div></div>
      {recurrences.status === "fulfilled" ? <SubscriptionList items={recurrences.value} model="recurrence" /> : <DataNotice error={recurrences.reason} />}
      <p className="budget-footnote">Alleen bekende data worden getoond. De lijsten worden niet bij elkaar opgeteld.</p></section>}
  </>;
}


