# Meta — desautorização e exclusão de dados

**Data da consulta:** 01/09/2026
**Fonte normativa principal:** [Data Deletion Request Callback — Meta](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback)

## Contratos públicos

| Finalidade | Método/URL | Efeito |
|---|---|---|
| Deauthorization | `https://SEU-DOMINIO/api/meta/deauthorization` | Marca a conexão como desautorizada e inutiliza o token |
| Data deletion callback | `POST https://SEU-DOMINIO/api/meta/data-deletion` | Valida pedido assinado, inicia exclusão e devolve status/code |
| Página humana/status | `GET https://SEU-DOMINIO/data-deletion?code={confirmation_code}` | Explica como pedir exclusão ou mostra status sem expor identidade |

Desautorização e exclusão não são sinônimos. Logout local também não revoga a autorização na Meta. Fonte: [Manual Login Flow — Detecting uninstall](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow#deauth-callback).

## O que a Meta exige para data deletion

A documentação consultada, atualizada em 07/11/2025, determina:

- apps que acessam dados de usuário devem informar na política de privacidade como pedir exclusão;
- o callback deve usar HTTPS e ser cadastrado no campo **Data Deletion Request URL**;
- a Meta envia `POST` com o campo `signed_request`;
- o payload contém um ID app-scoped do solicitante;
- o app deve iniciar a exclusão;
- a resposta deve ser JSON com uma URL de status legível e um código alfanumérico de confirmação;
- a URL deve permitir entender o estado do pedido e, quando legítimo, a justificativa de eventual recusa.

Resposta esperada:

```json
{
  "url": "https://SEU-DOMINIO/data-deletion?code=CONFIRMATION_CODE",
  "confirmation_code": "CONFIRMATION_CODE"
}
```

## Validação do `signed_request`

O body é `application/x-www-form-urlencoded` e contém `signed_request={encoded_signature}.{encoded_payload}`.

Processamento obrigatório:

1. Limitar tamanho do body e aceitar apenas `POST`.
2. Separar em exatamente duas partes no primeiro `.`.
3. Decodificar assinatura e payload com Base64 URL-safe, corrigindo padding.
4. Interpretar o payload como JSON.
5. Exigir `algorithm=HMAC-SHA256` como endurecimento de segurança coerente com o formato oficial.
6. Calcular `HMAC-SHA256(encoded_payload, INSTAGRAM_APP_SECRET)` sobre a parte ainda codificada.
7. Comparar assinatura esperada e recebida em tempo constante.
8. Validar `issued_at`/`expires`, quando presentes, com tolerância curta de relógio; rejeitar payload expirado.
9. Extrair o ID app-scoped somente depois da assinatura válida.
10. Nunca registrar `signed_request`, assinatura, payload completo ou App Secret.

Para desautorização, `authorized_at` registra somente a conexão/reconexão OAuth. Um evento cujo `issued_at` seja anterior a esse instante é auditado como obsoleto e não pode derrubar o token novo; refresh automático não altera essa geração de autorização. Na exclusão, a idempotência usa o hash do evento assinado inteiro: repetir o mesmo callback devolve o mesmo código sem afetar uma reconexão posterior, enquanto um novo pedido assinado recebe novo código e apaga a autorização vigente.

Em assinatura inválida, responder 4xx sem criar pedido. Não devolver detalhes criptográficos.

## Correlação do usuário

A aplicação precisa persistir separadamente:

- `app_scoped_user_id`: usado para correlacionar callbacks;
- `instagram_user_id`: `user_id` profissional retornado por `/me`, usado nos endpoints de publicação.

Não presumir que os dois IDs são iguais. O callback geral de data deletion documenta um ID app-scoped. O payload de deauthorization específico de Instagram Login não está descrito publicamente em detalhe; **verificar no painel da Meta** antes de produção.

Se um `signed_request` válido trouxer ID ainda não encontrado:

- criar/registrar um pedido idempotente com confirmação;
- não revelar que o ID existe ou não;
- encaminhar para reconciliação segura;
- nunca escolher uma conta “parecida” por username.

## Processo idempotente de exclusão

Após validar o pedido:

1. Criar ou reutilizar um registro de pedido pelo identificador app-scoped e fingerprint segura da solicitação.
2. Gerar `confirmation_code` aleatório, não sequencial e não derivado do ID.
3. Em transação:
   - bloquear novos jobs da conta;
   - cancelar jobs ainda não iniciados;
   - marcar a conexão como desconectada/indisponível;
   - remover o token cifrado e qualquer material que permita recuperá-lo.
4. Excluir ou anonimizar os dados recebidos da Meta associados ao ID:
   - app-scoped ID e Instagram professional ID, quando não forem mais necessários;
   - username, nome, foto e tipo de conta;
   - access tokens e datas de lifecycle;
   - metadados/perfis/mídias obtidos da Meta;
   - erros/logs que contenham dados pessoais.
5. Remover associações de grupos e impedir futuras publicações para a conta.
6. Processar histórico/campanhas/audit logs conforme política de retenção e obrigação legal; anonimizar quando retenção for legítima.
7. Marcar o pedido como concluído e atualizar a página de status.

Não apagar posts já publicados no Instagram a menos que exista requisito e API autorizada específicos; data deletion aqui trata dados mantidos pelo app. Não inventar revogação remota: eliminar o token local e tratar a desautorização da Meta como fonte de revogação.

## Estado do pedido

Estados internos mínimos sugeridos:

| Estado | Texto humano |
|---|---|
| `RECEIVED` | Recebemos o pedido e ele aguarda processamento. |
| `IN_PROGRESS` | A exclusão está em processamento. |
| `COMPLETED` | Os dados aplicáveis mantidos pelo InstaGestor foram excluídos ou anonimizados. |
| `REFUSED` | A exclusão não foi integralmente executada; a página deve informar justificativa legítima e canal de contato. |

A Meta não fixa SLA numérico na página consultada, mas orienta tratamento rápido. Não prometer prazo não aprovado pelo responsável legal.

A página de status:

- deve funcionar sem login;
- recebe apenas código aleatório;
- não exibe ID, username, email, token ou existência de conta;
- usa `Cache-Control: no-store`;
- aplica rate limit;
- informa canal de contato e política de privacidade;
- mantém mensagem compreensível quando o código for inválido, sem enumeração.

## Endpoint de desautorização

Cadastrar:

```text
https://SEU-DOMINIO/api/meta/deauthorization
```

Ao receber callback validado:

1. correlacionar pelo ID app-scoped;
2. inutilizar e remover o token armazenado;
3. marcar `REAUTH_REQUIRED`/`DISCONNECTED`;
4. cancelar novos claims e jobs futuros daquela conta;
5. manter jobs já publicados como publicados;
6. registrar audit event sem payload/secret/token;
7. tornar repetições idempotentes.

**Lacuna oficial:** o [guia de customização](https://developers.facebook.com/docs/development/create-an-app/instagram-use-case) manda cadastrar a Deauthorization callback URL, e o [manual geral](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow#deauth-callback) diz que ela é acionada quando o app é removido, mas as fontes públicas consultadas não especificam método e schema do payload para Instagram Login. Não reutilizar cegamente o parser de data deletion. **Verificar no painel da Meta** e capturar o teste oficial em ambiente seguro.

## Página de instruções `/data-deletion`

Quando aberta sem `code`, a página deve explicar em português:

1. que o usuário pode remover o app/configuração pela Meta e solicitar exclusão pelos controles oferecidos;
2. que também pode contatar `[EMAIL]` com as informações mínimas necessárias;
3. quais categorias de dados o app mantém;
4. quais dados serão excluídos/anonimizados;
5. possíveis retenções legais e o motivo;
6. como consultar o status usando o confirmation code;
7. links para Privacy e Terms.

Não publicar até substituir `[EMAIL]` e demais placeholders legais.

## Testes obrigatórios

### Data deletion

- [ ] Callback só aceita HTTPS em produção e `POST`.
- [ ] Body ausente/malformado retorna 4xx.
- [ ] Base64 URL-safe com/sem padding é tratado.
- [ ] Assinatura válida é aceita; assinatura alterada é rejeitada.
- [ ] Comparação é timing-safe.
- [ ] Payload expirado é rejeitado quando contém `expires`.
- [ ] Pedido repetido devolve o mesmo status sem duplicar exclusão.
- [ ] Resposta tem exatamente `url` e `confirmation_code` úteis.
- [ ] URL pública exibe status humano sem PII.
- [ ] Token deixa de ser recuperável imediatamente.
- [ ] Jobs futuros são cancelados/bloqueados.
- [ ] Logs não contêm `signed_request`, token, secret ou ID desnecessário.
- [ ] Teste oferecido pelo App Dashboard passa.

### Deauthorization

- [ ] Método e payload foram confirmados no teste do App Dashboard.
- [ ] Assinatura/autenticidade são validadas conforme o contrato efetivamente mostrado.
- [ ] ID app-scoped correlaciona a conta correta.
- [ ] Callback repetida é idempotente.
- [ ] Conta deixa de publicar e pede reconexão.

O passo a passo de teste por “Apps and Websites” na página geral da Meta é escrito para Facebook Login. Para Instagram Login, usar o teste específico exibido no App Dashboard e **verificar no painel da Meta**.

## Checklist do painel

- [ ] **Business login settings > Deauthorization callback URL** aponta para `/api/meta/deauthorization`.
- [ ] **Business login settings > Data deletion request URL** aponta para `/api/meta/data-deletion`.
- [ ] Privacy Policy explica o pedido de exclusão.
- [ ] `/data-deletion` está pública e sem placeholders.
- [ ] Resposta do callback aponta para a mesma página com confirmation code.
- [ ] Testes de callback do painel foram executados em staging.

## Fontes oficiais

- [Data Deletion Request Callback](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback) — atualizada em 07/11/2025
- [Customize the Instagram use case](https://developers.facebook.com/docs/development/create-an-app/instagram-use-case) — atualizada em 15/03/2026
- [Manually Build a Login Flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow#deauth-callback) — atualizada em 30/06/2026
- [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login)

Todas consultadas em 01/09/2026.
