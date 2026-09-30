import { authStateStatus } from "@/lib/auth/auth-state";
import { authConfig, requestAuthenticated } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await requestAuthenticated(request))) return Response.json({ error: "Niet ingelogd." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  try {
    const status = await authStateStatus(authConfig());
    return Response.json({ enabled: status.enabled, activatedAt: status.activatedAt }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "De beveiligingsstatus is tijdelijk niet beschikbaar." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
