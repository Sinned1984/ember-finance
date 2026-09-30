import { getIronSession } from "iron-session";
import { activateTotp } from "@/lib/auth/totp";
import { enrollmentThrottle, sameOriginPost, totpField } from "@/lib/auth/login-policy";
import { preAuthOptions, revokeAllPreAuth, type PreAuthData } from "@/lib/auth/preauth";
import { authConfig, requestAuthenticated, revokeAllSessions, sessionOptions, type SessionData } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  let reserved = false;
  try {
    const config = authConfig();
    if (!sameOriginPost(request, config.origin)) return json({ error: "Ongeldig verzoek." }, 403);
    if (!(await requestAuthenticated(request))) return json({ error: "Niet ingelogd." }, 401);
    reserved = enrollmentThrottle.reserve();
    if (!reserved) return json({ error: "Te veel pogingen. Probeer het later opnieuw." }, 429);
    const code = await totpField(request);
    const activation = await activateTotp(config, code ?? "");
    if (activation.status === "invalid") return json({ error: "De verificatiecode is ongeldig." }, 400);
    if (activation.status === "expired") return json({ error: "De setup is verlopen. Begin opnieuw." }, 410);
    if (activation.status === "already-enabled") return json({ error: "2FA is al ingeschakeld." }, 409);

    const response = json({ activated: true });
    response.headers.set("Clear-Site-Data", '"cache"');
    await revokeAllSessions(config).catch(() => {});
    await revokeAllPreAuth(config).catch(() => {});
    const session = await getIronSession<SessionData>(request, response, sessionOptions(config));
    session.destroy();
    const preAuth = await getIronSession<PreAuthData>(request, response, preAuthOptions(config));
    preAuth.destroy();
    return response;
  } catch {
    return json({ error: "2FA activeren is tijdelijk niet beschikbaar." }, 503);
  } finally {
    if (reserved) enrollmentThrottle.release();
  }
}
