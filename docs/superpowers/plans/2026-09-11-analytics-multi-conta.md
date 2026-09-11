# Analytics multi-conta e histórico de banidas — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Painel `/analises` com métricas agregadas e individuais das contas Instagram (seguidores, alcance, views, interações, mídias) alimentado por sync horário no worker, mais marcação manual de contas banidas com histórico.

**Architecture:** O worker ganha uma maintenance task que, a cada 60 s, reivindica contas elegíveis (`FOR UPDATE SKIP LOCKED`) e grava snapshots em duas tabelas novas (`account_daily_metrics`, `account_media`). O web só lê SQL: `src/server/analytics.ts` agrega por período/conta/grupo e as páginas renderizam server-side com SVG inline. Banimento reaproveita a transação de desconexão e registra o contexto em `audit_logs`.

**Tech Stack:** Next.js 16 (App Router, server components, server actions), postgres.js (SQL cru com template tags), Drizzle (schema + migrations), zod 4, vitest 4 (unit e integração), Playwright (e2e). Sem bibliotecas novas.

**Spec:** `docs/superpowers/specs/2026-09-11-analytics-multi-conta-design.md`

## Global Constraints

- Leia `node_modules/next/dist/docs/` antes de escrever código de página/action (AGENTS.md): esta versão do Next tem APIs diferentes do treinamento. `searchParams` e `params` são `Promise`.
- Ponytail FULL está ativo: menor diff que funciona, sem abstração nova, sem dependência nova. Marque atalhos deliberados com comentário `// ponytail: <teto>, <upgrade>`.
- Todo SQL usa o cliente `getSqlClient()` com template tag (`sql\`...\``); nunca concatene strings. Colunas `date` são selecionadas como `to_char(day, 'YYYY-MM-DD') AS day` para chegar como string.
- Horários persistidos em `timestamptz`; dia de métricas é **data UTC** (`YYYY-MM-DD`).
- Escopo de insights: a string exata é `instagram_business_manage_insights`.
- Textos de UI em português do Brasil, mesmo tom das telas existentes.
- Nenhum processo web chama a Meta para insights; só o worker.
- Testes de integração exigem `DATABASE_URL` terminando em `_test` (ex.: `postgresql://postgres:postgres@localhost:5432/instagestor_test`). Comandos: `pnpm test` (unit), `pnpm test:integration`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm lint`.
- Commits: mensagem em inglês no padrão `feat:`/`fix:`/`docs:`/`test:`, terminando com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Não commite `.env`, `instagestor-deploy.zip` nem `reel-teste.mp4` (já estão como untracked; deixe assim).

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/db/schema.ts` (modificar) | enum `BANNED`, colunas novas em `instagram_accounts`, tabelas `account_daily_metrics` e `account_media` |
| `db/migrations/0010_*.sql` + `meta/` (gerar) | migration revisada à mão |
| `src/lib/env.ts` (modificar) | `INSIGHTS_SYNC_INTERVAL_MS`, `INSIGHTS_MEDIA_WINDOW_DAYS` |
| `src/providers/instagram.ts` (modificar) | tipos `AccountSnapshot`, `AccountDayInsights`, `MediaSummary`, `MediaInsights`, `MediaProductType`; métodos novos na interface |
| `src/providers/meta-instagram.ts` (modificar) | escopo novo no OAuth, `permissions` no retorno do exchange, 5 métodos de insights, parsers |
| `src/providers/fake-instagram.ts` (modificar) | 5 métodos determinísticos por seed |
| `src/server/accounts.ts` (modificar) | `granted_scopes` no connect/fake, `closeAccountJobs` compartilhado, `banAccount`, `unbanAccount`, `requestInsightsRefresh` |
| `src/jobs/insights-sync.ts` (criar) | claim, sync por conta, regras de quais mídias consultar, tratamento de erro |
| `worker/index.ts` (modificar) | registra a task a cada 60 s |
| `src/server/analytics.ts` (criar) | `resolvePeriod`, `deltaPercent`, `loadAnalytics`, `loadBanHistory` |
| `src/components/charts.tsx` (criar) | `LineChart`, `BarChart` (SVG) + helpers puros `linePath`, `scaleY` |
| `src/components/ui.tsx` (modificar) | rótulo `BANNED`, `formatNumber`, `Delta` |
| `src/components/admin-shell.tsx` (modificar) | item "Análises" |
| `src/app/actions.ts` (modificar) | `banAccountAction`, `unbanAccountAction`, `refreshInsightsAction` |
| `src/app/(dashboard)/analises/page.tsx` (criar) | painel agregado/individual |
| `src/app/(dashboard)/analises/banidas/page.tsx` (criar) | histórico de banidas |
| `src/app/(dashboard)/contas/[id]/page.tsx` (modificar) | painel "Análises", marcar/desmarcar banida |
| `src/app/(dashboard)/contas/page.tsx` (modificar) | filtro `banidas` |
| `src/app/globals.css` (modificar) | `.chart*`, `.metric-delta*`, `.analytics-*` |
| `scripts/seed.ts` (modificar) | `granted_scopes` nas contas fake |
| `tests/integration/setup.ts` (modificar) | TRUNCATE das tabelas novas |
| `tests/unit/insights-sync-rules.test.ts` (criar) | regras puras do sync |
| `tests/unit/meta-instagram-insights.test.ts` (criar) | provider Meta com fetch mockado |
| `tests/unit/fake-instagram-insights.test.ts` (criar) | determinismo do fake |
| `tests/unit/analytics-math.test.ts` (criar) | `resolvePeriod`, `deltaPercent`, `linePath` |
| `tests/integration/insights-sync.integration.test.ts` (criar) | sync ponta a ponta com fake |
| `tests/integration/analytics.integration.test.ts` (criar) | agregação e ranking |
| `tests/integration/ban-account.integration.test.ts` (criar) | ban/unban |
| `tests/e2e/analytics.spec.ts` (criar) | páginas novas com provider fake |
| `docs/META_APP_REVIEW.md`, `docs/META_SETUP.md`, `docs/META_API_REFERENCE.md`, `docs/DATABASE.md`, `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`, `.env.example` (modificar) | documentação |

---

### Task 1: Schema, migration e variáveis de ambiente

**Files:**
- Modify: `src/db/schema.ts`
- Create (gerado): `db/migrations/0010_<nome>.sql`, `db/migrations/meta/0010_snapshot.json`, `db/migrations/meta/_journal.json`
- Modify: `src/lib/env.ts`
- Modify: `tests/integration/setup.ts`
- Modify: `.env.example`
- Test: `tests/unit/env.test.ts` (adicionar caso)

**Interfaces:**
- Produces: tabelas `account_daily_metrics(instagram_account_id, day, followers_count, follows_count, media_count, follower_gains, reach, views, profile_views, accounts_engaged, total_interactions, likes, comments, shares, saves, replies, website_clicks, profile_links_taps, synced_at)` e `account_media(id, instagram_account_id, media_type, product_type, permalink, thumbnail_url, caption, posted_at, expires_at, like_count, comments_count, views, reach, shares, saved, total_interactions, replies, follows, profile_visits, reels_avg_watch_time_ms, reels_total_watch_time_ms, story_taps_forward, story_taps_back, story_exits, insights_synced_at, published_job_id, created_at, updated_at)`; colunas `instagram_accounts.granted_scopes text[]`, `biography`, `website`, `insights_synced_at`, `insights_error_code`, `banned_at`, `ban_reason`; enum value `BANNED`; `getEnv().INSIGHTS_SYNC_INTERVAL_MS: number`, `getEnv().INSIGHTS_MEDIA_WINDOW_DAYS: number`.

- [ ] **Step 1: Escrever o teste do env que falha**

Abra `tests/unit/env.test.ts`, veja como os casos existentes chamam `getEnv()` com `vi.stubEnv`, e adicione ao final do `describe` existente:

```ts
it("usa defaults de sync de insights e valida limites", () => {
  expect(getEnv().INSIGHTS_SYNC_INTERVAL_MS).toBe(3_600_000);
  expect(getEnv().INSIGHTS_MEDIA_WINDOW_DAYS).toBe(30);

  vi.stubEnv("INSIGHTS_SYNC_INTERVAL_MS", "1000");
  resetEnvForTests();
  expect(() => getEnv()).toThrow();

  vi.stubEnv("INSIGHTS_SYNC_INTERVAL_MS", "600000");
  vi.stubEnv("INSIGHTS_MEDIA_WINDOW_DAYS", "400");
  resetEnvForTests();
  expect(() => getEnv()).toThrow();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/unit/env.test.ts`
Expected: FAIL — `INSIGHTS_SYNC_INTERVAL_MS` é `undefined`.

- [ ] **Step 3: Adicionar as variáveis em `src/lib/env.ts`**

Dentro do `z.object({...})`, logo após `CONTAINER_POLL_SECONDS`:

```ts
    INSIGHTS_SYNC_INTERVAL_MS: z.coerce.number().int().min(300_000).max(86_400_000).default(3_600_000),
    INSIGHTS_MEDIA_WINDOW_DAYS: z.coerce.number().int().min(3).max(365).default(30),
```

Em `.env.example`, após `CONTAINER_POLL_SECONDS=60`:

```
INSIGHTS_SYNC_INTERVAL_MS=3600000
INSIGHTS_MEDIA_WINDOW_DAYS=30
```

- [ ] **Step 4: Rodar o teste do env**

Run: `pnpm vitest run tests/unit/env.test.ts`
Expected: PASS

- [ ] **Step 5: Alterar `src/db/schema.ts`**

Adicione `date` ao import de `drizzle-orm/pg-core`. Altere o enum:

```ts
export const instagramAccountStatus = pgEnum("instagram_account_status", [
  "CONNECTED",
  "TOKEN_EXPIRING",
  "REAUTH_REQUIRED",
  "DISCONNECTED",
  "ERROR",
  "DISABLED",
  "BANNED",
]);
```

Em `instagramAccounts`, após `publishingLimitCheckedAt`:

```ts
    grantedScopes: text("granted_scopes").array(),
    biography: text("biography"),
    website: text("website"),
    insightsSyncedAt: timestamp("insights_synced_at", { withTimezone: true }),
    insightsErrorCode: text("insights_error_code"),
    bannedAt: timestamp("banned_at", { withTimezone: true }),
    banReason: text("ban_reason"),
```

Após `publicationJobs` (precisa referenciá-la), adicione as duas tabelas:

```ts
export const accountDailyMetrics = pgTable(
  "account_daily_metrics",
  {
    instagramAccountId: uuid("instagram_account_id")
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: "restrict" }),
    day: date("day").notNull(),
    followersCount: integer("followers_count"),
    followsCount: integer("follows_count"),
    mediaCount: integer("media_count"),
    followerGains: integer("follower_gains"),
    reach: integer("reach"),
    views: integer("views"),
    profileViews: integer("profile_views"),
    accountsEngaged: integer("accounts_engaged"),
    totalInteractions: integer("total_interactions"),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    replies: integer("replies"),
    websiteClicks: integer("website_clicks"),
    profileLinksTaps: integer("profile_links_taps"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.instagramAccountId, table.day] }),
    index("account_daily_metrics_day_idx").on(table.day),
  ],
);

export const accountMedia = pgTable(
  "account_media",
  {
    id: text("id").primaryKey(),
    instagramAccountId: uuid("instagram_account_id")
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: "restrict" }),
    mediaType: text("media_type").notNull(),
    productType: text("product_type").notNull(),
    permalink: text("permalink"),
    thumbnailUrl: text("thumbnail_url"),
    caption: text("caption"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    likeCount: integer("like_count"),
    commentsCount: integer("comments_count"),
    views: integer("views"),
    reach: integer("reach"),
    shares: integer("shares"),
    saved: integer("saved"),
    totalInteractions: integer("total_interactions"),
    replies: integer("replies"),
    follows: integer("follows"),
    profileVisits: integer("profile_visits"),
    reelsAvgWatchTimeMs: integer("reels_avg_watch_time_ms"),
    reelsTotalWatchTimeMs: bigint("reels_total_watch_time_ms", { mode: "number" }),
    storyTapsForward: integer("story_taps_forward"),
    storyTapsBack: integer("story_taps_back"),
    storyExits: integer("story_exits"),
    insightsSyncedAt: timestamp("insights_synced_at", { withTimezone: true }),
    publishedJobId: uuid("published_job_id").references(() => publicationJobs.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    index("account_media_account_posted_idx").on(table.instagramAccountId, table.postedAt),
    index("account_media_posted_idx").on(table.postedAt),
    check("account_media_product_type_valid", sql`${table.productType} IN ('FEED', 'REELS', 'STORY')`),
  ],
);
```

- [ ] **Step 6: Gerar e revisar a migration**

Run: `pnpm db:generate`
Expected: cria `db/migrations/0010_<nome>.sql` e atualiza `meta/`. Abra o SQL e confirme que contém, nesta ordem lógica: `ALTER TYPE "public"."instagram_account_status" ADD VALUE 'BANNED';`, `CREATE TABLE "account_daily_metrics"`, `CREATE TABLE "account_media"`, os `ALTER TABLE "instagram_accounts" ADD COLUMN ...` (7 colunas), as FKs e os 3 índices. Não deve haver `DROP`. Se o `ADD VALUE` vier depois de algum uso de `'BANNED'` no mesmo arquivo, mova-o para a primeira linha (PostgreSQL não permite usar o valor novo na mesma transação).

- [ ] **Step 7: Incluir as tabelas novas no TRUNCATE dos testes de integração**

Em `tests/integration/setup.ts`, altere a lista para:

```ts
    TRUNCATE TABLE
      account_daily_metrics,
      account_media,
      account_group_members,
      account_groups,
      audit_logs,
      campaign_media,
      campaign_targets,
      publication_jobs,
      campaigns,
      instagram_accounts,
      login_attempts,
      media_assets,
      oauth_states,
      settings,
      worker_heartbeats,
      users
    RESTART IDENTITY CASCADE
```

- [ ] **Step 8: Aplicar migration no banco de teste e rodar a suíte de integração existente**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instagestor_test pnpm db:migrate && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instagestor_test pnpm test:integration`
Expected: migration aplicada; suíte existente PASS (nada mudou de comportamento).

- [ ] **Step 9: Typecheck e commit**

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

```bash
git add src/db/schema.ts db/migrations src/lib/env.ts tests/integration/setup.ts tests/unit/env.test.ts .env.example
git commit -m "feat: add insights tables, banned status and sync settings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Tipos do provider e implementação Meta dos insights

**Files:**
- Modify: `src/providers/instagram.ts`
- Modify: `src/providers/meta-instagram.ts`
- Test: `tests/unit/meta-instagram-insights.test.ts` (criar)
- Test: `tests/unit/meta-instagram-provider.test.ts` (ajustar 1 asserção de escopo)

**Interfaces:**
- Produces (em `src/providers/instagram.ts`):

```ts
export const INSIGHTS_SCOPE = "instagram_business_manage_insights";
export type MediaProductType = "FEED" | "REELS" | "STORY";
export type AccountSnapshot = {
  username: string; displayName?: string; profilePictureUrl?: string;
  followersCount: number; followsCount: number; mediaCount: number;
  biography?: string; website?: string;
};
export type AccountDayInsights = {
  day: string; followerGains: number | null; reach: number | null; views: number | null;
  profileViews: number | null; accountsEngaged: number | null; totalInteractions: number | null;
  likes: number | null; comments: number | null; shares: number | null; saves: number | null;
  replies: number | null; websiteClicks: number | null; profileLinksTaps: number | null;
};
export type MediaSummary = {
  id: string; mediaType: string; productType: MediaProductType; permalink?: string; thumbnailUrl?: string;
  caption?: string; postedAt: Date; likeCount?: number; commentsCount?: number;
};
export type MediaInsights = {
  views: number | null; reach: number | null; shares: number | null; saved: number | null;
  totalInteractions: number | null; replies: number | null; follows: number | null; profileVisits: number | null;
  reelsAvgWatchTimeMs: number | null; reelsTotalWatchTimeMs: number | null;
  storyTapsForward: number | null; storyTapsBack: number | null; storyExits: number | null;
};
```
  e na interface `InstagramProvider`:
```ts
  getAccountSnapshot(accessToken: string): Promise<AccountSnapshot>;
  getAccountInsights(accountId: string, accessToken: string, days: string[]): Promise<AccountDayInsights[]>;
  listRecentMedia(accountId: string, accessToken: string, since: Date): Promise<MediaSummary[]>;
  listLiveStories(accountId: string, accessToken: string): Promise<MediaSummary[]>;
  getMediaInsights(mediaId: string, accessToken: string, productType: MediaProductType): Promise<MediaInsights>;
```
  e em `MetaInstagramProvider.exchangeAuthorizationCode` o retorno ganha `permissions: string[]`.

- [ ] **Step 1: Adicionar tipos e métodos à interface**

Em `src/providers/instagram.ts`, adicione os tipos acima (após `InstagramProfile`) e os cinco métodos ao final de `InstagramProvider`. O `typecheck` vai falhar até as Tasks 2 e 3 terminarem — esperado.

- [ ] **Step 2: Escrever os testes do provider Meta que falham**

Crie `tests/unit/meta-instagram-insights.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/lib/env";
import { MetaInstagramProvider } from "@/providers/meta-instagram";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fetchMock(...responses: Response[]) {
  const mock = vi.fn<typeof fetch>();
  for (const response of responses) mock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function calledUrl(mock: ReturnType<typeof fetchMock>, index: number) {
  return new URL(String(mock.mock.calls[index][0]));
}

beforeEach(() => {
  process.env.INSTAGRAM_PROVIDER = "meta";
  process.env.INSTAGRAM_APP_ID = "app-123";
  process.env.INSTAGRAM_APP_SECRET = "meta-provider-test-secret";
  process.env.INSTAGRAM_REDIRECT_URI = "http://localhost:3000/api/instagram/oauth/callback";
  process.env.META_API_VERSION = "v26.0";
  resetEnvForTests();
});

describe("OAuth com escopo de insights", () => {
  it("pede manage_insights e devolve as permissões concedidas", async () => {
    const url = new URL(new MetaInstagramProvider().authorizationUrl("state"));
    expect(url.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
    );

    fetchMock(
      jsonResponse({ data: [{ access_token: "curto", user_id: "app-7", permissions: "instagram_business_basic,instagram_business_content_publish" }] }),
      jsonResponse({ access_token: "longo", expires_in: 5_184_000 }),
    );
    const exchanged = await new MetaInstagramProvider().exchangeAuthorizationCode("codigo");
    expect(exchanged.permissions).toEqual(["instagram_business_basic", "instagram_business_content_publish"]);
  });
});

describe("getAccountSnapshot", () => {
  it("lê contadores e perfil em uma chamada", async () => {
    const mock = fetchMock(jsonResponse({
      username: "loja", name: "Loja", profile_picture_url: "https://cdn/x.jpg",
      followers_count: 1200, follows_count: 300, media_count: 45, biography: "Bio", website: "https://loja.example",
    }));
    const snapshot = await new MetaInstagramProvider().getAccountSnapshot("token");
    expect(snapshot).toEqual({
      username: "loja", displayName: "Loja", profilePictureUrl: "https://cdn/x.jpg",
      followersCount: 1200, followsCount: 300, mediaCount: 45, biography: "Bio", website: "https://loja.example",
    });
    const url = calledUrl(mock, 0);
    expect(url.pathname).toBe("/v26.0/me");
    expect(url.searchParams.get("fields")).toBe(
      "username,name,profile_picture_url,followers_count,follows_count,media_count,biography,website",
    );
  });
});

describe("getAccountInsights", () => {
  const totalValue = (values: Record<string, number>) => ({
    data: Object.entries(values).map(([name, value]) => ({ name, period: "day", total_value: { value } })),
  });

  it("faz uma chamada total_value por dia e uma time_series para follower_count", async () => {
    const mock = fetchMock(
      jsonResponse(totalValue({ reach: 10, views: 20, profile_views: 3, accounts_engaged: 4, total_interactions: 9, likes: 5, comments: 1, shares: 2, saves: 1, replies: 0, website_clicks: 2, profile_links_taps: 3 })),
      jsonResponse(totalValue({ reach: 11, views: 21, profile_views: 4, accounts_engaged: 5, total_interactions: 10, likes: 6, comments: 2, shares: 1, saves: 0, replies: 1, website_clicks: 0, profile_links_taps: 1 })),
      jsonResponse({ data: [{
        name: "follower_count", period: "day",
        values: [
          { value: 7, end_time: "2026-09-10T07:00:00+0000" },
          { value: 9, end_time: "2026-09-11T07:00:00+0000" },
        ],
      }] }),
    );
    const result = await new MetaInstagramProvider().getAccountInsights("178", "token", ["2026-09-11", "2026-09-10"]);
    expect(result).toEqual([
      { day: "2026-09-11", followerGains: 9, reach: 10, views: 20, profileViews: 3, accountsEngaged: 4, totalInteractions: 9, likes: 5, comments: 1, shares: 2, saves: 1, replies: 0, websiteClicks: 2, profileLinksTaps: 3 },
      { day: "2026-09-10", followerGains: 7, reach: 11, views: 21, profileViews: 4, accountsEngaged: 5, totalInteractions: 10, likes: 6, comments: 2, shares: 1, saves: 0, replies: 1, websiteClicks: 0, profileLinksTaps: 1 },
    ]);

    const first = calledUrl(mock, 0);
    expect(first.pathname).toBe("/v26.0/178/insights");
    expect(first.searchParams.get("metric_type")).toBe("total_value");
    expect(first.searchParams.get("period")).toBe("day");
    expect(first.searchParams.get("since")).toBe(String(Date.UTC(2026, 8, 11) / 1000));
    expect(first.searchParams.get("until")).toBe(String(Date.UTC(2026, 8, 11) / 1000 + 86_399));

    const series = calledUrl(mock, 2);
    expect(series.searchParams.get("metric")).toBe("follower_count");
    expect(series.searchParams.get("metric_type")).toBe("time_series");
    expect(series.searchParams.get("since")).toBe(String(Date.UTC(2026, 8, 10) / 1000));
  });

  it("tolera conta com menos de 100 seguidores deixando follower_gains nulo", async () => {
    fetchMock(
      jsonResponse(totalValue({ reach: 1 })),
      jsonResponse({ error: { message: "(#100) Not enough followers", type: "OAuthException", code: 100 } }, 400),
    );
    const [day] = await new MetaInstagramProvider().getAccountInsights("178", "token", ["2026-09-11"]);
    expect(day.followerGains).toBeNull();
    expect(day.reach).toBe(1);
    expect(day.views).toBeNull();
  });

  it("propaga erro de autorização", async () => {
    fetchMock(jsonResponse({ error: { message: "Invalid OAuth access token", code: 190 } }, 401));
    await expect(new MetaInstagramProvider().getAccountInsights("178", "token", ["2026-09-11"]))
      .rejects.toMatchObject({ kind: "AUTH" });
  });
});

describe("listRecentMedia e listLiveStories", () => {
  it("segue a paginação até passar de `since` e normaliza timestamp da Meta", async () => {
    const mock = fetchMock(
      jsonResponse({
        data: [
          { id: "m1", media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-09-10T12:00:00+0000", permalink: "https://ig/m1", thumbnail_url: "https://cdn/m1.jpg", caption: "a", like_count: 3, comments_count: 1 },
          { id: "m2", media_type: "IMAGE", media_product_type: "FEED", timestamp: "2026-09-01T12:00:00+0000", permalink: "https://ig/m2", media_url: "https://cdn/m2.jpg", like_count: 8, comments_count: 2 },
        ],
        paging: { next: "https://graph.instagram.com/v26.0/178/media?after=abc" },
      }),
      jsonResponse({
        data: [{ id: "m3", media_type: "IMAGE", media_product_type: "FEED", timestamp: "2026-07-01T12:00:00+0000" }],
      }),
    );
    const media = await new MetaInstagramProvider().listRecentMedia("178", "token", new Date("2026-08-15T00:00:00Z"));
    expect(media.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(media[0]).toMatchObject({ productType: "REELS", thumbnailUrl: "https://cdn/m1.jpg", likeCount: 3, commentsCount: 1 });
    expect(media[0].postedAt.toISOString()).toBe("2026-09-10T12:00:00.000Z");
    expect(media[1].thumbnailUrl).toBe("https://cdn/m2.jpg");
    expect(mock).toHaveBeenCalledTimes(2);
    expect(calledUrl(mock, 0).searchParams.get("fields")).toBe(
      "id,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,caption,like_count,comments_count",
    );
  });

  it("para de paginar quando a página já passou de `since`", async () => {
    const mock = fetchMock(jsonResponse({
      data: [{ id: "old", media_type: "IMAGE", media_product_type: "FEED", timestamp: "2026-01-01T00:00:00+0000" }],
      paging: { next: "https://graph.instagram.com/v26.0/178/media?after=zzz" },
    }));
    const media = await new MetaInstagramProvider().listRecentMedia("178", "token", new Date("2026-08-15T00:00:00Z"));
    expect(media).toEqual([]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("lista stories vivos como STORY", async () => {
    const mock = fetchMock(jsonResponse({
      data: [{ id: "s1", media_type: "IMAGE", media_product_type: "STORY", timestamp: "2026-09-11T08:00:00+0000", media_url: "https://cdn/s1.jpg" }],
    }));
    const stories = await new MetaInstagramProvider().listLiveStories("178", "token");
    expect(stories).toEqual([{
      id: "s1", mediaType: "IMAGE", productType: "STORY", permalink: undefined, thumbnailUrl: "https://cdn/s1.jpg",
      caption: undefined, postedAt: new Date("2026-09-11T08:00:00Z"), likeCount: undefined, commentsCount: undefined,
    }]);
    expect(calledUrl(mock, 0).pathname).toBe("/v26.0/178/stories");
  });
});

describe("getMediaInsights", () => {
  const lifetime = (values: Record<string, number>) => ({
    data: Object.entries(values).map(([name, value]) => ({ name, period: "lifetime", values: [{ value }] })),
  });

  it("pede as métricas de REELS e converte tempos para milissegundos inteiros", async () => {
    const mock = fetchMock(jsonResponse(lifetime({
      views: 100, reach: 80, likes: 9, comments: 1, shares: 2, saved: 3, total_interactions: 15,
      ig_reels_avg_watch_time: 4321.7, ig_reels_video_view_total_time: 987654,
    })));
    const insights = await new MetaInstagramProvider().getMediaInsights("m1", "token", "REELS");
    expect(insights).toEqual({
      views: 100, reach: 80, shares: 2, saved: 3, totalInteractions: 15, replies: null, follows: null, profileVisits: null,
      reelsAvgWatchTimeMs: 4322, reelsTotalWatchTimeMs: 987654, storyTapsForward: null, storyTapsBack: null, storyExits: null,
    });
    expect(calledUrl(mock, 0).searchParams.get("metric")).toBe(
      "views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time",
    );
  });

  it("faz segunda chamada de navigation para STORY e agrega o breakdown", async () => {
    const mock = fetchMock(
      jsonResponse(lifetime({ views: 50, reach: 40, replies: 2, shares: 1, follows: 1, profile_visits: 3, total_interactions: 7 })),
      jsonResponse({ data: [{
        name: "navigation", period: "lifetime",
        total_value: { value: 30, breakdowns: [{ dimension_keys: ["story_navigation_action_type"], results: [
          { dimension_values: ["tap_forward"], value: 20 },
          { dimension_values: ["tap_back"], value: 4 },
          { dimension_values: ["swipe_forward"], value: 5 },
          { dimension_values: ["exit"], value: 1 },
        ] }] },
      }] }),
    );
    const insights = await new MetaInstagramProvider().getMediaInsights("s1", "token", "STORY");
    expect(insights).toMatchObject({ views: 50, replies: 2, follows: 1, profileVisits: 3, storyTapsForward: 20, storyTapsBack: 4, storyExits: 6 });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(calledUrl(mock, 1).searchParams.get("breakdown")).toBe("story_navigation_action_type");
  });

  it("devolve tudo nulo quando a Meta recusa insights daquela mídia", async () => {
    fetchMock(jsonResponse({ error: { message: "(#100) Insights not available", code: 100, error_subcode: 2108006 } }, 400));
    const insights = await new MetaInstagramProvider().getMediaInsights("m9", "token", "FEED");
    expect(Object.values(insights).every((value) => value === null)).toBe(true);
  });
});
```

Em `tests/unit/meta-instagram-provider.test.ts`:

- no teste "gera URL OAuth...", troque a asserção de escopo para:

```ts
    expect(url.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
    );
```

- no teste "troca o código curto...", o `resolves.toEqual({...})` passa a incluir `permissions: ["instagram_business_basic", "instagram_business_content_publish"]` (o retorno ganhou esse campo). Procure outros `toEqual` sobre o retorno de `exchangeAuthorizationCode` no mesmo arquivo e faça o mesmo.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run tests/unit/meta-instagram-insights.test.ts tests/unit/meta-instagram-provider.test.ts`
Expected: FAIL — métodos inexistentes / escopo antigo.

- [ ] **Step 4: Implementar em `src/providers/meta-instagram.ts`**

Ajuste o import de tipos:

```ts
import type {
  AccountDayInsights, AccountSnapshot, ContainerInput, InstagramProfile, InstagramProvider,
  MediaInsights, MediaProductType, MediaSummary,
} from "./instagram";
import { INSIGHTS_SCOPE } from "./instagram";
```

Em `authorizationUrl`, troque o `scope` por:

```ts
      scope: `instagram_business_basic,instagram_business_content_publish,${INSIGHTS_SCOPE}`,
```

Em `exchangeAuthorizationCode`, troque o `return` final por:

```ts
    return { appScopedUserId: shortLived.user_id, accessToken: longLived.access_token, expiresIn: longLived.expires_in, permissions };
```

Adicione, no topo do arquivo (após `MetaErrorBody`), constantes e helpers:

```ts
const ACCOUNT_TOTAL_METRICS = [
  "reach", "views", "profile_views", "accounts_engaged", "total_interactions", "likes", "comments",
  "shares", "saves", "replies", "website_clicks", "profile_links_taps",
] as const;

// ponytail: lista fixa por tipo; se a Meta rejeitar uma métrica o sync inteiro da mídia devolve nulos.
// Validar no primeiro smoke test real e ajustar aqui.
const MEDIA_METRICS: Record<MediaProductType, string> = {
  FEED: "views,reach,likes,comments,shares,saved,total_interactions,follows,profile_visits",
  REELS: "views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time",
  STORY: "views,reach,replies,shares,follows,profile_visits,total_interactions",
};

const MEDIA_FIELDS = "id,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,caption,like_count,comments_count";

type InsightEntry = {
  name: string;
  total_value?: { value?: number; breakdowns?: Array<{ results?: Array<{ dimension_values?: string[]; value?: number }> }> };
  values?: Array<{ value?: number; end_time?: string }>;
};

type MetaMedia = {
  id: string; media_type?: string; media_product_type?: string; timestamp: string; permalink?: string;
  thumbnail_url?: string; media_url?: string; caption?: string; like_count?: number; comments_count?: number;
};

function parseMetaTimestamp(value: string) {
  return new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

function toInt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function entryValue(entries: InsightEntry[], name: string) {
  const entry = entries.find((item) => item.name === name);
  return toInt(entry?.total_value?.value ?? entry?.values?.[0]?.value);
}

function dayBounds(day: string) {
  const since = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
  return { since, until: since + 86_399 };
}

function toMediaSummary(item: MetaMedia, productType?: MediaProductType): MediaSummary {
  const product = productType ?? (item.media_product_type === "REELS" ? "REELS" : item.media_product_type === "STORY" ? "STORY" : "FEED");
  return {
    id: item.id,
    mediaType: item.media_type ?? "IMAGE",
    productType: product,
    permalink: item.permalink,
    thumbnailUrl: item.thumbnail_url ?? (item.media_type === "IMAGE" ? item.media_url : undefined),
    caption: item.caption?.slice(0, 300),
    postedAt: parseMetaTimestamp(item.timestamp),
    likeCount: item.like_count,
    commentsCount: item.comments_count,
  };
}

const emptyMediaInsights = (): MediaInsights => ({
  views: null, reach: null, shares: null, saved: null, totalInteractions: null, replies: null, follows: null,
  profileVisits: null, reelsAvgWatchTimeMs: null, reelsTotalWatchTimeMs: null,
  storyTapsForward: null, storyTapsBack: null, storyExits: null,
});
```

Adicione os métodos à classe (após `getProfile`):

```ts
  async getAccountSnapshot(accessToken: string): Promise<AccountSnapshot> {
    const me = await this.request<{
      username: string; name?: string; profile_picture_url?: string; followers_count?: number;
      follows_count?: number; media_count?: number; biography?: string; website?: string;
    }>("/me", {
      fields: "username,name,profile_picture_url,followers_count,follows_count,media_count,biography,website",
      access_token: accessToken,
    });
    return {
      username: me.username,
      displayName: me.name,
      profilePictureUrl: me.profile_picture_url,
      followersCount: toInt(me.followers_count) ?? 0,
      followsCount: toInt(me.follows_count) ?? 0,
      mediaCount: toInt(me.media_count) ?? 0,
      biography: me.biography,
      website: me.website,
    };
  }

  async getAccountInsights(accountId: string, accessToken: string, days: string[]): Promise<AccountDayInsights[]> {
    const results: AccountDayInsights[] = [];
    for (const day of days) {
      const { since, until } = dayBounds(day);
      const { data = [] } = await this.request<{ data?: InsightEntry[] }>(`/${accountId}/insights`, {
        metric: ACCOUNT_TOTAL_METRICS.join(","), period: "day", metric_type: "total_value",
        since: String(since), until: String(until), access_token: accessToken,
      });
      results.push({
        day, followerGains: null,
        reach: entryValue(data, "reach"), views: entryValue(data, "views"), profileViews: entryValue(data, "profile_views"),
        accountsEngaged: entryValue(data, "accounts_engaged"), totalInteractions: entryValue(data, "total_interactions"),
        likes: entryValue(data, "likes"), comments: entryValue(data, "comments"), shares: entryValue(data, "shares"),
        saves: entryValue(data, "saves"), replies: entryValue(data, "replies"),
        websiteClicks: entryValue(data, "website_clicks"), profileLinksTaps: entryValue(data, "profile_links_taps"),
      });
    }
    if (!days.length) return results;
    const sorted = [...days].sort();
    try {
      const { data = [] } = await this.request<{ data?: InsightEntry[] }>(`/${accountId}/insights`, {
        metric: "follower_count", period: "day", metric_type: "time_series",
        since: String(dayBounds(sorted[0]).since), until: String(dayBounds(sorted[sorted.length - 1]).until),
        access_token: accessToken,
      });
      for (const point of data.find((entry) => entry.name === "follower_count")?.values ?? []) {
        if (!point.end_time) continue;
        // end_time marca o fim do bucket; o dia do bucket é o dia UTC desse instante.
        const day = parseMetaTimestamp(point.end_time).toISOString().slice(0, 10);
        const target = results.find((entry) => entry.day === day);
        if (target) target.followerGains = toInt(point.value);
      }
    } catch (error) {
      // Contas com menos de 100 seguidores não têm follower_count; qualquer outro erro sobe.
      if (!(error instanceof InstagramError && error.kind === "VALIDATION")) throw error;
      log("info", "meta", "follower_count_unavailable", { account_id: accountId });
    }
    return results;
  }

  private async listMediaEdge(path: string, params: Record<string, string>, accessToken: string, since?: Date) {
    const collected: MediaSummary[] = [];
    let url: string | undefined = `${this.baseUrl}${path}?${new URLSearchParams({ ...params, limit: "50" })}`;
    while (url) {
      const page: { data?: MetaMedia[]; paging?: { next?: string } } = await this.fetchJson(url, {
        method: "GET", headers: { authorization: `Bearer ${accessToken}` },
      });
      const items = (page.data ?? []).map((item) => toMediaSummary(item));
      const recent = since ? items.filter((item) => item.postedAt >= since) : items;
      collected.push(...recent);
      const reachedLimit = since ? recent.length < items.length : false;
      url = !reachedLimit && page.paging?.next ? page.paging.next : undefined;
    }
    return collected;
  }

  listRecentMedia(accountId: string, accessToken: string, since: Date) {
    return this.listMediaEdge(`/${accountId}/media`, { fields: MEDIA_FIELDS }, accessToken, since);
  }

  async listLiveStories(accountId: string, accessToken: string) {
    const stories = await this.listMediaEdge(`/${accountId}/stories`, { fields: MEDIA_FIELDS }, accessToken);
    return stories.map((story) => ({ ...story, productType: "STORY" as const }));
  }

  async getMediaInsights(mediaId: string, accessToken: string, productType: MediaProductType): Promise<MediaInsights> {
    const result = emptyMediaInsights();
    let data: InsightEntry[];
    try {
      ({ data = [] } = await this.request<{ data?: InsightEntry[] }>(`/${mediaId}/insights`, {
        metric: MEDIA_METRICS[productType], access_token: accessToken,
      }));
    } catch (error) {
      if (error instanceof InstagramError && error.kind === "VALIDATION") return result;
      throw error;
    }
    result.views = entryValue(data, "views");
    result.reach = entryValue(data, "reach");
    result.shares = entryValue(data, "shares");
    result.saved = entryValue(data, "saved");
    result.totalInteractions = entryValue(data, "total_interactions");
    result.replies = entryValue(data, "replies");
    result.follows = entryValue(data, "follows");
    result.profileVisits = entryValue(data, "profile_visits");
    result.reelsAvgWatchTimeMs = entryValue(data, "ig_reels_avg_watch_time");
    result.reelsTotalWatchTimeMs = entryValue(data, "ig_reels_video_view_total_time");
    if (productType !== "STORY") return result;
    try {
      const { data: navigation = [] } = await this.request<{ data?: InsightEntry[] }>(`/${mediaId}/insights`, {
        metric: "navigation", breakdown: "story_navigation_action_type", access_token: accessToken,
      });
      const buckets = new Map<string, number>();
      for (const bucket of navigation.find((entry) => entry.name === "navigation")?.total_value?.breakdowns?.[0]?.results ?? []) {
        buckets.set(bucket.dimension_values?.[0] ?? "", toInt(bucket.value) ?? 0);
      }
      result.storyTapsForward = buckets.get("tap_forward") ?? null;
      result.storyTapsBack = buckets.get("tap_back") ?? null;
      result.storyExits = buckets.has("swipe_forward") || buckets.has("exit")
        ? (buckets.get("swipe_forward") ?? 0) + (buckets.get("exit") ?? 0)
        : null;
    } catch (error) {
      if (!(error instanceof InstagramError && error.kind === "VALIDATION")) throw error;
    }
    return result;
  }
```

Observação: `fetchJson` já é usado por `exchangeAuthorizationCode` com URL absoluta; `listMediaEdge` reaproveita para seguir `paging.next` (URL absoluta devolvida pela Meta) sem duplicar tratamento de erro.

- [ ] **Step 5: Rodar os testes**

Run: `pnpm vitest run tests/unit/meta-instagram-insights.test.ts tests/unit/meta-instagram-provider.test.ts`
Expected: PASS (11 testes no arquivo novo + suíte existente).

- [ ] **Step 6: Commit**

```bash
git add src/providers/instagram.ts src/providers/meta-instagram.ts tests/unit/meta-instagram-insights.test.ts tests/unit/meta-instagram-provider.test.ts
git commit -m "feat: read account and media insights from Meta

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Fake provider determinístico

**Files:**
- Modify: `src/providers/fake-instagram.ts`
- Test: `tests/unit/fake-instagram-insights.test.ts` (criar)

**Interfaces:**
- Consumes: tipos da Task 2.
- Produces: `FakeInstagramProvider` implementa os 5 métodos; ids de mídia no formato `fake_media_<accountId>_<n>` (n = 0..4) e story `fake_story_<accountId>_<dayIndex>`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/unit/fake-instagram-insights.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { FakeInstagramProvider } from "@/providers/fake-instagram";

describe("FakeInstagramProvider insights", () => {
  it("snapshot é determinístico dentro do mesmo dia e cresce entre dias", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T10:00:00Z"));
    const provider = new FakeInstagramProvider("success");
    const first = await provider.getAccountSnapshot("fake-token:1000:conta_a");
    const second = await provider.getAccountSnapshot("fake-token:1000:conta_a");
    expect(first).toEqual(second);
    expect(first.username).toBe("conta_a");
    expect(first.followersCount).toBeGreaterThan(0);

    vi.setSystemTime(new Date("2026-09-12T10:00:00Z"));
    const tomorrow = await provider.getAccountSnapshot("fake-token:1000:conta_a");
    expect(tomorrow.followersCount).toBeGreaterThan(first.followersCount);
  });

  it("insights por dia são determinísticos e respeitam a lista de dias", async () => {
    const provider = new FakeInstagramProvider("success");
    const a = await provider.getAccountInsights("1000", "t", ["2026-09-11", "2026-09-10"]);
    const b = await provider.getAccountInsights("1000", "t", ["2026-09-11", "2026-09-10"]);
    expect(a).toEqual(b);
    expect(a.map((day) => day.day)).toEqual(["2026-09-11", "2026-09-10"]);
    expect(a[0].reach).toBeGreaterThanOrEqual(0);
  });

  it("lista mídias recentes dentro da janela e um story vivo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T10:00:00Z"));
    const provider = new FakeInstagramProvider("success");
    const media = await provider.listRecentMedia("1000", "t", new Date("2026-09-01T00:00:00Z"));
    expect(media.length).toBeGreaterThan(0);
    expect(media.every((item) => item.postedAt >= new Date("2026-09-01T00:00:00Z"))).toBe(true);
    expect(media.every((item) => item.id.startsWith("fake_media_1000_"))).toBe(true);

    const stories = await provider.listLiveStories("1000", "t");
    expect(stories).toHaveLength(1);
    expect(stories[0].productType).toBe("STORY");
    expect(stories[0].postedAt.getTime()).toBeGreaterThan(Date.now() - 24 * 3_600_000);
  });

  it("insights de mídia respeitam o tipo", async () => {
    const provider = new FakeInstagramProvider("success");
    const reel = await provider.getMediaInsights("fake_media_1000_0", "t", "REELS");
    expect(reel.reelsAvgWatchTimeMs).not.toBeNull();
    expect(reel.storyTapsForward).toBeNull();
    const story = await provider.getMediaInsights("fake_story_1000_1", "t", "STORY");
    expect(story.storyTapsForward).not.toBeNull();
    expect(story.reelsAvgWatchTimeMs).toBeNull();
  });

  it("obedece ao cenário de falha", async () => {
    await expect(new FakeInstagramProvider("http_401").getAccountSnapshot("fake-token:1:a")).rejects.toMatchObject({ kind: "AUTH" });
    await expect(new FakeInstagramProvider("http_429").getAccountInsights("1", "t", ["2026-09-11"])).rejects.toMatchObject({ kind: "RATE_LIMIT" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/unit/fake-instagram-insights.test.ts`
Expected: FAIL — métodos inexistentes.

- [ ] **Step 3: Implementar em `src/providers/fake-instagram.ts`**

Ajuste o import de tipos:

```ts
import type {
  AccountDayInsights, AccountSnapshot, ContainerInput, FakeScenario, InstagramProvider,
  MediaInsights, MediaProductType, MediaSummary,
} from "./instagram";
```

Adicione após `type FakeContainer`:

```ts
const DAY_MS = 86_400_000;

function seeded(seed: string, max: number, min = 0) {
  const hash = createHash("sha256").update(seed).digest();
  return min + (hash.readUInt32BE(0) % (max - min + 1));
}
```

Adicione os métodos à classe (após `refreshAccessToken`):

```ts
  async getAccountSnapshot(accessToken: string): Promise<AccountSnapshot> {
    this.fail("request");
    const [, id = "1000", username = "conta_fake"] = accessToken.split(":");
    const dayIndex = Math.floor(Date.now() / DAY_MS);
    return {
      username,
      displayName: `Conta ${username}`,
      followersCount: 100 + seeded(`${id}:base`, 5000) + dayIndex * seeded(`${id}:growth`, 25, 5),
      followsCount: seeded(`${id}:follows`, 800, 50),
      mediaCount: 30 + seeded(`${id}:media`, 200),
      biography: `Bio da ${username}`,
      website: `https://${username}.example`,
    };
  }

  async getAccountInsights(accountId: string, accessToken: string, days: string[]): Promise<AccountDayInsights[]> {
    void accessToken;
    this.fail("request");
    const small = seeded(`${accountId}:small`, 9) === 0;
    return days.map((day) => {
      const value = (name: string, max: number) => seeded(`${accountId}:${day}:${name}`, max);
      return {
        day,
        followerGains: small ? null : value("gains", 60),
        reach: value("reach", 5000, 100),
        views: value("views", 12000, 200),
        profileViews: value("profile_views", 400),
        accountsEngaged: value("engaged", 900),
        totalInteractions: value("interactions", 1200),
        likes: value("likes", 800),
        comments: value("comments", 120),
        shares: value("shares", 150),
        saves: value("saves", 90),
        replies: value("replies", 40),
        websiteClicks: value("website", 60),
        profileLinksTaps: value("links", 80),
      };
    });
  }

  async listRecentMedia(accountId: string, accessToken: string, since: Date): Promise<MediaSummary[]> {
    void accessToken;
    this.fail("request");
    return Array.from({ length: 5 }, (_, position) => {
      const reel = position % 2 === 0;
      return {
        id: `fake_media_${accountId}_${position}`,
        mediaType: reel ? "VIDEO" : "IMAGE",
        productType: (reel ? "REELS" : "FEED") as MediaProductType,
        permalink: `https://www.instagram.com/p/fake_${accountId}_${position}/`,
        caption: `Publicação ${position + 1} da conta ${accountId}`,
        postedAt: new Date(Date.now() - (position * 5 + 1) * DAY_MS),
        likeCount: seeded(`${accountId}:${position}:likes`, 500),
        commentsCount: seeded(`${accountId}:${position}:comments`, 60),
      };
    }).filter((item) => item.postedAt >= since);
  }

  async listLiveStories(accountId: string, accessToken: string): Promise<MediaSummary[]> {
    void accessToken;
    this.fail("request");
    const dayIndex = Math.floor(Date.now() / DAY_MS);
    return [{
      id: `fake_story_${accountId}_${dayIndex}`,
      mediaType: "IMAGE",
      productType: "STORY",
      postedAt: new Date(Date.now() - 3_600_000),
    }];
  }

  async getMediaInsights(mediaId: string, accessToken: string, productType: MediaProductType): Promise<MediaInsights> {
    void accessToken;
    this.fail("request");
    const value = (name: string, max: number) => seeded(`${mediaId}:${name}`, max);
    const story = productType === "STORY";
    const reel = productType === "REELS";
    return {
      views: value("views", 8000, 50),
      reach: value("reach", 6000, 40),
      shares: value("shares", 120),
      saved: story ? null : value("saved", 200),
      totalInteractions: value("interactions", 900),
      replies: story ? value("replies", 30) : null,
      follows: reel ? null : value("follows", 25),
      profileVisits: reel ? null : value("visits", 80),
      reelsAvgWatchTimeMs: reel ? value("avg_watch", 15000, 1000) : null,
      reelsTotalWatchTimeMs: reel ? value("total_watch", 5_000_000, 10_000) : null,
      storyTapsForward: story ? value("forward", 400) : null,
      storyTapsBack: story ? value("back", 40) : null,
      storyExits: story ? value("exits", 60) : null,
    };
  }
```

- [ ] **Step 4: Rodar testes e typecheck**

Run: `pnpm vitest run tests/unit/fake-instagram-insights.test.ts && pnpm typecheck`
Expected: PASS; typecheck limpo (ambas as implementações completas).

- [ ] **Step 5: Commit**

```bash
git add src/providers/fake-instagram.ts tests/unit/fake-instagram-insights.test.ts
git commit -m "feat: deterministic insights in fake Instagram provider

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Escopos concedidos, banimento e pedido de atualização em `accounts.ts`

**Files:**
- Modify: `src/server/accounts.ts`
- Modify: `scripts/seed.ts`
- Test: `tests/integration/ban-account.integration.test.ts` (criar)

**Interfaces:**
- Consumes: `INSIGHTS_SCOPE` de `@/providers/instagram`; `permissions` do `exchangeAuthorizationCode` (Task 2).
- Produces:
```ts
export async function banAccount(accountId: string, reason: string, actorUserId: string): Promise<void>;
export async function unbanAccount(accountId: string, actorUserId: string): Promise<void>;
export async function requestInsightsRefresh(accountId?: string): Promise<number>; // linhas marcadas
```
  Contas fake (`createFakeAccounts` e seed) recebem `granted_scopes = ['instagram_business_basic','instagram_business_content_publish','instagram_business_manage_insights']`. `connectFromAuthorizationCode` grava `granted_scopes` com as permissões reais.

- [ ] **Step 1: Escrever o teste de integração que falha**

Crie `tests/integration/ban-account.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { banAccount, createFakeAccounts, requestInsightsRefresh, unbanAccount } from "@/server/accounts";
import { createAccounts, createCampaign, createJobs, createUser } from "./helpers";

describe("banimento manual", () => {
  it("marca a conta, fecha jobs pendentes e registra contexto na auditoria", async () => {
    const sql = getSqlClient();
    const userId = await createUser();
    const [account] = await createAccounts(1, "ban");
    await sql`
      UPDATE instagram_accounts SET last_error_code = 'META_190', last_error_at = now() - interval '1 day',
        encrypted_access_token = 'cifrado' WHERE id = ${account.id}
    `;
    await sql`
      INSERT INTO account_daily_metrics (instagram_account_id, day, followers_count, media_count)
      VALUES (${account.id}, current_date - 1, 900, 12), (${account.id}, current_date, 950, 13)
    `;
    const campaignId = await createCampaign(userId, "RUNNING");
    const [job] = await createJobs(campaignId, [account]);
    await sql`UPDATE publication_jobs SET status = 'PUBLISHED', published_at = now() WHERE id = ${job.id}`;
    const secondCampaign = await createCampaign(userId, "SCHEDULED", "Pendente");
    const [pending] = await createJobs(secondCampaign, [account]);

    await banAccount(account.id, "  Suspensa pela Meta após checkpoint  ", userId);

    const [row] = await sql<Array<{ status: string; ban_reason: string; banned_at: Date | null; encrypted_access_token: string | null }>>`
      SELECT status, ban_reason, banned_at, encrypted_access_token FROM instagram_accounts WHERE id = ${account.id}
    `;
    expect(row).toMatchObject({ status: "BANNED", ban_reason: "Suspensa pela Meta após checkpoint", encrypted_access_token: null });
    expect(row.banned_at).toBeInstanceOf(Date);

    const [pendingJob] = await sql<Array<{ status: string; last_error_code: string }>>`
      SELECT status, last_error_code FROM publication_jobs WHERE id = ${pending.id}
    `;
    expect(pendingJob).toEqual({ status: "FAILED", last_error_code: "ACCOUNT_BANNED" });
    const [closed] = await sql<Array<{ status: string }>>`SELECT status FROM campaigns WHERE id = ${secondCampaign}`;
    expect(closed.status).toBe("FAILED");

    const [audit] = await sql<Array<{ metadata_json: Record<string, unknown>; actor_user_id: string }>>`
      SELECT metadata_json, actor_user_id FROM audit_logs WHERE event_type = 'ACCOUNT_BANNED' AND entity_id = ${account.id}
    `;
    expect(audit.actor_user_id).toBe(userId);
    expect(audit.metadata_json).toMatchObject({
      reason: "Suspensa pela Meta após checkpoint", followersCount: 950, mediaCount: 13, lastErrorCode: "META_190", publishedByTool: 1,
    });
    expect(typeof audit.metadata_json.lastErrorAt).toBe("string");
  });

  it("rejeita motivo curto e banimento duplicado", async () => {
    const userId = await createUser();
    const [account] = await createAccounts(1, "dup");
    await expect(banAccount(account.id, "ab", userId)).rejects.toThrow(/motivo/i);
    await banAccount(account.id, "Motivo válido", userId);
    await expect(banAccount(account.id, "Outro motivo", userId)).rejects.toThrow(/já está/i);
  });

  it("desmarca voltando para DISCONNECTED e preserva o histórico", async () => {
    const sql = getSqlClient();
    const userId = await createUser();
    const [account] = await createAccounts(1, "unban");
    await banAccount(account.id, "Motivo válido", userId);
    await unbanAccount(account.id, userId);
    const [row] = await sql<Array<{ status: string; banned_at: Date | null; ban_reason: string | null }>>`
      SELECT status, banned_at, ban_reason FROM instagram_accounts WHERE id = ${account.id}
    `;
    expect(row).toEqual({ status: "DISCONNECTED", banned_at: null, ban_reason: null });
    const events = await sql<Array<{ event_type: string }>>`
      SELECT event_type FROM audit_logs WHERE entity_id = ${account.id} ORDER BY created_at
    `;
    expect(events.map((event) => event.event_type)).toEqual(["ACCOUNT_BANNED", "ACCOUNT_UNBANNED"]);
    await expect(unbanAccount(account.id, userId)).rejects.toThrow(/não está/i);
  });
});

describe("escopos e atualização de insights", () => {
  it("contas fake nascem com o escopo de insights e podem pedir sync imediato", async () => {
    const sql = getSqlClient();
    const userId = await createUser();
    await createFakeAccounts(2, userId);
    const accounts = await sql<Array<{ id: string; granted_scopes: string[] }>>`
      SELECT id, granted_scopes FROM instagram_accounts ORDER BY username
    `;
    expect(accounts[0].granted_scopes).toContain("instagram_business_manage_insights");
    await sql`UPDATE instagram_accounts SET insights_synced_at = now()`;

    expect(await requestInsightsRefresh(accounts[0].id)).toBe(1);
    const [first] = await sql<Array<{ insights_synced_at: Date | null }>>`
      SELECT insights_synced_at FROM instagram_accounts WHERE id = ${accounts[0].id}
    `;
    expect(first.insights_synced_at).toBeNull();

    expect(await requestInsightsRefresh()).toBe(2);
  });

  it("não marca conta sem escopo de insights", async () => {
    const sql = getSqlClient();
    const [account] = await createAccounts(1, "noscope");
    await sql`UPDATE instagram_accounts SET encrypted_access_token = 'x', insights_synced_at = now() WHERE id = ${account.id}`;
    expect(await requestInsightsRefresh()).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instagestor_test pnpm vitest run --config vitest.integration.config.mts tests/integration/ban-account.integration.test.ts`
Expected: FAIL — `banAccount` não exportado.

- [ ] **Step 3: Implementar em `src/server/accounts.ts`**

Adicione ao import de providers: `import { INSIGHTS_SCOPE } from "@/providers/instagram";` e defina após os imports:

```ts
const FAKE_SCOPES = ["instagram_business_basic", "instagram_business_content_publish", INSIGHTS_SCOPE];
type Sql = Parameters<Parameters<ReturnType<typeof getSqlClient>["begin"]>[0]>[0];
```

Em `createFakeAccounts`, adicione ao objeto de cada linha: `granted_scopes: FAKE_SCOPES,`.

Extraia a sequência de fechamento de jobs/campanhas de `disconnectAccount` para uma função de módulo (não exportada), parametrizando código e mensagem. Os três statements são os já existentes em `disconnectAccount` (jobs pendentes → `FAILED`, `PUBLISHING` → `RECONCILIATION_REQUIRED`, campanhas fechadas); troque `'ACCOUNT_DISCONNECTED'` por `${errorCode}`, `'Conta desconectada'` por `${errorMessage}`, `'ACCOUNT_DISCONNECTED_DURING_PUBLISH'` por `${`${errorCode}_DURING_PUBLISH`}` e a mensagem ambígua por `${`${errorMessage} durante publicação; verificação manual obrigatória`}`:

```ts
async function closeAccountJobs(sql: Sql, accountId: string, errorCode: string, errorMessage: string) {
  await sql`
    UPDATE publication_jobs SET status = 'FAILED', last_error_code = ${errorCode},
      last_error_type = 'AUTH', last_error_message = ${errorMessage}, finished_at = now(),
      locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
      fencing_token = fencing_token + 1, updated_at = now()
    WHERE instagram_account_id = ${accountId}
      AND status IN ('QUEUED', 'RETRY_WAIT', 'CLAIMED', 'CREATING_CONTAINER', 'WAITING_FOR_CONTAINER', 'READY_TO_PUBLISH')
  `;
  await sql`
    UPDATE publication_jobs SET status = 'RECONCILIATION_REQUIRED', reconciliation_required = true,
      last_error_code = ${`${errorCode}_DURING_PUBLISH`}, last_error_type = 'AMBIGUOUS',
      last_error_message = ${`${errorMessage} durante publicação; verificação manual obrigatória`},
      finished_at = now(), locked_at = NULL, locked_by = NULL, lock_expires_at = NULL,
      fencing_token = fencing_token + 1, updated_at = now()
    WHERE instagram_account_id = ${accountId} AND status = 'PUBLISHING'
  `;
  await sql`
    WITH affected AS (
      SELECT campaign_id FROM publication_jobs WHERE instagram_account_id = ${accountId} GROUP BY campaign_id
    ), totals AS (
      SELECT job.campaign_id,
        count(*) FILTER (WHERE job.status NOT IN ('PUBLISHED', 'FAILED', 'CANCELLED', 'RECONCILIATION_REQUIRED')) AS pending,
        count(*) FILTER (WHERE job.status = 'PUBLISHED') AS published,
        count(*) FILTER (WHERE job.status IN ('FAILED', 'RECONCILIATION_REQUIRED')) AS failed
      FROM publication_jobs job JOIN affected ON affected.campaign_id = job.campaign_id
      GROUP BY job.campaign_id
    )
    UPDATE campaigns SET status = CASE
        WHEN totals.failed = 0 THEN 'COMPLETED'::campaign_status
        WHEN totals.published = 0 THEN 'FAILED'::campaign_status
        ELSE 'PARTIALLY_FAILED'::campaign_status
      END,
      updated_at = now()
    FROM totals
    WHERE campaigns.id = totals.campaign_id AND totals.pending = 0
      AND campaigns.status IN ('SCHEDULED', 'RUNNING', 'PAUSED')
  `;
}
```

`disconnectAccount` fica:

```ts
export async function disconnectAccount(accountId: string, actorUserId: string) {
  await getSqlClient().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`instagestor:meta:account:${accountId}:0`}, 0))`;
    const [account] = await sql<{ id: string }[]>`
      UPDATE instagram_accounts SET status = 'DISCONNECTED', encrypted_access_token = NULL,
        disconnected_at = now(), updated_at = now() WHERE id = ${accountId} RETURNING id
    `;
    if (!account) throw new Error("Conta não encontrada");
    await closeAccountJobs(sql, accountId, "ACCOUNT_DISCONNECTED", "Conta desconectada");
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id)
      VALUES (${actorUserId}, 'ACCOUNT_DISCONNECTED', 'instagram_account', ${accountId})
    `;
  });
}
```

Adicione logo abaixo:

```ts
export async function banAccount(accountId: string, reason: string, actorUserId: string) {
  const trimmed = reason.trim();
  if (trimmed.length < 3 || trimmed.length > 500) throw new Error("Informe um motivo entre 3 e 500 caracteres");
  await getSqlClient().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`instagestor:meta:account:${accountId}:0`}, 0))`;
    const [account] = await sql<Array<{ status: string; last_error_code: string | null; last_error_at: Date | null }>>`
      SELECT status, last_error_code, last_error_at FROM instagram_accounts WHERE id = ${accountId} FOR UPDATE
    `;
    if (!account) throw new Error("Conta não encontrada");
    if (account.status === "BANNED") throw new Error("Conta já está marcada como banida");
    const [metrics] = await sql<Array<{ followers_count: number | null; media_count: number | null }>>`
      SELECT followers_count, media_count FROM account_daily_metrics
      WHERE instagram_account_id = ${accountId} AND followers_count IS NOT NULL
      ORDER BY day DESC LIMIT 1
    `;
    const [{ published }] = await sql<Array<{ published: number }>>`
      SELECT count(*)::int AS published FROM publication_jobs WHERE instagram_account_id = ${accountId} AND status = 'PUBLISHED'
    `;
    await sql`
      UPDATE instagram_accounts SET status = 'BANNED', encrypted_access_token = NULL, banned_at = now(),
        ban_reason = ${trimmed}, disconnected_at = now(), updated_at = now()
      WHERE id = ${accountId}
    `;
    await closeAccountJobs(sql, accountId, "ACCOUNT_BANNED", "Conta marcada como banida");
    await sql`
      INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id, metadata_json)
      VALUES (${actorUserId}, 'ACCOUNT_BANNED', 'instagram_account', ${accountId}, ${JSON.stringify({
        reason: trimmed,
        followersCount: metrics?.followers_count ?? null,
        mediaCount: metrics?.media_count ?? null,
        lastErrorCode: account.last_error_code,
        lastErrorAt: account.last_error_at?.toISOString() ?? null,
        publishedByTool: published,
      })}::jsonb)
    `;
  });
}

export async function unbanAccount(accountId: string, actorUserId: string) {
  const rows = await getSqlClient()`
    UPDATE instagram_accounts SET status = 'DISCONNECTED', banned_at = NULL, ban_reason = NULL, updated_at = now()
    WHERE id = ${accountId} AND status = 'BANNED' RETURNING id
  `;
  if (!rows.length) throw new Error("Conta não está marcada como banida");
  await audit(actorUserId, "ACCOUNT_UNBANNED", "instagram_account", accountId);
}

export async function requestInsightsRefresh(accountId?: string) {
  const rows = await getSqlClient()`
    UPDATE instagram_accounts SET insights_synced_at = NULL, updated_at = now()
    WHERE status IN ('CONNECTED', 'TOKEN_EXPIRING') AND encrypted_access_token IS NOT NULL
      AND ${INSIGHTS_SCOPE} = ANY(granted_scopes)
      AND (${accountId ?? null}::uuid IS NULL OR id = ${accountId ?? null}::uuid)
    RETURNING id
  `;
  return rows.length;
}
```

Em `connectFromAuthorizationCode`, inclua `granted_scopes` no INSERT e no `DO UPDATE`:

```ts
    INSERT INTO instagram_accounts (
      instagram_user_id, app_scoped_user_id, username, display_name, profile_picture_url, account_type,
      status, encrypted_access_token, authorized_at, token_expires_at, token_last_refreshed_at, token_last_checked_at,
      last_successful_api_call_at, disconnected_at, granted_scopes, banned_at, ban_reason, insights_synced_at
    ) VALUES (
      ${profile.id}, ${profile.appScopedUserId ?? exchanged.appScopedUserId}, ${profile.username},
      ${profile.displayName ?? null}, ${profile.profilePictureUrl ?? null}, ${profile.accountType ?? null},
      'CONNECTED', ${encrypted}, now(), now() + ${exchanged.expiresIn} * interval '1 second', now(), now(), now(), NULL,
      ${exchanged.permissions}, NULL, NULL, NULL
    )
    ON CONFLICT (instagram_user_id) DO UPDATE SET
      app_scoped_user_id = EXCLUDED.app_scoped_user_id, username = EXCLUDED.username,
      display_name = EXCLUDED.display_name, profile_picture_url = EXCLUDED.profile_picture_url,
      account_type = EXCLUDED.account_type, status = 'CONNECTED',
      encrypted_access_token = EXCLUDED.encrypted_access_token, token_expires_at = EXCLUDED.token_expires_at,
      authorized_at = now(), token_last_refreshed_at = now(), token_last_checked_at = now(), last_successful_api_call_at = now(),
      disconnected_at = NULL, granted_scopes = EXCLUDED.granted_scopes, banned_at = NULL, ban_reason = NULL,
      insights_synced_at = NULL, updated_at = now()
```

Em `scripts/seed.ts`, inclua `granted_scopes` no INSERT das contas fake: adicione a coluna à lista e o valor `${["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights"]}` após `token_last_refreshed_at`'s `now()`.

- [ ] **Step 4: Rodar o teste**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instagestor_test pnpm vitest run --config vitest.integration.config.mts tests/integration/ban-account.integration.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Rodar toda a integração (o refactor de `disconnectAccount` é coberto pelos testes existentes) e commit**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instagestor_test pnpm test:integration && pnpm typecheck`
Expected: PASS.

```bash
git add src/server/accounts.ts scripts/seed.ts tests/integration/ban-account.integration.test.ts
git commit -m "feat: manual account ban, granted scopes and insights refresh request

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Sync de insights no worker

**Files:**
- Create: `src/jobs/insights-sync.ts`
- Modify: `worker/index.ts`
- Test: `tests/unit/insights-sync-rules.test.ts` (criar)
- Test: `tests/integration/insights-sync.integration.test.ts` (criar)

**Interfaces:**
- Consumes: provider (Tasks 2–3), `markAccountUnavailableIfCurrent`, `getEnv().INSIGHTS_*`.
- Produces:
```ts
export function utcDay(date: Date): string;                       // "YYYY-MM-DD"
export function recentDays(now?: Date, count?: number): string[]; // [hoje, ontem, anteontem]
export async function runInsightsSync(workerId: string): Promise<{ synced: number; failed: number }>;
```

- [ ] **Step 1: Teste unitário das regras puras**

Crie `tests/unit/insights-sync-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { recentDays, utcDay } from "@/jobs/insights-sync";

describe("dias do sync", () => {
  it("usa data UTC e devolve hoje, ontem e anteontem", () => {
    const now = new Date("2026-09-11T23:30:00-03:00"); // 2026-09-12T02:30Z
    expect(utcDay(now)).toBe("2026-09-12");
    expect(recentDays(now)).toEqual(["2026-09-12", "2026-09-11", "2026-09-10"]);
    expect(recentDays(now, 1)).toEqual(["2026-09-12"]);
  });
});
```

- [ ] **Step 2: Teste de integração do sync**

Crie `tests/integration/insights-sync.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { runInsightsSync } from "@/jobs/insights-sync";
import { resetEnvForTests } from "@/lib/env";
import { resetInstagramProviderForTests } from "@/providers";
import { createFakeAccounts } from "@/server/accounts";
import { createAccounts, createUser } from "./helpers";

async function fakeAccounts(count: number) {
  const userId = await createUser();
  await createFakeAccounts(count, userId);
  return getSqlClient()<Array<{ id: string; instagram_user_id: string }>>`
    SELECT id, instagram_user_id FROM instagram_accounts ORDER BY username
  `;
}

describe("runInsightsSync", () => {
  it("grava snapshot diário, mídias e vincula jobs publicados", async () => {
    const sql = getSqlClient();
    const [account] = await fakeAccounts(1);
    const userId = (await sql<Array<{ id: string }>>`SELECT id FROM users LIMIT 1`)[0].id;
    const [campaign] = await sql<Array<{ id: string }>>`
      INSERT INTO campaigns (name, publication_type, status, delay_mode, delay_fixed_seconds, target_order, created_by)
      VALUES ('c', 'REEL', 'COMPLETED', 'FIXED', 0, 'SELECTED', ${userId}) RETURNING id
    `;
    const [job] = await sql<Array<{ id: string }>>`
      INSERT INTO publication_jobs (campaign_id, instagram_account_id, scheduled_at, status, meta_media_id, published_at)
      VALUES (${campaign.id}, ${account.id}, now(), 'PUBLISHED', ${`fake_media_${account.instagram_user_id}_0`}, now())
      RETURNING id
    `;

    const result = await runInsightsSync("worker-test");
    expect(result).toEqual({ synced: 1, failed: 0 });

    const days = await sql<Array<{ day: string; followers_count: number | null; reach: number | null }>>`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, followers_count, reach FROM account_daily_metrics
      WHERE instagram_account_id = ${account.id} ORDER BY day DESC
    `;
    expect(days).toHaveLength(3);
    expect(days[0].followers_count).toBeGreaterThan(0);
    expect(days[1].followers_count).toBeNull();
    expect(days.every((day) => day.reach !== null)).toBe(true);

    const media = await sql<Array<{ id: string; product_type: string; views: number | null; published_job_id: string | null; expires_at: Date | null }>>`
      SELECT id, product_type, views, published_job_id, expires_at FROM account_media WHERE instagram_account_id = ${account.id} ORDER BY id
    `;
    expect(media.length).toBeGreaterThanOrEqual(6);
    expect(media.every((item) => item.views !== null)).toBe(true);
    const story = media.find((item) => item.product_type === "STORY");
    expect(story?.expires_at).toBeInstanceOf(Date);
    expect(media.find((item) => item.id === `fake_media_${account.instagram_user_id}_0`)?.published_job_id).toBe(job.id);

    const [row] = await sql<Array<{ insights_synced_at: Date | null; insights_error_code: string | null; biography: string | null }>>`
      SELECT insights_synced_at, insights_error_code, biography FROM instagram_accounts WHERE id = ${account.id}
    `;
    expect(row.insights_synced_at).toBeInstanceOf(Date);
    expect(row.insights_error_code).toBeNull();
    expect(row.biography).toContain("Bio");
  });

  it("não reprocessa conta sincronizada dentro do intervalo nem conta sem escopo", async () => {
    const sql = getSqlClient();
    await fakeAccounts(1);
    await createAccounts(1, "semescopo");
    await sql`UPDATE instagram_accounts SET encrypted_access_token = 'x' WHERE username LIKE 'semescopo%'`;
    expect(await runInsightsSync("w")).toEqual({ synced: 1, failed: 0 });
    expect(await runInsightsSync("w")).toEqual({ synced: 0, failed: 0 });
    const [{ count }] = await sql<Array<{ count: number }>>`SELECT count(*)::int AS count FROM account_daily_metrics`;
    expect(count).toBe(3);
  });

  it("segunda passada reescreve só os três últimos dias e mantém histórico antigo", async () => {
    const sql = getSqlClient();
    const [account] = await fakeAccounts(1);
    await sql`
      INSERT INTO account_daily_metrics (instagram_account_id, day, followers_count, reach)
      VALUES (${account.id}, current_date - 10, 111, 222)
    `;
    await runInsightsSync("w");
    await sql`UPDATE instagram_accounts SET insights_synced_at = now() - interval '2 hours'`;
    await runInsightsSync("w");
    const [old] = await sql<Array<{ followers_count: number; reach: number }>>`
      SELECT followers_count, reach FROM account_daily_metrics WHERE instagram_account_id = ${account.id} AND day = current_date - 10
    `;
    expect(old).toEqual({ followers_count: 111, reach: 222 });
    const [{ count }] = await sql<Array<{ count: number }>>`SELECT count(*)::int AS count FROM account_daily_metrics`;
    expect(count).toBe(4);
  });

  it("erro AUTH leva a REAUTH_REQUIRED; rate limit adia a conta", async () => {
    const sql = getSqlClient();
    const [account] = await fakeAccounts(1);

    process.env.FAKE_PROVIDER_SCENARIO = "http_401";
    resetEnvForTests();
    resetInstagramProviderForTests();
    expect(await runInsightsSync("w")).toEqual({ synced: 0, failed: 1 });
    const [auth] = await sql<Array<{ status: string }>>`SELECT status FROM instagram_accounts WHERE id = ${account.id}`;
    expect(auth.status).toBe("REAUTH_REQUIRED");

    await sql`UPDATE instagram_accounts SET status = 'CONNECTED', insights_synced_at = NULL WHERE id = ${account.id}`;
    process.env.FAKE_PROVIDER_SCENARIO = "http_429";
    resetEnvForTests();
    resetInstagramProviderForTests();
    expect(await runInsightsSync("w")).toEqual({ synced: 0, failed: 1 });
    const [limited] = await sql<Array<{ status: string; insights_error_code: string | null; future: boolean }>>`
      SELECT status, insights_error_code, insights_synced_at > now() + interval '10 minutes' AS future
      FROM instagram_accounts WHERE id = ${account.id}
    `;
    expect(limited).toEqual({ status: "CONNECTED", insights_error_code: "FAKE_429", future: true });

    process.env.FAKE_PROVIDER_SCENARIO = "success";
    resetEnvForTests();
    resetInstagramProviderForTests();
  });
});
```

`FAKE_PROVIDER_SCENARIO` é lido pelo `FakeInstagramProvider` no construtor via `getEnv()` (cacheado) e o provider também é cacheado em `getInstagramProvider()`; por isso, ao trocar a variável no meio do teste, chame `resetEnvForTests()` e depois `resetInstagramProviderForTests()`.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run tests/unit/insights-sync-rules.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Criar `src/jobs/insights-sync.ts`**

```ts
import { getSqlClient } from "@/db/client";
import { decryptToken } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { asInstagramError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { getInstagramProvider } from "@/providers";
import { INSIGHTS_SCOPE, type AccountDayInsights, type AccountSnapshot, type MediaProductType, type MediaSummary } from "@/providers/instagram";
import { markAccountUnavailableIfCurrent } from "./account-availability";

const DAY_MS = 86_400_000;
const CLAIM_BATCH = 10;
const FRESH_MEDIA_DAYS = 3;

type ClaimedAccount = { id: string; instagram_user_id: string; encrypted_access_token: string; status: string };
type PendingMedia = { id: string; product_type: MediaProductType };

// ponytail: dia = data UTC; a Meta fecha o dia no fuso dela. Trocar para settings.default_timezone se as bordas incomodarem.
export function utcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function recentDays(now = new Date(), count = 3) {
  return Array.from({ length: count }, (_, offset) => utcDay(new Date(now.getTime() - offset * DAY_MS)));
}

async function claimAccounts() {
  return getSqlClient()<ClaimedAccount[]>`
    WITH candidates AS (
      SELECT id FROM instagram_accounts
      WHERE status IN ('CONNECTED', 'TOKEN_EXPIRING') AND encrypted_access_token IS NOT NULL
        AND ${INSIGHTS_SCOPE} = ANY(granted_scopes)
        AND (insights_synced_at IS NULL OR insights_synced_at < now() - ${getEnv().INSIGHTS_SYNC_INTERVAL_MS} * interval '1 millisecond')
      ORDER BY insights_synced_at NULLS FIRST
      FOR UPDATE SKIP LOCKED
      LIMIT ${CLAIM_BATCH}
    )
    UPDATE instagram_accounts account SET insights_synced_at = now(), updated_at = now()
    FROM candidates WHERE account.id = candidates.id
    RETURNING account.id, account.instagram_user_id, account.encrypted_access_token, account.status
  `;
}

async function upsertDailyMetrics(accountId: string, today: string, snapshot: AccountSnapshot, days: AccountDayInsights[]) {
  const sql = getSqlClient();
  for (const day of days) {
    const isToday = day.day === today;
    await sql`
      INSERT INTO account_daily_metrics (
        instagram_account_id, day, followers_count, follows_count, media_count, follower_gains, reach, views,
        profile_views, accounts_engaged, total_interactions, likes, comments, shares, saves, replies,
        website_clicks, profile_links_taps, synced_at
      ) VALUES (
        ${accountId}, ${day.day}::date,
        ${isToday ? snapshot.followersCount : null}, ${isToday ? snapshot.followsCount : null}, ${isToday ? snapshot.mediaCount : null},
        ${day.followerGains}, ${day.reach}, ${day.views}, ${day.profileViews}, ${day.accountsEngaged}, ${day.totalInteractions},
        ${day.likes}, ${day.comments}, ${day.shares}, ${day.saves}, ${day.replies}, ${day.websiteClicks}, ${day.profileLinksTaps}, now()
      )
      ON CONFLICT (instagram_account_id, day) DO UPDATE SET
        followers_count = COALESCE(EXCLUDED.followers_count, account_daily_metrics.followers_count),
        follows_count = COALESCE(EXCLUDED.follows_count, account_daily_metrics.follows_count),
        media_count = COALESCE(EXCLUDED.media_count, account_daily_metrics.media_count),
        follower_gains = EXCLUDED.follower_gains, reach = EXCLUDED.reach, views = EXCLUDED.views,
        profile_views = EXCLUDED.profile_views, accounts_engaged = EXCLUDED.accounts_engaged,
        total_interactions = EXCLUDED.total_interactions, likes = EXCLUDED.likes, comments = EXCLUDED.comments,
        shares = EXCLUDED.shares, saves = EXCLUDED.saves, replies = EXCLUDED.replies,
        website_clicks = EXCLUDED.website_clicks, profile_links_taps = EXCLUDED.profile_links_taps, synced_at = now()
    `;
  }
}

async function upsertMedia(accountId: string, items: MediaSummary[]) {
  if (!items.length) return;
  const sql = getSqlClient();
  const rows = items.map((item) => ({
    id: item.id,
    instagram_account_id: accountId,
    media_type: item.mediaType,
    product_type: item.productType,
    permalink: item.permalink ?? null,
    thumbnail_url: item.thumbnailUrl ?? null,
    caption: item.caption ?? null,
    posted_at: item.postedAt.toISOString(),
    expires_at: item.productType === "STORY" ? new Date(item.postedAt.getTime() + DAY_MS).toISOString() : null,
    like_count: item.likeCount ?? null,
    comments_count: item.commentsCount ?? null,
  }));
  await sql`
    INSERT INTO account_media ${sql(rows)}
    ON CONFLICT (id) DO UPDATE SET
      permalink = COALESCE(EXCLUDED.permalink, account_media.permalink),
      thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, account_media.thumbnail_url),
      caption = COALESCE(EXCLUDED.caption, account_media.caption),
      like_count = COALESCE(EXCLUDED.like_count, account_media.like_count),
      comments_count = COALESCE(EXCLUDED.comments_count, account_media.comments_count),
      updated_at = now()
  `;
}

async function pendingMedia(accountId: string) {
  return getSqlClient()<PendingMedia[]>`
    SELECT id, product_type FROM account_media
    WHERE instagram_account_id = ${accountId} AND (
      (product_type = 'STORY' AND expires_at > now())
      OR (product_type <> 'STORY' AND posted_at > now() - ${FRESH_MEDIA_DAYS} * interval '1 day')
      OR (product_type <> 'STORY'
        AND posted_at > now() - ${getEnv().INSIGHTS_MEDIA_WINDOW_DAYS} * interval '1 day'
        AND (insights_synced_at IS NULL OR insights_synced_at < now() - interval '24 hours'))
    )
    ORDER BY posted_at DESC
  `;
}

async function syncAccount(account: ClaimedAccount, now: Date) {
  const sql = getSqlClient();
  const provider = getInstagramProvider();
  const accessToken = decryptToken(account.encrypted_access_token);
  const igUserId = account.instagram_user_id;
  const today = utcDay(now);
  let calls = 0;

  const snapshot = await provider.getAccountSnapshot(accessToken);
  calls++;
  const days = recentDays(now);
  const insights = await provider.getAccountInsights(igUserId, accessToken, days);
  calls += days.length + 1;
  await upsertDailyMetrics(account.id, today, snapshot, insights);

  const since = new Date(now.getTime() - getEnv().INSIGHTS_MEDIA_WINDOW_DAYS * DAY_MS);
  const [recent, stories] = await Promise.all([
    provider.listRecentMedia(igUserId, accessToken, since),
    provider.listLiveStories(igUserId, accessToken),
  ]);
  calls += 2;
  await upsertMedia(account.id, [...recent, ...stories]);

  let mediaSynced = 0;
  for (const media of await pendingMedia(account.id)) {
    try {
      const values = await provider.getMediaInsights(media.id, accessToken, media.product_type);
      calls++;
      await sql`
        UPDATE account_media SET views = ${values.views}, reach = ${values.reach}, shares = ${values.shares},
          saved = ${values.saved}, total_interactions = ${values.totalInteractions}, replies = ${values.replies},
          follows = ${values.follows}, profile_visits = ${values.profileVisits},
          reels_avg_watch_time_ms = ${values.reelsAvgWatchTimeMs}, reels_total_watch_time_ms = ${values.reelsTotalWatchTimeMs},
          story_taps_forward = ${values.storyTapsForward}, story_taps_back = ${values.storyTapsBack}, story_exits = ${values.storyExits},
          insights_synced_at = now(), updated_at = now()
        WHERE id = ${media.id}
      `;
      mediaSynced++;
    } catch (rawError) {
      const error = asInstagramError(rawError);
      if (error.kind === "AUTH" || error.kind === "RATE_LIMIT") throw error;
      log("warn", "insights-sync", "media_failed", { account_id: account.id, media_id: media.id, error_code: error.code });
    }
  }

  await sql`
    UPDATE account_media SET published_job_id = job.id, updated_at = now()
    FROM publication_jobs job
    WHERE job.meta_media_id = account_media.id AND account_media.instagram_account_id = ${account.id}
      AND account_media.published_job_id IS NULL
  `;
  await sql`
    UPDATE instagram_accounts SET username = ${snapshot.username}, display_name = ${snapshot.displayName ?? null},
      profile_picture_url = COALESCE(${snapshot.profilePictureUrl ?? null}, profile_picture_url),
      biography = ${snapshot.biography ?? null}, website = ${snapshot.website ?? null},
      insights_synced_at = now(), insights_error_code = NULL, last_successful_api_call_at = now(), updated_at = now()
    WHERE id = ${account.id} AND encrypted_access_token = ${account.encrypted_access_token}
  `;
  return { calls, mediaSynced };
}

export async function runInsightsSync(workerId: string) {
  const accounts = await claimAccounts();
  let synced = 0;
  let failed = 0;
  for (const account of accounts) {
    const started = Date.now();
    try {
      const { calls, mediaSynced } = await syncAccount(account, new Date());
      synced++;
      log("info", "insights-sync", "account_synced", {
        worker_id: workerId, account_id: account.id, calls, media_synced: mediaSynced, duration_ms: Date.now() - started,
      });
    } catch (rawError) {
      failed++;
      const error = asInstagramError(rawError);
      if (error.kind === "AUTH") {
        await markAccountUnavailableIfCurrent({
          accountId: account.id,
          expectedEncryptedToken: account.encrypted_access_token,
          expectedStatus: account.status,
          nextStatus: "REAUTH_REQUIRED",
          errorCode: error.code,
          errorKind: error.kind,
          errorMessage: error.message,
        });
      } else {
        const delayMs = error.kind === "RATE_LIMIT" ? Math.max(error.retryAfterSeconds ?? 0, 900) * 1000 : 0;
        await getSqlClient()`
          UPDATE instagram_accounts SET insights_error_code = ${error.code},
            insights_synced_at = now() + ${delayMs} * interval '1 millisecond',
            last_error_at = now(), last_error_code = ${error.code}, last_error_message = ${error.message}, updated_at = now()
          WHERE id = ${account.id} AND encrypted_access_token = ${account.encrypted_access_token}
        `;
      }
      log("warn", "insights-sync", "account_failed", {
        worker_id: workerId, account_id: account.id, error_code: error.code, error_kind: error.kind, duration_ms: Date.now() - started,
      });
    }
  }
  return { synced, failed };
}
```

- [ ] **Step 5: Registrar no worker**

Em `worker/index.ts`, importe `import { runInsightsSync } from "../src/jobs/insights-sync";` e, em `main()`, após `recoveryTask`:

```ts
  const insightsTask = createMaintenanceTask("insights_sync_failed", () => runInsightsSync(workerId));
  const insightsTimer = setInterval(() => void insightsTask.trigger(), 60_000);
  void insightsTask.trigger();
```

No `shutdown`, adicione `clearInterval(insightsTimer);`. No `Promise.all` final de espera, inclua `insightsTask.wait()`.

- [ ] **Step 6: Rodar testes**

Run: `pnpm vitest run tests/unit/insights-sync-rules.test.ts && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instagestor_test pnpm vitest run --config vitest.integration.config.mts tests/integration/insights-sync.integration.test.ts`
Expected: PASS (1 unit + 4 integração). Se o teste de "segunda passada" falhar em `count`, confira se `recentDays` e o `INSERT` do teste caem no mesmo dia UTC (`current_date` do Postgres vs. `utcDay` — o banco de teste deve estar em UTC; se não estiver, use `(now() AT TIME ZONE 'UTC')::date` no teste).

- [ ] **Step 7: Rodar o worker localmente por um ciclo para ver o log**

Run: `pnpm worker` (com `.env` apontando para o banco de desenvolvimento com contas fake do seed), aguarde ~5 s e interrompa com Ctrl+C.
Expected: linhas JSON `"event":"account_synced"` com `calls` e `media_synced`.

- [ ] **Step 8: Commit**

```bash
git add src/jobs/insights-sync.ts worker/index.ts tests/unit/insights-sync-rules.test.ts tests/integration/insights-sync.integration.test.ts
git commit -m "feat: hourly insights sync in worker

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Módulo de agregação `src/server/analytics.ts`

**Files:**
- Create: `src/server/analytics.ts`
- Test: `tests/unit/analytics-math.test.ts` (criar)
- Test: `tests/integration/analytics.integration.test.ts` (criar)

**Interfaces:**
- Produces:
```ts
export type PeriodDays = 7 | 30 | 90;
export type Period = { days: PeriodDays; from: string; to: string; previousFrom: string; previousTo: string };
export function resolvePeriod(days: PeriodDays, now?: Date): Period;
export function deltaPercent(current: number, previous: number): number | null;
export type Totals = {
  followers: number; netChange: number; gains: number; lost: number; reach: number; views: number; profileViews: number;
  accountsEngaged: number; totalInteractions: number; likes: number; comments: number; shares: number; saves: number;
  replies: number; websiteClicks: number; profileLinksTaps: number; mediaCount: number; mediaByTool: number;
};
export type DailyPoint = { day: string; followers: number | null; reach: number; views: number };
export const RANKING_ORDERS = ["followers", "net_change", "reach", "views", "total_interactions", "media_count"] as const;
export type RankingOrder = (typeof RANKING_ORDERS)[number];
export type AccountRank = {
  id: string; username: string; display_name: string | null; profile_picture_url: string | null; status: string;
  followers: number | null; net_change: number | null; reach: number; views: number; total_interactions: number;
  media_count: number; insights_synced_at: Date | null;
};
export const MEDIA_ORDERS = ["views", "reach", "like_count", "comments_count", "shares", "saved", "posted_at"] as const;
export type MediaOrder = (typeof MEDIA_ORDERS)[number];
export type MediaRow = {
  id: string; account_id: string; username: string; media_type: string; product_type: string; permalink: string | null;
  thumbnail_url: string | null; caption: string | null; posted_at: Date; like_count: number | null; comments_count: number | null;
  views: number | null; reach: number | null; shares: number | null; saved: number | null; replies: number | null; follows: number | null;
  reels_avg_watch_time_ms: number | null; story_taps_forward: number | null; story_taps_back: number | null; story_exits: number | null;
  published_job_id: string | null;
};
export type AnalyticsResult = {
  totals: Totals; previous: Totals; series: DailyPoint[]; ranking: AccountRank[]; media: MediaRow[];
  syncedAt: Date | null; missingScope: Array<{ id: string; username: string }>; syncErrors: Array<{ id: string; username: string; code: string }>;
};
export async function loadAnalytics(input: {
  accountIds: string[] | null; period: Period; mediaType?: "FEED" | "REELS" | "STORY";
  rankingOrder?: RankingOrder; mediaOrder?: MediaOrder;
}): Promise<AnalyticsResult>;
export type BanRecord = {
  id: string; account_id: string; username: string; display_name: string | null; status: string; banned_at: Date;
  reason: string | null; followers_count: number | null; published_by_tool: number | null; last_error_code: string | null;
  last_error_at: string | null; days_alive: number;
};
export async function loadBanHistory(): Promise<{ records: BanRecord[]; total: number; last30: number; avgDaysAlive: number | null; avgFollowers: number | null }>;
```

- [ ] **Step 1: Teste unitário das funções puras**

Crie `tests/unit/analytics-math.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deltaPercent, resolvePeriod } from "@/server/analytics";

describe("resolvePeriod", () => {
  it("fecha em hoje UTC e calcula o período anterior de mesmo tamanho", () => {
    const period = resolvePeriod(7, new Date("2026-09-11T22:00:00-03:00"));
    expect(period).toEqual({
      days: 7, from: "2026-09-06", to: "2026-09-12", previousFrom: "2026-08-30", previousTo: "2026-09-05",
    });
  });
});

describe("deltaPercent", () => {
  it("calcula variação relativa e devolve null sem base", () => {
    expect(deltaPercent(120, 100)).toBe(20);
    expect(deltaPercent(80, 100)).toBe(-20);
    expect(deltaPercent(5, 0)).toBeNull();
    expect(deltaPercent(0, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Teste de integração da agregação**

Crie `tests/integration/analytics.integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { loadAnalytics, loadBanHistory, resolvePeriod } from "@/server/analytics";
import { banAccount } from "@/server/accounts";
import { createAccounts, createUser } from "./helpers";

async function seedMetrics(accountId: string, rows: Array<{ daysAgo: number; followers?: number; gains?: number; reach?: number; views?: number; likes?: number }>) {
  const sql = getSqlClient();
  for (const row of rows) {
    await sql`
      INSERT INTO account_daily_metrics (instagram_account_id, day, followers_count, follower_gains, reach, views, likes)
      VALUES (${accountId}, (now() AT TIME ZONE 'UTC')::date - ${row.daysAgo}, ${row.followers ?? null}, ${row.gains ?? null},
        ${row.reach ?? null}, ${row.views ?? null}, ${row.likes ?? null})
    `;
  }
}

describe("loadAnalytics", () => {
  it("agregado soma os individuais e calcula ganhos, perdidos e variação", async () => {
    const sql = getSqlClient();
    const [a, b] = await createAccounts(2, "an");
    await sql`UPDATE instagram_accounts SET granted_scopes = ARRAY['instagram_business_manage_insights'], encrypted_access_token = 'x', insights_synced_at = now()`;
    // Conta A: base 100 antes do período, termina em 130; ganhou 40 → perdeu 10.
    await seedMetrics(a.id, [
      { daysAgo: 8, followers: 100, reach: 5 },
      { daysAgo: 3, followers: 120, gains: 25, reach: 50, views: 100, likes: 4 },
      { daysAgo: 0, followers: 130, gains: 15, reach: 30, views: 80, likes: 6 },
    ]);
    // Conta B: sem linha antes do período; primeira do período vira base (200 → 210).
    await seedMetrics(b.id, [
      { daysAgo: 5, followers: 200, gains: 10, reach: 10, views: 20 },
      { daysAgo: 1, followers: 210, gains: 5, reach: 20, views: 30 },
    ]);
    await sql`
      INSERT INTO account_media (id, instagram_account_id, media_type, product_type, posted_at, views, like_count)
      VALUES ('m1', ${a.id}, 'VIDEO', 'REELS', now() - interval '2 days', 500, 10),
             ('m2', ${b.id}, 'IMAGE', 'FEED', now() - interval '1 day', 300, 20),
             ('m3', ${b.id}, 'IMAGE', 'FEED', now() - interval '40 days', 900, 1)
    `;

    const period = resolvePeriod(7);
    const all = await loadAnalytics({ accountIds: null, period });
    expect(all.totals).toMatchObject({
      followers: 340, netChange: 40, gains: 55, lost: 15, reach: 110, views: 230, likes: 10, mediaCount: 2, mediaByTool: 0,
    });
    expect(all.previous.reach).toBe(5);
    expect(all.series.length).toBe(7);
    expect(all.series[all.series.length - 1].reach).toBe(30);
    expect(all.ranking.map((row) => row.username)).toEqual([a.username, b.username]); // ordem padrão: alcance (80 > 30)
    expect(all.media.map((row) => row.id)).toEqual(["m1", "m2"]);
    expect(all.missingScope).toEqual([]);

    const onlyA = await loadAnalytics({ accountIds: [a.id], period });
    const onlyB = await loadAnalytics({ accountIds: [b.id], period });
    expect(onlyA.totals.reach + onlyB.totals.reach).toBe(all.totals.reach);
    expect(onlyA.totals).toMatchObject({ followers: 130, netChange: 30, gains: 40, lost: 10 });
    expect(onlyB.totals).toMatchObject({ followers: 210, netChange: 10, gains: 15, lost: 5 });
    expect(onlyA.ranking).toHaveLength(1);

    const reels = await loadAnalytics({ accountIds: null, period, mediaType: "REELS" });
    expect(reels.media.map((row) => row.id)).toEqual(["m1"]);
    const byFollowers = await loadAnalytics({ accountIds: null, period, rankingOrder: "followers" });
    expect(byFollowers.ranking[0].username).toBe(b.username);
  });

  it("lista contas sem escopo e com erro de sync", async () => {
    const sql = getSqlClient();
    const [noScope, withError] = await createAccounts(2, "flag");
    await sql`UPDATE instagram_accounts SET encrypted_access_token = 'x'`;
    await sql`UPDATE instagram_accounts SET granted_scopes = ARRAY['instagram_business_manage_insights'], insights_error_code = 'META_4' WHERE id = ${withError.id}`;
    const result = await loadAnalytics({ accountIds: null, period: resolvePeriod(30) });
    expect(result.missingScope.map((row) => row.id)).toEqual([noScope.id]);
    expect(result.syncErrors).toEqual([{ id: withError.id, username: withError.username, code: "META_4" }]);
    expect(result.totals.followers).toBe(0);
    expect(result.syncedAt).toBeNull();
  });
});

describe("loadBanHistory", () => {
  it("lê os eventos de banimento com contexto", async () => {
    const sql = getSqlClient();
    const userId = await createUser();
    const [account] = await createAccounts(1, "hist");
    await sql`UPDATE instagram_accounts SET created_at = now() - interval '45 days' WHERE id = ${account.id}`;
    await sql`INSERT INTO account_daily_metrics (instagram_account_id, day, followers_count) VALUES (${account.id}, current_date, 777)`;
    await banAccount(account.id, "Checkpoint não resolvido", userId);

    const history = await loadBanHistory();
    expect(history.total).toBe(1);
    expect(history.last30).toBe(1);
    expect(history.avgFollowers).toBe(777);
    expect(history.avgDaysAlive).toBe(45);
    expect(history.records[0]).toMatchObject({
      account_id: account.id, username: account.username, status: "BANNED", reason: "Checkpoint não resolvido",
      followers_count: 777, published_by_tool: 0, days_alive: 45,
    });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run tests/unit/analytics-math.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Criar `src/server/analytics.ts`**

```ts
import { getSqlClient } from "@/db/client";
import { INSIGHTS_SCOPE } from "@/providers/instagram";

const DAY_MS = 86_400_000;

export type PeriodDays = 7 | 30 | 90;
export type Period = { days: PeriodDays; from: string; to: string; previousFrom: string; previousTo: string };

function utcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function resolvePeriod(days: PeriodDays, now = new Date()): Period {
  const to = new Date(`${utcDay(now)}T00:00:00Z`);
  const from = new Date(to.getTime() - (days - 1) * DAY_MS);
  const previousTo = new Date(from.getTime() - DAY_MS);
  const previousFrom = new Date(previousTo.getTime() - (days - 1) * DAY_MS);
  return { days, from: utcDay(from), to: utcDay(to), previousFrom: utcDay(previousFrom), previousTo: utcDay(previousTo) };
}

export function deltaPercent(current: number, previous: number) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export type Totals = {
  followers: number; netChange: number; gains: number; lost: number; reach: number; views: number; profileViews: number;
  accountsEngaged: number; totalInteractions: number; likes: number; comments: number; shares: number; saves: number;
  replies: number; websiteClicks: number; profileLinksTaps: number; mediaCount: number; mediaByTool: number;
};

export type DailyPoint = { day: string; followers: number | null; reach: number; views: number };

export const RANKING_ORDERS = ["followers", "net_change", "reach", "views", "total_interactions", "media_count"] as const;
export type RankingOrder = (typeof RANKING_ORDERS)[number];

export type AccountRank = {
  id: string; username: string; display_name: string | null; profile_picture_url: string | null; status: string;
  followers: number | null; net_change: number | null; reach: number; views: number; total_interactions: number;
  media_count: number; insights_synced_at: Date | null;
};

export const MEDIA_ORDERS = ["views", "reach", "like_count", "comments_count", "shares", "saved", "posted_at"] as const;
export type MediaOrder = (typeof MEDIA_ORDERS)[number];

export type MediaRow = {
  id: string; account_id: string; username: string; media_type: string; product_type: string; permalink: string | null;
  thumbnail_url: string | null; caption: string | null; posted_at: Date; like_count: number | null; comments_count: number | null;
  views: number | null; reach: number | null; shares: number | null; saved: number | null; replies: number | null; follows: number | null;
  reels_avg_watch_time_ms: number | null; story_taps_forward: number | null; story_taps_back: number | null; story_exits: number | null;
  published_job_id: string | null;
};

export type AnalyticsResult = {
  totals: Totals; previous: Totals; series: DailyPoint[]; ranking: AccountRank[]; media: MediaRow[];
  syncedAt: Date | null; missingScope: Array<{ id: string; username: string }>; syncErrors: Array<{ id: string; username: string; code: string }>;
};

type SumsRow = Omit<Totals, "followers" | "netChange" | "lost">;
type FollowerBound = { instagram_account_id: string; followers: number; net_change: number };

// Por conta: último followers_count até `to` e base (último antes de `from`, senão o primeiro dentro do período).
function followerBounds(ids: string[] | null, from: string, to: string) {
  return getSqlClient()<FollowerBound[]>`
    WITH scoped AS (
      SELECT id FROM instagram_accounts WHERE ${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[])
    ), last_in AS (
      SELECT DISTINCT ON (m.instagram_account_id) m.instagram_account_id, m.followers_count
      FROM account_daily_metrics m JOIN scoped ON scoped.id = m.instagram_account_id
      WHERE m.day <= ${to}::date AND m.followers_count IS NOT NULL
      ORDER BY m.instagram_account_id, m.day DESC
    ), base AS (
      SELECT DISTINCT ON (instagram_account_id) instagram_account_id, followers_count FROM (
        SELECT m.instagram_account_id, m.followers_count, 0 AS rank, m.day
        FROM account_daily_metrics m JOIN scoped ON scoped.id = m.instagram_account_id
        WHERE m.day < ${from}::date AND m.followers_count IS NOT NULL
        UNION ALL
        SELECT m.instagram_account_id, m.followers_count, 1 AS rank, m.day
        FROM account_daily_metrics m JOIN scoped ON scoped.id = m.instagram_account_id
        WHERE m.day BETWEEN ${from}::date AND ${to}::date AND m.followers_count IS NOT NULL
      ) candidates
      ORDER BY instagram_account_id, rank, CASE WHEN rank = 0 THEN day END DESC, day ASC
    )
    SELECT last_in.instagram_account_id, last_in.followers_count AS followers,
      last_in.followers_count - base.followers_count AS net_change
    FROM last_in JOIN base USING (instagram_account_id)
  `;
}

async function loadTotals(ids: string[] | null, from: string, to: string): Promise<Totals> {
  const sql = getSqlClient();
  const [[sums], bounds] = await Promise.all([
    sql<SumsRow[]>`
      WITH scoped AS (
        SELECT id FROM instagram_accounts WHERE ${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[])
      ), metrics AS (
        SELECT coalesce(sum(follower_gains), 0)::int AS gains, coalesce(sum(reach), 0)::int AS reach,
          coalesce(sum(views), 0)::int AS views, coalesce(sum(profile_views), 0)::int AS "profileViews",
          coalesce(sum(accounts_engaged), 0)::int AS "accountsEngaged", coalesce(sum(total_interactions), 0)::int AS "totalInteractions",
          coalesce(sum(likes), 0)::int AS likes, coalesce(sum(comments), 0)::int AS comments, coalesce(sum(shares), 0)::int AS shares,
          coalesce(sum(saves), 0)::int AS saves, coalesce(sum(replies), 0)::int AS replies,
          coalesce(sum(website_clicks), 0)::int AS "websiteClicks", coalesce(sum(profile_links_taps), 0)::int AS "profileLinksTaps"
        FROM account_daily_metrics m JOIN scoped ON scoped.id = m.instagram_account_id
        WHERE m.day BETWEEN ${from}::date AND ${to}::date
      ), media AS (
        SELECT count(*)::int AS "mediaCount", count(published_job_id)::int AS "mediaByTool"
        FROM account_media am JOIN scoped ON scoped.id = am.instagram_account_id
        WHERE am.posted_at >= ${from}::date AND am.posted_at < ${to}::date + 1
      )
      SELECT metrics.*, media.* FROM metrics, media
    `,
    followerBounds(ids, from, to),
  ]);
  const followers = bounds.reduce((total, row) => total + row.followers, 0);
  const netChange = bounds.reduce((total, row) => total + row.net_change, 0);
  // ponytail: perdidos = ganhos − variação líquida; subestima em contas < 100 seguidores (sem follower_gains).
  const lost = Math.max(sums.gains - netChange, 0);
  return { ...sums, followers, netChange, lost };
}

export async function loadAnalytics(input: {
  accountIds: string[] | null; period: Period; mediaType?: "FEED" | "REELS" | "STORY";
  rankingOrder?: RankingOrder; mediaOrder?: MediaOrder;
}): Promise<AnalyticsResult> {
  const sql = getSqlClient();
  const ids = input.accountIds;
  const { from, to, previousFrom, previousTo } = input.period;
  const rankingOrder: RankingOrder = input.rankingOrder ?? "reach";
  const mediaOrder: MediaOrder = input.mediaOrder ?? "views";

  const [totals, previous, series, sums, bounds, media, [state], missingScope, syncErrors] = await Promise.all([
    loadTotals(ids, from, to),
    loadTotals(ids, previousFrom, previousTo),
    sql<DailyPoint[]>`
      WITH days AS (
        SELECT generate_series(${from}::date, ${to}::date, interval '1 day')::date AS day
      )
      SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
        sum(m.followers_count)::int AS followers,
        coalesce(sum(m.reach), 0)::int AS reach, coalesce(sum(m.views), 0)::int AS views
      FROM days
      LEFT JOIN account_daily_metrics m ON m.day = days.day
        AND (${ids}::uuid[] IS NULL OR m.instagram_account_id = ANY(${ids}::uuid[]))
      GROUP BY days.day ORDER BY days.day
    `,
    sql<Array<{ id: string; username: string; display_name: string | null; profile_picture_url: string | null; status: string; reach: number; views: number; total_interactions: number; media_count: number; insights_synced_at: Date | null }>>`
      SELECT account.id, account.username, account.display_name, account.profile_picture_url, account.status, account.insights_synced_at,
        coalesce(sum(m.reach), 0)::int AS reach, coalesce(sum(m.views), 0)::int AS views,
        coalesce(sum(m.total_interactions), 0)::int AS total_interactions,
        (SELECT count(*)::int FROM account_media am WHERE am.instagram_account_id = account.id
          AND am.posted_at >= ${from}::date AND am.posted_at < ${to}::date + 1) AS media_count
      FROM instagram_accounts account
      LEFT JOIN account_daily_metrics m ON m.instagram_account_id = account.id AND m.day BETWEEN ${from}::date AND ${to}::date
      WHERE (${ids}::uuid[] IS NULL OR account.id = ANY(${ids}::uuid[]))
        AND (account.granted_scopes IS NOT NULL OR account.insights_synced_at IS NOT NULL OR m.instagram_account_id IS NOT NULL)
      GROUP BY account.id
    `,
    followerBounds(ids, from, to),
    sql<MediaRow[]>`
      SELECT am.id, am.instagram_account_id AS account_id, account.username, am.media_type, am.product_type, am.permalink,
        am.thumbnail_url, am.caption, am.posted_at, am.like_count, am.comments_count, am.views, am.reach, am.shares, am.saved,
        am.replies, am.follows, am.reels_avg_watch_time_ms, am.story_taps_forward, am.story_taps_back, am.story_exits, am.published_job_id
      FROM account_media am JOIN instagram_accounts account ON account.id = am.instagram_account_id
      WHERE (${ids}::uuid[] IS NULL OR am.instagram_account_id = ANY(${ids}::uuid[]))
        AND am.posted_at >= ${from}::date AND am.posted_at < ${to}::date + 1
        AND (${input.mediaType ?? null}::text IS NULL OR am.product_type = ${input.mediaType ?? null}::text)
      ORDER BY ${sql(mediaOrder)} DESC NULLS LAST, am.posted_at DESC
      LIMIT 20
    `,
    sql<Array<{ synced_at: Date | null }>>`
      SELECT min(insights_synced_at) AS synced_at FROM instagram_accounts
      WHERE status IN ('CONNECTED', 'TOKEN_EXPIRING') AND ${INSIGHTS_SCOPE} = ANY(granted_scopes)
        AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[]))
    `,
    sql<Array<{ id: string; username: string }>>`
      SELECT id, username FROM instagram_accounts
      WHERE status IN ('CONNECTED', 'TOKEN_EXPIRING') AND NOT (${INSIGHTS_SCOPE} = ANY(coalesce(granted_scopes, '{}')))
        AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[]))
      ORDER BY username
    `,
    sql<Array<{ id: string; username: string; code: string }>>`
      SELECT id, username, insights_error_code AS code FROM instagram_accounts
      WHERE status IN ('CONNECTED', 'TOKEN_EXPIRING') AND insights_error_code IS NOT NULL
        AND (${ids}::uuid[] IS NULL OR id = ANY(${ids}::uuid[]))
      ORDER BY username
    `,
  ]);

  const boundsById = new Map(bounds.map((row) => [row.instagram_account_id, row]));
  const ranking: AccountRank[] = sums
    .map((row) => ({
      ...row,
      followers: boundsById.get(row.id)?.followers ?? null,
      net_change: boundsById.get(row.id)?.net_change ?? null,
    }))
    .sort((a, b) => (b[rankingOrder] ?? -1) - (a[rankingOrder] ?? -1) || a.username.localeCompare(b.username));

  return { totals, previous, series, ranking, media, syncedAt: state?.synced_at ?? null, missingScope, syncErrors };
}

export type BanRecord = {
  id: string; account_id: string; username: string; display_name: string | null; status: string; banned_at: Date;
  reason: string | null; followers_count: number | null; published_by_tool: number | null; last_error_code: string | null;
  last_error_at: string | null; days_alive: number;
};

export async function loadBanHistory() {
  const records = await getSqlClient()<BanRecord[]>`
    SELECT log.id, account.id AS account_id, account.username, account.display_name, account.status, log.created_at AS banned_at,
      log.metadata_json->>'reason' AS reason,
      (log.metadata_json->>'followersCount')::int AS followers_count,
      (log.metadata_json->>'publishedByTool')::int AS published_by_tool,
      log.metadata_json->>'lastErrorCode' AS last_error_code,
      log.metadata_json->>'lastErrorAt' AS last_error_at,
      floor(extract(epoch FROM (log.created_at - account.created_at)) / 86400)::int AS days_alive
    FROM audit_logs log
    JOIN instagram_accounts account ON account.id::text = log.entity_id
    WHERE log.event_type = 'ACCOUNT_BANNED'
    ORDER BY log.created_at DESC
  `;
  const cutoff = Date.now() - 30 * DAY_MS;
  const average = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
  return {
    records,
    total: records.length,
    last30: records.filter((record) => record.banned_at.getTime() >= cutoff).length,
    avgDaysAlive: average(records.map((record) => record.days_alive)),
    avgFollowers: average(records.flatMap((record) => (record.followers_count === null ? [] : [record.followers_count]))),
  };
}
```

Notas para quem implementa:
- `${ids}::uuid[] IS NULL` com `ids = null` funciona porque postgres.js envia `NULL`; com array envia `uuid[]`.
- `sql(mediaOrder)` interpola um identificador (postgres.js), não um valor; `mediaOrder` sempre vem da whitelist `MEDIA_ORDERS` — a página valida antes de chamar.
- A série usa `generate_series` para não ter buracos; `followers` fica `null` em dias sem linha.

- [ ] **Step 5: Rodar os testes**

Run: `pnpm vitest run tests/unit/analytics-math.test.ts && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instagestor_test pnpm vitest run --config vitest.integration.config.mts tests/integration/analytics.integration.test.ts`
Expected: PASS (2 unit + 3 integração). Se `days_alive` der 44 por arredondamento de horas, troque no teste `interval '45 days'` por `interval '45 days 1 hour'`.

- [ ] **Step 6: Commit**

```bash
git add src/server/analytics.ts tests/unit/analytics-math.test.ts tests/integration/analytics.integration.test.ts
git commit -m "feat: analytics aggregation queries and ban history

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Gráficos SVG e helpers de UI

**Files:**
- Create: `src/components/charts.tsx`
- Modify: `src/components/ui.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/unit/analytics-math.test.ts` (adicionar casos de `linePath`/`formatNumber`)

**Interfaces:**
- Produces:
```ts
// src/components/charts.tsx
export function scaleY(value: number, max: number, height: number, padding: number): number;
export function linePath(values: Array<number | null>, width: number, height: number, padding: number): string;
export function LineChart(props: { title: string; points: Array<{ label: string; value: number | null }>; formatValue?: (value: number) => string }): JSX.Element;
export function BarChart(props: { title: string; groups: Array<{ label: string; values: number[] }>; seriesLabels: string[]; formatValue?: (value: number) => string }): JSX.Element;
// src/components/ui.tsx
export function formatNumber(value: number | null | undefined): string; // pt-BR, "—" para null
export function Delta({ value }: { value: number | null }): JSX.Element; // ▲ 12,5% / ▼ 3% / "novo"
```
  `StatusBadge` reconhece `BANNED` ("Banida", tom danger).

- [ ] **Step 1: Adicionar testes das funções puras**

Em `tests/unit/analytics-math.test.ts`, adicione:

```ts
import { linePath, scaleY } from "@/components/charts";
import { formatNumber } from "@/components/ui";

describe("gráfico de linha", () => {
  it("escala valores no eixo e pula pontos nulos", () => {
    expect(scaleY(0, 100, 200, 10)).toBe(190);
    expect(scaleY(100, 100, 200, 10)).toBe(10);
    expect(linePath([0, 100, null, 50], 300, 200, 10)).toBe("M10,190 L103.33,10 M290,100");
  });
});

describe("formatNumber", () => {
  it("formata em pt-BR e usa travessão para nulo", () => {
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatNumber(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/unit/analytics-math.test.ts`
Expected: FAIL — módulos/exports inexistentes.

- [ ] **Step 3: Criar `src/components/charts.tsx`**

```tsx
const WIDTH = 640;
const HEIGHT = 200;
const PADDING = 12;

export function scaleY(value: number, max: number, height: number, padding: number) {
  const usable = height - padding * 2;
  return Math.round((height - padding - (max ? (value / max) * usable : 0)) * 100) / 100;
}

export function linePath(values: Array<number | null>, width: number, height: number, padding: number) {
  const max = Math.max(1, ...values.map((value) => value ?? 0));
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;
  let path = "";
  let open = false;
  values.forEach((value, index) => {
    if (value === null) {
      open = false;
      return;
    }
    const x = Math.round((padding + index * step) * 100) / 100;
    const y = scaleY(value, max, height, padding);
    path += `${path ? " " : ""}${open ? "L" : "M"}${x},${y}`;
    open = true;
  });
  return path;
}

const defaultFormat = (value: number) => new Intl.NumberFormat("pt-BR").format(value);

export function LineChart({ title, points, formatValue = defaultFormat }: {
  title: string; points: Array<{ label: string; value: number | null }>; formatValue?: (value: number) => string;
}) {
  const values = points.map((point) => point.value);
  const max = Math.max(1, ...values.map((value) => value ?? 0));
  const step = points.length > 1 ? (WIDTH - PADDING * 2) / (points.length - 1) : 0;
  const last = [...points].reverse().find((point) => point.value !== null);
  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        {last ? <strong>{formatValue(last.value!)}</strong> : <strong>—</strong>}
      </figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={title} preserveAspectRatio="none">
        <line className="chart-axis" x1={PADDING} x2={WIDTH - PADDING} y1={HEIGHT - PADDING} y2={HEIGHT - PADDING} />
        <path className="chart-line" d={linePath(values, WIDTH, HEIGHT, PADDING)} fill="none" />
        {points.map((point, index) => point.value === null ? null : (
          <circle className="chart-point" key={point.label} cx={PADDING + index * step} cy={scaleY(point.value, max, HEIGHT, PADDING)} r="3">
            <title>{`${point.label}: ${formatValue(point.value)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-labels" aria-hidden="true">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </figure>
  );
}

export function BarChart({ title, groups, seriesLabels, formatValue = defaultFormat }: {
  title: string; groups: Array<{ label: string; values: number[] }>; seriesLabels: string[]; formatValue?: (value: number) => string;
}) {
  const max = Math.max(1, ...groups.flatMap((group) => group.values));
  const groupWidth = groups.length ? (WIDTH - PADDING * 2) / groups.length : 0;
  const barWidth = seriesLabels.length ? (groupWidth * 0.7) / seriesLabels.length : 0;
  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <span className="chart-legend">
          {seriesLabels.map((label, index) => <em className={`chart-swatch chart-bar-${index}`} key={label}>{label}</em>)}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={title} preserveAspectRatio="none">
        <line className="chart-axis" x1={PADDING} x2={WIDTH - PADDING} y1={HEIGHT - PADDING} y2={HEIGHT - PADDING} />
        {groups.map((group, groupIndex) => group.values.map((value, seriesIndex) => {
          const x = PADDING + groupIndex * groupWidth + groupWidth * 0.15 + seriesIndex * barWidth;
          const y = scaleY(value, max, HEIGHT, PADDING);
          return (
            <rect className={`chart-bar chart-bar-${seriesIndex}`} key={`${group.label}-${seriesIndex}`} x={x} y={y} width={barWidth} height={HEIGHT - PADDING - y}>
              <title>{`${group.label} · ${seriesLabels[seriesIndex]}: ${formatValue(value)}`}</title>
            </rect>
          );
        }))}
      </svg>
      <div className="chart-labels" aria-hidden="true">
        <span>{groups[0]?.label}</span>
        <span>{groups[groups.length - 1]?.label}</span>
      </div>
    </figure>
  );
}
```

- [ ] **Step 4: Alterar `src/components/ui.tsx`**

Em `statusLabels`, adicione `BANNED: "Banida",`. Em `dangerStatuses`, adicione `"BANNED"`. Ao final do arquivo:

```tsx
export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="metric-delta metric-delta-neutral">novo</span>;
  const tone = value > 0 ? "up" : value < 0 ? "down" : "neutral";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "•";
  return (
    <span className={`metric-delta metric-delta-${tone}`}>
      {arrow} {new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(Math.abs(value))}% vs. período anterior
    </span>
  );
}
```

- [ ] **Step 5: CSS**

Ao final de `src/app/globals.css` (as variáveis `--brand`, `--border`, `--success`, `--danger`, `--text-soft` já existem no `:root` do arquivo):

```css
.chart { margin: 0; display: grid; gap: 0.5rem; }
.chart figcaption { display: flex; justify-content: space-between; align-items: baseline; font-size: 0.875rem; color: var(--text-soft); }
.chart figcaption strong { font-size: 1.25rem; color: inherit; }
.chart svg { width: 100%; height: 200px; display: block; }
.chart-axis { stroke: var(--border); stroke-width: 1; }
.chart-line { stroke: var(--brand); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.chart-point { fill: var(--brand); }
.chart-bar-0 { fill: var(--brand); }
.chart-bar-1 { fill: var(--text-soft); opacity: 0.6; }
.chart-legend { display: flex; gap: 0.75rem; }
.chart-swatch { font-style: normal; padding-left: 1rem; position: relative; }
.chart-swatch::before { content: ""; position: absolute; left: 0; top: 0.3em; width: 0.6rem; height: 0.6rem; border-radius: 2px; background: currentColor; }
.chart-swatch.chart-bar-0 { color: var(--brand); }
.chart-swatch.chart-bar-1 { color: var(--text-soft); }
.chart-labels { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-soft); }
.metric-delta { font-size: 0.75rem; }
.metric-delta-up { color: var(--success); }
.metric-delta-down { color: var(--danger); }
.metric-delta-neutral { color: var(--text-soft); }
.analytics-filters { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: end; }
.analytics-filters label { display: grid; gap: 0.25rem; font-size: 0.8125rem; }
.analytics-tabs { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.media-thumb-small { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; background: var(--border); }
.metric-grid-analytics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.75rem; }
```

- [ ] **Step 6: Rodar testes, typecheck e commit**

Run: `pnpm vitest run tests/unit/analytics-math.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add src/components/charts.tsx src/components/ui.tsx src/app/globals.css tests/unit/analytics-math.test.ts
git commit -m "feat: SVG charts, delta badge and banned status label

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Server actions e página `/analises`

**Files:**
- Modify: `src/app/actions.ts`
- Modify: `src/components/admin-shell.tsx`
- Create: `src/app/(dashboard)/analises/page.tsx`
- Test: verificação manual no navegador (e2e vem na Task 11)

**Interfaces:**
- Consumes: `loadAnalytics`, `resolvePeriod`, `deltaPercent`, `RANKING_ORDERS`, `MEDIA_ORDERS` (Task 6); `LineChart`, `BarChart`, `Delta`, `formatNumber` (Task 7); `requestInsightsRefresh`, `banAccount`, `unbanAccount` (Task 4).
- Produces:
```ts
export async function refreshInsightsAction(formData: FormData): Promise<void>; // campos: accountId? (uuid), returnTo? (path)
export async function banAccountAction(formData: FormData): Promise<void>;      // campos: accountId, reason
export async function unbanAccountAction(formData: FormData): Promise<void>;    // campos: accountId
```

- [ ] **Step 1: Server actions**

Em `src/app/actions.ts`, amplie o import de accounts:

```ts
import { banAccount, createFakeAccounts, disconnectAccount, requestInsightsRefresh, unbanAccount, verifyAccount } from "@/server/accounts";
```

Adicione após `verifyAccountAction`:

```ts
function safeReturnPath(value: FormDataEntryValue | null, fallback: string) {
  const path = typeof value === "string" ? value : "";
  return /^\/(analises|contas)(\/|\?|$)/.test(path) ? path : fallback;
}

export async function refreshInsightsAction(formData: FormData) {
  await requireAdmin();
  const accountId = z.uuid().optional().parse(formData.get("accountId") || undefined);
  const returnTo = safeReturnPath(formData.get("returnTo"), "/analises");
  let count = 0;
  try {
    count = await requestInsightsRefresh(accountId);
    revalidatePath("/analises");
  } catch (error) {
    back(returnTo, error);
  }
  const separator = returnTo.includes("?") ? "&" : "?";
  redirect(`${returnTo}${separator}ok=${encodeURIComponent(`Atualização solicitada para ${count} conta(s); o worker processa em até 1 minuto`)}`);
}

export async function banAccountAction(formData: FormData) {
  const user = await requireAdmin();
  const accountId = id.parse(formData.get("accountId"));
  try {
    await banAccount(accountId, String(formData.get("reason") ?? ""), user.id);
    revalidatePath("/contas");
    revalidatePath(`/contas/${accountId}`);
    revalidatePath("/analises/banidas");
  } catch (error) {
    back(`/contas/${accountId}`, error);
  }
  redirect(`/contas/${accountId}?ok=${encodeURIComponent("Conta marcada como banida")}`);
}

export async function unbanAccountAction(formData: FormData) {
  const user = await requireAdmin();
  const accountId = id.parse(formData.get("accountId"));
  try {
    await unbanAccount(accountId, user.id);
    revalidatePath("/contas");
    revalidatePath(`/contas/${accountId}`);
    revalidatePath("/analises/banidas");
  } catch (error) {
    back(`/contas/${accountId}`, error);
  }
  redirect(`/contas/${accountId}?ok=${encodeURIComponent("Banimento desmarcado; reconecte a conta para voltar a usá-la")}`);
}
```

- [ ] **Step 2: Item de navegação**

Em `src/components/admin-shell.tsx`, no array `navigation`, insira após `Contas`:

```ts
  { href: "/analises", label: "Análises", mark: "A" },
```

- [ ] **Step 3: Criar `src/app/(dashboard)/analises/page.tsx`**

```tsx
import Link from "next/link";
import { z } from "zod";
import { refreshInsightsAction } from "@/app/actions";
import { getSqlClient } from "@/db/client";
import { BarChart, LineChart } from "@/components/charts";
import { Delta, EmptyState, formatDate, formatNumber, MessageBanner, MetricCard, PageHeader, Panel, StatusBadge, initials } from "@/components/ui";
import {
  deltaPercent, loadAnalytics, MEDIA_ORDERS, RANKING_ORDERS, resolvePeriod,
  type MediaOrder, type MediaRow, type PeriodDays, type RankingOrder, type Totals,
} from "@/server/analytics";

type Query = Record<string, string | string[] | undefined>;
type PageProps = { searchParams: Promise<Query> };

const PERIODS: PeriodDays[] = [7, 30, 90];
const MEDIA_TYPES = [
  ["", "Todas"], ["REELS", "Reels"], ["FEED", "Posts"], ["STORY", "Stories"],
] as const;

const PRIMARY_CARDS: Array<{ label: string; key: keyof Totals; tone?: "success" | "danger" | "brand" }> = [
  { label: "Seguidores", key: "followers", tone: "brand" },
  { label: "Seguidores ganhos", key: "gains", tone: "success" },
  { label: "Seguidores perdidos", key: "lost", tone: "danger" },
  { label: "Variação líquida", key: "netChange" },
  { label: "Alcance", key: "reach" },
  { label: "Visualizações", key: "views" },
  { label: "Visitas ao perfil", key: "profileViews" },
  { label: "Interações", key: "totalInteractions" },
  { label: "Curtidas", key: "likes" },
  { label: "Comentários", key: "comments" },
  { label: "Compartilhamentos", key: "shares" },
  { label: "Salvamentos", key: "saves" },
];

const SECONDARY_CARDS: Array<{ label: string; key: keyof Totals }> = [
  { label: "Cliques no link", key: "websiteClicks" },
  { label: "Toques em links do perfil", key: "profileLinksTaps" },
  { label: "Respostas de story", key: "replies" },
  { label: "Contas engajadas", key: "accountsEngaged" },
  { label: "Mídias no período", key: "mediaCount" },
  { label: "Publicadas via InstaGestor", key: "mediaByTool" },
];

function first(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

function buildHref(base: Record<string, string | undefined>, overrides: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...base, ...overrides })) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `/analises?${query}` : "/analises";
}

function shortDay(day: string) {
  const [, month, dayOfMonth] = day.split("-");
  return `${dayOfMonth}/${month}`;
}

function minutesAgo(date: Date | null) {
  return date ? Math.round((Date.now() - date.getTime()) / 60_000) : null;
}

function productLabel(productType: string) {
  return ({ REELS: "Reel", FEED: "Post", STORY: "Story" } as Record<string, string>)[productType] ?? productType;
}

function extraMetric(row: MediaRow) {
  if (row.product_type === "REELS") {
    return row.reels_avg_watch_time_ms === null ? "—" : `${(row.reels_avg_watch_time_ms / 1000).toFixed(1)}s assistidos`;
  }
  if (row.product_type === "STORY") {
    return `${formatNumber(row.story_taps_forward)} avanços · ${formatNumber(row.story_taps_back)} voltas · ${formatNumber(row.story_exits)} saídas`;
  }
  return `${formatNumber(row.follows)} seguidores ganhos`;
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const periodDays = PERIODS.find((days) => String(days) === first(query.periodo)) ?? 30;
  const accountId = z.uuid().safeParse(first(query.conta)).data;
  const groupId = z.uuid().safeParse(first(query.grupo)).data;
  const mediaType = pick(first(query.tipo), ["FEED", "REELS", "STORY"] as const);
  const rankingOrder: RankingOrder = pick(first(query.ordem), RANKING_ORDERS) ?? "reach";
  const mediaOrder: MediaOrder = pick(first(query.ordem_midia), MEDIA_ORDERS) ?? "views";
  const base = {
    periodo: String(periodDays), conta: accountId, grupo: accountId ? undefined : groupId, tipo: mediaType,
    ordem: rankingOrder === "reach" ? undefined : rankingOrder, ordem_midia: mediaOrder === "views" ? undefined : mediaOrder,
  };

  const sql = getSqlClient();
  const [accounts, groups] = await Promise.all([
    sql<Array<{ id: string; username: string; display_name: string | null; profile_picture_url: string | null; status: string; biography: string | null; website: string | null; followers_count: number | null; follows_count: number | null; media_count: number | null }>>`
      SELECT account.id, account.username, account.display_name, account.profile_picture_url, account.status, account.biography, account.website,
        latest.followers_count, latest.follows_count, latest.media_count
      FROM instagram_accounts account
      LEFT JOIN LATERAL (
        SELECT followers_count, follows_count, media_count FROM account_daily_metrics
        WHERE instagram_account_id = account.id AND followers_count IS NOT NULL ORDER BY day DESC LIMIT 1
      ) latest ON true
      WHERE account.status <> 'DISCONNECTED' OR account.insights_synced_at IS NOT NULL
      ORDER BY account.username
    `,
    sql<Array<{ id: string; name: string }>>`SELECT id, name FROM account_groups ORDER BY name`,
  ]);

  const selectedAccount = accountId ? accounts.find((account) => account.id === accountId) : undefined;
  const selectedGroup = !selectedAccount && groupId ? groups.find((group) => group.id === groupId) : undefined;
  let accountIds: string[] | null = null;
  let title = "Todas as contas";
  if (selectedAccount) {
    accountIds = [selectedAccount.id];
    title = selectedAccount.display_name ?? `@${selectedAccount.username}`;
  } else if (selectedGroup) {
    const members = await sql<Array<{ instagram_account_id: string }>>`
      SELECT instagram_account_id FROM account_group_members WHERE group_id = ${selectedGroup.id}
    `;
    accountIds = members.map((member) => member.instagram_account_id);
    title = `Grupo ${selectedGroup.name}`;
  }

  const period = resolvePeriod(periodDays);
  const data = await loadAnalytics({ accountIds, period, mediaType, rankingOrder, mediaOrder });
  const ago = minutesAgo(data.syncedAt);
  const stale = ago !== null && ago > 180;
  const nothingToShow = !data.ranking.length && !data.missingScope.length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Análises"
        title={title}
        description={
          ago === null
            ? "Nenhum sync de insights concluído ainda."
            : `Dados atualizados há ${ago < 60 ? `${ago} min` : `${Math.round(ago / 60)} h`} · os últimos 2 dias ainda podem mudar.`
        }
        actions={
          <>
            <form action={refreshInsightsAction}>
              {selectedAccount ? <input type="hidden" name="accountId" value={selectedAccount.id} /> : null}
              <input type="hidden" name="returnTo" value={buildHref(base, {})} />
              <button className="button button-secondary" type="submit">Atualizar agora</button>
            </form>
            <Link className="button button-ghost" href="/analises/banidas">Histórico de banidas</Link>
          </>
        }
      />
      <MessageBanner error={first(query.erro)} success={first(query.ok)} />
      {stale ? (
        <div className="message-banner message-error" role="status">
          <strong>Sync atrasado</strong>
          <span>O último sync foi há mais de 3 horas. Verifique se o worker está rodando.</span>
        </div>
      ) : null}

      <form className="analytics-filters" method="get" action="/analises">
        <label>
          Período
          <select name="periodo" defaultValue={String(periodDays)}>
            {PERIODS.map((days) => <option key={days} value={days}>Últimos {days} dias</option>)}
          </select>
        </label>
        <label>
          Conta
          <select name="conta" defaultValue={selectedAccount?.id ?? ""}>
            <option value="">Todas</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>@{account.username}</option>)}
          </select>
        </label>
        <label>
          Grupo
          <select name="grupo" defaultValue={selectedGroup?.id ?? ""}>
            <option value="">Nenhum</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        <button className="button button-primary" type="submit">Aplicar</button>
      </form>

      {data.missingScope.length ? (
        <Panel title={`${data.missingScope.length} conta(s) precisam reconectar para habilitar análises`} description="A permissão de insights só é concedida em uma nova conexão via Meta.">
          <ul className="tag-list">
            {data.missingScope.map((account) => <li key={account.id}>@{account.username}</li>)}
          </ul>
          <Link className="button button-secondary" href="/api/instagram/oauth/start">Reconectar via Meta</Link>
        </Panel>
      ) : null}
      {data.syncErrors.length ? (
        <Panel title={`${data.syncErrors.length} conta(s) com erro no último sync`}>
          <ul className="tag-list">
            {data.syncErrors.map((account) => <li key={account.id}>@{account.username} · <span className="mono-copy">{account.code}</span></li>)}
          </ul>
        </Panel>
      ) : null}

      {selectedAccount ? (
        <section className="account-hero panel">
          <span className="account-avatar account-avatar-large" aria-hidden="true">
            {selectedAccount.profile_picture_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedAccount.profile_picture_url} alt="" referrerPolicy="no-referrer" />
            ) : initials(selectedAccount.display_name ?? selectedAccount.username)}
          </span>
          <div className="account-hero-main">
            <StatusBadge status={selectedAccount.status} />
            <p>@{selectedAccount.username} · {formatNumber(selectedAccount.followers_count)} seguidores · {formatNumber(selectedAccount.follows_count)} seguindo · {formatNumber(selectedAccount.media_count)} publicações</p>
            {selectedAccount.biography ? <p className="muted">{selectedAccount.biography}</p> : null}
            {selectedAccount.website ? <a className="text-link" href={selectedAccount.website} rel="noreferrer" target="_blank">{selectedAccount.website}</a> : null}
            <Link className="text-link" href={`/contas/${selectedAccount.id}`}>Ver detalhes operacionais</Link>
          </div>
        </section>
      ) : null}

      {nothingToShow ? (
        <EmptyState
          title="Nenhuma conta com análises"
          description="Conecte (ou reconecte) contas concedendo a permissão de insights. O worker sincroniza automaticamente em até 1 minuto."
          href="/api/instagram/oauth/start"
          actionLabel="Conectar Instagram"
        />
      ) : (
        <>
          <section className="metric-grid-analytics" aria-label="Indicadores do período">
            {PRIMARY_CARDS.map((card) => (
              <MetricCard
                key={card.key}
                label={card.label}
                value={formatNumber(data.totals[card.key])}
                tone={card.tone ?? "default"}
                detail={<Delta value={deltaPercent(data.totals[card.key], data.previous[card.key])} />}
              />
            ))}
          </section>
          <section className="metric-grid metric-grid-compact" aria-label="Indicadores secundários">
            {SECONDARY_CARDS.map((card) => (
              <MetricCard key={card.key} label={card.label} value={formatNumber(data.totals[card.key])} detail={<Delta value={deltaPercent(data.totals[card.key], data.previous[card.key])} />} />
            ))}
          </section>

          <section className="two-column-grid">
            <Panel>
              <LineChart title="Seguidores por dia" points={data.series.map((point) => ({ label: shortDay(point.day), value: point.followers }))} />
            </Panel>
            <Panel>
              <BarChart
                title="Alcance e visualizações por dia"
                seriesLabels={["Alcance", "Visualizações"]}
                groups={data.series.map((point) => ({ label: shortDay(point.day), values: [point.reach, point.views] }))}
              />
            </Panel>
          </section>

          {!selectedAccount ? (
            <Panel title="Ranking de contas" description="Clique em uma conta para ver só ela">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Conta</th>
                      <th scope="col">Status</th>
                      {([
                        ["followers", "Seguidores"], ["net_change", "Δ seguidores"], ["reach", "Alcance"],
                        ["views", "Views"], ["total_interactions", "Interações"], ["media_count", "Mídias"],
                      ] as const).map(([key, label]) => (
                        <th scope="col" key={key} aria-sort={rankingOrder === key ? "descending" : undefined}>
                          <Link className="text-link" href={buildHref(base, { ordem: key })}>{label}</Link>
                        </th>
                      ))}
                      <th scope="col">Último sync</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ranking.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Conta"><Link className="table-primary-link" href={buildHref(base, { conta: row.id, grupo: undefined })}>@{row.username}</Link></td>
                        <td data-label="Status"><StatusBadge status={row.status} /></td>
                        <td data-label="Seguidores">{formatNumber(row.followers)}</td>
                        <td data-label="Δ seguidores">{row.net_change === null ? "—" : `${row.net_change > 0 ? "+" : ""}${formatNumber(row.net_change)}`}</td>
                        <td data-label="Alcance">{formatNumber(row.reach)}</td>
                        <td data-label="Views">{formatNumber(row.views)}</td>
                        <td data-label="Interações">{formatNumber(row.total_interactions)}</td>
                        <td data-label="Mídias">{formatNumber(row.media_count)}</td>
                        <td data-label="Último sync">{formatDate(row.insights_synced_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}

          <Panel
            title="Mídias no período"
            description="Até 20 mídias, ordenadas pela coluna escolhida"
            action={
              <nav className="analytics-tabs" aria-label="Tipo de mídia">
                {MEDIA_TYPES.map(([value, label]) => (
                  <Link key={value || "todas"} className={`button button-small ${(mediaType ?? "") === value ? "button-primary" : "button-secondary"}`} href={buildHref(base, { tipo: value || undefined })}>{label}</Link>
                ))}
              </nav>
            }
          >
            {data.media.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Mídia</th>
                      <th scope="col">Conta</th>
                      <th scope="col">Tipo</th>
                      {([
                        ["posted_at", "Data"], ["views", "Views"], ["reach", "Alcance"], ["like_count", "Curtidas"],
                        ["comments_count", "Coment."], ["shares", "Compart."], ["saved", "Salv."],
                      ] as const).map(([key, label]) => (
                        <th scope="col" key={key} aria-sort={mediaOrder === key ? "descending" : undefined}>
                          <Link className="text-link" href={buildHref(base, { ordem_midia: key })}>{label}</Link>
                        </th>
                      ))}
                      <th scope="col">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.media.map((row) => (
                      <tr key={row.id}>
                        <td data-label="Mídia">
                          <a className="table-primary-link" href={row.permalink ?? "#"} rel="noreferrer" target="_blank">
                            {row.thumbnail_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img className="media-thumb-small" src={row.thumbnail_url} alt="" referrerPolicy="no-referrer" />
                            ) : null}
                            <span className="cell-wrap">{row.caption?.slice(0, 60) || row.id}</span>
                          </a>
                          {row.published_job_id ? <span className="status-badge status-success">via InstaGestor</span> : null}
                        </td>
                        <td data-label="Conta">@{row.username}</td>
                        <td data-label="Tipo">{productLabel(row.product_type)}</td>
                        <td data-label="Data">{formatDate(row.posted_at)}</td>
                        <td data-label="Views">{formatNumber(row.views)}</td>
                        <td data-label="Alcance">{formatNumber(row.reach)}</td>
                        <td data-label="Curtidas">{formatNumber(row.like_count)}</td>
                        <td data-label="Coment.">{formatNumber(row.comments_count)}</td>
                        <td data-label="Compart.">{formatNumber(row.shares)}</td>
                        <td data-label="Salv.">{formatNumber(row.saved)}</td>
                        <td data-label="Detalhe" className="cell-wrap">{extraMetric(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="panel-placeholder">Nenhuma mídia sincronizada no período.</p>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verificar no navegador**

Run: `pnpm dev` (web + worker) com o banco de desenvolvimento semeado (`pnpm db:migrate && pnpm db:seed` com provider fake). Aguarde ~1 min para o worker sincronizar.
Expected: `/analises` mostra cards com números > 0, dois gráficos, ranking com 10 contas fake, tabela de mídias com reels/posts/story; clicar em uma conta filtra; `?periodo=7` muda os números; "Atualizar agora" redireciona com banner verde; sem JavaScript de cliente além do existente. Confira também `/analises?conta=<uuid-inexistente>` (cai em "Todas as contas") e `?ordem=xyz` (ignora).

- [ ] **Step 5: Typecheck, lint e commit**

Run: `pnpm typecheck && pnpm lint`
Expected: limpo.

```bash
git add src/app/actions.ts src/components/admin-shell.tsx "src/app/(dashboard)/analises/page.tsx"
git commit -m "feat: analytics page with aggregate and per-account views

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Página `/analises/banidas`

**Files:**
- Create: `src/app/(dashboard)/analises/banidas/page.tsx`

**Interfaces:**
- Consumes: `loadBanHistory` (Task 6), `formatNumber`, `formatDate`, `StatusBadge`, `MetricCard`, `Panel`, `EmptyState`, `PageHeader`.

- [ ] **Step 1: Criar a página**

```tsx
import Link from "next/link";
import { EmptyState, formatDate, formatNumber, MetricCard, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { loadBanHistory } from "@/server/analytics";

export default async function BannedAccountsPage() {
  const history = await loadBanHistory();
  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="Navegação estrutural">
        <Link href="/analises">Análises</Link><span aria-hidden="true">/</span><span>Banidas</span>
      </nav>
      <PageHeader
        eyebrow="Análises"
        title="Histórico de banidas"
        description="Cada marcação manual fica registrada com o contexto da conta naquele momento."
      />
      <section className="metric-grid metric-grid-compact" aria-label="Resumo de banimentos">
        <MetricCard label="Total de banimentos" value={history.total} tone={history.total ? "danger" : "default"} />
        <MetricCard label="Nos últimos 30 dias" value={history.last30} />
        <MetricCard label="Média de dias de vida" value={history.avgDaysAlive === null ? "—" : formatNumber(history.avgDaysAlive)} />
        <MetricCard label="Média de seguidores no ban" value={formatNumber(history.avgFollowers)} />
      </section>
      <Panel>
        {history.records.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Conta</th>
                  <th scope="col">Banida em</th>
                  <th scope="col">Motivo</th>
                  <th scope="col">Seguidores</th>
                  <th scope="col">Dias de vida</th>
                  <th scope="col">Publicações via ferramenta</th>
                  <th scope="col">Último erro da Meta</th>
                  <th scope="col">Situação atual</th>
                </tr>
              </thead>
              <tbody>
                {history.records.map((record) => (
                  <tr key={record.id}>
                    <td data-label="Conta"><Link className="table-primary-link" href={`/contas/${record.account_id}`}>@{record.username}</Link></td>
                    <td data-label="Banida em">{formatDate(record.banned_at)}</td>
                    <td data-label="Motivo" className="cell-wrap">{record.reason ?? "—"}</td>
                    <td data-label="Seguidores">{formatNumber(record.followers_count)}</td>
                    <td data-label="Dias de vida">{formatNumber(record.days_alive)}</td>
                    <td data-label="Publicações via ferramenta">{formatNumber(record.published_by_tool)}</td>
                    <td data-label="Último erro da Meta" className="cell-wrap">
                      {record.last_error_code ? (
                        <>
                          <span className="mono-copy">{record.last_error_code}</span>
                          {record.last_error_at ? <small className="muted"> · {formatDate(record.last_error_at)}</small> : null}
                        </>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td data-label="Situação atual"><StatusBadge status={record.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Nenhuma conta banida" description="Marque uma conta como banida na tela de detalhes da conta e ela aparecerá aqui." href="/contas" actionLabel="Ir para contas" />
        )}
      </Panel>
    </div>
  );
}
```

- [ ] **Step 2: Verificar, typecheck e commit**

Run: `pnpm typecheck && pnpm lint`; no navegador, `/analises/banidas` mostra o estado vazio (ainda não há ação de banir na UI — vem na Task 10).

```bash
git add "src/app/(dashboard)/analises/banidas/page.tsx"
git commit -m "feat: banned accounts history page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Banimento e resumo de análises em `/contas/[id]`; filtro em `/contas`

**Files:**
- Modify: `src/app/(dashboard)/contas/[id]/page.tsx`
- Modify: `src/app/(dashboard)/contas/page.tsx`

**Interfaces:**
- Consumes: `banAccountAction`, `unbanAccountAction`, `refreshInsightsAction` (Task 8); `loadAnalytics`, `resolvePeriod` (Task 6); `formatNumber` (Task 7).

- [ ] **Step 1: `/contas/[id]` — imports e dados**

Altere o import de actions para:

```ts
import { banAccountAction, disconnectAccountAction, refreshInsightsAction, unbanAccountAction, verifyAccountAction } from "@/app/actions";
```

Adicione `formatNumber` ao import de `@/components/ui` e:

```ts
import { loadAnalytics, resolvePeriod } from "@/server/analytics";
```

No tipo `Account`, adicione:

```ts
  banned_at: Date | null;
  ban_reason: string | null;
  granted_scopes: string[] | null;
  insights_synced_at: Date | null;
```

No `SELECT` da conta, acrescente `banned_at, ban_reason, granted_scopes, insights_synced_at`. Após o `Promise.all` existente e o `if (!account) notFound();`, adicione:

```ts
  const analytics = await loadAnalytics({ accountIds: [account.id], period: resolvePeriod(30) });
  const hasInsightsScope = account.granted_scopes?.includes("instagram_business_manage_insights") ?? false;
  const isBanned = account.status === "BANNED";
```

Altere `mustReconnect` para incluir `"BANNED"`:

```ts
  const mustReconnect = ["REAUTH_REQUIRED", "DISCONNECTED", "DISABLED", "BANNED"].includes(account.status);
```

- [ ] **Step 2: `/contas/[id]` — ações do cabeçalho e banner de banimento**

No `actions` do `PageHeader`, mantenha os botões existentes e acrescente, antes do bloco `canVerify ? (...)`:

```tsx
            {isBanned ? (
              <form action={unbanAccountAction}>
                <input type="hidden" name="accountId" value={account.id} />
                <button className="button button-secondary" type="submit">Desmarcar banimento</button>
              </form>
            ) : null}
```

Logo após `<MessageBanner ... />`, adicione:

```tsx
      {isBanned ? (
        <div className="message-banner message-error" role="alert">
          <strong>Conta marcada como banida em {formatDate(account.banned_at)}</strong>
          <span>{account.ban_reason}</span>
        </div>
      ) : null}
```

- [ ] **Step 3: `/contas/[id]` — painel de análises**

Após a `<section className="metric-grid metric-grid-compact" aria-label="Resultados da conta">`, insira:

```tsx
      <Panel
        title="Análises (últimos 30 dias)"
        description={hasInsightsScope
          ? `Último sync: ${formatDate(account.insights_synced_at)}`
          : "Reconecte esta conta via Meta para conceder a permissão de insights."}
        action={hasInsightsScope ? (
          <div className="page-actions">
            <form action={refreshInsightsAction}>
              <input type="hidden" name="accountId" value={account.id} />
              <input type="hidden" name="returnTo" value={`/contas/${account.id}`} />
              <button className="button button-small button-secondary" type="submit">Atualizar agora</button>
            </form>
            <Link className="text-link" href={`/analises?conta=${account.id}`}>Ver análises completas</Link>
          </div>
        ) : undefined}
      >
        <section className="metric-grid metric-grid-compact">
          <MetricCard label="Seguidores" value={formatNumber(analytics.totals.followers)} tone="brand" />
          <MetricCard label="Alcance" value={formatNumber(analytics.totals.reach)} />
          <MetricCard label="Visualizações" value={formatNumber(analytics.totals.views)} />
          <MetricCard label="Interações" value={formatNumber(analytics.totals.totalInteractions)} />
        </section>
      </Panel>
```

- [ ] **Step 4: `/contas/[id]` — zona de banimento**

Ao final do `page-stack`, após o `Panel` "Atividade recente", adicione (só quando não banida):

```tsx
      {!isBanned ? (
        <Panel className="danger-zone" title="Marcar como banida" description="Use quando a Meta suspendeu ou desativou esta conta. Jobs pendentes serão encerrados e o token descartado.">
          <details className="native-disclosure">
            <summary>Registrar banimento</summary>
            <form className="form-stack" action={banAccountAction}>
              <input type="hidden" name="accountId" value={account.id} />
              <label>
                Motivo
                <textarea name="reason" minLength={3} maxLength={500} rows={3} required placeholder="Ex.: suspensa após checkpoint de verificação" />
              </label>
              <button className="button button-danger" type="submit">Confirmar banimento</button>
            </form>
          </details>
        </Panel>
      ) : null}
```

- [ ] **Step 5: `/contas` — filtro e contagens**

Em `src/app/(dashboard)/contas/page.tsx`:

- na lista de filtros, adicione `["banidas", "Banidas"],` após `["reconectar", "Reconectar"],`;
- em `filteredAccounts`, adicione `if (selectedFilter === "banidas") return account.status === "BANNED";` antes do `return true;`;
- no `ORDER BY ... CASE account.status`, deixe `BANNED` cair no `ELSE 4` (nada a fazer);
- na condição que mostra o botão "Desconectar" (`!(["DISCONNECTED", "DISABLED"].includes(account.status))`), inclua `"BANNED"` na lista para esconder o botão em contas banidas.

- [ ] **Step 6: Verificar no navegador**

Run: `pnpm dev`. Em `/contas/<id de uma conta fake>`: painel "Análises" com números; "Registrar banimento" → motivo → confirmar → redireciona com banner verde, status "Banida", banner vermelho com motivo, botão "Desmarcar banimento"; `/analises/banidas` lista a conta com dias de vida e seguidores; `/contas?filtro=banidas` mostra só ela; "Desmarcar banimento" → status "Desconectada" e botão "Reconectar via Meta".

- [ ] **Step 7: Typecheck, lint e commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add "src/app/(dashboard)/contas/[id]/page.tsx" "src/app/(dashboard)/contas/page.tsx"
git commit -m "feat: ban controls and analytics summary on account page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Teste e2e das páginas novas

**Files:**
- Create: `tests/e2e/analytics.spec.ts`

**Interfaces:**
- Consumes: `login`, `withE2EDatabase` de `tests/e2e/helpers.ts`; provider fake do ambiente e2e (ver `playwright.config.ts` para as variáveis usadas pelo servidor).

- [ ] **Step 1: Escrever o teste**

```ts
import { expect, test } from "@playwright/test";
import { login, withE2EDatabase } from "./helpers";

const DAY = 86_400_000;

async function seedAnalyticsAccount() {
  return withE2EDatabase(async (sql) => {
    await sql`DELETE FROM account_media`;
    await sql`DELETE FROM account_daily_metrics`;
    await sql`DELETE FROM audit_logs WHERE event_type IN ('ACCOUNT_BANNED', 'ACCOUNT_UNBANNED')`;
    await sql`DELETE FROM instagram_accounts WHERE instagram_user_id LIKE 'e2e_analytics_%'`;
    const [account] = await sql<Array<{ id: string }>>`
      INSERT INTO instagram_accounts (instagram_user_id, username, status, encrypted_access_token, granted_scopes, insights_synced_at, created_at)
      VALUES ('e2e_analytics_1', 'e2e_analytics', 'CONNECTED', 'cifrado',
        ARRAY['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'],
        now(), now() - interval '20 days')
      RETURNING id
    `;
    const today = new Date();
    for (let offset = 0; offset < 5; offset++) {
      const day = new Date(today.getTime() - offset * DAY).toISOString().slice(0, 10);
      await sql`
        INSERT INTO account_daily_metrics (instagram_account_id, day, followers_count, follower_gains, reach, views, likes)
        VALUES (${account.id}, ${day}::date, ${1000 - offset * 10}, 12, 300, 900, 40)
      `;
    }
    await sql`
      INSERT INTO account_media (id, instagram_account_id, media_type, product_type, posted_at, views, reach, like_count, caption, permalink)
      VALUES ('e2e_reel_1', ${account.id}, 'VIDEO', 'REELS', now() - interval '1 day', 4321, 3000, 50, 'Reel de teste', 'https://www.instagram.com/p/e2e/')
    `;
    return account.id;
  });
}

test.describe("análises", () => {
  test("mostra agregado, filtra por conta e permite banir com histórico", async ({ page }) => {
    const accountId = await seedAnalyticsAccount();
    await login(page);

    await page.goto("/analises");
    await expect(page.getByRole("heading", { name: "Todas as contas" })).toBeVisible();
    await expect(page.getByText("Seguidores ganhos")).toBeVisible();
    await expect(page.getByRole("img", { name: "Seguidores por dia" })).toBeVisible();
    await expect(page.getByRole("link", { name: "@e2e_analytics" }).first()).toBeVisible();
    await expect(page.getByText("Reel de teste")).toBeVisible();

    await page.getByRole("link", { name: "@e2e_analytics" }).first().click();
    await expect(page).toHaveURL(new RegExp(`conta=${accountId}`));
    await expect(page.getByRole("heading", { name: "@e2e_analytics" })).toBeVisible();
    await expect(page.getByText("1.000 seguidores")).toBeVisible();

    await page.getByRole("button", { name: "Atualizar agora" }).click();
    await expect(page.getByText(/Atualização solicitada/)).toBeVisible();

    await page.goto(`/contas/${accountId}`);
    await expect(page.getByRole("heading", { name: "Análises (últimos 30 dias)" })).toBeVisible();
    await page.getByText("Registrar banimento").click();
    await page.getByLabel("Motivo").fill("Suspensa pela Meta no e2e");
    await page.getByRole("button", { name: "Confirmar banimento" }).click();
    await expect(page.getByText("Conta marcada como banida").first()).toBeVisible();
    await expect(page.getByText("Banida", { exact: true })).toBeVisible();

    await page.goto("/analises/banidas");
    await expect(page.getByText("Suspensa pela Meta no e2e")).toBeVisible();
    await expect(page.getByRole("cell", { name: "1.000" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "20" })).toBeVisible();

    await page.goto(`/contas/${accountId}`);
    await page.getByRole("button", { name: "Desmarcar banimento" }).click();
    await expect(page.getByText("Banimento desmarcado")).toBeVisible();
    await expect(page.getByText("Desconectada", { exact: true })).toBeVisible();
  });
});
```

- [ ] **Step 2: Rodar**

Run: `pnpm test:e2e -- tests/e2e/analytics.spec.ts` (com o ambiente e2e do `playwright.config.ts`, que já sobe o web em provider fake e migra o banco `_test`).
Expected: PASS. Se o texto "1.000 seguidores" não bater, confira a formatação `Intl` no ambiente (Node ≥ 20 traz ICU completo).

- [ ] **Step 3: Rodar tudo e commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instagestor_test pnpm test:integration && pnpm test:e2e`
Expected: tudo PASS.

```bash
git add tests/e2e/analytics.spec.ts
git commit -m "test: e2e coverage for analytics and ban flow

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Documentação e App Review

**Files:**
- Modify: `docs/META_APP_REVIEW.md`, `docs/META_SETUP.md`, `docs/META_API_REFERENCE.md`, `docs/DATABASE.md`, `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`, `README.md`

- [ ] **Step 1: `docs/META_APP_REVIEW.md`**

Após a seção `## Texto sugerido — instagram_business_content_publish`, adicione:

```markdown
## Texto sugerido — `instagram_business_manage_insights`

### Justificativa em inglês

> InstaGestor shows an authorized organization administrator the performance of the Instagram professional accounts the organization owns or is authorized to manage. After the administrator connects an account with Business Login for Instagram, a background worker periodically calls the account insights endpoint (reach, views, profile views, accounts engaged, interactions, follower count) and the media insights endpoint for recent posts, reels and stories. The results are stored and displayed in the Analytics screen, aggregated across all connected accounts and per account, so the administrator can compare accounts, track follower growth and identify the best-performing content. InstaGestor does not use insights for ads, does not expose them to third parties and does not access consumer accounts.

### O screencast precisa mostrar

1. Conta já conectada após o OAuth (com a permissão de insights concedida na tela da Meta).
2. Tela **Análises** com os cards de seguidores, alcance, visualizações e interações.
3. Filtro por conta mostrando a mesma tela para uma conta só.
4. Tabela de mídias com views/alcance por reel/post/story.
5. Se endpoints forem mostrados, exibir apenas `GET /{ig-user-id}/insights` e `GET /{ig-media-id}/insights`; ocultar token e headers.
```

Na seção `## Roteiro de screencast único`, acrescente ao final da lista existente um passo "Abrir **Análises** e mostrar os indicadores da conta conectada". Na seção `## Erros que devem reprovar nossa própria submissão`, troque a linha que fala em "insights sem funcionalidade correspondente" por "Pedir mensagens/comentários sem funcionalidade correspondente (insights agora tem tela própria)".

- [ ] **Step 2: `docs/META_SETUP.md`**

Onde o documento diz para desmarcar "insights" (item 4 da lista de permissões, linha ~71), altere para manter `instagram_business_manage_insights` e desmarcar somente mensagens, comentários, Human Agent e ads. Onde lista o escopo da URL OAuth, atualize para os três escopos.

- [ ] **Step 3: `docs/META_API_REFERENCE.md`**

Na linha "Solicitar somente `instagram_business_basic` e `instagram_business_content_publish`" das decisões consolidadas, adicione `instagram_business_manage_insights`. Na tabela de decisões, adicione as linhas:

```markdown
| Insights de conta | [IG User Insights](https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights) | 11/09/2026 | `GET /{ig-user-id}/insights?metric=...&period=day&metric_type=total_value&since&until`; `follower_count` só com `time_series`, ≥ 100 seguidores e 30 dias de histórico; cálculo pode atrasar 48 h. | Worker reescreve os 3 últimos dias a cada sync; `follower_gains` fica `NULL` abaixo de 100 seguidores. Validar a lista `ACCOUNT_TOTAL_METRICS` no primeiro smoke test. |
| Insights de mídia | [IG Media Insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights) | 11/09/2026 | Métricas variam por `media_product_type`; `impressions` descontinuada para mídia após 02/07/2024; `navigation` de story exige `breakdown=story_navigation_action_type`. | Lista fixa por tipo em `MEDIA_METRICS`; erro `VALIDATION` devolve nulos sem interromper o sync. |
| Perfil e mídias | [`/me`](https://developers.facebook.com/docs/instagram-platform/reference/me), [`/{ig-user-id}/media`](https://developers.facebook.com/docs/instagram-platform/reference/instagram-user/media), [`/{ig-user-id}/stories`](https://developers.facebook.com/docs/instagram-platform/reference/instagram-user/stories) | 11/09/2026 | `/me` devolve `followers_count,follows_count,media_count,biography,website`; `/media` pagina por `paging.next`; `/stories` só devolve stories vivos. | Sync lê `/me` com todos os campos em uma chamada; pagina `/media` até `INSIGHTS_MEDIA_WINDOW_DAYS`. |
```

- [ ] **Step 4: `docs/DATABASE.md`**

Na tabela do modelo de dados, adicione:

```markdown
| `account_daily_metrics` | Snapshot diário de métricas por conta | PK `(instagram_account_id, day)`; dia é data UTC; 3 últimos dias reescritos pelo sync |
| `account_media` | Mídias recentes e seus insights | PK = IG media id; `product_type` restrito a FEED/REELS/STORY; `published_job_id` liga ao job que publicou |
```

Na linha de `instagram_accounts`, acrescente "escopos concedidos, bio/site, estado do sync de insights e banimento manual". Na seção de índices, adicione "métricas por `day`; mídias por `(instagram_account_id, posted_at)` e `posted_at`". Na seção de retenção, adicione "defina retenção para `account_media` fora da janela se o volume incomodar; `account_daily_metrics` é pequena (1 linha/conta/dia)".

- [ ] **Step 5: `docs/DEPLOYMENT.md`, `docs/ARCHITECTURE.md`, `README.md`**

- `DEPLOYMENT.md`: na tabela/lista de variáveis do worker, adicione `INSIGHTS_SYNC_INTERVAL_MS` (default 3600000) e `INSIGHTS_MEDIA_WINDOW_DAYS` (default 30) com uma frase: "o sync de insights roda no worker; sem worker o painel de análises fica parado".
- `ARCHITECTURE.md`: em "Worker", acrescente "sincroniza insights das contas a cada hora (claim em lote com `SKIP LOCKED`)". Em "Web", acrescente "expõe o painel de análises lendo somente do PostgreSQL". Em "Decisões de simplificação", adicione "Insights persistidos em snapshots diários; sem consulta ao vivo na renderização".
- `README.md`: na lista de funcionalidades, adicione "Análises agregadas e por conta (seguidores, alcance, views, interações, mídias) e histórico de contas banidas".

- [ ] **Step 6: Commit**

```bash
git add docs README.md
git commit -m "docs: insights permission, analytics tables and sync settings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Checklist de entrega

- [ ] `pnpm lint && pnpm typecheck && pnpm test` limpos
- [ ] `pnpm test:integration` e `pnpm test:e2e` limpos contra banco `_test`
- [ ] Migration `0010` aplicada em staging antes do deploy do worker novo
- [ ] Contas existentes reconectadas via OAuth (banner em `/analises` lista quais faltam)
- [ ] Submissão do App Review com `instagram_business_manage_insights` (roteiro na Task 12)
- [ ] Primeiro smoke test real: conferir no log do worker se `ACCOUNT_TOTAL_METRICS` e `MEDIA_METRICS` foram aceitos; ajustar listas se a Meta rejeitar alguma métrica
