// Pure deployment validation, also used before standalone startup. Never reads env itself.
export function validateAuthConfig(env: Record<string, string | undefined>) {
  try {
    const username = env.EMBER_AUTH_USERNAME ?? "";
    const passwordHash = env.EMBER_AUTH_PASSWORD_HASH ?? "";
    const secret = env.EMBER_AUTH_SECRET ?? "";
    const url = new URL(env.EMBER_APP_URL ?? "");
    const production = env.NODE_ENV === "production";
    if (!username.trim() || username !== username.trim() || username.length > 128 || /[\x00-\x1f\x7f]/.test(username) ||
        !/^\$2[aby]\$(12|13|14)\$[./A-Za-z0-9]{53}$/.test(passwordHash) ||
        !/^[A-Za-z0-9_-]{43,128}$/.test(secret) || new Set(secret).size < 16 ||
        url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
        (url.protocol !== "https:" && (production || url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
      throw new Error();
    }
    return { username, passwordHash, secret, origin: url.origin, production };
  } catch {
    throw new Error("Invalid Ember authentication configuration.");
  }
}

export type AuthConfig = ReturnType<typeof validateAuthConfig>;
