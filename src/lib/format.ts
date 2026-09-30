import { compareDecimal } from "./report-math.ts";

export const unavailable = "Niet beschikbaar";
const integerFormat = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });

// Presentation only: never convert decimal financial strings to Number or round them.
export function formatDecimal(value: string | null, decimals = 0): string {
  if (value === null) return unavailable;
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const digits = fraction.replace(/0+$/, "").padEnd(decimals, "0");
  return `${value.startsWith("-") ? "−" : ""}${integerFormat.format(BigInt(whole))}${digits ? `,${digits}` : ""}`;
}

export function formatCurrency(value: string | null, currency: string | null, decimals: number | null = null, showPlus = false): string {
  if (value === null) return unavailable;
  const plus = showPlus && !value.startsWith("-") ? "+" : "";
  if (!currency) return `${plus}${formatDecimal(value, decimals ?? 0)} (valuta onbekend)`;
  if (!/^[A-Z]{3}$/.test(currency)) return `${currency} ${plus}${formatDecimal(value, decimals ?? 0)}`;
  const formatter = new Intl.NumberFormat("nl-NL", { style: "currency", currency, signDisplay: showPlus ? "always" : "auto" });
  const digits = formatDecimal(value.replace(/^-/, ""), decimals ?? formatter.resolvedOptions().minimumFractionDigits);
  let inserted = false;
  return formatter.formatToParts(value.startsWith("-") ? -1n : 1n).map(part => {
    if (["integer", "group", "decimal", "fraction"].includes(part.type)) {
      if (inserted) return "";
      inserted = true; return digits;
    }
    return part.type === "minusSign" ? "−" : part.value;
  }).join("");
}

function calendarDate(value: string | null) {
  if (!value) return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day ? date : null;
}
export function formatDate(value: string | null, style: "short" | "long" = "short"): string {
  const date = calendarDate(value);
  if (!date) return unavailable;
  return new Intl.DateTimeFormat("nl-NL", { day: style === "short" ? "2-digit" : "numeric", month: style === "short" ? "2-digit" : "long", year: "numeric", timeZone: "UTC" }).format(date);
}
export function formatMonth(month: string): string {
  const date = calendarDate(`${month}-01`);
  return date ? new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" }).format(date) : unavailable;
}
export function formatPercentage(value: string | null): string {
  return value === null ? unavailable : `${formatDecimal(value)}%`;
}
export function comparisonText(change: string | null, currency: string, previousLabel: string): string {
  if (change === null) return "Vergelijking niet beschikbaar";
  const sign = compareDecimal(change, "0");
  return sign === 0 ? `Gelijk aan ${previousLabel}` : `${formatCurrency(change.replace(/^-/, ""), currency)} ${sign > 0 ? "hoger" : "lager"} dan ${previousLabel}`;
}
