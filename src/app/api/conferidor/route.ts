import { z } from "zod";
import { finishHighlightCheck, organizationForCheckerKey, pendingHighlightChecks, recordHighlightCheck } from "@/server/highlight-checker";

export const runtime = "nodejs";

// Chamado só pelo conferidor de destaques no PC do cliente, autenticado pela chave embutida no programa baixado.
const result = z.union([
  z.object({ fatal: z.string().min(1).max(300) }),
  z.object({
    accountId: z.uuid(),
    destaques: z.number().int().min(0).max(100_000).nullable(),
    erro: z.string().min(1).max(300).nullable(),
  }),
]);

async function organizationFrom(request: Request) {
  const key = request.headers.get("authorization")?.match(/^Bearer ([\w-]{20,100})$/)?.[1];
  return key ? organizationForCheckerKey(key) : null;
}

export async function GET(request: Request) {
  const organizationId = await organizationFrom(request);
  if (!organizationId) return new Response("Chave inválida", { status: 401 });
  return Response.json({ contas: await pendingHighlightChecks(organizationId) });
}

export async function POST(request: Request) {
  const organizationId = await organizationFrom(request);
  if (!organizationId) return new Response("Chave inválida", { status: 401 });
  const parsed = result.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Resultado inválido", { status: 400 });
  if ("fatal" in parsed.data) await finishHighlightCheck(organizationId, parsed.data.fatal);
  else await recordHighlightCheck(organizationId, parsed.data.accountId, parsed.data.destaques, parsed.data.erro);
  return Response.json({ ok: true });
}
