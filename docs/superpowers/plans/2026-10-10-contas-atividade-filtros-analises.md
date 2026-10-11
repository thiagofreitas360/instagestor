# Contas: vínculo com loops, tempo de atividade e filtros de análises

Data: 10/10/2026.

Status: implementação concluída e aplicada ao ambiente Docker local em 11/10/2026. Migration `0026_account_activity` aplicada; aplicação e worker atualizados e saudáveis.

Validação: 136 testes unitários, 104 testes de integração em banco dedicado, três fluxos E2E de contas/análises/classificação, typecheck, lint e build de produção passaram. A migration foi validada também em banco vazio. As telas foram conferidas em desktop/mobile e temas claro/escuro. A verificação final no ambiente local confirmou login, filtros de vínculo, coluna de atividade, pesquisa, loops e tratamento de filtro inválido.

## 1. Resultado esperado

- Em Contas, encontrar contas sem vínculo atual com nenhum loop.
- Em cada conta, identificar quando foi conectada, há quantos dias está ativa ou por quantos dias ficou ativa antes de ficar indisponível, desconectar ou ser marcada como banida.
- Em Análises, buscar contas por usuário ou nome e filtrar pelo loop inteligente.
- Aplicar o mesmo recorte aos indicadores, gráficos, ranking, mídias e avisos de sincronização.

Decisão confirmada pelo usuário: analisar o desempenho geral das contas atualmente vinculadas ao loop. A execução autorizada adotou o período ativo atual ou o último encerrado, preservando períodos anteriores na auditoria. Uma futura mudança para dias acumulados exige a adaptação da seção 10.

## 2. O que já existe e pode ser reaproveitado

| Recurso existente | Uso no plano |
| --- | --- |
| `loop_accounts` | Determinar vínculo atual. A restrição única já permite somente um loop por conta na organização. |
| `loops`, com estados ACTIVE e PAUSED | Popular o filtro, incluindo loops pausados. |
| `instagram_accounts.created_at` | Primeira conexão ao InstaGestor; permanece estável na reconexão e é usado pelo aquecimento. |
| `authorized_at` | Última autorização OAuth; também protege contra callbacks antigos da Meta. |
| `disconnected_at`, `banned_at` | Datas operacionais já registradas, usadas como referência para dados antigos. |
| `audit_logs` | Preservar o contexto de períodos encerrados sem criar outra tabela de histórico. |
| `loadAnalytics({ accountIds })` | Reaproveitar todos os cálculos a partir do conjunto filtrado de contas. |
| Formulários GET e parâmetros de URL | Manter filtros compartilháveis e recuperáveis ao navegar. |
| `formatDate`, componentes e CSS atuais | Exibir datas em português e manter a interface existente. |
| Vitest, PostgreSQL de testes e Playwright | Validar cálculos, persistência, isolamento entre clientes e navegação. |

Limitações identificadas: a reconexão atual atualiza `authorized_at` e apaga `disconnected_at` e `banned_at`; reautorizar uma conta já ativa também atualiza a autorização. Portanto, essa data sozinha não representa um período contínuo de atividade. O histórico de banidas calcula dias desde `created_at`, incluindo possíveis intervalos desconectados. Em Análises, escolher uma conta atualmente tem precedência sobre o grupo.

A documentação local de `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` foi consultada. Manter páginas de servidor e leitura assíncrona de `searchParams` conforme a versão instalada.

## 3. Regras de produto

### 3.1. Filtro Não vinculadas

- Significa ausência de vínculo **atual** em `loop_accounts`, independentemente do status da conta.
- Uma conta em loop pausado continua vinculada.
- Uma conta sem grupo, mas em um loop, não entra no resultado.
- Contas removidas de um loop, ou cujo loop foi excluído, entram no resultado.
- O filtro deve combinar com busca, nicho/grupo, novas/antigas, perfil de aquecimento e status.
- Adicionar um controle independente `Vínculo com loop`, com `Todas` e `Não vinculadas`. Usar `vinculo=nao_vinculadas`, sem ocupar o parâmetro de status `filtro`.

Essa interpretação atende à necessidade operacional de encontrar contas disponíveis para vinculação. Não significa que a conta nunca participou de um loop no passado.

### 3.2. Datas e dias de atividade

| Informação | Regra |
| --- | --- |
| Primeira conexão | Data de entrada da conta no InstaGestor, não a data de criação do perfil no Instagram. |
| Conexão do período | Início do período ativo atual, ou do último período encerrado. |
| Conta ativa | CONNECTED ou TOKEN_EXPIRING. |
| Dias ativa | Dias completos entre o início do período e o instante atual. |
| Conta encerrada | Mostrar duração congelada e data/motivo de término. |
| Reconexão após indisponibilidade | Abrir um novo período; manter o anterior na auditoria. |
| Reautorização enquanto ativa | Preservar o início do período, mesmo que `authorized_at` mude. |
| Renovação automática de token | Preservar o início do período. |
| Erro temporário de publicação ou sync | Não encerrar o período se a conta continuar disponível. |
| REAUTH_REQUIRED ou outro estado indisponível | Encerrar quando o sistema detectar a perda de disponibilidade; usar texto de indisponibilidade, sem classificar automaticamente como banimento. |
| Desmarcar banimento | Continuar desconectada e preservar o término anterior até a reconexão. |

Contar blocos completos de 24 horas, com zero dias antes das primeiras 24 horas. Exibir datas no fuso America/Sao_Paulo, reutilizando `formatDate`. A duração depende dos instantes, não da troca de dia no calendário. Não mostrar valores negativos ou números obtidos de datas inválidas.

Se a conta já estava desconectada e for marcada como banida posteriormente, registrar a data do banimento sem estender seu período ativo até essa data. Repetir uma ação ou um callback também não pode alterar o primeiro término.

Exemplo de apresentação na lista:

| Situação | Informação exibida |
| --- | --- |
| Conectada | Conectada em 01/10/2026 · Ativa há 9 dias |
| Desconectada | Conectada em 01/09/2026 · Ficou ativa 20 dias · Desconectada em 21/09/2026 |
| Banida | Conectada em 01/09/2026 · Ficou ativa 20 dias · Banida em 21/09/2026 |
| Reconectada | Reconectada em 08/10/2026 · Ativa há 2 dias; primeira conexão e período anterior nos detalhes |

Os exemplos pressupõem o mesmo horário de início e fim. Para períodos inferiores a 24 horas, usar `Menos de 1 dia`.

### 3.3. Pesquisa e loop em Análises

- Campo de busca com lupa, rótulo acessível `Buscar conta` e placeholder `@usuário ou nome`.
- Busca parcial em `username` e `display_name`, ignorando maiúsculas, espaços nas pontas e um `@` inicial.
- Aplicar com Enter ou o botão existente; sem introduzir autocomplete ou busca a cada tecla nesta entrega.
- Novo seletor `Loop inteligente`: `Todos os loops` e os loops da organização, identificando os pausados.
- Selecionar um loop recorta as contas vinculadas atualmente, incluindo as indisponíveis que possuam dados históricos elegíveis.
- Combinar pesquisa, conta, grupo e loop por interseção. Uma conta fora do loop/grupo selecionado gera resultado vazio, sem descartar filtros silenciosamente.
- Preservar período, tipo de mídia e ordenações na navegação e nos formulários.
- Sem resultados, informar `Nenhuma conta encontrada para esses filtros`; distinguir esse caso da ausência de insights ou de permissão.

O recorte por loop representa o desempenho geral dessas contas no período, incluindo publicações manuais. Uma conta transferida traz seu histórico para o recorte do loop atual. Não atribuir esse resultado exclusivamente à estratégia do loop.

## 4. Implementação dos dados de atividade

### 4.1. Schema e migration

Adicionar dois timestamps com fuso em `instagram_accounts`: `active_started_at` e `active_ended_at`. Eles representam o período atual ou o último encerrado. Acrescentar `active_timing_estimated` para preservar a indicação de estimativa mesmo quando uma reautorização copia a data legada para o início do período. Manter `created_at`, `authorized_at`, `disconnected_at` e `banned_at` com suas finalidades existentes.

- Campos inicialmente anuláveis para admitir histórico legado incompleto.
- Validar que o término não precede o início quando ambos existirem.
- Novas conexões reais, contas fake e seed devem gravar o início explicitamente.
- Gerar a próxima migration Drizzle conforme o journal vigente, incluindo seus metadados.
- Não alterar migrations já aplicadas.
- Manter os timestamps nulos nas contas existentes e apresentar o cálculo com as datas legadas como `estimado`. Definir o default de início com `now()` somente depois de adicionar a coluna, para não preencher retrospectivamente as contas antigas com a data da migration. Novos inserts e o cálculo na leitura usam o relógio do PostgreSQL.
- Se não existir uma data de término confiável para conta indisponível, exibir `Tempo ativo indisponível`; não continuar contando até hoje.

Os dois campos evitam reutilizar a data de autorização, que tem uma função de segurança, e a data operacional de desconexão, que pode mudar em ações posteriores. Não armazenar um contador de dias atualizado diariamente: calcular a duração na leitura.

### 4.2. Atualizações de estado

Atualizar os seguintes caminhos, dentro das transações e condições de concorrência existentes:

| Caminho | Alteração necessária |
| --- | --- |
| `connectFromAuthorizationCode` | Iniciar período na primeira conexão ou na volta de uma conta indisponível; preservar início se já ativa. |
| `createFakeAccounts` e seed | Preencher início e permitir fixtures coerentes. |
| `disconnectAccount` | Encerrar somente um período aberto; preservar término anterior em repetição. |
| `banAccount` | Encerrar se ainda aberto; registrar snapshot de duração sem contar dias já desconectados. |
| `unbanAccount` | Preservar período encerrado ao remover a marcação de banimento. |
| `deauthorizeBySignedRequest` | Encerrar após a validação atual de callback; ignorados ou repetidos não alteram datas. |
| `markAccountUnavailableIfCurrent` | Encerrar somente quando a mudança condicional de estado realmente ocorrer. |
| `verifyAccount` | Abrir período ao recuperar efetivamente uma conta indisponível; verificações de conta ativa preservam o início. |
| `refreshExpiringTokens` | Preservar o período quando alternar entre TOKEN_EXPIRING e CONNECTED. |
| `deleteDataBySignedRequest` | Limpar os novos campos e metadados associados conforme o fluxo de exclusão, sem reconstituir histórico de conta anonimizada. |

`markAccountUnavailableIfCurrent` já é utilizado pela fila, comentários automáticos, manutenção de tokens, verificação e sincronização de insights. Corrigir nesse ponto compartilhado evita repetir a regra em cada worker. Preservar as comparações de token/status, locks, tratamento de jobs e proteções contra callbacks anteriores à reconexão.

### 4.3. Histórico e cálculo

- Acrescentar início, término, duração e indicação de estimativa aos metadados dos eventos de encerramento existentes. Registrar a indisponibilidade na auditoria quando ainda não houver evento correspondente.
- Gravar mudança de estado e snapshot na mesma transação. Não guardar tokens nos metadados.
- Reaproveitar o snapshot para mostrar o último período anterior nos detalhes, sem construir uma nova tela de histórico.
- Criar uma única função pequena para calcular duração, tratar datas recebidas como `Date` ou string e indicar ausência/estimativa. Reutilizá-la na lista e nos detalhes.
- No histórico de banidas, distinguir os atuais `Dias de vida` desde a primeira conexão dos novos `Dias ativos` do período. Acrescentar estes últimos a partir do snapshot; não mudar silenciosamente o significado do indicador antigo.
- Não reconstruir números exatos de períodos antigos incompletos nem incluir estimativas numa média identificada como exata.

## 5. Implementação da aba Contas

Arquivo principal: `src/app/(dashboard)/contas/page.tsx`.

1. Estender os tipos e SELECT com as datas de atividade e um booleano de vínculo obtido por `EXISTS` em `loop_accounts`, sempre limitado à organização.
2. Usar o índice único existente de organização/conta; não criar uma consulta por linha nem juntar loops aos jobs de forma que multiplique agregações.
3. Adicionar o parâmetro e controle de vínculo, aplicando-o junto aos demais filtros.
4. Preservar o parâmetro nos links de status, formulários, `returnTo` e chave da seleção em lote. Trocar o resultado deve limpar a seleção, como já acontece.
5. Acrescentar uma coluna compacta `Conexão / atividade` com data, duração e término quando houver.
6. Atualizar `src/app/(dashboard)/contas/[id]/page.tsx` com primeira conexão, período atual/último, datas de término e último período anterior disponível.
7. Adaptar rótulos da tabela para mobile e verificar legibilidade nos temas claro e escuro.

Aceite: com três contas — uma sem loop, uma em loop ativo e outra em loop pausado — `Não vinculadas` retorna apenas a primeira. Remover seu vínculo deve atualizar o resultado na próxima leitura.

## 6. Implementação da aba Análises

Arquivo principal: `src/app/(dashboard)/analises/page.tsx`.

1. Adicionar `busca` e `loop` ao tratamento de parâmetros e ao `buildHref`/objeto base.
2. Validar UUID e existência do loop na organização. Loop inexistente ou alheio deve gerar filtro inválido, sem retornar silenciosamente Todas.
3. Consultar loops ativos/pausados e resolver uma única lista de contas elegíveis para a interseção dos filtros. Usar SQL parametrizado e preservar os critérios atuais de elegibilidade para análises.
4. Enviar a lista final para `loadAnalytics`. Usar `null` somente na ausência real de filtros; usar `[]` para resultado vazio, evitando consultar todas as contas por engano.
5. Reaproveitar o serviço para totais, período anterior, gráficos, ranking, mídias, sincronização e avisos. Não reimplementar suas agregações.
6. Ajustar a precedência atual entre conta e grupo para a interseção definida; preservar o contexto ao abrir uma conta no ranking.
7. Incluir lupa em SVG simples e texto/rótulo acessível. O ícone decorativo deve ficar oculto do leitor de tela.
8. Preservar `tipo`, `ordem` e `ordem_midia` como campos ocultos no formulário GET quando necessário; hoje esse formulário não leva todas essas escolhas.
9. Preservar o recorte no retorno de `Atualizar agora`. Manter a abrangência atual da sincronização: ela continua por conta selecionada ou por organização, com mensagem explícita da quantidade solicitada; o filtro define a exibição.

Exemplo de URL: `/analises?periodo=30&loop=<uuid>&grupo=<uuid>&busca=loja`.

Para analisar viralização, reaproveitar visualizações, alcance, crescimento de seguidores, compartilhamentos e salvamentos já disponíveis. Comparar loops no mesmo período e ordenar contas/mídias pelas métricas existentes. Esta entrega permite alternar o loop; não exige um painel paralelo nem uma pontuação nova de viralização. Quantidade de contas e volume de posts influenciam os totais.

## 7. Arquivos, consumidores e fixtures envolvidos

| Área | Arquivos ou consumidores |
| --- | --- |
| Dados | `src/db/schema.ts`, próxima migration e metadados em `db/migrations`. |
| Ciclo de atividade | `src/server/accounts.ts`, `src/jobs/account-availability.ts`, verificação do caminho de renovação em `src/jobs/token-maintenance.ts`. |
| Consumidores dos estados | Fila, comentários automáticos e insights; reaproveitam o ponto compartilhado de indisponibilidade. |
| Contas | Lista e detalhes em `src/app/(dashboard)/contas`. |
| Análises | Página principal, `src/server/analytics.ts` para snapshots de banimento e `analises/banidas/page.tsx`. |
| Interface | `src/app/globals.css` apenas para ajustes necessários; reutilizar `src/components/ui.tsx` e seleção em lote. |
| Ações e callbacks | Verificar `src/app/actions.ts` e rotas Meta/OAuth; alterar somente se necessário para contratos ou retornos. |
| Testes e fixtures | Helpers de integração/E2E, fixtures de datas, `scripts/seed.ts`, testes de analytics, reconexão, banimento, callbacks e classificação. |
| Documentação | Este plano e descrição dos novos campos em `docs/DATABASE.md`. |

`loadAnalytics` também é chamado nos detalhes da conta e nos testes de multitenancy. Preservar sua interface de `accountIds` evita mudanças desnecessárias nesses consumidores. Não há necessidade de nova dependência, API de busca ou mudança no agendamento dos loops.

## 8. Validação e critérios de aceite

### Testes unitários de duração

- Mesma hora: menos de um dia; 24 horas completas: um dia.
- Período aberto cresce com o relógio; encerrado mantém a duração.
- Datas inválidas, início futuro, término anterior e dados ausentes não produzem valores negativos/NaN.
- Datas como string ou `Date` produzem o mesmo resultado.
- Cruzar meia-noite local sem completar 24 horas não acrescenta um dia.

### Integração com PostgreSQL

- Primeira conexão, desconexão, banimento e reconexão preservam corretamente cada período.
- Reautorizar conta ativa ou renovar token não reinicia a contagem.
- Repetir desconexão/callback, banir conta já desconectada e desmarcar banimento não estendem atividade.
- Falha antiga do worker ou callback anterior ao novo OAuth não encerra a conexão atual.
- Falha temporária de insights não encerra atividade; perda efetiva de autorização encerra.
- Snapshots sobrevivem à reconexão; registros legados ficam identificados como estimados ou incompletos.
- Busca e filtro de loop retornam a interseção esperada, inclusive loop/grupo vazio e conta desconectada com histórico elegível.
- Nenhum filtro inclui contas ou métricas de outra organização.
- Totais filtrados correspondem à soma das contas esperadas; lista vazia nunca vira agregado geral.
- Exclusão de dados remove os novos registros pessoais de atividade.

### E2E e interface

- Não vinculadas combina com busca, nicho, perfil, classificação e status; loop pausado não entra.
- Seleção em lote considera apenas o resultado atual e preserva filtros ao retornar da ação.
- Lupa, Enter, seletor de loop e retorno de navegação funcionam por teclado.
- Filtros permanecem ao alterar período, ranking, tipo/ordem de mídia e solicitar sincronização.
- Indicadores, gráficos, ranking e mídias mostram o mesmo recorte.
- Estados vazios e filtros inválidos apresentam mensagens específicas.
- Datas e durações são legíveis em desktop/mobile e nos dois temas.

Executar testes direcionados, `pnpm typecheck`, `pnpm lint` e `pnpm build`. Usar exclusivamente banco dedicado de testes para integração/E2E, respeitando a proteção existente que exige nome terminado em `_test`. Não rodar essas suítes contra o banco do ambiente em uso.

## 9. Ordem de execução e entrega

1. **Dados de atividade:** schema, migration aditiva, cálculo compartilhado, updates de estado, snapshots e fixtures. Entrega: períodos persistidos sem perder o histórico nem alterar a segurança OAuth.
2. **Contas:** Não vinculadas, coluna de atividade e detalhes. Entrega: encontrar contas livres e ver duração aberta ou congelada.
3. **Análises:** busca com lupa, seletor de loops e interseção completa. Entrega: recorte consistente em toda a tela.
4. **Validação:** testes direcionados, regressões existentes relacionadas, verificação de interface, typecheck, lint e build.
5. **Aplicação:** validar migration em cópia/banco de testes; aplicar migration antes do código que lê os novos campos; atualizar web e worker juntos para que todos os caminhos registrem atividade.

A migration mantém os campos antigos, permitindo reverter o código sem remover colunas ou histórico. O período entre migration e atualização dos processos continua atendido pelo tratamento de dados legados.

Considerar concluído somente quando os quatro recursos funcionarem juntos, as ações de estado mantiverem as datas corretas e os testes de isolamento/reconexão passarem. Prazo depende da definição da contagem de dias e da disponibilidade do ambiente de testes; não foi estimado sem executar a implementação.

## 10. Adaptações se as premissas mudarem

**Dias acumulados:** somar os intervalos encerrados e o intervalo atual, sem incluir lacunas desconectadas. Nesse caso, usar uma tabela própria de períodos por conta, com organização, início, fim e motivo, em lugar de depender de auditoria para um indicador central. Não somar desde `created_at`. O acumulado antigo pode permanecer incompleto.

**Somente posts publicados pelo loop:** filtrar `account_media.published_job_id` pelo job e sua origem de loop. Seguidores e métricas diárias da conta não podem ser atribuídos exclusivamente ao loop e precisam ficar identificados como contexto geral. A exclusão atual do loop zera `publication_jobs.loop_id`; preservar a origem, por campanha/snapshot e identificação do loop, passa a ser parte necessária dessa variante. Não basta filtrar a associação atual de contas.

**Atribuição histórica das contas ao loop vigente em cada dia:** exige guardar intervalos de vínculo, porque `loop_accounts` contém apenas o vínculo atual. Não faz parte da versão proposta.

## 11. Limites desta etapa

A implementação e a atualização do ambiente local foram concluídas. Não houve deploy remoto nem teste com publicação real na Meta. Dados antigos sem histórico completo permanecem estimados ou sem duração disponível. Não inclui novos gráficos, classificação automática de viralização, comparação simultânea de vários loops ou reconstrução exata de histórico que não foi registrado.
