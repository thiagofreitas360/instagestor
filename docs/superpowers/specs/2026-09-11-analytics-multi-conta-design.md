# Analytics multi-conta e histórico de banidas — design

**Data:** 2026-09-11
**Status:** aprovado em conversa; plano de implementação em `docs/superpowers/plans/`
**Sub-projeto:** 1 de 2 (o 2 — gestão de comentários — não está planejado)

## 1. Objetivo

Dar ao administrador um raio-x das contas Instagram conectadas, somando todas e olhando uma por uma: seguidores (total, ganhos, perdidos), alcance, visualizações, visitas ao perfil, interações (curtidas, comentários, compartilhamentos, salvamentos, respostas), cliques no link, e o desempenho por mídia (posts, reels, stories). Registrar manualmente contas banidas e manter um histórico com o contexto de cada banimento.

## 2. Fora de escopo (decidido)

| Item | Motivo |
| --- | --- |
| Alterar foto, bio, nome, site | A Instagram API não tem endpoint de escrita de perfil. Impossível. |
| DMs / Messaging API | Decisão do produto: fora por enquanto. Escopo `instagram_business_manage_messages`, webhook e App Review próprios. |
| Comentários (ler/responder/ocultar) | Escopo `instagram_business_manage_comments` + App Review. Sub-projeto futuro. |
| Demografia de seguidores, horários online | Follow-up barato (1 chamada), fica para depois da primeira entrega. |
| Detecção automática de banimento | A Meta não sinaliza "banida"; marcação é manual por decisão do produto. Erros `AUTH` continuam levando a `REAUTH_REQUIRED` como hoje. |
| Tempo real / WebSocket | Sync horário + botão "Atualizar agora" atende. Mantém polling, sem Redis. |

## 3. Decisões consolidadas

- **Banida = marcação manual** pelo administrador, com motivo e data.
- **Cadência:** sync a cada ~1 h por conta, mais "Atualizar agora".
- **Persistência própria em PostgreSQL** (snapshot diário por conta + linha por mídia). Sem consulta ao vivo na renderização. Painel lê só SQL.
- **Agregado e individual são a mesma tela** com filtro (`conta`, `grupo`); sem filtro = todas.
- **Gráficos em SVG inline**, sem biblioteca.
- **Dia = data UTC.** A Meta agrega por dia no fuso dela; aceitamos a diferença de horas nas bordas. (`ponytail:` marcar no código; trocar para fuso de `settings.default_timezone` se a discrepância incomodar.)

## 4. Permissões e migração das contas existentes

- OAuth passa a pedir `instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights`.
- `exchangeAuthorizationCode` continua exigindo apenas `basic` + `content_publish`; `manage_insights` é opcional (a conta publica mesmo sem ele). As permissões concedidas são persistidas em `instagram_accounts.granted_scopes`.
- Contas conectadas antes desta versão têm `granted_scopes = NULL` e são tratadas como **sem insights**. O painel lista essas contas com aviso "Reconecte para habilitar análises" e link para `/api/instagram/oauth/start`.
- Contas fake (`createFakeAccounts` e seed) recebem os três escopos para o painel funcionar em desenvolvimento.
- App Review: `docs/META_APP_REVIEW.md` ganha seção para `instagram_business_manage_insights` (justificativa em inglês + roteiro de screencast mostrando a tela `/analises`). `docs/META_SETUP.md` e `docs/META_API_REFERENCE.md` são atualizados com o escopo e os endpoints de insights.

## 5. Modelo de dados

Uma migration Drizzle (`pnpm db:generate`), revisada à mão.

### 5.1 `instagram_accounts` (colunas novas)

| Coluna | Tipo | Uso |
| --- | --- | --- |
| `granted_scopes` | `text[]` | permissões devolvidas no OAuth; `NULL` = conectada antes do recurso |
| `biography` | `text` | leitura do perfil |
| `website` | `text` | leitura do perfil |
| `insights_synced_at` | `timestamptz` | último sync concluído (sucesso ou erro registrado); `NULL` = pendente |
| `insights_error_code` | `text` | último erro não-AUTH do sync; `NULL` após sucesso |
| `banned_at` | `timestamptz` | banimento vigente |
| `ban_reason` | `text` | motivo informado pelo administrador |

Enum `instagram_account_status` ganha `BANNED`. `DISABLED` permanece (nada o escreve; não é removido nesta entrega).

### 5.2 `account_daily_metrics`

Uma linha por conta por dia UTC. Dia corrente e os dois anteriores são reescritos a cada sync (a Meta atrasa até 48 h). Linhas mais antigas são finais.

| Coluna | Tipo | Origem Meta |
| --- | --- | --- |
| `instagram_account_id` | `uuid` FK `RESTRICT` | — |
| `day` | `date` | — |
| `followers_count` | `int` nullable | `/me?fields=followers_count` (snapshot no momento do sync; só preenchido na linha do dia corrente — dias passados inseridos retroativamente ficam `NULL`) |
| `follows_count` | `int` nullable | `/me?fields=follows_count` (idem) |
| `media_count` | `int` nullable | `/me?fields=media_count` (idem) |
| `follower_gains` | `int` nullable | `follower_count`, `period=day`, `metric_type=time_series` (indisponível abaixo de 100 seguidores → `NULL`) |
| `reach` | `int` nullable | `reach` `total_value` |
| `views` | `int` nullable | `views` `total_value` |
| `profile_views` | `int` nullable | `profile_views` `total_value` |
| `accounts_engaged` | `int` nullable | `accounts_engaged` `total_value` |
| `total_interactions` | `int` nullable | `total_interactions` `total_value` |
| `likes` | `int` nullable | `likes` |
| `comments` | `int` nullable | `comments` |
| `shares` | `int` nullable | `shares` |
| `saves` | `int` nullable | `saves` |
| `replies` | `int` nullable | `replies` |
| `website_clicks` | `int` nullable | `website_clicks` |
| `profile_links_taps` | `int` nullable | `profile_links_taps` |
| `synced_at` | `timestamptz` | — |

PK `(instagram_account_id, day)`. Índice em `day` para agregação por período.

### 5.3 `account_media`

Uma linha por mídia do Instagram (post, reel ou story) das contas conectadas, limitada à janela de sync.

| Coluna | Tipo | Origem |
| --- | --- | --- |
| `id` | `text` PK | IG media id |
| `instagram_account_id` | `uuid` FK `RESTRICT` | — |
| `media_type` | `text` | `IMAGE`, `VIDEO`, `CAROUSEL_ALBUM` |
| `product_type` | `text` | `FEED`, `REELS`, `STORY` (de `media_product_type`; stories vêm de `/me/stories`) |
| `permalink` | `text` nullable | — |
| `thumbnail_url` | `text` nullable | `thumbnail_url` ou `media_url` de imagem |
| `caption` | `text` nullable | truncado a 300 caracteres |
| `posted_at` | `timestamptz` | `timestamp` |
| `expires_at` | `timestamptz` nullable | stories: `posted_at + 24 h` |
| `like_count` | `int` nullable | `/me/media` |
| `comments_count` | `int` nullable | `/me/media` |
| `views` | `int` nullable | insights |
| `reach` | `int` nullable | insights |
| `shares` | `int` nullable | insights |
| `saved` | `int` nullable | insights (`saved` em mídia, `saves` em conta) |
| `total_interactions` | `int` nullable | insights |
| `replies` | `int` nullable | insights (story) |
| `follows` | `int` nullable | insights (feed, story) |
| `profile_visits` | `int` nullable | insights (feed, story) |
| `reels_avg_watch_time_ms` | `int` nullable | `ig_reels_avg_watch_time` |
| `reels_total_watch_time_ms` | `bigint` nullable | `ig_reels_video_view_total_time` |
| `story_taps_forward` | `int` nullable | `navigation` breakdown `tap_forward` |
| `story_taps_back` | `int` nullable | `navigation` breakdown `tap_back` |
| `story_exits` | `int` nullable | `navigation` breakdown `swipe_forward` + `exit` |
| `insights_synced_at` | `timestamptz` nullable | — |
| `published_job_id` | `uuid` FK `SET NULL` nullable | `publication_jobs.id` quando `meta_media_id = account_media.id` (preenchido no sync) |

Índices: `(instagram_account_id, posted_at DESC)`, `(posted_at)`.

Métricas por tipo de mídia (lista a validar no primeiro smoke test real, como a referência Meta já exige):

- `FEED`: `views,reach,likes,comments,shares,saved,total_interactions,follows,profile_visits`
- `REELS`: `views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time`
- `STORY`: `views,reach,replies,shares,follows,profile_visits,total_interactions,navigation` (com `breakdown=story_navigation_action_type`)

Métrica rejeitada pela Meta para um tipo → coluna fica `NULL`, sync da mídia é considerado concluído.

### 5.4 Histórico de banimentos

Sem tabela nova. Cada marcação grava `audit_logs` com `event_type = 'ACCOUNT_BANNED'` e `metadata_json = { reason, followersCount, mediaCount, lastErrorCode, lastErrorAt, publishedByTool }`. Desmarcar grava `ACCOUNT_UNBANNED`. A página de histórico lê `audit_logs` (permite mais de um banimento por conta ao longo do tempo) e junta com `instagram_accounts` para username e `created_at`.

## 6. Provider

`InstagramProvider` ganha:

```ts
getAccountSnapshot(accessToken): Promise<{ username; displayName?; profilePictureUrl?; followersCount; followsCount; mediaCount; biography?; website? }>;
getAccountInsights(accountId, accessToken, days: string[]): Promise<AccountDayInsights[]>; // dias 'YYYY-MM-DD' UTC; total_value por dia + follower_gains
listRecentMedia(accountId, accessToken, since: Date): Promise<MediaSummary[]>;          // /{id}/media paginado até `since`
listLiveStories(accountId, accessToken): Promise<MediaSummary[]>;                      // /{id}/stories
getMediaInsights(mediaId, accessToken, productType): Promise<MediaInsights>;          // por tipo, tolerante a métrica rejeitada
```

- Meta: `getAccountInsights` faz 1 chamada `total_value` por dia pedido (todas as métricas juntas) + 1 chamada `time_series` de `reach,follower_count` cobrindo o intervalo inteiro. Erro específico de "menos de 100 seguidores" → `follower_gains = null`, sem falhar.
- Fake: valores determinísticos (`sha256(accountId + day)` → inteiros em faixas plausíveis, seguidores crescendo ~1 %/dia); gera 3–6 mídias por conta nos últimos 30 dias e 1 story vivo; obedece `FAKE_PROVIDER_SCENARIO` como as demais operações.

## 7. Sync no worker

Arquivo `src/jobs/insights-sync.ts`, registrado em `worker/index.ts` como maintenance task com timer de 60 s (mesmo `createMaintenanceTask`).

Cada execução:

1. Claim de até 10 contas em uma transação:
   `status IN ('CONNECTED','TOKEN_EXPIRING') AND encrypted_access_token IS NOT NULL AND 'instagram_business_manage_insights' = ANY(granted_scopes) AND (insights_synced_at IS NULL OR insights_synced_at < now() - INSIGHTS_SYNC_INTERVAL) ORDER BY insights_synced_at NULLS FIRST FOR UPDATE SKIP LOCKED`, marcando `insights_synced_at = now()` no claim (evita claim duplo entre workers; uma falha total reprocessa só na próxima janela).
2. Para cada conta, sequencialmente:
   - `getAccountSnapshot` → atualiza `followers_count/follows_count/media_count/biography/website/username/display_name/profile_picture_url` na conta e no snapshot do dia.
   - `getAccountInsights` para hoje, ontem e anteontem → upsert em `account_daily_metrics`.
   - `listRecentMedia(since = now − INSIGHTS_MEDIA_WINDOW_DAYS)` + `listLiveStories` → upsert em `account_media` (contadores de like/comments, thumbnail, caption).
   - `getMediaInsights` apenas para mídias que precisam: stories com `expires_at > now()`; feed/reels com `posted_at > now − 3 dias` (a cada sync); feed/reels entre 3 e `INSIGHTS_MEDIA_WINDOW_DAYS` dias com `insights_synced_at < now − 24 h` (uma vez por dia). Stories expirados nunca mais são consultados.
   - Vincula `published_job_id` via `UPDATE account_media SET published_job_id = job.id FROM publication_jobs job WHERE job.meta_media_id = account_media.id AND account_media.published_job_id IS NULL`.
   - Sucesso → `insights_error_code = NULL`, `last_successful_api_call_at = now()`.
3. Erros:
   - `AUTH` → `markAccountUnavailableIfCurrent(... nextStatus: 'REAUTH_REQUIRED')` (reuso; fecha jobs pendentes como hoje).
   - `RATE_LIMIT` → grava `insights_error_code`, `insights_synced_at = now() + GREATEST(retryAfter, 15 min)` (a conta volta a ser elegível após `INSIGHTS_SYNC_INTERVAL_MS` contado desse instante) e passa para a próxima conta.
   - `TRANSIENT`/`PERMANENT`/`VALIDATION` na conta → grava `insights_error_code` e segue; a conta volta na próxima janela.
   - Erro em uma mídia isolada → loga e continua com as demais.
4. Log JSON por conta: `insights_synced` com `account_id`, `media_synced`, `calls`, `duration_ms`.

Orçamento: 1 (`/me`) + 3 (`total_value` × dia) + 1 (`time_series`) + 1–2 (`/media` paginado) + 1 (`/stories`) + N mídias (≈ posts dos últimos 3 dias + stories vivos + 1/dia para o resto). Tipicamente 8–20 chamadas/conta/hora.

"Atualizar agora": server action `refreshInsightsAction(accountId?)` faz `UPDATE instagram_accounts SET insights_synced_at = NULL WHERE id = $1` (ou todas as elegíveis quando sem id) e redireciona com `?ok=`. O web nunca chama a Meta para insights.

## 8. Cálculos

Para o período `[início, fim]` (fim = hoje UTC) e o período anterior de mesmo tamanho:

- **Seguidores (total):** soma, por conta, do `followers_count` não nulo da última linha dentro do período.
- **Variação líquida:** soma, por conta, de (`followers_count` da última linha ≤ `fim`) − (`followers_count` da última linha < `início`; se não existir, a primeira do período).
- **Ganhos:** `SUM(follower_gains)` no período (`NULL` conta como 0).
- **Perdidos:** `GREATEST(ganhos − variação líquida, 0)`. Derivado; subestima em contas sem `follower_gains` (< 100 seguidores). (`ponytail:` marcar; trocar por `follows_and_unfollows` com breakdown se o smoke test confirmar que devolve unfollows separado.)
- **Alcance, views, visitas ao perfil, contas engajadas, interações, curtidas, comentários, compartilhamentos, salvamentos, respostas, cliques no link, toques em links:** `SUM` no período.
- **Delta %** de cada card = (atual − anterior) / anterior; anterior = 0 → mostra "novo".
- **Série diária** para gráficos: `GROUP BY day` das mesmas somas.
- **Mídias no período:** `account_media` com `posted_at` dentro do período; ordenação padrão por `views DESC NULLS LAST`.
- **Publicações pela ferramenta:** `count(published_job_id)` entre as mídias do período.

Uma função `loadAnalytics({ accountIds, from, to })` em `src/server/analytics.ts` roda essas queries (cards, série, ranking, mídias) e é usada pela página com o filtro resolvido (todas / uma conta / contas de um grupo).

## 9. Interface

Navegação: item **Análises** (`/analises`, marca "A") entre Contas e Grupos. Item **Banidas** não entra na sidebar; é acessado por `/analises` e por `/contas` (filtro).

### 9.1 `/analises`

Query params: `periodo=7|30|90` (default 30), `conta=<uuid>`, `grupo=<uuid>`, `tipo=REELS|FEED|STORY` (filtro da tabela de mídias), `ordem=<coluna>` (ranking). Tudo server-rendered com `<form method="get">` — sem JavaScript de cliente além do `AutoRefresh` já existente.

Blocos, de cima para baixo:

1. **Cabeçalho**: título ("Todas as contas" / `@usuario` / nome do grupo), seletor de período, seletor de conta/grupo, botão "Atualizar agora", link "Histórico de banidas". Subtítulo com "Dados atualizados há X min" (mínimo `insights_synced_at` do conjunto).
2. **Aviso** (quando houver): "N contas precisam reconectar para habilitar análises" com lista e link OAuth. "N contas com erro no sync" com código.
3. **Cards KPI** (`MetricCard` existente + delta): Seguidores, Ganhos, Perdidos, Variação líquida, Alcance, Visualizações, Visitas ao perfil, Interações, Curtidas, Comentários, Compartilhamentos, Salvamentos. Cliques no link e Respostas de story em segunda linha compacta.
4. **Gráficos**: linha "Seguidores por dia" (agregado = soma) e barras "Alcance e visualizações por dia". Componentes `LineChart` e `BarChart` em `src/components/charts.tsx`, SVG puro, `<title>` por ponto para acessibilidade, largura 100 % via `viewBox`.
5. **Ranking de contas** (só sem filtro de conta): tabela com Conta, Status, Seguidores, Δ seguidores, Alcance, Views, Interações, Mídias no período, Última sync. Ordenável por `?ordem=`. Linha clica para `/analises?conta=<id>`. O ranking lista contas conectadas agora ou com métricas no período; contas banidas/desconectadas saem quando seu histórico deixa a janela.
6. **Mídias no período**: tabs `Todas | Reels | Posts | Stories` (links), tabela com miniatura, conta, tipo, data, Views, Alcance, Curtidas, Comentários, Compart., Salv., coluna extra por tipo (Reels: tempo médio assistido; Stories: saídas/avanços/voltas; Feed: seguidores ganhos), badge "via InstaGestor" quando `published_job_id` não é nulo, link para o permalink. Limite 20, ordenação `?ordem=`.
7. **Individual** (com `conta`): acima do bloco 3, um `account-hero` compacto com foto, `@usuario`, bio, site, `followers/follows/media_count` atuais e link para `/contas/[id]`.

Estado vazio: sem nenhuma conta com insights → `EmptyState` explicando a reconexão.

### 9.2 `/analises/banidas`

Tabela ordenada por data desc: Conta, Data, Motivo, Seguidores no ban, Dias de vida (`banned_at − created_at`), Publicações pela ferramenta, Último erro Meta (código + data), Situação atual (BANNED / reconectada). Cards no topo: total de banidas, banidas nos últimos 30 dias, média de dias de vida, média de seguidores no ban. Fonte: `audit_logs` + `instagram_accounts`.

### 9.3 `/contas/[id]`

- Painel "Análises" com 4 números (seguidores, alcance 30 d, views 30 d, interações 30 d) e link "Ver análises completas".
- Ação **Marcar como banida**: `<details>` com `textarea name="reason"` (obrigatório, 3–500 caracteres) e botão de confirmação; server action `banAccountAction`. Visível para qualquer status exceto `BANNED`.
- Em `BANNED`: banner com data/motivo, botão **Desmarcar banimento** (`unbanAccountAction`) → status `DISCONNECTED`, e botão "Reconectar via Meta".

### 9.4 `/contas`

Filtro `banidas`; `StatusBadge` ganha rótulo `BANNED: "Banida"` (tom danger). Contas `BANNED` não entram em `connected` nem `needsAttention`.

## 10. Banimento

`banAccount(accountId, reason, actorUserId)` em `src/server/accounts.ts`:

1. Mesmo lock por conta e mesma sequência de `disconnectAccount` (falha jobs pendentes, `RECONCILIATION_REQUIRED` para `PUBLISHING`, fecha campanhas). Para não duplicar, `disconnectAccount` é refatorado para uma função interna `closeAccount(sql, accountId, { status, bannedAt, banReason })` chamada pelos dois fluxos.
2. `UPDATE instagram_accounts SET status = 'BANNED', encrypted_access_token = NULL, banned_at = now(), ban_reason = $2, disconnected_at = now()`.
3. `audit_logs` `ACCOUNT_BANNED` com metadata descrita em 5.4 (`followersCount`/`mediaCount` da última linha de `account_daily_metrics`, `publishedByTool` = `count(publication_jobs PUBLISHED)`).

`unbanAccount(accountId, actorUserId)`: `status = 'DISCONNECTED'`, `banned_at = NULL`, `ban_reason = NULL`, audit `ACCOUNT_UNBANNED`. Métricas históricas permanecem.

Campanhas: `scheduleCampaign` já rejeita contas não conectadas; `BANNED` cai nessa regra sem mudança. `deauthorizeBySignedRequest` e `deleteDataBySignedRequest` continuam funcionando em conta `BANNED` (só mudam status/token; `banned_at` fica).

## 11. Configuração

| Variável | Default | Uso |
| --- | --- | --- |
| `INSIGHTS_SYNC_INTERVAL_MS` | `3600000` | idade mínima de `insights_synced_at` para nova sync |
| `INSIGHTS_MEDIA_WINDOW_DAYS` | `30` | janela de mídias buscadas e reatualizadas |

Ambas em `src/lib/env.ts` com validação zod; documentadas em `.env.example` e `docs/DEPLOYMENT.md`.

## 12. Erros e limites

- Conta sem `manage_insights`: nunca entra no claim; aparece no aviso da UI.
- Rate limit da Meta: `RATE_LIMIT` adia a conta pelo `retry-after` (mínimo 15 min). Não há retry no mesmo ciclo.
- Meta atrasa métricas em até 48 h: os três últimos dias são sempre reescritos; o painel indica "dados dos últimos 2 dias ainda podem mudar".
- Mídia apagada no Instagram: some de `/me/media`; a linha em `account_media` permanece (histórico), sem novas consultas depois da janela.
- Conta reconectada com outro `instagram_user_id` (troca de conta no OAuth) cria outra linha em `instagram_accounts`, como hoje; histórico fica com a conta antiga.
- Worker parado: painel mostra "Dados atualizados há X h" em tom de alerta acima de 3 h.
- Token expirado durante o sync: `AUTH` → `REAUTH_REQUIRED` pelo caminho já existente.

## 13. Testes

- **Unit (vitest):** parser das respostas da Meta (`total_value`, `time_series`, `navigation` breakdown, métrica rejeitada); dias UTC do sync; período e delta; escala do gráfico. A seleção de mídias que precisam de insights (3 dias / 24 h / stories vivos) é SQL e fica coberta pela integração.
- **Integração (Postgres `_test`, fake provider):** sync grava snapshot e mídias; segunda passada reescreve só os 3 últimos dias; conta sem escopo não é claimada; conta com `RATE_LIMIT` é adiada; `loadAnalytics` agregado = soma dos individuais; `banAccount` fecha jobs pendentes e grava audit com metadata; `unbanAccount` volta a `DISCONNECTED`.
- **E2E (Playwright, fake):** `/analises` renderiza cards e ranking; filtro por conta; marcar/desmarcar banida em `/contas/[id]`; `/analises/banidas` lista o evento.

## 14. Follow-ups registrados

- Demografia (`follower_demographics`, `engaged_audience_demographics`) na visão individual.
- `online_followers` (melhor horário para postar).
- `follows_and_unfollows` com breakdown para "perdidos" exato.
- Fuso de agregação diária configurável.
- Sub-projeto 2: gestão de comentários.

## 15. Referências

- Instagram Platform — Insights (Instagram Login): `graph.instagram.com`, escopos `instagram_business_basic` + `instagram_business_manage_insights`.
- `GET /{ig-user-id}/insights` — `metric`, `period=day`, `metric_type=total_value|time_series`, `since`/`until`, `breakdown`. `follower_count` exige ≥ 100 seguidores e limita a 30 dias. Cálculo pode atrasar até 48 h.
- `GET /{ig-media-id}/insights` — métricas por tipo; `impressions` descontinuada para mídia após 02/07/2024; `navigation` com `breakdown=story_navigation_action_type`.
- `GET /me?fields=followers_count,follows_count,media_count,biography,website`.
- `GET /{ig-user-id}/media`, `GET /{ig-user-id}/stories`.
- `docs/META_API_REFERENCE.md` (padrão de validação por smoke test).
