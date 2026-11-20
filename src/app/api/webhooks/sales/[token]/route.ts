import { ingestSalesEvent } from "@/server/sales";

export const dynamic = "force-dynamic";

// Recebe avisos do bot/gateway de vendas (XyronBot, SharkBot, MadBot ou genérico).
// Corpo JSON: { event|status|event_name|type, id, amount|value, product_name }.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const result = await ingestSalesEvent(token, body);
  return Response.json({ ok: result.ok, result: result.result }, { status: result.status });
}
