# Auditoria Ponytail

**Plugin:** `ponytail@ponytail` 4.9.0
**Modo:** FULL
**Escopo:** diff de implementação e repositório completo, depois das auditorias de corretude, segurança e confiabilidade

Foram executados os workflows atuais `ponytail-review` e `ponytail-audit`. Todos os cortes seguros encontrados foram aplicados:

- `delete:` declaração direta de `@vitest/coverage-v8` sem script nem configuração de cobertura. O runner Vitest permanece. `[package.json]`
- `delete:` campo `mimeType` carregado no job e passado a `getPublishableUrl`, embora nenhuma implementação o consumisse. Nada o substitui. `[src/jobs/queue.ts, src/providers/storage.ts]`
- `delete:` geração `output: "standalone"` que o Dockerfile não consumia. O runtime já usa `next start`. `[next.config.ts]`
- `delete:` finalização específica de campanhas ambíguas repetida pelo sweeper terminal da mesma transação. O sweeper único cobre todas as campanhas. `[src/jobs/queue.ts]`
- `delete:` cinco SVGs do starter Next sem referência e o `COPY public` correspondente. Nada os substitui. `[public, Dockerfile]`
- `delete:` FFmpeg na imagem worker; somente o web recebe e valida uploads. `[Dockerfile.worker]`
- `shrink:` colunas de storage, mídia, conta, job e auditoria selecionadas por páginas que não as renderizavam. SELECTs passam a buscar somente os campos consumidos. `[src/app/(dashboard)]`

Resultado aplicado: `net: -55 linhas, -1 dependência direta.` O pacote de cobertura ainda pode aparecer no grafo local como *optional peer* do próprio Vitest; ele deixou de ser uma dependência declarada pelo projeto.

## Dependências removidas

- `@vitest/coverage-v8` foi removida das `devDependencies`, pois não existia comando de cobertura nem aceite que dependesse dela.
- As dependências restantes possuem uso atual. Luxon permanece para conversão timezone/DST; Sharp e ffprobe validam mídia; AWS SDK atende a implementação S3 real; Drizzle mantém schema e migrations; PostgreSQL.js executa os queries parametrizados.

## Infraestrutura evitada

- PostgreSQL implementa fila, rate limit de login, leases, fencing, recovery, heartbeat e advisory locks.
- Não há Redis, BullMQ, RabbitMQ, Kafka, NATS, event bus, WebSocket, Elasticsearch, Kubernetes, Temporal ou Airflow.
- O produto permanece um monólito modular com apenas dois processos implantáveis: web e worker.
- MinIO é somente a implementação S3 local do Compose; produção pode usar qualquer endpoint S3 compatível.
- A imagem worker não carrega FFmpeg; o binário existe somente onde o upload é validado.

## Abstrações removidas

- O shape `StoredAsset` deixou de transportar `mimeType`, flexibilidade sem consumidor.
- O recovery deixou de possuir dois finalizadores equivalentes; um único sweeper transacional fecha campanhas terminais.
- Nenhuma camada estrutural adicional precisou ser removida: a revisão contínua evitou repositories, factories, base providers, managers, DTOs duplicados e serviços delegadores.
- As duas interfaces preservadas têm mais de uma implementação real: `InstagramProvider` (Meta/Fake) e `StorageProvider` (Local/S3).

## Código simplificado

- URLs de preview local e S3 usam uma única rota assinada de mesma origem; não existe lógica de CSP por endpoint de bucket no browser.
- A mesma fila PostgreSQL atende agendamento, claim e retries; não existe sincronização com um broker paralelo.
- Polling simples de 8 segundos atualiza a fila no painel; não há conexão push permanente.
- A versão da API Meta e os limites operacionais ficam centralizados em environment/schema, sem factories de configuração.

## Coisas que deliberadamente NÃO foram simplificadas

- Fencing e renovação de lease foram mantidos para impedir escrita de worker obsoleto.
- `FOR UPDATE SKIP LOCKED`, locks por conta e limite global foram mantidos para impedir claim concorrente e publicação simultânea indevida.
- `RECONCILIATION_REQUIRED` foi mantido porque retry cego depois de `media_publish` pode duplicar uma publicação.
- Criptografia AES-256-GCM dos tokens, OAuth state single-use, assinatura dos callbacks e rate limit atômico foram mantidos por segurança.
- Validação real de imagens/vídeos, limites de upload e streaming com `Range` foram mantidos nas fronteiras não confiáveis.
- Crash recovery, backoff com jitter, controle de quota, token refresh com compare-and-swap, graceful shutdown, audit logs, healthchecks e migrations foram mantidos como garantias operacionais.
- Testes unitários, PostgreSQL, carga e E2E não foram reduzidos; são os checks executáveis exigidos para essas garantias.

Após esses cortes, toda a suíte foi executada novamente; os resultados reproduzíveis ficam no README e no relatório final da entrega.
