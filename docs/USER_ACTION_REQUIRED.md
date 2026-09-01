# Ações humanas necessárias

Este arquivo contém somente atividades que exigem acesso humano a contas, infraestrutura, documentos legais ou à Meta. Não coloque segredos em issues, commits, screenshots ou mensagens.

## Etapa 1 — Infraestrutura de produção

- [ ] Definir o domínio público do painel.
- [ ] Configurar DNS e TLS válido para esse domínio.
- [ ] Provisionar PostgreSQL de produção com TLS, backups e política de retenção.
- [ ] Criar bucket S3/R2 compatível privado e credenciais de menor privilégio.
- [ ] Confirmar que URLs assinadas do bucket são acessíveis pela Meta via HTTPS.
- [ ] Escolher registry/orquestrador/VPS e cadastrar os secrets no secret manager.
- [ ] Preencher razão social, CNPJ, endereço e contatos nas páginas legais antes da exposição pública.

## Etapa 2 — Segredos e environment

- [ ] Gerar `SESSION_SECRET` com `pnpm secret:session`.
- [ ] Gerar `TOKEN_ENCRYPTION_KEY` com `pnpm secret:encryption` e guardar cópia segura junto ao plano de backup.
- [ ] Definir uma senha forte e exclusiva para o admin.
- [ ] Preencher a configuração de produção a partir de `.env.example`, sem reutilizar valores locais.
- [ ] Definir `NODE_ENV=production`, `INSTAGRAM_PROVIDER=meta` e `ALLOW_FAKE_PROVIDER_IN_PRODUCTION=false`.
- [ ] Definir `APP_URL` e `INSTAGRAM_REDIRECT_URI` com o domínio HTTPS final.

## Etapa 3 — Meta Developers

- [ ] Entrar em Meta Developers com a conta responsável pela organização.
- [ ] Criar ou selecionar o App e adicionar Instagram API with Instagram Login / Business Login for Instagram.
- [ ] Cadastrar exatamente a redirect URI `https://SEU_DOMINIO/api/instagram/oauth/callback`.
- [ ] Cadastrar callback de desautorização e endpoint de exclusão de dados conforme [META_SETUP.md](META_SETUP.md).
- [ ] Solicitar somente `instagram_business_basic` e `instagram_business_content_publish`.
- [ ] Copiar App ID e App Secret diretamente para o secret manager de produção.
- [ ] Criar conta Instagram profissional de teste e conceder acesso necessário ao App.
- [ ] Quando necessário fora dos papéis do App, concluir Business Verification e solicitar Advanced Access usando [META_APP_REVIEW.md](META_APP_REVIEW.md).

## Etapa 4 — Primeiro acesso

- [ ] Executar migrations como job de release.
- [ ] Executar o seed do administrador uma vez.
- [ ] Confirmar `/api/health` sem detalhes sensíveis e heartbeat recente do worker.
- [ ] Entrar no painel com o admin e trocar/remover qualquer credencial temporária.

## Etapa 5 — Primeira conta

- [ ] Clicar em “Conectar Instagram”.
- [ ] Autorizar uma única conta profissional de teste na tela oficial da Meta.
- [ ] Confirmar retorno ao painel e status `CONNECTED`.
- [ ] Usar “Verificar conexão” e confirmar perfil e quota.

## Etapa 6 — Smoke test real mínimo

- [ ] Fazer upload de uma imagem JPEG não sensível.
- [ ] Criar uma campanha `FEED_IMAGE` para somente a conta de teste.
- [ ] Revisar o cronograma e publicar/agendar uma vez.
- [ ] Acompanhar `QUEUED` → `PUBLISHED` e confirmar o Meta media ID.
- [ ] Confirmar visualmente a publicação no Instagram.
- [ ] Conferir logs e audit log sem tokens, senha, App Secret ou chaves.

Não conecte as demais contas antes de esse fluxo único passar. Depois, amplie gradualmente e monitore quota, retries e heartbeat.

## Etapa 7 — Tipos de mídia e rollout gradual

- [ ] Com a mesma conta Business de teste, publicar um Story de imagem e confirmar o resultado.
- [ ] Publicar um Reel curto, aguardar o container terminar e confirmar `share_to_feed` conforme a campanha.
- [ ] Testar Carousel com dois itens; manter Feed vídeo isolado desabilitado até a validação descrita em `META_API_REFERENCE.md`.
- [ ] Ampliar o lote de contas nesta ordem: 1 → 5 → 10 → aproximadamente 50.
- [ ] Em cada patamar, conferir quota, jobs em retry, reconciliações, heartbeat, duração e ausência de duplicidade antes de avançar.
