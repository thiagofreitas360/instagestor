# Meta App Review — pacote de prontidão

**Data da consulta:** 01/09/2026 · **Revisado para Tech Provider:** 04/10/2026
**Permissões:** `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`

## Quando a revisão é necessária

| Cenário | Access | App Review |
|---|---|---|
| Somente contas profissionais próprias/administradas, com papéis adequados | Standard | Não exigido segundo a tabela oficial |
| Contas de clientes/terceiros ou usuários sem papel no app/business portfolio | Advanced | Obrigatório |

Advanced Access também exige Business Verification. O número de contas não altera a regra. Fonte: [Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview) e [App Review for Instagram API](https://developers.facebook.com/docs/instagram-platform/app-review).

## Pré-requisitos de submissão

- Aplicação carregável e testável externamente.
- Plataforma Web ou mobile Web; são as plataformas atualmente documentadas para Instagram Login.
- Botão/link de Instagram Login visível e de acordo com as diretrizes de marca.
- Credenciais de teste válidas e instruções passo a passo.
- App icon 1024×1024, Privacy Policy URL, categoria e business email.
- Fluxo completo de OAuth funcionando com uma conta profissional de teste.
- Ao menos uma chamada bem-sucedida quando o painel exigir esse pré-requisito.
- Justificativa individual e screencast end-to-end para cada permissão.
- Nenhuma permissão sem uso. A Meta cita permissões desnecessárias como causa de reprovação.
- Segredos, tokens, passwords e authorization code fora da gravação e dos logs mostrados.

Se a UI estiver apenas em português, adicionar legendas/tooltips claros; a Meta recomenda inglês quando possível.

## Caminho atual no App Dashboard

1. Abra o App Dashboard.
2. No menu esquerdo, vá a **Products > Instagram > API setup with Instagram login**.
3. Expanda **Complete app review**.
4. Confira as permissões e clique **Continue to app review**.
5. Em **App Review > Requests**, clique **Edit**.
6. Preencha cada item de App Settings, App Verification e Permission & feature requests.

Os rótulos são os documentados em 01/09/2026. Se divergirem, **verificar no painel da Meta**.

## Texto sugerido — Tech Provider Access Verification

Em **App Dashboard > Verificações > Access Verification**. Exige Business Verification concluída.

> InstaGestor is a social media management platform operated by POTENCIALIZE DIGITAL LTDA (CNPJ 63.946.775/0001-74) for small and medium businesses. Each client business gets an isolated workspace in which its own users connect the Instagram professional accounts the business owns or is authorized to manage, one account per authorization, through Business Login for Instagram in the official Meta window. InstaGestor never asks for or stores Instagram passwords; access tokens are stored encrypted (AES-256-GCM) and are never sent to the browser.
>
> We access only three permissions: instagram_business_basic (to identify the connected account), instagram_business_content_publish (to publish and schedule organic Feed, Reels, Stories and carousel posts that the business creates and explicitly confirms) and instagram_business_manage_insights (to show the business performance reports for its own accounts). We do not use messaging, comments, ads or any private API, scraping or browser automation.
>
> Every record is scoped to the client organization; an Instagram account can belong to only one organization at a time, and an attempt to connect an account that already belongs to another client is rejected without revealing that client. Data is never sold, used for advertising or shared between clients. Businesses can disconnect an account at any time in InstaGestor or remove the app in Instagram settings; we implement the deauthorization and data deletion callbacks, which delete the token and remove or anonymize the account data. Privacy policy: https://instagestor.orbih.shop/privacy. Data deletion: https://instagestor.orbih.shop/data-deletion.

## Texto sugerido — `instagram_business_basic`

### Justificativa em inglês

> InstaGestor is a multi-tenant web platform that lets client businesses connect and manage the Instagram professional accounts they own or are authorized to manage. Each business works in an isolated workspace. After a business user selects “Connect Instagram” and completes Business Login for Instagram in the official Meta window, the application uses `instagram_business_basic` to retrieve the account's app-scoped ID, professional account ID, username, name, account type, and profile picture. This data is shown only to that business, in the Accounts screen, so the user can identify the correct publishing destination and monitor connection status. InstaGestor does not use this permission for messaging, comments, ads, scraping, or consumer accounts.

### O screencast precisa mostrar

1. Login no InstaGestor.
2. Tela **Contas**.
3. Clique **Conectar Instagram**.
4. Popup oficial do Instagram e concessão da permissão.
5. Popup fecha sozinho e a lista de contas atualiza.
6. Conta exibida com username/ID e tipo de conta.
7. Se endpoints forem mostrados, exibir apenas o nome `GET /me`; ocultar token e headers.

Essa demonstração acompanha os requisitos da [Permissions reference](https://developers.facebook.com/docs/permissions#instagram_business_basic): login completo e leitura de metadados básicos, como username e ID.

## Texto sugerido — `instagram_business_content_publish`

### Justificativa em inglês

> InstaGestor lets client businesses publish and schedule organic content to the Instagram professional accounts they own or are authorized to manage. A business user uploads media, writes or reviews the caption, selects the destination account, previews the schedule, and explicitly confirms the campaign. At execution time, the application uses `instagram_business_content_publish` to create an Instagram media container, monitor video/container readiness when applicable, and publish the approved container. The application displays the resulting Instagram media ID and status. It does not publish ads, messages, comments, or content to consumer accounts, and it does not publish without a campaign created and confirmed by a user of the business that owns the account.

### O screencast precisa mostrar

1. A conta já conectada após o OAuth.
2. Upload de uma imagem JPEG válida controlada pela organização.
3. Criação de uma campanha de Feed para uma única conta de teste.
4. Inclusão de caption/hashtags.
5. Preview da conta e do horário.
6. Confirmação explícita da campanha.
7. Processamento do container e publicação.
8. Status **Publicado** e IG Media ID no InstaGestor.
9. O post resultante no Instagram nativo/web.

A [Permissions reference](https://developers.facebook.com/docs/permissions#instagram_business_basic) pede demonstrar criação de um novo post orgânico de Feed, caption/hashtags/metadados e resultado no Feed. Use imagem no teste principal; Reel/Story/Carousel podem ser mostrados depois, sem tornar a gravação principal ambígua.

## Texto sugerido — `instagram_business_manage_insights`

### Justificativa em inglês

> InstaGestor shows each client business the performance of the Instagram professional accounts it owns or is authorized to manage. After a business user connects an account with Business Login for Instagram, a background worker periodically calls the account insights endpoint (reach, views, profile views, accounts engaged, interactions, follower count) and the media insights endpoint for recent posts, reels and stories. The results are stored and displayed in the Analytics screen, aggregated across all connected accounts and per account, only to that business, so it can compare its accounts, track follower growth and identify the best-performing content. InstaGestor does not use insights for ads, does not expose them to third parties and does not access consumer accounts.

### O screencast precisa mostrar

1. Conta já conectada após o OAuth (com a permissão de insights concedida na tela da Meta).
2. Tela **Análises** com os cards de seguidores, alcance, visualizações e interações.
3. Filtro por conta mostrando a mesma tela para uma conta só.
4. Tabela de mídias com views/alcance por reel/post/story.
5. Se endpoints forem mostrados, exibir apenas `GET /{ig-user-id}/insights` e `GET /{ig-media-id}/insights`; ocultar token e headers.

## Roteiro de screencast único

Grave em uma tomada contínua ou com cortes claramente identificados:

1. Abrir a URL pública de staging e fazer login com a credencial de reviewer.
2. Abrir **Contas**.
3. Clicar **Conectar Instagram**.
4. Mostrar o popup do Business Login for Instagram e autorizar os três scopes.
5. Mostrar o popup fechando e a lista de contas atualizando sozinha.
6. Mostrar a conta conectada com username, ID e status, cobrindo `instagram_business_basic`.
7. Abrir **Mídias** e enviar uma imagem JPEG de teste.
8. Abrir **Campanhas**, criar Feed de imagem, selecionar a conta e preencher caption.
9. Mostrar preview e confirmar/publicar, cobrindo `instagram_business_content_publish`.
10. Mostrar o status final, IG Media ID e o post no Instagram.
11. Abrir **Análises** e mostrar os indicadores da conta conectada.

Final opcional: mostrar Story e Reel em conta Business, sem substituir a prova obrigatória do Feed image.

## Instruções para o reviewer

Preencher no painel, sem commitar valores reais:

```text
Application URL: https://instagestor.orbih.shop/
Login URL: https://instagestor.orbih.shop/login
Test admin email: [REVIEWER_EMAIL]
Test admin password: [REVIEWER_PASSWORD]

Steps:
1. Sign in with the test administrator credentials.
2. Open Accounts in the left navigation.
3. Select "Conectar Instagram" (Connect Instagram). A popup with the official Instagram login opens; if the browser blocks it, select "Continuar nesta aba" (Continue in this tab).
4. Complete Business Login for Instagram using the professional test account supplied in the secure App Review fields. The popup closes and the account list refreshes automatically.
5. Confirm that the account username and ID appear in Accounts.
6. Open "Mídias" (Media) and upload the supplied JPEG test file.
7. Open "Campanhas" (Campaigns), create a Feed image campaign, select the connected account, add the supplied caption, and confirm publication.
8. Open "Fila" (Queue) and wait for the status "Publicado" (Published).
9. Copy the displayed Instagram media ID and open the supplied Instagram test account to confirm the post.
10. Open "Análises" (Analytics) to see account and media insights; use the account filter to view a single account.
```

O usuário do reviewer deve ser exclusivo, numa organização de demonstração sem dados de clientes reais, sem MFA e com a conta de teste já adicionada como Instagram Tester enquanto o app não estiver Live.

Não colocar senha em repositório, README, vídeo público ou campo de justificativa. Usar somente o campo seguro fornecido pelo App Review.

## Evidências antes de enviar

- [ ] OAuth pede exatamente os três scopes.
- [ ] Redirect URI de staging corresponde exatamente ao painel.
- [ ] `/me` retorna a conta profissional e a UI exibe a identidade.
- [ ] Uma imagem de Feed foi publicada com sucesso pela API v26.0.
- [ ] O IG Media ID aparece na UI sem mostrar access token.
- [ ] Reviewer consegue repetir o fluxo sem VPN, allowlist ou intervenção da equipe.
- [ ] Privacy, Terms e Data Deletion estão públicas.
- [ ] Deauthorization e data deletion callbacks respondem ao teste do painel.
- [ ] App icon, categoria e business email estão completos.
- [ ] Business Verification está concluída quando Advanced é solicitado.
- [ ] Vídeo contém legendas/tooltips se a UI não estiver em inglês.
- [ ] Nenhum scope extra aparece na URL ou consent screen.

## Erros que devem reprovar nossa própria submissão

- Pedir mensagens/comentários sem funcionalidade correspondente (insights agora tem tela própria).
- Descrever automação genérica sem mostrar a ação explícita do administrador.
- Mostrar apenas o painel interno e não o resultado no Instagram.
- Fornecer credencial expirada, MFA inacessível ou ambiente restrito.
- Usar conta pessoal em vez de Instagram Professional.
- Expor token, App Secret, password, authorization code ou chave de criptografia.
- Gravar uma UI diferente da enviada ao reviewer.
- Não explicar botões/textos em português.
- Solicitar Advanced antes de a Business Verification e os itens do app estarem completos.

## Inconsistências oficiais

1. A página de App Review lista `instagram_business_content_publishing`, enquanto Business Login, Permissions Reference, Content Publishing e Postman usam `instagram_business_content_publish`.
   - Usar `_publish` no OAuth e no código.
   - **Verificar no painel da Meta** qual rótulo selecionar na submissão.
2. O guia de customização pode adicionar `instagram_business_manage_messages` como “required” para o caso de uso amplo.
   - Não pedir esse scope ao usuário nem solicitar Advanced Access para ele.
   - Se o painel impedir sua remoção, **verificar no painel da Meta** e explicar que o app não usa mensagens.
3. A documentação genérica de criação/release pode apresentar exigências mais amplas, mas a tabela específica de Instagram Platform diz Standard sem review para negócio próprio/administrado.
   - Conferir o nível efetivo exibido no app antes do go-live.

## Fontes oficiais

- [App Review for Instagram API](https://developers.facebook.com/docs/instagram-platform/app-review)
- [Instagram Platform overview — Access levels](https://developers.facebook.com/docs/instagram-platform/overview)
- [Permissions reference](https://developers.facebook.com/docs/permissions)
- [Customize the Instagram use case](https://developers.facebook.com/docs/development/create-an-app/instagram-use-case)
- [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login)

Todas consultadas em 01/09/2026.
