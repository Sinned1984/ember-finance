import { requestAuthenticated } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return new Response(null, { status: await requestAuthenticated(request) ? 204 : 401, headers: { "Cache-Control": "private, no-store" } });
}
