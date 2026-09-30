// Format the decimal string without converting financial values to floating point.
export function formatBalance(balance: string | null, decimals: number | null): string {
  if (balance === null) return "Unavailable";
  const negative = balance.startsWith("-");
  const [whole, rawFraction = ""] = balance.replace(/^-/, "").split(".");
  const fraction = rawFraction.replace(/0+$/, "").padEnd(decimals ?? rawFraction.length, "0");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

