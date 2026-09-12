# Instagestor

Painel interno para organizar e publicar mídia em aproximadamente 50 ou mais contas profissionais do Instagram. A aplicação usa somente a API oficial da Meta e também oferece um provider fake para desenvolvimento e testes sem credenciais externas. Também traz análises agregadas e por conta (seguidores, alcance, views, interações, mídias) e histórico de contas banidas.

A arquitetura deliberadamente pequena é: Next.js + PostgreSQL + worker Node.js + storage S3 compatível. A fila usa o próprio PostgreSQL; não há Redis, broker ou microserviços.

## Início rápido com Docker

Pré-requisitos: Docker com Compose v2. O arquivo de Compose sobe PostgreSQL, MinIO, web e worker; um container efêmero cria o bucket local.

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec -e NODE_ENV=development web pnpm db:seed
docker compose ps
```

No PowerShell, substitua o primeiro comando por `Copy-Item .env.example .env`.

Acesse:

- painel: <http://localhost:3000>
- saúde da aplicação: <http://localhost:3000/api/health>
- console do MinIO: <http://localhost:9001>

Entre com `ADMIN_EMAIL` e `ADMIN_PASSWORD` definidos no `.env`. Os valores incluídos no exemplo são exclusivamente locais. Para acompanhar a inicialização:

```bash
docker compose logs -f web worker
```

Para encerrar sem apagar os dados:

```bash
docker compose down
```

`docker compose down -v` também remove o banco e os objetos locais; use apenas quando quiser descartar todo o ambiente.

## Desenvolvimento fora dos containers

Pré-requisitos: Node.js 22, pnpm 11, FFmpeg/ffprobe e Docker para os serviços de dados.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres minio minio-init
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm dev` inicia web e worker juntos. Para depurar os processos separadamente, use dois terminais:

```bash
pnpm dev:web
pnpm dev:worker
```

O `.env.example` usa `localhost`, adequado aos processos executados na máquina. O Compose troca internamente esses hosts pelos nomes `postgres` e `minio`.

Gere segredos novos antes de compartilhar um ambiente:

```bash
pnpm secret:session
pnpm secret:encryption
```

Copie cada saída para a variável indicada. `TOKEN_ENCRYPTION_KEY` precisa representar exatamente 32 bytes em base64. Trocar essa chave depois de conectar contas torna os tokens existentes ilegíveis.

## Verificações

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:load
pnpm test:load:db
pnpm test:integration
pnpm test:e2e
pnpm build
```

Os testes de integração, carga PostgreSQL e E2E usam `TRUNCATE` em PostgreSQL real e recusam qualquer banco cujo nome não termine exatamente em `_test`. Crie um banco descartável isolado e forneça a URL somente aos comandos de teste:

```bash
DATABASE_URL=postgresql://usuario:senha@localhost:5432/instagestor_test pnpm test:integration
DATABASE_URL=postgresql://usuario:senha@localhost:5432/instagestor_test pnpm test:load:db
DATABASE_URL=postgresql://usuario:senha@localhost:5432/instagestor_test pnpm test:e2e
```

No PowerShell, defina `$env:DATABASE_URL` antes do comando. Mantenha `INSTAGRAM_PROVIDER=fake`; nenhum teste automatizado publica no Instagram real.

## Providers

`INSTAGRAM_PROVIDER=fake` habilita o fluxo local controlado por `FAKE_PROVIDER_SCENARIO`. O fake é bloqueado em produção, exceto quando `ALLOW_FAKE_PROVIDER_IN_PRODUCTION=true` é definido explicitamente. O Compose local usa esse opt-in porque executa a build de produção com dados fake.

Para usar a Meta real, configure as credenciais, uma URL pública HTTPS e mude para `INSTAGRAM_PROVIDER=meta`. Nunca armazene tokens ou App Secret no repositório. Consulte [META_SETUP.md](docs/META_SETUP.md) e [USER_ACTION_REQUIRED.md](docs/USER_ACTION_REQUIRED.md).

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Banco de dados](docs/DATABASE.md)
- [Fila, retries e recuperação](docs/QUEUE.md)
- [Deploy](docs/DEPLOYMENT.md)
- [Segurança](docs/SECURITY.md)
- [Solução de problemas](docs/TROUBLESHOOTING.md)
- [Referência da API Meta](docs/META_API_REFERENCE.md)
- [Auditoria Ponytail](docs/PONYTAIL_AUDIT.md)
- [Ações humanas finais](docs/USER_ACTION_REQUIRED.md)
