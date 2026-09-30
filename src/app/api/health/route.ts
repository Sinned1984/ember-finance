export const dynamic = "force-dynamic";

// Liveness only: independent of Firefly, credentials and private financial data.
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
