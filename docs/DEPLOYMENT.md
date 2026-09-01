# Deploy

Este guia prepara um deploy provider-neutral. Nenhum deploy real é executado pelo projeto e não há dependência obrigatória de Vercel, AWS ou Cloudflare.

## Topologia mínima

- um endpoint HTTPS para a imagem `Dockerfile` (web);
- um processo privado com a imagem `Dockerfile.worker` (worker);
- PostgreSQL 15 ou mais recente com backup;
- bucket S3 compatível privado, acessível pela aplicação;
- URLs de mídia assinadas acessíveis pela Meta pela internet.

Para a escala inicial, uma réplica web e uma worker são suficientes. O banco e o bucket devem usar volumes ou serviços gerenciados persistentes. MinIO e as senhas padrão do `docker-compose.yml` são apenas para desenvolvimento local.

Quando o storage possui endereços interno e externo diferentes, configure `S3_ENDPOINT` com a origem alcançável pelos containers e `S3_PUBLIC_ENDPOINT` com a origem HTTPS alcançável pela Meta. A segunda é usada somente para assinar URLs; nunca use hostname interno nela em produção.

## Build das imagens

Na raiz do repositório:

```bash
docker build --tag instagestor-web:VERSION --file Dockerfile .
docker build --tag instagestor-worker:VERSION --file Dockerfile.worker .
```

Use uma tag imutável (commit SHA ou versão), envie as duas imagens ao registry escolhido e mantenha web e worker na mesma revisão. Somente a imagem web inclui FFmpeg/ffprobe, pois a validação acontece no upload; o worker consome apenas mídias já validadas.

## Segredos e configuração

Gere segredos fora do repositório:

```bash
pnpm secret:session
pnpm secret:encryption
```

Injete-os pelo secret manager da plataforma. Nunca grave `.env` na imagem. Consulte todas as variáveis em `.env.example`; em produção, observe especialmente:

- `NODE_ENV=production`;
- `APP_URL=https://painel.seudominio.example`, sem barra final e igual ao origin público;
- `DATABASE_URL` com TLS quando oferecido pelo provedor;
- `SESSION_SECRET` aleatório com ao menos 32 caracteres;
- `TOKEN_ENCRYPTION_KEY` aleatória, representando exatamente 32 bytes em base64;
- `INSTAGRAM_PROVIDER=meta`;
- `ALLOW_FAKE_PROVIDER_IN_PRODUCTION=false`;
- `INSTAGRAM_REDIRECT_URI=https://painel.seudominio.example/api/instagram/oauth/callback`;
- credenciais Meta e S3 vindas do secret manager;
- `S3_FORCE_PATH_STYLE=false` para AWS/R2, salvo exigência do endpoint.

Não troque `TOKEN_ENCRYPTION_KEY` sem um procedimento de recriptografia. Preserve uma cópia segura da chave junto aos backups; sem ela, tokens restaurados não podem ser usados.

## Banco e rollout

Faça backup antes de aplicar uma nova versão. Execute migrations exatamente uma vez como job de release:

```bash
pnpm db:migrate
```

O comando padrão da imagem web também aplica migrations antes de iniciar, o que é conveniente para uma única réplica. Com múltiplas réplicas, sobrescreva o comando para `pnpm start` e mantenha a migration como job separado para evitar concorrência de rollout.

Sequência recomendada:

1. backup do PostgreSQL e verificação do bucket;
2. migration com a nova imagem web;
3. subida de uma réplica web e confirmação de `/api/health`;
4. substituição do worker, aguardando o shutdown gracioso do anterior;
5. smoke test com o provider fake em staging, nunca na produção real;
6. observação de logs, heartbeats e fila.

Migrations devem ser compatíveis com a versão anterior durante o rollout. Para rollback, volte as imagens; não reverta schema destrutivamente sem migration revisada e backup testado.

## Rede, TLS e proxy

Exponha somente o web. PostgreSQL, worker e endpoint administrativo do storage ficam em rede privada. Termine TLS em um reverse proxy ou load balancer e encaminhe `Host`, `X-Forwarded-Proto` e IP do cliente de forma confiável. O origin observado deve coincidir com `APP_URL`, pois mutações e OAuth dependem dessa origem.

Configure limites de request no proxy acima de `UPLOAD_MAX_BYTES`, mas não ilimitados. Preserve timeouts suficientes para upload; o trabalho de publicação continua no worker.

O bucket deve permanecer privado. Libere somente URLs assinadas de curta duração. A Meta precisa alcançar essas URLs por HTTPS sem VPN, cookie ou allowlist de IP instável.

## Healthchecks e shutdown

- web: `GET /api/health`, HTTP 200 quando aplicação e banco estão prontos;
- worker: heartbeat do hostname com menos de 30 segundos;
- PostgreSQL e storage: probes nativos do provedor.

O orquestrador deve enviar `SIGTERM` e conceder pelo menos `JOB_LOCK_SECONDS` mais uma margem antes de matar o worker. Durante shutdown ele para novos claims e termina jobs ativos.

## Persistência e recuperação

- Faça backup automático e cifrado do PostgreSQL, com retenção definida.
- Habilite versionamento ou política de recuperação no bucket quando disponível.
- Teste periodicamente restore do banco junto com a mesma `TOKEN_ENCRYPTION_KEY`.
- Objetos e registros precisam pertencer ao mesmo ponto lógico de restauração; registre e trate objetos órfãos sem apagar em massa.

Um restore não deve iniciar workers até que migrations, segredos e conectividade com storage tenham sido verificados.

## Escala

Para aumentar vazão, eleve primeiro `WORKER_CONCURRENCY` com cautela. Depois adicione réplicas worker; `SKIP LOCKED`, fencing e advisory locks coordenam as instâncias. Mantenha `META_ACCOUNT_CONCURRENCY=1` salvo evidência e teste que justifiquem mudar.

O default é `WORKER_CONCURRENCY=3` por processo e `MAX_PUBLICATION_ATTEMPTS=5` por novo job. Multiplique a concorrência pelo número de réplicas ao dimensionar o pool do PostgreSQL e preserve os limites globais/por conta.

Não adicione Redis ou broker só para escalar o primeiro ambiente. Meça jobs vencidos, duração de publish, conexões do banco e rate limits antes de mudar a arquitetura.

## Checklist de produção

As ações que exigem acesso humano a domínio, infraestrutura e Meta estão em [USER_ACTION_REQUIRED.md](USER_ACTION_REQUIRED.md). A configuração detalhada da Meta está em [META_SETUP.md](META_SETUP.md).
