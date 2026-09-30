import { compare } from "bcryptjs";
import { getIronSession } from "iron-session";
import { authConfig, createSession, revokeSession, sessionOptions, type SessionData } from "@/lib/auth/session";
import { loginFields, loginThrottle, sameOriginPost } from "@/lib/auth/login-policy";
import { createPreAuth, preAuthOptions, revokePreAuth, type PreAuthData } from "@/lib/auth/preauth";
import { authStateStatus } from "@/lib/auth/auth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const failed = () => new Response(null, { status: 303, headers: { Location: "/login?error=1", "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  let reserved = false;
  try {
    const config = authConfig();
    if (!sameOriginPost(request, config.origin)) return failed();
    reserved = loginThrottle.reserve();
    if (!reserved) return failed();
    const fields = await loginFields(request);
    if (!fields) return failed();
    // Check password even for a wrong username; never disclose which field failed.
    const correct = await compare(fields.password, config.passwordHash);
    if (!correct || fields.username !== config.username) return failed();
    const state = await authStateStatus(config);
    if (state.enabled) {
      const response = new Response(null, { status: 303, headers: { Location: "/login/2fa", "Cache-Control": "private, no-store" } });
      const preAuth = await getIronSession<PreAuthData>(request, response, preAuthOptions(config));
      await revokePreAuth(preAuth, config);
      Object.assign(preAuth, await createPreAuth(config, state.generation));
      await preAuth.save();
      return response;
    }
    const response = new Response(null, { status: 303, headers: { Location: "/", "Cache-Control": "private, no-store" } });
    const session = await getIronSession<SessionData>(request, response, sessionOptions(config));
    await revokeSession(session, config);
    Object.assign(session, await createSession(config, state.generation));
    await session.save();
    return response;
  } catch { return failed(); }
  finally { if (reserved) loginThrottle.release(); }
}
