export function subscriptionWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const start = `${part("year")}-${part("month")}-${part("day")}`;
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 90);
  return { start, end: end.toISOString().slice(0, 10) };
}

// Select only dates returned by Firefly; never generate a recurrence schedule.
export function nextSuppliedDate(dates: string[], today: string, first: string | null = null, end: string | null = null) {
  return dates.map(date => date.slice(0, 10)).filter(date => date >= today && (!first || date >= first) && (!end || date <= end)).sort()[0] ?? null;
}

