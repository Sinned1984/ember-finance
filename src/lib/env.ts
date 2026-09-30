import "server-only";

import { validateConfig } from "./config-validation.ts";
export { ConfigurationError } from "./config-validation.ts";

export function readConfig(env: Record<string, string | undefined> = process.env) {
  return validateConfig(env);
}

