# Meta App Review — pacote de prontidão

**Data da consulta:** 01/09/2026
**Permissões:** `instagram_business_basic`, `instagram_business_content_publish`

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

## Texto sugerido — `instagram_business_basic`

### Justificativa em inglês

> InstaGestor is a private web application used by an authorized organization administrator to connect and manage Instagram professional accounts that the organization owns or is authorized to manage. After the administrator selects “Connect Instagram” and completes Business Login for Instagram, the application uses `instagram_business_basic` to retrieve the account's app-scoped ID, professional account ID, username, name, account type, and profile picture. This data is shown in the Accounts screen so the administrator can identify the correct publishing destination and monitor connection status. InstaGestor does not use this permission for messaging, comments, ads, scraping, or consumer accounts.

### O screencast precisa mostrar

1. Login no InstaGestor.
2. Tela **Contas**.
3. Clique **Conectar Instagram**.
4. Janela oficial do Instagram e concessão da permissão.
5. Retorno ao app.
6. Conta exibida com username/ID e tipo de conta.
7. Se endpoints forem mostrados, exibir apenas o nome `GET /me`; ocultar token e headers.

Essa demonstração acompanha os requisitos da [Permissions reference](https://developers.facebook.com/docs/permissions#instagram_business_basic): login completo e leitura de metadados básicos, como username e ID.

## Texto sugerido — `instagram_business_content_publish`

### Justificativa em inglês

> InstaGestor lets an authorized organization administrator publish and schedule organic content to Instagram professional accounts that the organization owns or is authorized to manage. The administrator uploads media, writes or reviews the caption, selects the destination account, previews the schedule, and explicitly confirms the campaign. At execution time, the application uses `instagram_business_content_publish` to create an Instagram media container, monitor video/container readiness when applicable, and publish the approved container. The application displays the resulting Instagram media ID and status. It does not publish ads, messages, comments, or content to consumer accounts, and it does not publish without an administrator-created and confirmed campaign.

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

## Roteiro de screencast único

Grave em uma tomada contínua ou com cortes claramente identificados:

1. Abrir a URL pública de staging e fazer login com a credencial de reviewer.
2. Abrir **Contas**.
3. Clicar **Conectar Instagram**.
4. Mostrar Business Login for Instagram e autorizar os dois scopes.
5. Retornar automaticamente ao InstaGestor.
6. Mostrar a conta conectada com username, ID e status, cobrindo `instagram_business_basic`.
7. Abrir **Mídias** e enviar uma imagem JPEG de teste.
8. Abrir **Campanhas**, criar Feed de imagem, selecionar a conta e preencher caption.
9. Mostrar preview e confirmar/publicar, cobrindo `instagram_business_content_publish`.
10. Mostrar o status final, IG Media ID e o post no Instagram.

Final opcional: mostrar Story e Reel em conta Business, sem substituir a prova obrigatória do Feed image.

## Instruções para o reviewer

Preencher no painel, sem commitar valores reais:

```text
Application URL: https://STAGING-DOMAIN/
Admin login URL: https://STAGING-DOMAIN/login
Test admin email: [REVIEWER_EMAIL]
Test admin password: [REVIEWER_PASSWORD]

Steps:
1. Sign in with the test administrator credentials.
2. Open Accounts in the left navigation.
3. Select Connect Instagram.
4. Complete Business Login for Instagram using the professional test account supplied in the secure App Review fields.
5. Confirm that the account username and ID appear in Accounts.
6. Open Media and upload the supplied JPEG test file.
7. Open Campaigns, create a Feed image campaign, select the connected account, add the supplied caption, and confirm publication.
8. Open Queue/History and wait for Published.
9. Copy the displayed Instagram media ID and open the supplied Instagram test account to confirm the post.
```

Não colocar senha em repositório, README, vídeo público ou campo de justificativa. Usar somente o campo seguro fornecido pelo App Review.

## Evidências antes de enviar

- [ ] OAuth pede exatamente os dois scopes.
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

- Pedir mensagens/comentários/insights sem funcionalidade correspondente.
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
