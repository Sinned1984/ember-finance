// Pure validation shared by server-only configuration and the container entrypoint.
// Never reads process.env itself or returns configuration through a client endpoint.
export class ConfigurationError extends Error {
  constructor() {
    super("Set a valid FIREFLY_BASE_URL and FIREFLY_API_TOKEN in the server environment, then restart Ember.");
  }
}

export function validateConfig(env: Record<string, string | undefined>) {
  const token = env.FIREFLY_API_TOKEN?.trim();
  try {
    const url = new URL(env.FIREFLY_BASE_URL ?? "");
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || !token || /\s/.test(token) || token === 'replace-with-your-personal-access-token') {
      throw new ConfigurationError();
    }
    url.pathname = url.pathname.replace(/\/+$/, '') + '/';
    return { baseUrl: url.toString(), token };
  } catch {
    throw new ConfigurationError();
  }
}
