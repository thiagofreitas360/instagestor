import { DateTime } from "luxon";
import { getSqlClient } from "@/db/client";
import { decryptToken, encryptToken, randomSecret, sha256 } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { deltaPercent, resolvePeriod } from "@/server/analytics";

export type SalesPreset = "today" | "yesterday" | "7d" | "30d" | "total";
export const SALES_PRESETS: SalesPreset[] = ["today", "yesterday", "7d", "30d", "total"];
export const SALES_PRESET_LABELS: Record<SalesPreset, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  "7d": "7 dias",
  "30d": "30 dias",
  total: "Total",
};

// Nome do evento recebido (qualquer caixa) → tipo interno. Cobre XyronBot/SharkBot/MadBot e genéricos.
const EVENT_ALIASES: Record<string, "LEAD" | "PIX" | "SALE" | "UPSELL"> = {
  lead: "LEAD", user_joined: "LEAD", start_bot: "LEAD", novo_lead: "LEAD",
  pix_generated: "PIX", pix_gerado: "PIX", payment_created: "PIX", waiting_payment: "PIX", initiatecheckout: "PIX",
  paid: "SALE", approved: "SALE", payment_approved: "SALE", pix_pago: "SALE", venda_aprovada: "SALE", purchase: "SALE",
  upsell: "UPSELL", upsell_approved: "UPSELL",
};

function asObj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function pickAmountCents(body: Record<string, unknown>): number | null {
  // Muitos provedores (SharkBot etc.) aninham tudo em `data`. Procuramos o valor
  // bruto da venda em data.transaction / transaction / payment / order e no topo.
  const data = asObj(body.data) ?? body;
  const tx = asObj(data.transaction) ?? asObj(body.transaction);
  const pay = asObj(data.payment) ?? asObj(body.payment);
  const order = asObj(data.order) ?? asObj(body.order);
  const raw =
    tx?.amount ?? tx?.value ?? tx?.total ?? tx?.total_price ?? tx?.price ??
    pay?.amount ?? pay?.value ??
    order?.amount ?? order?.total ?? order?.total_price ??
    data.amount ?? data.value ?? data.total ?? data.total_price ?? data.price ?? data.valor ??
    body.amount ?? body.value ?? body.total ?? body.price;
  if (raw === null || raw === undefined) return null;
  let num: number;
  if (typeof raw === "number") {
    num = raw;
  } else {
    // string: "R$ 1.234,56" / "97,50" / "97.50"
    let s = String(raw).replace(/[^\d.,-]/g, "");
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); // pt-BR: ponto milhar, vírgula decimal
    num = Number(s);
  }
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function salesWebhookUrl(token: string) {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/api/webhooks/sales/${token}`;
}

/** Retorna o token do webhook da organização, criando-o na primeira vez. */
export async function getOrCreateSalesToken(organizationId: string): Promise<string> {
  const sql = getSqlClient();
  const [existing] = await sql<Array<{ encrypted_token: string }>>`
    SELECT encrypted_token FROM sales_webhooks WHERE organization_id = ${organizationId}
  `;
  if (existing) return decryptToken(existing.encrypted_token);
  const token = randomSecret(24);
  await sql`
    INSERT INTO sales_webhooks (organization_id, token_hash, encrypted_token)
    VALUES (${organizationId}, ${sha256(token)}, ${encryptToken(token)})
    ON CONFLICT (organization_id) DO NOTHING
  `;
  const [row] = await sql<Array<{ encrypted_token: string }>>`
    SELECT encrypted_token FROM sales_webhooks WHERE organization_id = ${organizationId}
  `;
  return decryptToken(row.encrypted_token);
}

/** Recebe um aviso do bot/gateway. Idempotente por (org, external_id, tipo). */
export async function ingestSalesEvent(
  token: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; result?: "recorded" | "duplicate" | "ignored" }> {
  if (!token || typeof body !== "object" || body === null) return { ok: false, status: 400 };
  const sql = getSqlClient();
  const [webhook] = await sql<Array<{ organization_id: string }>>`
    SELECT organization_id FROM sales_webhooks WHERE token_hash = ${sha256(token)}
  `;
  if (!webhook) return { ok: false, status: 404 };

  const b = body as Record<string, unknown>;
  const data = asObj(b.data) ?? b;
  const tx = asObj(data.transaction) ?? asObj(b.transaction) ?? {};
  const rawEvent = String(b.event ?? data.event ?? b.status ?? tx.status ?? b.event_name ?? b.type ?? "").trim();
  const mapped = EVENT_ALIASES[rawEvent.toLowerCase()];
  if (!mapped) return { ok: true, status: 200, result: "ignored" };

  const idRaw = tx.external_id ?? tx.id ?? data.id ?? b.id;
  const externalId = idRaw !== null && idRaw !== undefined ? String(idRaw).slice(0, 200) : null;
  const amountCents = pickAmountCents(b);
  const nameRaw = tx.plan_name ?? tx.product_name ?? tx.plan ?? data.product_name ?? b.product_name;
  const productName = nameRaw !== null && nameRaw !== undefined ? String(nameRaw).slice(0, 200) : null;

  const inserted = await sql<Array<{ id: string }>>`
    INSERT INTO sales_events (organization_id, event_type, external_id, amount_cents, product_name, raw_event, payload)
    VALUES (${webhook.organization_id}, ${mapped}, ${externalId}, ${amountCents}, ${productName}, ${rawEvent || null}, ${JSON.stringify(b)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  return { ok: true, status: 200, result: inserted.length ? "recorded" : "duplicate" };
}

export type CustomRange = { from: string; to: string; label: string };

function computeRange(preset: SalesPreset, timezone: string, custom: CustomRange | undefined, now = new Date()) {
  const iso = (day: DateTime) => day.toISO()!;
  if (custom) {
    const start = DateTime.fromISO(custom.from, { zone: timezone }).startOf("day");
    const endExcl = DateTime.fromISO(custom.to, { zone: timezone }).startOf("day").plus({ days: 1 });
    const lenDays = Math.max(1, Math.round(endExcl.diff(start, "days").days));
    return { start: iso(start), end: iso(endExcl), prevStart: iso(start.minus({ days: lenDays })), prevEnd: iso(start) };
  }
  if (preset === "total") return { start: null, end: null, prevStart: null, prevEnd: null };
  const period =
    preset === "today" ? resolvePeriod(1, timezone, now, 0)
    : preset === "yesterday" ? resolvePeriod(1, timezone, now, 1)
    : preset === "7d" ? resolvePeriod(7, timezone, now)
    : resolvePeriod(30, timezone, now);
  const at = (day: string, plus = 0) => iso(DateTime.fromISO(day, { zone: timezone }).plus({ days: plus }));
  return { start: at(period.from), end: at(period.to, 1), prevStart: at(period.previousFrom), prevEnd: at(period.previousTo, 1) };
}

type AggRow = {
  leads: number; pix_count: number; sales_count: number; upsell_count: number;
  pix_amount: string; sales_amount: string; upsell_amount: string;
};

export type SalesActivity = { id: string; event_type: string; amount_cents: number | null; product_name: string | null; occurred_at: Date };
export type ViralProfile = { id: string; username: string; profile_picture_url: string | null; views: string };

export type SalesDashboard = {
  preset: SalesPreset;
  periodLabel: string;
  chartDays: number;
  allTimeRevenueCents: number;
  revenueCents: number;
  salesCount: number;
  pixCount: number;
  pixAmountCents: number;
  leads: number;
  upsellCents: number;
  viewsTotal: number;
  videosPosted: number;
  conversionRate: number; // PIX → PAGO (%)
  trend: { revenue: number | null; views: number | null; videos: number | null; leads: number | null; pix: number | null; conversion: number | null };
  funnel: { values: number[]; rates: Array<number | null> };
  series: Array<{ label: string; value: number | null }>;
  activity: SalesActivity[];
  viral: ViralProfile[];
};

export async function loadSalesDashboard(
  organizationId: string,
  preset: SalesPreset,
  timezone: string,
  options: { custom?: CustomRange; chartDays?: number } = {},
): Promise<SalesDashboard> {
  const sql = getSqlClient();
  const chartDays = options.chartDays === 7 ? 7 : 30;
  const { start, end, prevStart, prevEnd } = computeRange(preset, timezone, options.custom);
  const chart = resolvePeriod(chartDays as 7 | 30, timezone);

  const agg = (s: string | null, e: string | null) => sql<AggRow[]>`
    SELECT
      count(*) FILTER (WHERE event_type = 'LEAD')::int AS leads,
      count(*) FILTER (WHERE event_type = 'PIX')::int AS pix_count,
      count(*) FILTER (WHERE event_type = 'SALE')::int AS sales_count,
      count(*) FILTER (WHERE event_type = 'UPSELL')::int AS upsell_count,
      coalesce(sum(amount_cents) FILTER (WHERE event_type = 'PIX'), 0)::bigint AS pix_amount,
      coalesce(sum(amount_cents) FILTER (WHERE event_type = 'SALE'), 0)::bigint AS sales_amount,
      coalesce(sum(amount_cents) FILTER (WHERE event_type = 'UPSELL'), 0)::bigint AS upsell_amount
    FROM sales_events
    WHERE organization_id = ${organizationId}
      AND (${s}::timestamptz IS NULL OR (occurred_at >= ${s}::timestamptz AND occurred_at < ${e}::timestamptz))
  `;

  const posted = (s: string | null, e: string | null) => sql<Array<{ views: string; videos: number }>>`
    SELECT
      (SELECT coalesce(sum(views), 0)::bigint FROM account_media
        WHERE organization_id = ${organizationId}
          AND (${s}::timestamptz IS NULL OR (posted_at >= ${s}::timestamptz AND posted_at < ${e}::timestamptz))) AS views,
      (SELECT count(*)::int FROM publication_jobs
        WHERE organization_id = ${organizationId} AND status = 'PUBLISHED'
          AND (${s}::timestamptz IS NULL OR (published_at >= ${s}::timestamptz AND published_at < ${e}::timestamptz))) AS videos
  `;

  const [[current], [previous], [postedNow], [postedPrev], series, activity, viral, [allTime]] = await Promise.all([
    agg(start, end),
    prevStart ? agg(prevStart, prevEnd) : Promise.resolve([null as unknown as AggRow]),
    posted(start, end),
    prevStart ? posted(prevStart, prevEnd) : Promise.resolve([{ views: "0", videos: 0 }]),
    sql<Array<{ label: string; value: string }>>`
      WITH days AS (SELECT generate_series(${chart.from}::date, ${chart.to}::date, interval '1 day')::date AS day)
      SELECT to_char(days.day, 'DD/MM') AS label,
        coalesce(sum(se.amount_cents) FILTER (WHERE se.event_type IN ('SALE', 'UPSELL')), 0)::bigint AS value
      FROM days
      LEFT JOIN sales_events se ON (se.occurred_at AT TIME ZONE ${timezone})::date = days.day
        AND se.organization_id = ${organizationId}
      GROUP BY days.day ORDER BY days.day
    `,
    sql<SalesActivity[]>`
      SELECT id, event_type, amount_cents, product_name, occurred_at
      FROM sales_events WHERE organization_id = ${organizationId}
      ORDER BY occurred_at DESC LIMIT 12
    `,
    sql<ViralProfile[]>`
      SELECT account.id, account.username, account.profile_picture_url, coalesce(sum(am.views), 0)::bigint AS views
      FROM account_media am
      JOIN instagram_accounts account ON account.organization_id = am.organization_id AND account.id = am.instagram_account_id
      WHERE am.organization_id = ${organizationId} AND am.posted_at >= now() - interval '3 days'
      GROUP BY account.id HAVING coalesce(sum(am.views), 0) > 0
      ORDER BY views DESC LIMIT 3
    `,
    sql<Array<{ total: string }>>`
      SELECT coalesce(sum(amount_cents) FILTER (WHERE event_type IN ('SALE', 'UPSELL')), 0)::bigint AS total
      FROM sales_events WHERE organization_id = ${organizationId}
    `,
  ]);

  const revenueCents = Number(current.sales_amount) + Number(current.upsell_amount);
  const viewsTotal = Number(postedNow.views);
  const videosPosted = postedNow.videos;
  const conversionRate = current.pix_count > 0 ? Math.round((current.sales_count / current.pix_count) * 1000) / 10 : 0;

  let trend: SalesDashboard["trend"] = { revenue: null, views: null, videos: null, leads: null, pix: null, conversion: null };
  if (previous) {
    const prevRevenue = Number(previous.sales_amount) + Number(previous.upsell_amount);
    const prevConversion = previous.pix_count > 0 ? (previous.sales_count / previous.pix_count) * 100 : 0;
    trend = {
      revenue: deltaPercent(revenueCents, prevRevenue),
      views: deltaPercent(viewsTotal, Number(postedPrev.views)),
      videos: deltaPercent(videosPosted, postedPrev.videos),
      leads: deltaPercent(current.leads, previous.leads),
      pix: deltaPercent(current.pix_count, previous.pix_count),
      conversion: deltaPercent(conversionRate, prevConversion),
    };
  }

  const funnelValues = [viewsTotal, current.leads, current.pix_count, current.sales_count, current.upsell_count];
  const rate = (from: number, to: number) => (from > 0 ? Math.round((to / from) * 1000) / 10 : null);
  const funnelRates = [
    rate(funnelValues[0], funnelValues[1]),
    rate(funnelValues[1], funnelValues[2]),
    rate(funnelValues[2], funnelValues[3]),
    rate(funnelValues[3], funnelValues[4]),
  ];

  return {
    preset,
    periodLabel: options.custom?.label ?? SALES_PRESET_LABELS[preset],
    chartDays,
    allTimeRevenueCents: Number(allTime.total),
    revenueCents,
    salesCount: current.sales_count,
    pixCount: current.pix_count,
    pixAmountCents: Number(current.pix_amount),
    leads: current.leads,
    upsellCents: Number(current.upsell_amount),
    viewsTotal,
    videosPosted,
    conversionRate,
    trend,
    funnel: { values: funnelValues, rates: funnelRates },
    series: series.map((point) => ({ label: point.label, value: Number(point.value) / 100 })),
    activity,
    viral,
  };
}
