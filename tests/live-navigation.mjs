import assert from 'node:assert/strict';
import { budgetPeriod } from '../src/lib/budget-period.ts';
import { getTransactions, getSelectedTransactions } from '../src/lib/firefly/transactions.ts';
import { getCategoryDetail, getBudgetDetail } from '../src/lib/firefly/details.ts';
import { getMonthlyBills, parseBillTotals } from '../src/lib/firefly/monthly-bills.ts';
import { getFireflyJson } from '../src/lib/firefly/client.ts';

// Opt-in live GET-only checks. Never print records, IDs, amounts, URLs, queries or credentials.
async function main() {
  let period = budgetPeriod(), data = await getTransactions(1, 25, period);
  if (!data.rows.length) { period = budgetPeriod(period.previous); data = await getTransactions(1, 25, period); }
  const older = data.totalPages > 1 ? await getTransactions(2, 25, period) : data;
  const candidate = older.rows.find(r => r.description.trim() && r.description.length <= 200 && !/[\\\x00-\x1f\x7f]/.test(r.description));
  if (candidate) {
    const found = await getSelectedTransactions(period, 1, { query: candidate.description });
    let matched = found.rows.some(r => r.id === candidate.id);
    // Bounded result pagination; never download the whole history.
    for (let page = 2; !matched && page <= Math.min(4, found.totalPages); page++) matched = (await getSelectedTransactions(period, page, { query: candidate.description })).rows.some(r => r.id === candidate.id);
    assert.ok(matched, 'Live monthly search did not recover the selected transaction');
    console.log(data.totalPages > 1 ? 'PASS: live search recovers a transaction from normal page 2' : 'PASS: live search; no second normal page available in sampled month');
  } else console.log('SKIP: no suitable live search fixture in sampled month');
  for (const kind of ['categories', 'budgets']) {
    const id = [...data.rows, ...older.rows].map(r => kind === 'categories' ? r.categoryId : r.budgetId).find(Boolean);
    if (!id) { console.log(`SKIP: no ${kind} identity in sampled pages`); continue; }
    const detail = kind === 'categories' ? await getCategoryDetail(id, period) : await getBudgetDetail(id, period);
    assert.ok(detail.name);
    const rows = await getSelectedTransactions(period, 1, { kind, id });
    assert.ok(rows.rows.every(r => (kind === 'categories' ? r.categoryId : r.budgetId) === id), 'Live detail selection must preserve Firefly IDs');
    const raw = await getFireflyJson(`api/v1/${kind}/${id}`, { start: period.start, end: period.end }, AbortSignal.timeout(15000), kind === 'categories' ? 'category' : 'budget');
    const expected = raw.data.attributes.spent ?? [];
    if (kind === 'categories') assert.ok((detail.spent ?? []).every(r => expected.some(s => s.currency_code === r.currency && s.sum.replace(/^-/, '') === r.amount.replace(/^-/, ''))), 'Category aggregate reconciliation failed');
    else assert.ok(detail.rows.filter(r => r.spent !== null).every(r => expected.some(s => s.currency_code === r.currency && s.sum.replace(/^-/, '') === r.spent.replace(/^-/, ''))), 'Budget aggregate reconciliation failed');
    console.log(`PASS: live ${kind} IDs, monthly selection and authoritative spending reconciliation`);
  }
  for (const month of [period.month, period.next]) {
    const selected = budgetPeriod(month), summary = await getMonthlyBills(selected);
    assert.ok(summary.bills !== null && summary.totals !== null, 'Live monthly bill responses incomplete');
    const raw = await getFireflyJson('api/v1/summary/basic', { start: selected.start, end: selected.end }, AbortSignal.timeout(15000), 'subscription');
    assert.ok(JSON.stringify(summary.totals) === JSON.stringify(parseBillTotals(raw)), 'Live bill summary changed or reconciliation failed');
  }
  console.log('PASS: live current/next-month bill matching/schedules and summary reconciliation; no data printed');
}
try { await main(); } catch { console.error('FAIL: live navigation contract/reconciliation check. No private response or error details printed.'); process.exitCode = 1; }
