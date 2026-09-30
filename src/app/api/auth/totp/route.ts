import { getIronSession } from "iron-session";
import { authConfig, createSession, revokeSession, sessionOptions, type SessionData } from "@/lib/auth/session";
import { activePreAuth, preAuthOptions, registerPreAuthFailure, revokePreAuth, type PreAuthData } from "@/lib/auth/preauth";
import { sameOriginPost, totpField, totpThrottle } from "@/lib/auth/login-policy";
import { verifyTotpOnce } from "@/lib/auth/totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (location: string) => new Response(null, { status: 303, headers: { Location: location, "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  let reserved = false;
  try {
    const config = authConfig();
    if (!sameOriginPost(request, config.origin)) return response("/login/2fa?error=1");
    reserved = totpThrottle.reserve();
    if (!reserved) return response("/login?error=2fa");

    const result = response("/login/2fa?error=1");
    const preAuth = await getIronSession<PreAuthData>(request, result, preAuthOptions(config));
    if (!(await activePreAuth(preAuth, config))) {
      preAuth.destroy();
      result.headers.set("Location", "/login?error=expired");
      return result;
    }

    const code = await totpField(request);
    if (!code || !(await verifyTotpOnce(config, code))) {
      if (!(await registerPreAuthFailure(preAuth, config))) {
        preAuth.destroy();
        result.headers.set("Location", "/login?error=2fa");
      }
      return result;
    }

    await revokePreAuth(preAuth, config);
    preAuth.destroy();
    result.headers.set("Location", "/");
    const session = await getIronSession<SessionData>(request, result, sessionOptions(config));
    await revokeSession(session, config);
    Object.assign(session, await createSession(config, preAuth.generation));
    await session.save();
    return result;
  } catch { return response("/login/2fa?error=1"); }
  finally { if (reserved) totpThrottle.release(); }
}
