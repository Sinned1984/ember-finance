// Exact decimal arithmetic. Numbers are used only for bounded visual bar widths.
function parts(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return { integer: BigInt(whole + fraction), scale: fraction.length };
}
function aligned(a: string, b: string) {
  const left = parts(a), right = parts(b);
  const scale = Math.max(left.scale, right.scale);
  return { a: left.integer * 10n ** BigInt(scale - left.scale), b: right.integer * 10n ** BigInt(scale - right.scale), scale };
}
export function subtractDecimal(a: string, b: string): string {
  const values = aligned(a, b), result = values.a - values.b;
  const digits = (result < 0n ? -result : result).toString().padStart(values.scale + 1, "0");
  return `${result < 0n ? "-" : ""}${values.scale ? digits.slice(0, -values.scale) + "." + digits.slice(-values.scale) : digits}`;
}
export function compareDecimal(a: string, b: string): number {
  const values = aligned(a, b);
  return values.a < values.b ? -1 : values.a > values.b ? 1 : 0;
}
export function barPercent(amount: string, largest: string): number {
  const values = aligned(amount, largest);
  if (values.a <= 0n || values.b <= 0n) return 0;
  return Number(values.a >= values.b ? 1000n : values.a * 1000n / values.b) / 10;
}
