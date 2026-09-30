// Only derive fields absent from Firefly. Never convert money to floating point.
export function negateDecimal(value: string) { return value.startsWith("-") ? value.slice(1) : `-${value}`; }
export function budgetUsage(limit: string, spent: string) {
  const scale = Math.max(limit.split(".")[1]?.length ?? 0, spent.split(".")[1]?.length ?? 0);
  const units = (value: string) => {
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    return BigInt(whole + fraction.padEnd(scale, "0")) * (value.startsWith("-") ? -1n : 1n);
  };
  const l = units(limit), s = units(spent), difference = l - s;
  const digits = (difference < 0n ? -difference : difference).toString().padStart(scale + 1, "0");
  const remaining = `${difference < 0n ? "-" : ""}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
  const status = s > l ? "over" : l > 0n && s * 100n >= l * 80n ? "close" : "within";
  const tenths = l > 0n ? (s * 1000n) / l : null;
  const percentage = tenths === null ? null : `${tenths < 0n ? "-" : ""}${(tenths < 0n ? -tenths : tenths) / 10n}.${(tenths < 0n ? -tenths : tenths) % 10n}`;
  const progress = l > 0n ? Number(s <= 0n ? 0n : s >= l ? 1000n : s * 1000n / l) / 10 : s > 0n ? 100 : 0;
  return { remaining, percentage, progress, status };
}

