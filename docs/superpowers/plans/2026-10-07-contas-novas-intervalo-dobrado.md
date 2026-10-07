# Contas novas: intervalo dobrado, identificação e ações em lote

Data: 07/10/2026.

Status: implementação concluída em 07/10/2026. Migration 0023 gerada e validada em banco de teste dedicado. A atualização do banco do ambiente em uso e o deploy permanecem como etapas de aplicação da mudança.

Validação: 122 testes unitários, 47 testes de integração direcionados, fluxo E2E de classificação de 50 contas em desktop/mobile e E2E existente de automação passaram. Typecheck, lint e build de produção passaram. Os casos de concorrência, reconexão, remarcação, repetição e recuperação estão cobertos nos testes adicionados/atualizados.

## 1. Objetivo

Permitir marcar manualmente uma conta do Instagram como nova. Enquanto a marcação estiver ligada, os intervalos de publicação dessa conta nos loops serão multiplicados por dois. A lista de Contas deve mostrar a marcação, permitir filtrar contas novas e antigas e alterar várias contas em uma única ação.

Exemplo: um loop configurado para 50–60 minutos continua usando essa faixa para contas antigas. Contas novas no mesmo loop usam 100–120 minutos. Desmarcar a opção devolve a conta ao intervalo normal.

## 2. Regras de produto

| Tema | Comportamento definido |
| --- | --- |
| Classificação | Manual: nova quando a chave estiver ligada; antiga quando estiver desligada. |
| Local da configuração | Na conta, independentemente do loop ao qual pertence. |
| Multiplicador | Fixo em 2× nesta versão. |
| Contas existentes | Começam com a opção desligada, preservando a classificação atual. |
| Novas conexões ao sistema | Começam com a opção desligada; conectar uma conta não comprova sua idade no Instagram. O usuário pode marcar todas em lote. |
| Reconexão | Preserva a marcação existente. |
| Etiqueta | `Nova · intervalo 2×`, junto ao nome da conta. Some ao desmarcar. |
| Contas antigas na lista | Sem etiqueta adicional junto ao nome. Disponíveis no filtro Antigas. |
| Escopo de publicação | Apenas loops. Campanhas e escalas com horários definidos mantêm sua programação. |
| Regra por seguidores | Resolver primeiro a faixa aplicável; depois dobrar seus intervalos quando a conta for nova. |
| Limite diário | Manter o teto já definido pelo loop ou pela faixa de seguidores. Não dividir por dois. |
| Primeira publicação sem histórico de loop | Manter o início atual, com espaçamento entre contas. O multiplicador regula os intervalos entre publicações. |
| Pausa, retomada e recuperação | Respeitar o intervalo desde a última publicação concluída; retomar não libera publicação antecipada. |
| Mudança de loop | Preservar a marcação e considerar a última publicação concluída de loop da conta, mesmo que tenha ocorrido em outro loop. |
| Publicação em processamento | Termina normalmente. A próxima usa a nova configuração. |
| Alteração repetida para o mesmo valor | Não sortear um novo horário nem remarcar jobs quando a marcação não mudou. |

Os intervalos configurados atualmente aceitam até 1.440 minutos. A regra 2× pode produzir até 2.880 minutos; o cálculo deve aceitar esse resultado, sem truncar silenciosamente nem mudar os limites dos campos de configuração do loop.

## 3. Interface da lista de Contas

Manter a tabela atual, suas colunas e ações. Acrescentar uma coluna de seleção e a etiqueta junto ao nome.

| Selecionar | Conta | Status | Demais informações |
| --- | --- | --- | --- |
| ☐ | @conta01 — Nova · intervalo 2× | Conectada | Informações e ações atuais |
| ☐ | @conta02 — Nova · intervalo 2× | Conectada | Informações e ações atuais |
| ☐ | @conta03 | Conectada | Informações e ações atuais |

### Filtros

- Acrescentar um filtro independente `Tipo de conta`: Todas, Novas e Antigas.
- Usar um parâmetro próprio na URL, por exemplo `tipo=todas|novas|antigas`, sem substituir o filtro atual de status.
- Combinar classificação com busca, nicho/grupo e status.
- Mostrar contadores de novas e antigas considerando os outros filtros antes de aplicar a classificação.
- Preservar os parâmetros ao aplicar filtros, mudar status e retornar de uma ação.
- Trocar filtros limpa a seleção; nenhuma conta fora do resultado permanece selecionada.
- Valor desconhecido na URL deve cair em Todas.

### Seleção e ações

- Checkbox individual com nome acessível, por exemplo `Selecionar @conta01`.
- Checkbox no cabeçalho para selecionar todo o resultado filtrado. Exibir estado parcial quando apenas algumas contas estiverem selecionadas.
- Texto explícito: `Selecionar todas as 50 contas deste filtro`.
- A tela atual não tem paginação; selecionar todas abrange todo o resultado filtrado exibido.
- Quando houver seleção, mostrar a quantidade e os botões `Marcar como novas`, `Marcar como antigas` e `Limpar seleção`.
- Enviar os IDs selecionados e o valor final desejado. Não enviar uma ordem genérica para alterar todas as contas da organização.
- Desabilitar as ações enquanto a operação estiver sendo salva e impedir envio duplicado.
- Atualizar etiquetas, contadores e resultado somente após sucesso no servidor.
- Em erro, manter a classificação exibida e explicar que a operação não foi concluída.
- Após sucesso, limpar a seleção e manter os filtros.
- No filtro Novas, contas desmarcadas saem do resultado. Manter a mensagem de sucesso visível, inclusive quando o resultado ficar vazio.

Mensagens: `50 contas marcadas como novas`, `50 contas marcadas como antigas` ou `Nenhuma conta precisava ser alterada`. Em seleção mista, informar o número efetivamente alterado e, quando necessário, quantas já estavam na classificação desejada.

Não acrescentar uma confirmação extra para essa mudança reversível. A ação e a quantidade selecionada devem estar claras antes do clique.

### Detalhes da conta e loops

- Nos detalhes, acrescentar a opção `Conta nova — intervalo dobrado nos loops`, com texto curto explicando o efeito e um botão Salvar.
- Usar a mesma operação de servidor para uma conta ou várias contas.
- Mostrar a etiqueta na seleção de contas do editor de loops.
- Na visualização do loop, mostrar o intervalo efetivo de cada conta, inclusive quando a faixa de seguidores alterar o intervalo base.
- Reutilizar estilos, cores, mensagens e controles da aplicação. A etiqueta deve ser compreensível pelo texto, sem depender somente da cor.

## 4. Banco e operação de alteração

### Persistência

- Acrescentar `instagram_accounts.is_new_account`, booleano, obrigatório, com padrão `false`.
- Representar o campo como `isNewAccount` no schema Drizzle.
- Gerar a próxima migration com `pnpm db:generate`; revisar SQL, snapshot e journal. A última migration existente no levantamento é a 0022; não fixar a numeração se outro trabalho gerar uma migration antes.
- Não criar tabela de etiquetas, novo enum de status ou índice específico para um booleano nesta etapa. A consulta atual já carrega as contas da organização.
- Garantir que os caminhos de OAuth/reconexão não sobrescrevam a marcação existente.

### Serviço de servidor

Criar uma operação em `src/server/accounts.ts`, por exemplo `setAccountsNewStatus`, recebendo a organização, o usuário responsável, os IDs selecionados e o booleano desejado.

- Validar seleção não vazia, UUIDs e valor desejado; remover IDs repetidos.
- Obter a organização e o usuário pela sessão na Server Action, nunca por campos enviados pelo navegador.
- Confirmar que todas as contas existem e pertencem à organização. Se alguma for inválida ou de outro cliente, rejeitar o lote inteiro.
- Permitir classificar contas desconectadas: a marcação persiste, mas não torna uma conta disponível para publicar.
- Alterar somente contas cujo valor realmente mudou.
- Atualizar marcação, horários pendentes e auditoria na mesma transação. Uma falha deve desfazer o lote inteiro.
- Ordenar os bloqueios das contas e dos loops envolvidos de forma determinística e compatível com o fluxo de edição de loop existente. Não adquirir bloqueios de loop e conta em ordens opostas em caminhos que bloqueiam os dois.
- Revalidar a relação conta/loop dentro da transação, evitando usar um vínculo desatualizado se outra operação mover a conta.
- Registrar em `audit_logs` o valor anterior, o novo valor e os horários de jobs alterados, usando o padrão atual de auditoria.
- Retornar apenas as informações necessárias para a mensagem e a atualização da tela.

Adicionar uma Server Action em `src/app/actions.ts`. Autenticar com `requireAdmin`, validar com Zod, chamar o serviço e revalidar Contas, detalhes das contas afetadas, Loops e Fila. Preservar a URL de retorno interna e seus filtros usando o padrão existente de retorno seguro.

## 5. Agendamento e remarcação

### Cálculo comum

Estender `effectiveLoopLimits` em `src/server/automation.ts` para receber a marcação da conta:

1. Resolver os limites padrão ou por seguidores, como hoje.
2. Multiplicar mínimo e máximo por dois quando `isNewAccount` for verdadeiro.
3. Retornar o mesmo limite diário.

Usar esse cálculo tanto para agendar quanto para apresentar o intervalo efetivo na UI. Assim, o texto exibido e a regra aplicada partem da mesma função.

### Caminhos que devem respeitar a regra

- Agendamento após publicação concluída.
- Inclusão da conta em um loop.
- Retomada de loop pausado.
- Recuperação pelo `reconcileActiveLoops` quando não há job ativo.
- Remarcação após ligar ou desligar a chave.
- Mudança de loop, preservando o histórico de publicação da conta.

O código atual usa `completedAt` para espaçar a próxima publicação, mas pode agendar imediatamente em retomada/recuperação quando esse argumento não existe. Buscar a última publicação concluída de loop da conta nesses caminhos e aplicar o cálculo comum. Distinguir uma conta sem histórico de uma conta retomando trabalho.

O horário deve respeitar o intervalo real desde a publicação anterior e a abertura do próximo dia quando o limite diário foi atingido. A meia-noite não pode encurtar um intervalo ainda em andamento. Manter o fuso horário configurado da organização, com fallback atual para America/Sao_Paulo.

### Jobs já criados

| Situação | Tratamento ao mudar a marcação |
| --- | --- |
| `DRAFT` ou `QUEUED`, sem processamento iniciado | Recalcular somente o próximo job de loop daquela conta. |
| `RETRY_WAIT`, sem lease ativo | Ajustar o horário sem antecipar o prazo de repetição já determinado pelo worker/provedor. |
| `CLAIMED` até `PUBLISHING`, ou job com lease ativo | Não interferir na publicação atual. A próxima considera a nova marcação. |
| Publicado, falhou definitivamente, cancelado ou exige reconciliação | Preservar o histórico e o tratamento existente. |
| Loop pausado, encerrado, conta indisponível ou sem vínculo | Salvar a marcação sem iniciar ou reativar publicação. |

Não cancelar e recriar mídia ou avançar `used_media_ids` para ajustar apenas o horário. Preservar mídia, posição, tentativas, comentário automático e dados do container.

Ao remarcar:

- Recalcular a partir da última publicação concluída e sortear dentro da nova faixa efetiva. Nesta versão, não persistir um novo campo só para guardar o sorteio anterior.
- Se o novo horário já tiver passado, agendar um intervalo completo a partir do momento da alteração; não disparar imediatamente para compensar tempo perdido.
- Se não houver publicação anterior, preservar o início já definido para a primeira postagem.
- Para `RETRY_WAIT`, manter `next_attempt_at` igual ao maior valor entre o prazo existente de repetição e o novo horário permitido. O claim atual usa `next_attempt_at` para esses jobs.
- Atualizar `scheduled_at` e, quando aplicável, `next_attempt_at` na mesma transação.
- Usar condição de status e bloqueio de linha para tratar a disputa com o worker: se ele já reivindicou o job, a publicação é considerada em processamento e termina normalmente.
- Preservar a restrição existente de um job ativo por conta e loop.

Exemplos determinísticos para validação:

| Última publicação | Alteração | Intervalo fixo efetivo | Próxima publicação |
| --- | --- | --- | --- |
| 10:00 | Ligar às 10:20 | 120 min | 12:00 |
| 10:00 | Desligar às 10:30 | 60 min | 11:00 |
| 10:00 | Desligar às 11:10 | 60 min | 12:10, porque o prazo normal já passou |
| Sem histórico | Marcar antes da primeira publicação | 120 min entre publicações | Preservar o início definido; após concluir, esperar 120 min |

## 6. Arquivos previstos

| Arquivo | Mudança |
| --- | --- |
| `src/db/schema.ts` | Campo booleano na conta. |
| `db/migrations/<próxima>_*.sql` e `db/migrations/meta/` | Migration, snapshot e journal gerados. |
| `src/server/accounts.ts` | Serviço de marcação individual/em lote, transação e auditoria. |
| `src/server/automation.ts` | Intervalos efetivos, referência histórica e remarcação de pendentes. |
| `src/app/actions.ts` | Server Action, validação, mensagens e revalidação das páginas. |
| `src/app/(dashboard)/contas/page.tsx` | Campo nas consultas, etiqueta, filtro, contadores e seleção. |
| `src/components/account-bulk-selection.tsx` | Componente pequeno para seleção, quantidade e estado de envio. |
| `src/app/(dashboard)/contas/[id]/page.tsx` | Chave individual e explicação. |
| `src/app/(dashboard)/loops/page.tsx` | Marcações e intervalos efetivos por conta. |
| `src/components/loop-editor.tsx` | Etiqueta nas contas disponíveis para o loop. |
| `src/app/globals.css` | Ajustes pontuais para etiqueta e barra de ações. |
| `tests/unit/automation.test.ts` | Cálculo de intervalo e casos de tempo. |
| `tests/integration/automation.integration.test.ts` | Fila, remarcação, retomada e recuperação. |
| `tests/integration/account-classification.integration.test.ts` | Lote, isolamento entre clientes, auditoria e atomicidade. |
| `tests/integration/oauth-reconnect.integration.test.ts` | Preservação da marcação na reconexão. |
| `tests/e2e/account-classification.spec.ts` | Fluxo de UI com seleção e ações em lote. |

Manter SQL no servidor e limitar o componente client à interação necessária. Usar checkboxes e formulários nativos. A tabela já contém formulários individuais: a implementação do lote deve usar um formulário separado e associação pelo atributo `form`, evitando formulários aninhados.

Não é necessário criar uma nova tarefa periódica no worker ou alterar providers da Meta: a reconciliação existente deve chamar o cálculo corrigido. Se a implementação revelar necessidade de ajuste em `src/jobs/queue.ts`, limitar ao respeito dos horários de repetição e às condições existentes de claim; não redesenhar a fila.

## 7. Ordem de implementação

- [x] **Etapa 1 — Persistência:** adicionar o campo, gerar e revisar migration; verificar padrão desligado e preservação em reconexão.
- [x] **Etapa 2 — Regra de intervalo:** estender o cálculo existente e validar padrão, conta nova e faixa de seguidores.
- [x] **Etapa 3 — Agendamento completo:** tratar última publicação, limite diário, meia-noite, inclusão, retomada e reconciliação.
- [x] **Etapa 4 — Alteração transacional:** implementar classificação e remarcação no mesmo lote, com auditoria, autorização e proteção contra disputa com worker.
- [x] **Etapa 5 — Server Action:** conectar serviço à UI, tratar mensagens e preservar filtros.
- [x] **Etapa 6 — Lista de Contas:** acrescentar etiqueta, filtro independente, contadores, checkboxes e barra de ações.
- [x] **Etapa 7 — Detalhes e Loops:** disponibilizar a chave individual e exibir marcação/intervalo efetivo.
- [x] **Etapa 8 — Verificação:** executar os testes relevantes, conferir desktop/mobile e concluir revisão do diff.

Seguir as instruções de `AGENTS.md` e consultar os guias locais da versão instalada do Next antes de escrever código de páginas e actions. Já foram consultados no planejamento os guias `forms.md` e `server-actions.md`.

## 8. Testes e critérios de aceite

### Regra e fila

- [ ] Conta antiga continua usando o intervalo base; conta nova usa exatamente a faixa dobrada.
- [ ] Faixa por seguidores é resolvida antes do multiplicador; limite diário permanece igual.
- [ ] Intervalo de 1.440 minutos produz 2.880 para conta nova, sem truncamento.
- [ ] Ligar/desligar ajusta o próximo job permitido, mantendo sua mídia e seu histórico.
- [ ] Desligar após o prazo normal não gera publicação imediata.
- [ ] Repetição não é antecipada e o worker só consegue reivindicá-la no horário permitido.
- [ ] Jobs em processamento não são interrompidos; o seguinte usa a nova marcação.
- [ ] Pausa/retomada, reinício do worker, falha ao criar a próxima postagem e mudança de loop não encurtam o intervalo.
- [ ] Virada do dia e limite diário respeitam fuso e distância desde a publicação anterior.
- [ ] A alteração de uma conta não remarca contas não selecionadas nem jobs de campanhas/escalas.

### Lote e persistência

- [ ] Um lote de 50 contas pode ser marcado e desmarcado em uma ação.
- [ ] Seleção mista e IDs repetidos não produzem contagens incorretas nem remarcações desnecessárias.
- [ ] Lote com ID inválido ou de outro cliente não altera nenhuma conta.
- [ ] Falha na remarcação desfaz também a classificação e a auditoria da operação.
- [ ] Reconectar preserva a marcação; conta desconectada pode ser classificada sem voltar a publicar.
- [ ] Alteração concorrente com claim, edição de loop e agendamento não duplica jobs nem deixa a fila com uma regra desatualizada.

### Interface

- [ ] A etiqueta aparece ao marcar e some ao desmarcar.
- [ ] Novas/Antigas combina corretamente com status, busca e nicho.
- [ ] Selecionar todas afeta somente o resultado filtrado; seleção parcial aparece corretamente.
- [ ] Trocar filtros limpa a seleção; sucesso mantém os filtros e atualiza contadores.
- [ ] Desmarcar todas no filtro Novas mostra sucesso e estado vazio adequado.
- [ ] Ações funcionam por teclado, têm rótulos acessíveis e mostram estado de envio.
- [ ] Lista e barra de ações permanecem utilizáveis em desktop e celular, nos temas existentes.

### Execução de validação

Na implementação, executar primeiro os testes direcionados aos cenários alterados. Depois concluir typecheck, lint e build. Rodar a suíte unitária como verificação de regressão das funções compartilhadas.

```text
pnpm exec vitest run tests/unit/automation.test.ts
pnpm exec vitest run --config vitest.integration.config.mts tests/integration/automation.integration.test.ts tests/integration/account-classification.integration.test.ts tests/integration/oauth-reconnect.integration.test.ts
pnpm exec playwright test tests/e2e/account-classification.spec.ts tests/e2e/automation.spec.ts
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Integração e E2E devem usar o ambiente de teste dedicado conforme a configuração existente. Os testes destrutivos de integração exigem banco cujo nome termine em `_test`. Não executar migrations ou testes contra o banco de uso real para validar a feature.

## 9. Aplicação da mudança

Depois de implementar e validar, preparar a atualização conjunta do web e do worker. Aplicar a migration aditiva antes de iniciar o código que lê o novo campo, usando o procedimento de deploy existente.

Após a atualização, nenhuma conta passa automaticamente para nova. O usuário escolhe a classificação individualmente ou em lote. Verificar o fluxo em ambiente de teste com contas antigas e novas no mesmo loop e conferir os horários na Fila antes de aplicar a marcação a contas reais.

Para aplicar ao ambiente em uso, executar `pnpm db:migrate` antes de reiniciar web e worker com o novo código. A implementação e os testes não alteraram contas reais nem executaram deploy.

## 10. Escopo reservado para futuras solicitações

Prazo automático de maturação, multiplicadores configuráveis, progressão gradual de frequência, limite diário exclusivo para contas novas e novas regras para campanhas/escalas dependem de uma solicitação separada. A primeira versão entrega marcação manual, filtro, ações em lote e intervalo 2× nos loops.
