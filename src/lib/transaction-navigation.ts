// URL state is shared by normal pagination, search and drill-downs; no browser data cache.
export function transactionHref(path: string, month: string, page = 1, query = "") {
  const params = new URLSearchParams({ month });
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  return `${path}?${params}`;
}

export function transactionSearch(value: string | string[] | undefined) {
  const query = typeof value === "string" ? value.trim() : "";
  // Keep the existing bounded URL-input policy; search text is never an API operator.
  const error = Array.isArray(value) || query.length > 200 || /[\\\x00-\x1f\x7f]/.test(query)
    ? "Gebruik maximaal 200 tekens, zonder backslashes of besturingstekens." : null;
  return { query, error };
}

export const isFireflyId = (id: string) => /^[1-9]\d{0,18}$/.test(id);
