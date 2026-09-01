# Solução de problemas

Comece por estes comandos, que não exibem os valores das variáveis:

```bash
docker compose ps
docker compose logs --tail=200 web worker postgres minio minio-init
curl -i http://localhost:3000/api/health
```

Não cole `.env`, URLs de banco, tokens ou logs não revisados em tickets.

## O Compose não valida

Execute:

```bash
docker compose config --quiet
```

Se a versão não reconhecer `condition: service_completed_successfully`, atualize para Docker Compose v2. Verifique também portas 3000, 5432, 9000 e 9001 ocupadas. Elas podem ser alteradas por `WEB_PORT`, `POSTGRES_PORT`, `MINIO_API_PORT` e `MINIO_CONSOLE_PORT`.

## Web reinicia ou reclama de variável inválida

Compare `.env` com `.env.example`. Causas frequentes:

- `SESSION_SECRET` com menos de 32 caracteres;
- `TOKEN_ENCRYPTION_KEY` que não representa 32 bytes em base64;
- URL sem `http://` ou `https://`;
- `INSTAGRAM_PROVIDER=meta` sem App ID, App Secret ou redirect URI;
- `STORAGE_PROVIDER=s3` sem bucket ou credenciais;
- fake em `NODE_ENV=production` sem o opt-in local explícito.

Valide sem imprimir secrets:

```bash
docker compose exec web node -e "console.log({nodeEnv:process.env.NODE_ENV,provider:process.env.INSTAGRAM_PROVIDER,storage:process.env.STORAGE_PROVIDER,hasDatabase:Boolean(process.env.DATABASE_URL)})"
```

## PostgreSQL não fica saudável

Veja `docker compose logs postgres`. Se a senha foi alterada depois que o volume nasceu, o PostgreSQL mantém a credencial original. Ajuste o `.env` para a senha original ou, somente em ambiente descartável, remova os volumes com `docker compose down -v` e recrie.

Confirme migrations:

```bash
docker compose exec web pnpm db:migrate
```

Não rode comandos de correção manual em tabelas de jobs durante publicação.

## Login não funciona

Crie ou atualize o admin pelo seed e confirme as variáveis locais:

```bash
docker compose exec -e NODE_ENV=development web pnpm db:seed
```

Após cinco tentativas na janela de quinze minutos, o par e-mail/IP é temporariamente bloqueado; um IP também possui teto de trinta admissões para limitar custo Argon2 entre e-mails distintos. Aguarde a janela antes de testar novamente. O proxy confiável deve remover headers fornecidos pelo cliente e definir `CF-Connecting-IP`, `X-Real-IP` ou `X-Forwarded-For`; sem isso todas as requisições usam o bucket `unknown`. Confirme também que `APP_URL` corresponde exatamente ao origin usado no browser.

## MinIO sobe, mas upload falha

Verifique o initializer:

```bash
docker compose logs minio-init
docker compose run --rm minio-init
```

O `S3_BUCKET` e as credenciais precisam coincidir entre MinIO, web e worker. Fora de containers, use `S3_ENDPOINT=http://localhost:9000`. Dentro do Compose, o endpoint de operações é `http://minio:9000`, mas `S3_PUBLIC_ENDPOINT` continua sendo a origem acessível pelo consumidor da URL assinada (localmente, `http://localhost:9000`; em produção, HTTPS público).

Em produção, confirme políticas do bucket e acesso privado. CORS não substitui a necessidade de a Meta alcançar diretamente a URL assinada HTTPS.

## Vídeo é rejeitado ou ffprobe não existe

O upload e a validação acontecem no processo web, cuja imagem inclui FFmpeg/ffprobe. O worker não precisa desses binários. Em desenvolvimento nativo, instale FFmpeg e confirme:

```bash
ffprobe -version
```

O upload aceita MP4/MOV dentro dos limites configurados, com vídeo H.264/HEVC e áudio AAC quando presente. MIME, conteúdo e extensão precisam coincidir. O log mostra a categoria do erro, não o arquivo em si.

## Worker está unhealthy ou offline

```bash
docker compose logs --tail=200 worker
docker compose exec worker node scripts/worker-healthcheck.mjs
```

O probe procura um heartbeat do próprio hostname nos últimos trinta segundos. Confirme banco, migrations e relógio do host. Ao reiniciar, o worker recupera locks expirados; aguarde pelo menos `JOB_LOCK_SECONDS` antes de concluir que um job sumiu.

Se o processo recebe SIGKILL, não há shutdown gracioso, mas o lease continua garantindo recuperação.

## Jobs ficam em QUEUED

Cheque:

- campanha em `SCHEDULED` ou `RUNNING`, não pausada;
- `scheduled_at` já vencido;
- conta em `CONNECTED` ou `TOKEN_EXPIRING`;
- worker com heartbeat recente;
- conexões disponíveis no PostgreSQL.

Horários são armazenados em UTC. Revise `DEFAULT_TIMEZONE` e o timezone escolhido na campanha se a execução parece deslocada.

## Muitos RETRY_WAIT ou HTTP 429

Não aumente concorrência. O worker respeita `Retry-After` e aplica backoff exponencial. Reduza `WORKER_CONCURRENCY` ou `META_GLOBAL_CONCURRENCY`, consulte a quota da conta e aguarde. Um 429 persistente pode exigir revisar limites atuais da Meta.

## RECONCILIATION_REQUIRED

Esse estado é intencional. Ocorre quando `media_publish` pode ter sido aceito, mas não houve resposta confiável, ou quando o lease venceu durante `PUBLISHING`.

1. Abra a conta no Instagram e verifique se a mídia apareceu.
2. Compare horário, legenda e conteúdo.
3. Registre a decisão operacional.
4. Não transforme o job em retry automático.

Se a publicação não existir e for necessário tentar novamente, crie/duplique uma campanha de forma explícita após a verificação humana.

## OAuth retorna state inválido

O state expira em dez minutos e só pode ser usado uma vez. Inicie a conexão novamente no painel. Confirme `APP_URL`, `INSTAGRAM_REDIRECT_URI`, HTTPS e a URI cadastrada na Meta com igualdade exata. Não reutilize a URL de callback de outro ambiente.

## Token ficou ilegível

Isso normalmente indica que `TOKEN_ENCRYPTION_KEY` mudou ou que banco e secret vieram de backups diferentes. Restaure a chave correta pelo secret manager. Se ela foi perdida, os tokens AES-GCM não são recuperáveis; reconecte as contas. Nunca “corrija” removendo a criptografia.

## Build Docker falha

Use BuildKit/Docker atual e confirme que o lockfile corresponde ao `package.json`:

```bash
pnpm install --frozen-lockfile
docker build --progress=plain --file Dockerfile .
docker build --progress=plain --file Dockerfile.worker .
```

Erros nativos de `argon2` ou `sharp` geralmente indicam arquitetura/base incompatível ou cache antigo. Refaça sem cache apenas para diagnóstico: `docker build --no-cache ...`; isso não apaga dados do Compose.
