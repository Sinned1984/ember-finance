import QRCode from "qrcode";
import { beginTotpSetup } from "@/lib/auth/totp";
import { sameOriginPost } from "@/lib/auth/login-policy";
import { authConfig, requestAuthenticated } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const config = authConfig();
    if (!sameOriginPost(request, config.origin)) return Response.json({ error: "Ongeldig verzoek." }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
    if (!(await requestAuthenticated(request))) return Response.json({ error: "Niet ingelogd." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
    const setup = await beginTotpSetup(config);
    if (setup.status === "already-enabled") return Response.json({ error: "2FA is al ingeschakeld." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    const qrCode = await QRCode.toDataURL(setup.uri, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 256,
      color: { dark: "#13141cff", light: "#f1edf7ff" },
    });
    return Response.json({ qrCode, secret: setup.secret, expires: setup.expires }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "2FA instellen is tijdelijk niet beschikbaar." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
