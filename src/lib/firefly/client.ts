import "server-only";
import { readConfig } from "../env.ts";

export class FireflyError extends Error {}

export async function getAccountPage(page: number, signal: AbortSignal): Promise<unknown> {
  return getFireflyJson("api/v1/accounts", { type: "asset", page: String(page), limit: "50" }, signal, "account");
}

// Only server-side callers supply a fixed API path; never follow API response links.
export async function getFireflyJson(path: string, query: Record<string, string>, signal: AbortSignal, feature: "account" | "report" | "transaction" | "category" | "budget" | "subscription"): Promise<unknown> {
  const { baseUrl, token } = readConfig();
  if (!/^api\/v1\/[a-z/-]+$/.test(path) && !/^api\/v1\/(categories|budgets)\/[1-9]\d{0,18}(\/transactions|\/limits)?$/.test(path)) throw new FireflyError("Invalid API request.");
  const url = new URL(path, baseUrl);
  url.search = new URLSearchParams(query).toString();
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new FireflyError(response.status === 401 || response.status === 403
        ? "Firefly rejected access. Check the server API token and its permissions."
        : `Firefly could not provide ${feature} data. Please try again later.`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof FireflyError) throw error;
    throw new FireflyError(`Unable to read Firefly ${feature} data. Check the server connection and try again.`);
  }
}

