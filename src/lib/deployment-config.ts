import { isIP } from "node:net";

// Container-startup validation only; authentication independently requires HTTPS.
export function validateDeploymentConfig(env: Record<string, string | undefined>, origin: string) {
  const mode = env.EMBER_DEPLOYMENT_MODE ?? "reverse-proxy";
  if (mode === "reverse-proxy") return mode;
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    if (mode !== "standalone-https" || env.EMBER_APP_URL !== origin || url.protocol !== "https:" ||
        url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
        isIP(hostname.replace(/^\[|\]$/g, "")) || hostname.length > 253 || !hostname.includes(".") ||
        !hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
        /\.(?:local|localhost|internal|test|invalid|example)$/.test(hostname) ||
        /\.(?:home\.arpa|ts\.net)$/.test(hostname)) throw new Error();
    return mode;
  } catch {
    throw new Error("Invalid Ember HTTPS deployment configuration.");
  }
}
