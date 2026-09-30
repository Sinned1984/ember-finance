import { NextRequest, NextResponse } from "next/server";
import { authConfig, requestAuthenticated } from "./lib/auth/session";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Exact public application routes; never exempt arbitrary file extensions or /api/*.
  const publicRoute = ["/login", "/login/2fa", "/api/auth/login", "/api/auth/totp", "/api/auth/logout", "/api/health"].includes(path);
  if (!publicRoute && !(await requestAuthenticated(request))) {
    // Redirect only to the configured public origin, never a supplied Host header.
    let loginUrl;
    try { loginUrl = new URL("/login", authConfig().origin).href; }
    catch { return new NextResponse("Inloggen is tijdelijk niet beschikbaar.", { status: 503, headers: { "Cache-Control": "no-store" } }); }
    return path.startsWith("/api/")
      ? NextResponse.json({ error: "Niet ingelogd." }, { status: 401, headers: { "Cache-Control": "private, no-store" } })
      : new NextResponse(null, { status: 303, headers: { Location: loginUrl, "Cache-Control": "private, no-store" } });
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static/).*)"] };
