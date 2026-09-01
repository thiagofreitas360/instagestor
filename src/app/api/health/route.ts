import { getSqlClient } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getSqlClient()`SELECT 1`;
    return Response.json({ status: "ok", database: "ok", timestamp: new Date().toISOString() });
  } catch {
    return Response.json({ status: "degraded", database: "unavailable", timestamp: new Date().toISOString() }, { status: 503 });
  }
}
