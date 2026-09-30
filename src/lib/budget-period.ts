export function budgetPeriod(value?: string | string[], now = new Date()) {
  const current = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit" }).formatToParts(now);
  const fallback = `${current.find(p => p.type === "year")!.value}-${current.find(p => p.type === "month")!.value}`;
  const month = typeof value === "string" && /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value) ? value : fallback;
  const [year, number] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const shift = (delta: number) => {
    const date = new Date(Date.UTC(year, number - 1 + delta, 1));
    return date.toISOString().slice(0, 7);
  };
  return { month, start: `${month}-01`, end: `${month}-${end}`, previous: month === "1900-01" ? null : shift(-1), next: month === "2199-12" ? null : shift(1),
    label: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, number - 1, 1))) };
}
export type BudgetPeriod = ReturnType<typeof budgetPeriod>;

