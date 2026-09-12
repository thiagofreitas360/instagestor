# Banco de dados

## Visão geral

PostgreSQL é a única fonte de verdade do Instagestor. Ele mantém domínio, autenticação, auditoria, fila, leases e heartbeats. Drizzle descreve o schema em `src/db/schema.ts`; migrations SQL versionadas ficam em `db/migrations`.

Todos os horários persistidos usam `timestamp with time zone` e são tratados como instantes UTC. O timezone da campanha é armazenado separadamente para entrada e apresentação.

## Modelo de dados

| Tabela | Finalidade | Invariantes principais |
| --- | --- | --- |
| `users` | Administrador interno | e-mail único; role limitada a `ADMIN`; somente hash Argon2id |
| `instagram_accounts` | Perfil, estado, quota e token da conta | `instagram_user_id` e `app_scoped_user_id` únicos; token somente cifrado; escopos concedidos, bio/site, estado do sync de insights e banimento manual |
| `account_daily_metrics` | Snapshot diário de métricas por conta | PK `(instagram_account_id, day)`; dia é data UTC; 3 últimos dias reescritos pelo sync |
| `account_media` | Mídias recentes e seus insights | PK = IG media id; `product_type` restrito a FEED/REELS/STORY; `published_job_id` liga ao job que publicou |
| `account_groups` | Agrupamento reutilizável | nome único |
| `account_group_members` | Relação grupo–conta | PK composta impede membro duplicado |
| `media_assets` | Metadados dos objetos | `storage_key` aleatória e única; tamanho positivo; soft delete |
| `campaigns` | Definição e estado da campanha | delay fixo/aleatório validado por check; autor não pode ser apagado |
| `campaign_media` | Mídias ordenadas | posição única por campanha; uma mídia não se repete na campanha |
| `campaign_targets` | Snapshot ordenado dos destinos | conta e posição únicas por campanha; horário materializado |
| `publication_jobs` | Fila e resultado por conta | um job por campanha/conta; tentativas válidas; lease e fencing |
| `oauth_states` | Proteção CSRF do OAuth | nonce armazenado como hash único, com expiração e consumo único |
| `audit_logs` | Trilha de ações sensíveis | ator pode virar nulo; evento e metadata permanecem |
| `settings` | Defaults editáveis | singleton forçado por `id=true`; intervalo válido |
| `worker_heartbeats` | Presença e carga dos workers | uma linha por `worker_id` |
| `login_attempts` | Rate limit de login | chave HMAC/hash, janela e bloqueio persistentes |

## Relações e política de exclusão

```mermaid
erDiagram
    USERS ||--o{ CAMPAIGNS : creates
    USERS ||--o{ AUDIT_LOGS : acts
    INSTAGRAM_ACCOUNTS ||--o{ ACCOUNT_GROUP_MEMBERS : belongs
    ACCOUNT_GROUPS ||--o{ ACCOUNT_GROUP_MEMBERS : contains
    CAMPAIGNS ||--o{ CAMPAIGN_MEDIA : uses
    MEDIA_ASSETS ||--o{ CAMPAIGN_MEDIA : attached
    CAMPAIGNS ||--o{ CAMPAIGN_TARGETS : snapshots
    INSTAGRAM_ACCOUNTS ||--o{ CAMPAIGN_TARGETS : targets
    CAMPAIGNS ||--o{ PUBLICATION_JOBS : materializes
    INSTAGRAM_ACCOUNTS ||--o{ PUBLICATION_JOBS : publishes
```

Relações puramente associativas usam cascade quando o pai é removido. Histórico que não pode perder referência usa `RESTRICT`: usuário criador, mídia usada e conta presente em target/job. Em auditoria, excluir o usuário usa `SET NULL` para preservar o evento.

Contas e mídias possuem estados de desconexão/deleção; a operação normal não depende de apagar fisicamente histórico. Não faça cascade manual em produção.

## Invariantes críticas

### Snapshot e idempotência

O agendamento bloqueia a campanha, substitui `campaign_targets` e cria `publication_jobs` na mesma transação. Depois disso, editar um grupo não muda os destinos. A unique constraint `publication_jobs_campaign_account_unique` faz uma segunda materialização da mesma campanha/conta falhar no banco.

`max_attempts` é gravado no job a partir de `MAX_PUBLICATION_ATTEMPTS` (default 5), preservando a política usada quando ele foi criado.

### Ownership do job

`locked_by`, `lock_expires_at` e `fencing_token` formam o contrato do lease. Claims incrementam o fencing token e updates de processamento precisam conferir owner e token. Recuperar lock vencido também incrementa o token, invalidando qualquer worker antigo. `container_started_at` marca a primeira criação persistida do container e limita somente o tempo efetivo de processamento externo; espera por quota anterior não envelhece esse prazo.

O desenho completo está em [QUEUE.md](QUEUE.md).

### Segredos

`encrypted_access_token` guarda envelope AES-256-GCM (`versão.iv.tag.ciphertext`), nunca plaintext. `authorized_at` muda somente em conexão/reconexão OAuth e permite ignorar callback antigo sem confundi-lo com refresh automático do token. `oauth_states.nonce_hash` não guarda o state original. `login_attempts.key_hash` não guarda e-mail/IP legíveis. App Secret, senha admin, chaves e credenciais de infraestrutura nunca pertencem ao banco. Parâmetros `jsonb` são sempre pré-serializados com `JSON.stringify` e o cliente envia a string como está (`src/db/client.ts`); linhas de `audit_logs` gravadas antes dessa correção podem ter `metadata_json` como string escalar.

## Índices

Os índices correspondem aos caminhos usados pela aplicação:

- conta por `status`;
- campanha por `status`;
- mídia por `processing_status`;
- OAuth por `expires_at`;
- auditoria por `created_at` e índices parciais de expressão para confirmação de exclusão e idempotência de desautorização;
- fila por `(status, scheduled_at)` e `(status, next_attempt_at)`;
- jobs por conta e campanha;
- recovery por `lock_expires_at`;
- métricas por `day`; mídias por `(instagram_account_id, posted_at)` e `posted_at`.

Unique constraints também criam índices para identidades, posições e idempotência. Antes de adicionar outro índice, confirme o query real com `EXPLAIN (ANALYZE, BUFFERS)` em dados representativos; cada índice aumenta custo de escrita da fila.

## Migrations

Gerar migration depois de alterar o schema:

```bash
pnpm db:generate
```

Revise o SQL gerado, principalmente alterações de enum, defaults, `NOT NULL`, foreign keys e operações destrutivas. Aplicar migrations pendentes:

```bash
pnpm db:migrate
```

Regras operacionais:

1. nunca edite uma migration já aplicada em ambiente compartilhado;
2. crie uma nova migration corretiva;
3. faça backup antes de mudanças de produção;
4. execute migration uma vez como etapa de release;
5. mantenha compatibilidade com a versão anterior durante rollout;
6. não use `drizzle-kit push` em produção.

O histórico `db/migrations/meta` pertence ao Drizzle e deve ser versionado junto ao SQL.

## Conexões

`DATABASE_URL` é obrigatória. `DATABASE_POOL_SIZE` vale 10 por processo quando omitida e o boot exige pelo menos `WORKER_CONCURRENCY + 2`, pois cada job ativo mantém uma conexão reservada para advisory locks e ainda precisa de margem para heartbeat, lease e updates. Ao escalar, estime:

```text
conexões máximas aproximadas = (réplicas web + réplicas worker) × DATABASE_POOL_SIZE + jobs administrativos
```

Isso é teto, não reserva fixa. Ainda assim, mantenha margem para migrations, backup e console. `WORKER_CONCURRENCY=3` é o default; aumentar runners sem dimensionar banco e limites Meta tende a piorar a fila.

Use TLS em produção e um usuário próprio da aplicação. Ele precisa operar o schema da aplicação e migrations conforme a estratégia escolhida, mas não precisa ser superuser nem ter acesso a outros bancos.

## Seed

`pnpm db:seed` faz upsert do admin a partir de `ADMIN_EMAIL` e `ADMIN_PASSWORD` (mínimo 12 caracteres), cria settings e, somente com provider fake fora de produção, dez contas e dois grupos de demonstração.

No Compose local, a imagem web executa com `NODE_ENV=production`; para incluir fixtures fake use deliberadamente:

```bash
docker compose exec -e NODE_ENV=development web pnpm db:seed
```

Nunca execute fixtures fake no banco de produção.

## Backup, restore e retenção

- mantenha backup automático cifrado e teste restore regularmente;
- guarde a `TOKEN_ENCRYPTION_KEY` separadamente, mas vinculada ao mesmo ambiente/ponto de recuperação;
- preserve `audit_logs` de acordo com a política interna/legal;
- defina retenção para OAuth states expirados, tentativas antigas, heartbeats órfãos e mídia soft-deleted;
- automatize limpeza somente após medir e testar lotes pequenos;
- coordene restore do banco com a existência dos objetos no bucket;
- defina retenção para `account_media` fora da janela se o volume incomodar; `account_daily_metrics` é pequena (1 linha/conta/dia).

Antes de liberar workers após restore, aplique migrations, valide a chave de tokens, confira storage e confirme que não há jobs `PUBLISHING` cujo resultado externo seja desconhecido. Esses jobs devem ir para reconciliação, não para retry cego.

## Testes de integração

Os testes de banco exigem uma URL cujo nome termine exatamente em `_test`. Eles limpam dados e nunca devem apontar para desenvolvimento compartilhado ou produção.

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/instagestor_test pnpm test:integration
```

A barreira por nome não substitui credenciais e instâncias isoladas no CI.
