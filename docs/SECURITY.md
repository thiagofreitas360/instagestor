# Segurança

## Modelo de ameaça e escopo

O Instagestor é um sistema interno, single-organization e inicialmente single-admin. Os ativos críticos são tokens das contas Instagram, App Secret, credenciais do administrador, chave de criptografia, sessão, mídia e capacidade de publicar. As fronteiras externas são browser, callbacks da Meta, PostgreSQL e storage S3.

O sistema não armazena senha do Instagram, cookies da rede social nem usa automação de browser. A integração real deve usar somente a API oficial da Meta.

## Controles implementados

### Autenticação e autorização

- senha do administrador com Argon2id;
- cookie de sessão `HttpOnly`, `SameSite=Lax` e `Secure` em produção;
- payload de sessão assinado por HMAC e validade de 12 horas;
- consulta do usuário ADMIN no banco a cada sessão validada;
- rate limit de login persistido no PostgreSQL, com admissão atômica por par e-mail+IP (5/15 min) e teto de custo por IP (30/15 min) antes do Argon2;
- checagem de mesma origem disponível para mutações administrativas;
- APIs administrativas devem chamar `requireAdminApi`; páginas privadas devem chamar `requireAdmin`.

O cookie é assinado, não criptografado, e contém somente identificador, role e expiração. Rotacionar `SESSION_SECRET` invalida todas as sessões.

### OAuth e callbacks

- `state` aleatório, armazenado apenas como SHA-256, expira em dez minutos e é single-use;
- callback consome o state atomicamente antes de trocar o código;
- callbacks de desautorização e exclusão verificam `signed_request` com HMAC-SHA256 e comparação constante;
- códigos OAuth, tokens e App Secret não devem aparecer em logs nem no frontend.

### Tokens

Tokens são cifrados em repouso com AES-256-GCM, IV aleatório e tag de autenticação. `TOKEN_ENCRYPTION_KEY` deve decodificar para exatamente 32 bytes. O logger redige campos cujo nome indique token, password, secret, authorization, cookie, código OAuth ou chave de criptografia.

A chave não está no banco e precisa ser protegida no secret manager e no processo de backup. Não existe rotação automática de chave nesta versão; uma troca sem recriptografia exige reconectar todas as contas.

### Upload e storage

- storage keys usam UUID e não derivam do filename;
- tamanho é limitado antes de persistir;
- conteúdo, MIME declarado e extensão precisam coincidir;
- imagens são decodificadas por Sharp;
- vídeos são inspecionados pelo ffprobe, com codecs e duração restritos;
- nomes enviados pelo usuário servem apenas como metadado;
- previews privados passam por uma rota assinada, de mesma origem, com streaming e suporte a `Range`;
- objetos enviados à Meta usam URL assinada com expiração; no modo S3 o bucket permanece privado;
- arquivos nunca são executados.

### Banco, fila e auditoria

- queries usam parâmetros do driver/ORM, não concatenação de entrada;
- constraints e transações mantêm snapshots e unicidade dos jobs;
- locking, lease e fencing impedem writes de workers obsoletos;
- resultado ambíguo de publish não recebe retry automático;
- eventos administrativos sensíveis geram `audit_logs` sem segredos.

## Headers e transporte

Em produção, o web deve enviar ao menos:

- Content-Security-Policy restritiva e compatível com os recursos realmente usados;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin` ou mais restritiva;
- `frame-ancestors 'none'` na CSP (ou `X-Frame-Options: DENY` como compatibilidade);
- HSTS no terminador TLS depois que todo o domínio operar somente em HTTPS.

Não habilite `unsafe-eval` em produção. Se scripts inline do framework exigirem ajuste da CSP, teste a política em staging e use nonce/hash em vez de abrir origens amplas.

## Segredos

Nunca versionar nem imprimir:

- `INSTAGRAM_APP_SECRET` ou access tokens;
- `SESSION_SECRET`;
- `TOKEN_ENCRYPTION_KEY`;
- `ADMIN_PASSWORD` ou hash exportado;
- credenciais PostgreSQL/S3;
- dumps do banco, cookies ou arquivos `.env`.

Use credenciais separadas por ambiente e menor privilégio. O usuário PostgreSQL da aplicação não precisa ser superuser. Restrinja o bucket a operações no prefixo da aplicação e mantenha console MinIO/S3 fora da internet pública.

## Checklist de revisão de endpoints

Para cada rota nova:

1. classifique-a como pública ou administrativa;
2. exija admin nas rotas privadas;
3. em POST/PATCH/PUT/DELETE do browser, valide mesma origem;
4. valide body, params e limites no servidor;
5. não retorne stack, SQL, config ou segredo;
6. registre evento de auditoria quando houver mudança sensível;
7. teste não autenticado, origem inválida e input malformado.

Rotas públicas esperadas são apenas login, health sanitizado, OAuth/callbacks necessários e páginas legais/de exclusão.

## Operação segura

- TLS é obrigatório fora de localhost.
- Desative o fake em produção: `ALLOW_FAKE_PROVIDER_IN_PRODUCTION=false`.
- Não exponha PostgreSQL, worker, porta 9000 privada ou console 9001 à internet.
- Aplique migrations e backups com identidades separadas quando a plataforma permitir.
- Alerte para falhas de login, callbacks inválidos, jobs ambíguos e ausência de heartbeat.
- Atualize dependências com PR revisado e execute `pnpm audit --prod`; priorize HIGH/CRITICAL exploráveis.
- Teste restore; backup sem a chave de tokens não restaura a operação.

## Riscos residuais aceitos

- A sessão é stateless: não há revogação individual imediata além de invalidar/trocar o usuário ou rotacionar o segredo.
- Rate limit de login depende do IP encaminhado corretamente pelo proxy. O ingress deve remover valores enviados pelo cliente e definir `CF-Connecting-IP`, `X-Real-IP` ou o primeiro item de `X-Forwarded-For`; sem cabeçalho confiável, todos compartilham o bucket conservador `unknown`.
- A chave de tokens é única por ambiente e não usa KMS nesta versão.
- O painel é single-admin; não há RBAC granular nem multi-tenancy.
- `RECONCILIATION_REQUIRED` exige decisão humana porque a API não fornece garantia suficiente para retry cego.

Esses limites são compatíveis com o escopo interno inicial, mas devem ser reavaliados antes de ampliar usuários, organizações ou exposição pública.
