# Configuração da Meta — Instagram Login

**Data da consulta:** 01/09/2026
**API:** Instagram API with Instagram Login / Business Login for Instagram
**Versão inicial:** `v26.0`

Este guia usa os nomes de tela documentados pela Meta em 01/09/2026. O App Dashboard muda sem aviso. Quando um rótulo não existir exatamente como descrito, não escolher uma opção “parecida” por suposição: **verificar no painel da Meta** e conferir o [guia oficial de customização do caso de uso](https://developers.facebook.com/docs/development/create-an-app/instagram-use-case).

## URLs finais da aplicação

Substitua `https://SEU-DOMINIO` por `APP_URL`, sem barra final duplicada.

| Finalidade | URL |
|---|---|
| OAuth Redirect URI | `https://SEU-DOMINIO/api/instagram/oauth/callback` |
| Deauthorization callback URL | `https://SEU-DOMINIO/api/meta/deauthorization` |
| Data deletion request URL | `https://SEU-DOMINIO/api/meta/data-deletion` |
| Página/instruções/status de exclusão | `https://SEU-DOMINIO/data-deletion` |
| Privacy Policy URL | `https://SEU-DOMINIO/privacy` |
| Terms URL | `https://SEU-DOMINIO/terms` |

Em produção, as URLs precisam ser públicas. A callback de data deletion deve usar HTTPS segundo a [documentação oficial](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback). Não usar `localhost` no cadastro de produção.

## Antes de abrir o painel

Tenha disponível:

- uma conta Meta Developer;
- uma conta Instagram Professional (Business ou Creator) própria para teste;
- domínio HTTPS já apontando para a aplicação;
- páginas `/privacy`, `/terms` e `/data-deletion` publicamente acessíveis;
- credencial de admin de staging para eventual App Review;
- ícone do app 1024×1024, categoria e business email;
- nenhuma credencial ou token em screenshots, documentação pública ou repositório.

A conta Instagram pode ter presença apenas no Instagram; este modo não exige Page do Facebook vinculada. Fonte: [Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview).

## 1. Criar o app e escolher o caso de uso

1. Acesse [Meta for Developers — Apps](https://developers.facebook.com/apps/).
2. Crie um app novo. Quando o painel solicitar tipo de app, escolha **Business**; o [Get Started oficial](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started) exige um app desse tipo para esta integração.
3. Adicione o caso de uso documentado como **Manage messaging and content on Instagram**.
4. No menu esquerdo, abra **Dashboard** e selecione/customize esse caso de uso.
5. Escolha **API setup with Instagram Login**.

A Meta permite apenas uma configuração Instagram por app: Instagram Login ou Facebook Login, não ambas. Se outro produto precisar de Facebook Login, criar outro app. Fonte: [Customize the Instagram use case](https://developers.facebook.com/docs/development/create-an-app/instagram-use-case).

## 2. Registrar os identificadores corretos

Em **Instagram > API setup with Instagram login**, copie de forma segura:

- **Instagram App ID** → `INSTAGRAM_APP_ID`;
- **Instagram App Secret** → `INSTAGRAM_APP_SECRET`.

Use os identificadores mostrados na seção Instagram/Business login settings. Não presumir que são intercambiáveis com outros App IDs/Secrets exibidos no app.

O secret deve existir apenas no ambiente do servidor/worker. Nunca usar variável `NEXT_PUBLIC_*`, devolver ao frontend ou registrar em log.

## 3. Configurar permissões mínimas

O OAuth desta aplicação deve pedir somente:

```text
instagram_business_basic
instagram_business_content_publish
```

1. Na customização do caso de uso, abra a área de permissões.
2. Adicione `instagram_business_basic`.
3. Adicione `instagram_business_content_publish`.
4. Remova/desmarque permissões de mensagens, comentários, insights, Human Agent, ads e qualquer outra que não seja usada.

O guia do painel informa que **Add all required permissions** pode adicionar `instagram_business_manage_messages` por padrão por causa do caso de uso amplo. Esta aplicação não usa mensagens e não deve incluir esse scope na URL OAuth. Se o painel não permitir remover a permissão do produto, deixá-la sem Advanced Access e sem solicitá-la ao usuário; **verificar no painel da Meta** antes da submissão.

Os scopes antigos `business_basic` e `business_content_publish` foram descontinuados em 27/01/2025. Fonte: [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login).

## 4. Adicionar a conta de teste

Na seção **Generate access tokens**:

1. Clique **Add account**.
2. Clique **Continue**.
3. Entre com a conta Instagram Professional de teste.
4. Conclua a autorização.
5. Clique **Save** e depois **Got it**, conforme o fluxo atual documentado.

Para Standard Access, as pessoas/contas usadas precisam ter os papéis adequados no app ou no business portfolio que o possui. Não usar conta de consumidor/pessoal.

## 5. Configurar o Business Login

Na seção **Set up Instagram business login**:

1. Clique **Set up**.
2. Adicione exatamente:

   ```text
   https://SEU-DOMINIO/api/instagram/oauth/callback
   ```

3. Clique **Save**.
4. Abra **Business login settings**.
5. Confira a lista **OAuth redirect URIs**; o valor precisa ser idêntico ao de `INSTAGRAM_REDIRECT_URI`, inclusive eventual `/` final.
6. Adicione a **Deauthorization callback URL**:

   ```text
   https://SEU-DOMINIO/api/meta/deauthorization
   ```

7. Adicione a **Data deletion request URL**:

   ```text
   https://SEU-DOMINIO/api/meta/data-deletion
   ```

8. Salve.

A Meta não prescreve os nomes desses paths; eles são o contrato desta aplicação. O método/payload de deauthorization específico do Instagram Login não está descrito publicamente com precisão. Depois do cadastro, usar o teste oferecido pelo painel e **verificar no painel da Meta** antes de produção.

## 6. Webhooks

Para o escopo inicial de publicação, a tabela oficial de [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing) não exige webhooks. O sistema consulta estado de container por polling persistente.

Se webhooks forem habilitados para um requisito futuro:

1. Informe uma Callback URL própria de webhook e um Verify token.
2. Clique **Verify and save**.
3. Assine somente campos realmente usados.

Não confundir webhook callback, OAuth callback, deauthorization callback e data deletion callback; são contratos separados.

## 7. App Settings e URLs legais

Preencha no App Dashboard:

- App icon 1024×1024;
- Privacy Policy URL: `https://SEU-DOMINIO/privacy`;
- App Category;
- Business Email;
- Terms URL, se o painel solicitar;
- domínio da aplicação, se o painel solicitar.

Não publicar placeholders legais. `[RAZÃO SOCIAL]`, `[CNPJ]`, `[ENDEREÇO]`, `[EMAIL]` e `[DOMÍNIO]` precisam ser substituídos pelo responsável antes do go-live.

## 8. Variáveis de ambiente

```dotenv
APP_URL=https://SEU-DOMINIO
META_API_VERSION=v26.0
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=https://SEU-DOMINIO/api/instagram/oauth/callback
```

Regras:

- `INSTAGRAM_REDIRECT_URI` deve ser um valor explícito, não montado a partir de `Host`/`X-Forwarded-Host` não confiável.
- O secret e tokens ficam somente no backend.
- Alterar `META_API_VERSION` apenas após ler o changelog e rodar os smoke tests.
- Não usar tokens gerados no painel como configuração permanente de produção; o fluxo normal é OAuth por conta e troca por token longo.

## 9. Conferir Standard ou Advanced Access

Use **Standard Access** quando todas as contas profissionais forem próprias/administradas pela organização e os usuários tiverem papéis adequados. É o default e, nesse cenário, a Meta diz que App Review não é necessário.

Use **Advanced Access** antes de servir contas que a organização não possui/administra ou pessoas sem role no app/business portfolio. Advanced exige:

- App Review;
- Business Verification;
- app externamente testável;
- justificativa e screencast por permissão.

Ter 50 contas não determina Advanced Access. Propriedade/administração e roles determinam. Fonte: [Platform overview — Access levels](https://developers.facebook.com/docs/instagram-platform/overview).

## 10. Teste do OAuth

URL mínima esperada:

```text
https://www.instagram.com/oauth/authorize
?client_id={INSTAGRAM_APP_ID}
&redirect_uri={URL_ENCODED_INSTAGRAM_REDIRECT_URI}
&response_type=code
&scope=instagram_business_basic,instagram_business_content_publish
&state={OPAQUE_SINGLE_USE_STATE}
```

Checklist:

1. Entre no painel interno.
2. Clique **Conectar Instagram**.
3. Confirme que a origem é `www.instagram.com` e os dois escopos são os esperados.
4. Autorize.
5. Confirme retorno ao callback cadastrado.
6. Verifique consumo single-use do `state` e do code.
7. Confirme troca pelo token curto e imediatamente pelo longo.
8. Confirme que token/secret/code não aparecem no browser, logs ou audit log.
9. Chame:

   ```text
   GET https://graph.instagram.com/v26.0/me
       ?fields=id,user_id,username,name,account_type,profile_picture_url
   ```

10. Confirme persistência separada de `id` app-scoped e `user_id` profissional.

Para reconexão, o authorize pode usar `force_reauth=true`. `enable_fb_login` tem default `true`; definir `false` apenas se a decisão do produto for esconder a opção de login pelo Facebook.

## 11. Smoke test de publicação

Executar em uma conta de teste, nesta ordem:

1. Consultar `/me`.
2. Consultar `content_publishing_limit` e registrar o schema real de `quota_usage`/`config`.
3. Publicar uma imagem JPEG válida no Feed.
4. Confirmar container ID e IG Media ID.
5. Publicar um Story de imagem em conta Business.
6. Publicar um Reel curto; aguardar `FINISHED` e usar `share_to_feed` conforme o teste.
7. Publicar um carousel de duas imagens.
8. Testar refresh somente quando o token longo tiver ao menos 24 h.
9. Acionar os testes de deauthorization e data deletion oferecidos pelo painel.

Só depois ampliar de 1 para 5, 10 e então ~50 contas.

## 12. Pontos que precisam ser conferidos no painel

- O painel pode forçar permissões do caso de uso amplo que a aplicação não solicita no OAuth.
- O rótulo de App Review pode aparecer incorretamente como `instagram_business_content_publishing`; o scope de runtime documentado é `instagram_business_content_publish`.
- O status real de Standard/Advanced e Business Verification do app.
- O teste e payload de deauthorization para Instagram Login.
- O retorno real de `content_publishing_limit`, devido às contradições oficiais 50/100 e `config`/`rate_limit_settings`.
- Story em Creator, Feed vídeo isolado e resumable upload para Instagram Login.

## Fontes oficiais

- [Customize the Instagram use case](https://developers.facebook.com/docs/development/create-an-app/instagram-use-case)
- [Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview)
- [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login)
- [Get Started — Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started)
- [Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing)
- [App Review for Instagram API](https://developers.facebook.com/docs/instagram-platform/app-review)
- [Data Deletion Request Callback](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback)
- [Meta Instagram workspace — Postman](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)

Todas consultadas em 01/09/2026.
