import { validateConfig } from "../src/lib/config-validation.ts";
import { validateAuthConfig } from "../src/lib/auth/config.ts";
import { initializeAuthState } from "../src/lib/auth/auth-state.ts";
import { validateDeploymentConfig } from "../src/lib/deployment-config.ts";

try {
  validateConfig(process.env);
} catch {
  console.error("Ember startup failed: configure valid server-side FIREFLY_BASE_URL and FIREFLY_API_TOKEN.");
  process.exit(1);
}

let authConfig;
try { authConfig = validateAuthConfig(process.env); }
catch {
  console.error("Ember startup failed: configure valid server-side authentication settings.");
  process.exit(1);
}

try { validateDeploymentConfig(process.env, authConfig.origin); }
catch {
  console.error("Ember startup failed: use a canonical public HTTPS hostname on port 443 for standalone-https, or reverse-proxy mode.");
  process.exit(1);
}

try { await initializeAuthState(authConfig); }
catch {
  console.error("Ember startup failed: persistent authentication state is unavailable.");
  process.exit(1);
}

// Same process: Node receives shutdown signals directly (Compose supplies an init).
await import("../server.js");
