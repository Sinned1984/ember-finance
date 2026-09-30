import "server-only";
import { readConfig } from "../env.ts";
import { nextSuppliedDate, subscriptionWindow } from "../subscription-dates.ts";
import { FireflyError } from "./client.ts";
import type { Subscription, SubscriptionEntry } from "./subscription-types.ts";

function invalid(): never { throw new FireflyError("Firefly returned an unsupported subscription response."); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function optional(value: unknown): string | null { if (value == null) return null; if (typeof value !== "string") return invalid(); return value; }
function required(value: unknown) { const result = optional(value); if (!result) return invalid(); return result; }
function amount(value: unknown) { const result = optional(value); if (result !== null && !/^-?\d+(\.\d+)?$/.test(result)) return invalid(); return result; }
function precision(value: unknown): number | null { if (value == null) return null; if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 30) return invalid(); return value; }
function date(value: unknown): string | null {
  const result = optional(value);
  if (result !== null) {
    const day = result.slice(0, 10);
    const parsed = new Date(`${day}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(result) || !Number.isFinite(Date.parse(result)) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return invalid();
  }
  return result?.slice(0, 10) ?? null;
}
function array(value: unknown): unknown[] { if (value == null) return []; if (!Array.isArray(value)) return invalid(); return value; }
function dates(value: unknown) { return array(value).map(value => { const result = date(value); if (!result) return invalid(); return result; }); }
function active(value: unknown) { if (value == null) return null; if (typeof value !== "boolean") return invalid(); return value; }
function billFrequency(value: unknown, skipValue: unknown) {
  const frequency = optional(value);
  if (!frequency) return null;
  const labels: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", "half-year": "Every half year", yearly: "Yearly" };
  if (!(frequency in labels)) return invalid();
  if (skipValue == null) return `${labels[frequency]} · skip interval unavailable`;
  if (typeof skipValue !== "number" || !Number.isSafeInteger(skipValue) || skipValue < 0) return invalid();
  return labels[frequency] + (skipValue ? ` · skip ${skipValue} occurrence${skipValue === 1 ? "" : "s"} between payments` : "");
}

export function parseSubscriptions(value: unknown, model: "bill" | "recurrence", expectedPage: number, today: string) {
  const root = object(value), pagination = object(object(root.meta).pagination);
  const pages = pagination.total_pages;
  if (!Array.isArray(root.data) || pagination.current_page !== expectedPage || typeof pages !== "number" || !Number.isInteger(pages) || pages < 0 || pages > 100 || (expectedPage > Math.max(1, pages)) || (pages === 0 && root.data.length > 0)) return invalid();
  const ids = new Set<string>();
  const subscriptions = root.data.map((value): Subscription => {
    const row = object(value), a = object(row.attributes), id = required(row.id);
    if (ids.has(id) || row.type !== (model === "bill" ? "bills" : "recurrences")) return invalid();
    ids.add(id);
    const enabled = active(a.active);
    if (model === "bill") {
      const endDate = date(a.end_date), expectedDate = date(a.next_expected_match);
      // The authoritative next match takes precedence. pay_dates is a bounded API-supplied fallback.
      const candidateDates = expectedDate ? [expectedDate] : dates(a.pay_dates);
      return { id, model, name: required(a.name), active: enabled, kind: null,
        minimum: amount(a.amount_min), maximum: amount(a.amount_max), currency: optional(a.currency_code), decimals: precision(a.currency_decimal_places),
        frequency: billFrequency(a.repeat_freq, a.skip), nextDate: enabled === true ? nextSuppliedDate(candidateDates, today, null, endDate) : null,
        expectedDate, endDate, notes: optional(a.notes), description: null, entries: [] };
    }
    const kind = optional(a.type);
    if (kind !== null && !["withdrawal", "deposit", "transfer"].includes(kind)) return invalid();
    const endDate = date(a.repeat_until), firstDate = date(a.first_date), latestDate = date(a.latest_date);
    const repetitions = array(a.repetitions).map(object);
    const suppliedDates = repetitions.flatMap(r => dates(r.occurrences)).filter(day => !latestDate || day > latestDate);
    const frequency = repetitions.map(r => optional(r.description)).filter(Boolean).join("; ") || null;
    const entries = array(a.transactions).map((value): SubscriptionEntry => {
      const t = object(value);
      return { description: optional(t.description), amount: amount(t.amount), currency: optional(t.currency_code), decimals: precision(t.currency_decimal_places), source: optional(t.source_name), destination: optional(t.destination_name), category: optional(t.category_name) };
    });
    return { id, model, name: required(a.title), active: enabled, kind: kind as Subscription["kind"], minimum: null, maximum: null, currency: null, decimals: null,
      frequency, nextDate: enabled === true ? nextSuppliedDate(suppliedDates, today, firstDate, endDate) : null,
      expectedDate: null, endDate, notes: optional(a.notes), description: optional(a.description), entries };
  });
  return { subscriptions, pages };
}

export async function getSubscriptions(model: "bill" | "recurrence", now = new Date()): Promise<Subscription[]> {
  const window = subscriptionWindow(now), { baseUrl, token } = readConfig();
  const signal = AbortSignal.timeout(15_000);
  const subscriptions: Subscription[] = [], ids = new Set<string>();
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const url = new URL(model === "bill" ? "api/v1/bills" : "api/v1/recurrences", baseUrl);
    url.search = new URLSearchParams({ page: String(page), limit: "50" }).toString();
    if (model === "bill") { url.searchParams.set("start", window.start); url.searchParams.set("end", window.end); }
    try {
      const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store", redirect: "error", signal });
      if (!response.ok) { await response.body?.cancel(); throw new FireflyError("Firefly could not provide subscriptions. Check server access and try again."); }
      const result = parseSubscriptions(await response.json(), model, page, window.start);
      if (page > 1 && pages !== result.pages) return invalid();
      pages = result.pages;
      for (const subscription of result.subscriptions) { if (ids.has(subscription.id)) return invalid(); ids.add(subscription.id); subscriptions.push(subscription); }
    } catch (error) {
      if (error instanceof FireflyError) throw error;
      throw new FireflyError("Unable to read Firefly subscriptions. Check the server connection and try again.");
    }
  }
  return subscriptions;
}

