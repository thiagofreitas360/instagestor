# Meta Instagram API — referência validada

**Produto alvo:** Instagram API with Instagram Login, usando Business Login for Instagram
**Data da consulta:** 01/09/2026
**Fontes aceitas nesta referência:** Meta for Developers e workspace oficial Meta no Postman

Este documento é um snapshot operacional. A Meta altera versões, limites e o App Dashboard; antes de trocar `META_API_VERSION` ou enviar o app para revisão, conferir novamente o [changelog da Instagram Platform](https://developers.facebook.com/docs/instagram-platform/changelog) e as [versões da Graph API](https://developers.facebook.com/docs/graph-api/changelog/versions).

## Decisões consolidadas

- Usar `graph.instagram.com` para chamadas da Instagram API with Instagram Login. Esse modo usa Instagram User access token e não exige Page do Facebook vinculada.
- Usar `META_API_VERSION=v26.0`. Em 01/09/2026, v26.0 é a versão Graph mais recente, lançada em 29/07/2026.
- Solicitar somente `instagram_business_basic` e `instagram_business_content_publish`.
- Usar `https://www.instagram.com/oauth/authorize`, `https://api.instagram.com/oauth/access_token`, `https://graph.instagram.com/access_token` e `https://graph.instagram.com/refresh_access_token` exatamente nos papéis descritos abaixo.
- Nunca codificar 50 ou 100 como quota fixa. Consultar `content_publishing_limit` e respeitar a configuração efetivamente devolvida pela conta.
- Para mídia hospedada, usar URL pública que a Meta consiga baixar sem cookie ou header privado. Gerar a URL próximo da criação do container e mantê-la válida até a Meta concluir a obtenção/processamento.

## Matriz de decisões e implicações

| Assunto | Fonte oficial | Data consultada | Conclusão | Implicação no código |
|---|---|---:|---|---|
| Configuração escolhida | [Platform overview](https://developers.facebook.com/docs/instagram-platform/overview), [Postman — Instagram Login](https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login) | 01/09/2026 | Instagram Login atende contas profissionais Business e Creator, usa credenciais do Instagram e não requer Page vinculada. Não oferece ads nem product tagging. | Um único adapter para `graph.instagram.com`; não implementar descoberta de Page/Page token para este provider. |
| Versão atual | [Graph API versions](https://developers.facebook.com/docs/graph-api/changelog/versions) | 01/09/2026 | v26.0 é a versão mais recente; expiração ainda consta como `TBD`. | Definir `META_API_VERSION=v26.0`; centralizar composição das URLs. OAuth e troca/refresh de token não recebem versão no caminho. |
| Escopos | [Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login), [Permissions reference](https://developers.facebook.com/docs/permissions#instagram_business_basic), [Postman oficial](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) | 01/09/2026 | `instagram_business_basic` lê perfil/mídia básica. `instagram_business_content_publish` depende do primeiro e permite publicação orgânica. Os nomes antigos `business_basic` e `business_content_publish` foram descontinuados em 27/01/2025. | OAuth pede somente os dois escopos novos. Rejeitar conexão se ambos não forem concedidos; não pedir mensagens, comentários, insights ou ads. |
| Autorização OAuth | [Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login) | 01/09/2026 | `GET https://www.instagram.com/oauth/authorize` com `client_id`, `redirect_uri`, `response_type=code`, `scope` e `state`. O código vale 1 hora e só pode ser usado uma vez. | `state` criptográfico, curto, single-use e obrigatório no produto, embora opcional no protocolo da Meta. Tratar cancelamento e remover eventual sufixo documentado `#_` do código. |
| Redirect OAuth | [Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login) | 01/09/2026 | `redirect_uri` deve corresponder exatamente a uma URI cadastrada, inclusive barra final. A mesma URI deve ser enviada na autorização e na troca do código. | Usar `INSTAGRAM_REDIRECT_URI`; não derivar de header da requisição. Cadastrar `${APP_URL}/api/instagram/oauth/callback` exatamente como configurado. |
| Código por token curto | [Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login) | 01/09/2026 | `POST https://api.instagram.com/oauth/access_token`, `multipart/form-data`, com `client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri` e `code`. Token curto vale 1 hora. | Executar apenas no servidor, com timeout; nunca enviar secret, code ou token ao browser/log. Persistir os IDs retornados antes de descartar a resposta. |
| Token longo | [Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login) | 01/09/2026 | `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=...&access_token=...`. Token longo vale cerca de 60 dias e a resposta contém `expires_in`. | Trocar o token curto ainda válido imediatamente; persistir `expires_in` real e armazenar o token cifrado. Não hardcode de segundos. |
| Refresh | [Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login) | 01/09/2026 | `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=...`. Só funciona se o token longo tiver ao menos 24 h, não estiver expirado e `instagram_business_basic` continuar concedido. Renova por mais 60 dias. | Renovar antecipadamente, mas nunca antes de 24 h. Se expirou ou perdeu escopo, marcar `REAUTH_REQUIRED`; refresh não recupera token expirado. |
| Inatividade da permissão | [Permissions reference](https://developers.facebook.com/docs/permissions) | 01/09/2026 | A Meta informa que uma permissão não usada por 90 dias pode precisar ser concedida novamente. | Uma data de expiração futura não garante acesso; classificar erros de permissão e orientar reconexão. |
| Identidade `/me` | [Get Started](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started), [`/me` reference](https://developers.facebook.com/docs/instagram-platform/reference/me) | 01/09/2026 | `GET https://graph.instagram.com/v26.0/me?fields=id,user_id,username,name,account_type,profile_picture_url`. `id` é app-scoped; `user_id` identifica a conta profissional. | Persistir ambos separadamente. Usar `user_id` para endpoints da conta e `id` para correlacionar callbacks app-scoped. Validar o formato real da resposta no primeiro smoke test. |
| Leitura de mídia | [Get Started](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started), [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) | 01/09/2026 | `GET /{ig_user_id}/media` lista até 10 mil mídias recentes. Stories não aparecem nessa edge; a referência manda usar `GET /{ig_user_id}/stories`. | Paginar por cursor; não usar a edge como reconciliação ilimitada de histórico e consultar Stories separadamente quando necessário. |
| Criar container | [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing), [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) | 01/09/2026 | `POST /{ig_user_id}/media` cria container; imagem usa `image_url`; vídeo usa `video_url` e `media_type`. Receber `id` não garante que vídeo terminou. | Persistir `meta_container_id` antes de qualquer polling; não recriar container de forma cega após resposta ambígua. |
| URL publicável | [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing), [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) | 01/09/2026 | A Meta faz cURL da mídia, que precisa estar publicamente acessível durante a tentativa. URLs em US-ASCII são fortemente recomendadas. A Meta não publica TTL mínimo para URL assinada. | Presigned URL HTTPS, sem autenticação adicional, criada perto do job. O TTL é configuração operacional; **verificar com teste real da Meta** antes de produção. Não apagar o objeto enquanto o container processa. |
| Feed imagem | [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing), [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) | 01/09/2026 | Criar container com `image_url` e `caption`; depois publicar. | Habilitar `FEED_IMAGE`; validar JPEG conforme a tabela de mídia. |
| Feed vídeo isolado | [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing) | 01/09/2026 | O guia atual enumera vídeo simples e `media_type=VIDEO`, mas a referência mais nova privilegia Reels e não traz especificações separadas completas para Feed vídeo. | Manter `FEED_VIDEO` atrás de capability/smoke test. Caminho preferencial de vídeo no Feed: Reel com `share_to_feed=true`. **Verificar no painel da Meta e em conta real v26.0** antes de liberar `VIDEO` isolado. |
| Reels | [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing), [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) | 01/09/2026 | `media_type=REELS`, `video_url`, caption opcional e `share_to_feed`. `share_to_feed=true` permite Feed + Reels, mas não garante seleção algorítmica. | Aguardar `FINISHED`; publicar o mesmo container. Não prometer presença na aba Reels. |
| Stories | [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing), [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media), [Postman oficial](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) | 01/09/2026 | `media_type=STORIES` com `image_url` ou `video_url`. Story expira após 24 h. A ressalva “Stories apenas para Business” aparece na seção Facebook Login do Postman, não de forma inequívoca na seção Instagram Login. | Habilitar para Business. Para Creator, manter bloqueado/experimental até **verificar no painel da Meta e testar uma conta Creator**. Stickers não são suportados. |
| Carousel | [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing), [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) | 01/09/2026 | Criar filhos com `is_carousel_item=true`; vídeo filho usa `media_type=VIDEO`; criar pai com `media_type=CAROUSEL` e `children` ordenados. Máximo 10 itens; Reel não pode ser filho. | Persistir IDs dos filhos e do pai; aguardar vídeos filhos. Caption fica no pai. Validar no mínimo 2 itens como regra do produto; o mínimo da API não está expresso claramente — **verificar no painel da Meta**. |
| Publicar | [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing), [Media Publish](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media_publish) | 01/09/2026 | `POST /{ig_user_id}/media_publish` com `creation_id`; sucesso devolve o IG Media ID. | `media_publish` não recebe retry HTTP automático. Timeout após envio é ambíguo: ir para reconciliação, não publicar novamente às cegas. |
| Status do container | [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing), [IG Container](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-container), [Postman — status](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) | 01/09/2026 | `GET /{container_id}?fields=status_code,status`. Estados: `IN_PROGRESS`, `FINISHED`, `PUBLISHED`, `ERROR`, `EXPIRED`. A recomendação oficial é consultar uma vez/minuto por no máximo 5 minutos. | Poll persistente/reagendado; `FINISHED` libera publish, `PUBLISHED` exige reconciliação do resultado, `ERROR` classifica falha, `EXPIRED` exige novo fluxo controlado. Não segurar worker por minutos. |
| Lifecycle/limite de containers | [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) | 01/09/2026 | Container expira em 24 h. Uma conta pode criar até 400 containers em janela móvel de 24 h. | Não criar containers muito antes do horário. Cada carousel cria vários containers; considerar isso no orçamento de criação. |
| Quota de publicações | [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing), [Content Publishing Limit](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit), [Media Publish](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media_publish) | 01/09/2026 | Há contradição oficial: o guia atualizado em 30/06/2026 diz 100 posts/24 h; a seção de carousel do mesmo guia e as referências dizem 50. Carousel conta como um post publicado. | Nunca hardcode. Consultar quota por conta e respeitar `quota_total` recebido. Se a configuração não vier, usar bloqueio conservador e **verificar no painel da Meta**, em vez de assumir 100. |
| Endpoint de quota | [Content Publishing Limit](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit) | 01/09/2026 | `GET /{ig_user_id}/content_publishing_limit`; os campos descritos são `quota_usage` e `config` (`quota_total`, `quota_duration`). O exemplo da própria página pede `rate_limit_settings`, outra inconsistência. | Tentar `fields=quota_usage,config` e validar em Graph API Explorer/conta real. Persistir o retorno bruto sanitizado para diagnóstico. **Verificar no painel da Meta**. |
| Standard/Advanced | [Platform overview](https://developers.facebook.com/docs/instagram-platform/overview), [App Review](https://developers.facebook.com/docs/instagram-platform/app-review) | 01/09/2026 | Standard é suficiente para contas próprias/administradas e pessoas com papéis adequados. Advanced é necessário para contas de terceiros e exige App Review + Business Verification. Quantidade de contas não decide o nível. | Começar Standard se as ~50 contas forem realmente próprias/administradas. Migrar para Advanced antes de atender clientes/contas sem role. |
| Deauthorization | [Customize Instagram use case](https://developers.facebook.com/docs/development/create-an-app/instagram-use-case), [Manual login flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow#deauth-callback) | 01/09/2026 | O painel exige URL de desautorização e a callback informa remoção do app. A documentação pública consultada não define método/payload específico para Instagram Login. | Cadastrar `/api/meta/deauthorization`, desconectar e inutilizar token quando a assinatura/ID forem validados. Antes de produção, **verificar no painel da Meta** e executar o teste oficial do callback. |
| Data deletion | [Data Deletion Request Callback](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback) | 01/09/2026 | POST HTTPS com `signed_request`; validar HMAC-SHA256, iniciar exclusão e responder JSON com `url` e `confirmation_code`. | Endpoint separado `/api/meta/data-deletion`; página/status humana `/data-deletion`. Detalhes em `META_DATA_DELETION.md`. |

## OAuth e tokens

### 1. Autorização

```text
GET https://www.instagram.com/oauth/authorize
  ?client_id={INSTAGRAM_APP_ID}
  &redirect_uri={URL_ENCODED_INSTAGRAM_REDIRECT_URI}
  &response_type=code
  &scope=instagram_business_basic,instagram_business_content_publish
  &state={OPAQUE_SINGLE_USE_STATE}
```

Parâmetros opcionais atuais:

- `force_reauth=true`: força novo login; útil em reconexão.
- `enable_fb_login=false`: esconde a opção de login pelo Facebook. O default documentado é `true`; só alterar de forma deliberada.

Em sucesso, a Meta redireciona com `?code=...`; em cancelamento, com `error=access_denied`, `error_reason=user_denied` e `error_description=...`. O código é single-use e vale 1 hora.

### 2. Troca pelo token curto

```http
POST https://api.instagram.com/oauth/access_token
Content-Type: multipart/form-data

client_id={INSTAGRAM_APP_ID}
client_secret={INSTAGRAM_APP_SECRET}
grant_type=authorization_code
redirect_uri={INSTAGRAM_REDIRECT_URI}
code={CODE}
```

A documentação atual mostra uma resposta `data[]` com `access_token`, `user_id` app-scoped e `permissions`. Confirmar a forma efetivamente recebida no smoke test e falhar de modo explícito diante de shape desconhecido.

### 3. Troca pelo token longo

```text
GET https://graph.instagram.com/access_token
  ?grant_type=ig_exchange_token
  &client_secret={INSTAGRAM_APP_SECRET}
  &access_token={SHORT_LIVED_TOKEN}
```

### 4. Renovação

```text
GET https://graph.instagram.com/refresh_access_token
  ?grant_type=ig_refresh_token
  &access_token={VALID_LONG_LIVED_TOKEN}
```

Lifecycle confirmado:

| Artefato | Validade/condição |
|---|---|
| Authorization code | 1 hora, uso único |
| Token curto do Business Login | 1 hora |
| Token longo | aproximadamente 60 dias; usar `expires_in` retornado |
| Momento mínimo de refresh | token longo com pelo menos 24 horas |
| Token expirado | não pode ser renovado; novo OAuth obrigatório |
| Permissão inativa | após 90 dias sem uso, a Meta pode exigir nova concessão |

## Endpoints Graph usados

Todos usam `Authorization: Bearer {INSTAGRAM_USER_ACCESS_TOKEN}`. É preferível o header a token em query string, para reduzir vazamento em logs.

```text
GET  https://graph.instagram.com/v26.0/me
     ?fields=id,user_id,username,name,account_type,profile_picture_url

GET  https://graph.instagram.com/v26.0/{ig_user_id}/media

GET  https://graph.instagram.com/v26.0/{ig_user_id}/stories

POST https://graph.instagram.com/v26.0/{ig_user_id}/media

GET  https://graph.instagram.com/v26.0/{container_id}
     ?fields=status_code,status

POST https://graph.instagram.com/v26.0/{ig_user_id}/media_publish
     creation_id={container_id}

GET  https://graph.instagram.com/v26.0/{ig_user_id}/content_publishing_limit
     ?fields=quota_usage,config
```

## Fluxos por formato

### Feed de imagem

1. `POST /{ig_user_id}/media` com `image_url` e `caption` opcional.
2. Guardar o container ID.
3. `POST /{ig_user_id}/media_publish` com `creation_id`.
4. Guardar o IG Media ID devolvido.

### Reel

1. Criar com `media_type=REELS`, `video_url`, `caption` opcional e `share_to_feed` quando solicitado.
2. Consultar `status_code` até `FINISHED`, sem exceder a cadência oficial.
3. Publicar o container.

### Story

1. Criar com `media_type=STORIES` e exatamente um de `image_url`/`video_url`.
2. Para vídeo, aguardar `FINISHED`.
3. Publicar. Não há suporte documentado a stickers de link, poll ou localização.

### Carousel

1. Criar cada imagem/vídeo filho com `is_carousel_item=true`; vídeo filho usa `media_type=VIDEO`.
2. Aguardar `FINISHED` para filhos de vídeo.
3. Criar o pai com `media_type=CAROUSEL`, `children={id1,id2,...}` na ordem final e caption no pai.
4. Publicar o pai. Máximo oficial: 10 filhos; Reels não são aceitos como filhos.

## Status do container

| `status_code` | Significado | Ação |
|---|---|---|
| `IN_PROGRESS` | Upload/processamento ainda em curso | Reagendar consulta; não publicar |
| `FINISHED` | Container elegível/pronto | Avançar uma vez para `media_publish` |
| `PUBLISHED` | Objeto do container já foi publicado | Não repetir; reconciliar e obter/confirmar o media ID |
| `ERROR` | Processamento falhou | Registrar `status`, classificar e aplicar política de retry |
| `EXPIRED` | Não foi publicado em 24 h | Não publicar; criar novo container apenas por transição controlada |

A Meta recomenda polling uma vez por minuto, durante no máximo 5 minutos. Depois disso, o job deve ser reagendado em vez de manter processo bloqueado.

## Restrições de mídia confirmadas

| Tipo | Requisitos oficiais em 01/09/2026 |
|---|---|
| Imagem Feed/Carousel | JPEG somente (não MPO/JPS); até 8 MB; aspecto entre 4:5 e 1.91:1; largura 320–1440 px; sRGB |
| Reel | MOV ou MP4, sem edit lists e com `moov` no início; HEVC/H.264 progressive, closed GOP, 4:2:0; AAC até 48 kHz, mono/estéreo; 23–60 FPS; até 1920 px horizontais; aspecto aceito 0.01:1–10:1, recomendado 9:16; vídeo VBR até 25 Mbps; áudio 128 kbps; 3 s–15 min; até 300 MB |
| Capa de Reel | JPEG; até 8 MB; sRGB; recomendado 9:16. Compartilhamento no Feed usa recorte central 1:1 |
| Story imagem | JPEG; até 8 MB; sRGB; recomendado 9:16 |
| Story vídeo | MOV/MP4 e mesmos codecs-base do Reel; 23–60 FPS; até 1920 px horizontais; aspecto 0.1:1–10:1, recomendado 9:16; VBR até 25 Mbps; áudio 128 kbps; 3–60 s; até 100 MB |
| Caption | Até 2.200 caracteres, 30 hashtags e 20 `@mentions`; em carousel, usar no pai |
| Carousel | Até 10 imagens/vídeos; Reels não podem ser filhos; imagens são recortadas com base na primeira, default 1:1 |

O Postman oficial ainda contém exemplo antigo de Reel de até 1 GB, enquanto a referência Meta atualizada em 12/08/2026 diz 300 MB. Usar 300 MB e **verificar no painel da Meta** antes de alterar.

## Quotas e conflitos oficiais

Há três limites distintos:

1. **Criação de containers:** 400 por conta em janela móvel de 24 h.
2. **Publicação:** o guia atual diz 100 posts/24 h, mas outras seções/referências oficiais dizem 50.
3. **Graph/API rate limiting geral:** erros e headers próprios da plataforma; não substituir a quota de publicação por heurística global.

Política segura:

- Consultar `content_publishing_limit` antes de reservar uma publicação próxima da quota.
- Usar `config.quota_total` e `config.quota_duration` retornados, não constante.
- Tratar carousel como uma publicação, embora seus filhos e pai consumam containers.
- Se `config` não vier ou o schema divergir, bloquear conservadoramente aquela conta e **verificar no painel da Meta/Graph API Explorer**.
- Revalidar a quota periodicamente e depois de erro de limite.

## Lacunas que exigem verificação real

- **Deauthorization payload:** método e schema específicos de Instagram Login não estão publicados claramente.
- **Quota:** 100 versus 50 e `config` versus `rate_limit_settings` em páginas oficiais.
- **Story em Creator:** não prometer antes de teste real.
- **Feed vídeo isolado:** preferir Reel + `share_to_feed`; testar `media_type=VIDEO` antes de habilitar.
- **Resumable upload:** o guia o restringe a Facebook Login for Business, mas exemplos antigos do Postman o mostram em contexto Instagram Login. Nesta integração, usar `video_url` público até confirmação no painel.
- **Tagging:** Instagram Login declara não oferecer tagging, enquanto a referência compartilhada expõe alguns parâmetros. Não implementar user/product tagging sem validação de produto e painel.

## Fontes oficiais consultadas

- [Graph API — versões](https://developers.facebook.com/docs/graph-api/changelog/versions)
- [Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview)
- [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login)
- [Get Started — Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started)
- [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing)
- [IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media)
- [IG User Media Publish](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media_publish)
- [IG User Content Publishing Limit](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit)
- [IG Container](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-container)
- [`/me`](https://developers.facebook.com/docs/instagram-platform/reference/me)
- [Permissions reference](https://developers.facebook.com/docs/permissions)
- [Meta Instagram workspace — Postman](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Postman — criar imagem](https://www.postman.com/meta/instagram/request/23987686-f4b5a72d-a125-4080-8968-93de1a549e68)
- [Postman — criar vídeo](https://www.postman.com/meta/instagram/request/23987686-8d93f052-4c50-4cef-b23e-57732bf370f3)
- [Postman — publicar container](https://www.postman.com/meta/instagram/request/23987686-299b176b-90aa-4d8a-b6cf-e6028fc69de5)

Observação: respostas salvas no Postman oficial ainda exibem, em alguns exemplos, header `instagram-api-version: v23.0`. Isso não determina a versão atual; a fonte de verdade para versão é a página oficial de versões, que indica v26.0.
