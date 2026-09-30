import { getIronSession } from "iron-session";
import { authConfig, revokeSession, sessionOptions, type SessionData } from "@/lib/auth/session";
import { sameOriginPost } from "@/lib/auth/login-policy";
import { preAuthOptions, revokePreAuth, type PreAuthData } from "@/lib/auth/preauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const config = authConfig();
    if (!sameOriginPost(request, config.origin)) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
    const response = new Response(null, { status: 303, headers: {
      Location: "/login", "Cache-Control": "private, no-store", "Clear-Site-Data": '"cache"',
    } });
    const session = await getIronSession<SessionData>(request, response, sessionOptions(config));
    await revokeSession(session, config);
    session.destroy();
    const preAuth = await getIronSession<PreAuthData>(request, response, preAuthOptions(config));
    await revokePreAuth(preAuth, config);
    preAuth.destroy();
    return response;
  } catch { return new Response("Uitloggen is tijdelijk niet mogelijk. Probeer het opnieuw.", { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
