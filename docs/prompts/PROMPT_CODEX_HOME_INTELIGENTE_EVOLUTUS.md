# Codex — Implementar Home Inteligente V4 do Evolutus

## Objetivo

**Implemente integralmente** a evolução da Home Inteligente do Evolutus. Resolva a falha na qual, após o usuário **concluir a ficha "Treino A - Peito + Tríceps"**, a Home continua apresentando a própria ficha A como a próxima recomendação do dia.

O resultado deve ser **correto, determinístico, seguro, econômico em consultas ao Supabase e leve em celulares modestos**. Não se limite a mudar textos, ordenar fichas de outra maneira ou esconder a ficha por `last_date === today`: o sistema precisa distinguir **ficha não iniciada, em andamento e realmente concluída**.

**Trabalhe no repositório atual**, não em uma implementação hipotética. Analise a arquitetura antes de editar, implemente código, migrations e testes, execute os gates possíveis e entregue um PR revisável. Não execute migrations nem deploy em produção sem autorização explícita. Não solicite esclarecimentos desnecessários: examine o projeto e decida tecnicamente com base nas regras abaixo.

## 1. Contexto confirmado no snapshot analisado

- `src/features/home/recommendSheet.js`: motor atual escolhe primeiro uma ficha programada para hoje e usa `lastDate` como atividade; mesmo depois de registrar atividade hoje, pode recomendar a mesma ficha.
- `src/features/home/useSheetInsights.js`: consulta `get_my_sheet_insights()` via `useCachedQuery`; cache por usuário/dia e observação de invalidação.
- `src/features/home/RecommendedSheetPanel.jsx`: hero, CTA "Iniciar ficha", informação da última atividade e cartões auxiliares.
- `src/pages/NewWorkout.jsx`: recebe `?ficha=<uuid>`, usa `runFinishWorkout`, sincroniza pendências e redireciona para `/historico` em `outcome === 'done'`.
- `src/utils/finishWorkout.js`: trata a execução de `completeSession()` sem inspecionar seu resultado estruturado. A RPC pode retornar `{ reason: 'not_enough_activity', awardedCoins: 0 }` **sem erro**, mas o cliente considera conclusão bem-sucedida.
- `src/services/economyService.js`: `completeWorkoutSession()` chama `complete_workout_session()`.
- `supabase/migrations/20261009000006_evocoins_workout_completion.sql`: conclusão diária de EvoCoins verifica esforço no servidor; **não conhece a ficha individual**.
- `supabase/migrations/20261123000001_workout_sheet_attribution.sql`: coluna `workouts.sheet_id` imutável, FK composta `(sheet_id, user_id)`, índice parcial e RPC `get_my_sheet_insights()`; esta agrega dias do histórico todo para obter o último registro e o total mensal.
- `src/services/workoutsService.js`: inserts online registram `sheet_id`, mas novos registros que passam pela outbox offline perdem essa associação.
- `src/services/offline/outbox.js`, `src/services/offline/syncScheduler.js` e RPCs `private.apply_workout_mutation` / `public.sync_workout_mutations`: protocolo de sincronização idempotente com allowlist estrita; mudanças aqui exigem compatibilidade.
- `src/utils/pageCache.js`, `src/hooks/useCachedQuery.js`: cache de cinco minutos, deduplicação de consultas e invalidação após mutações, incluindo outras abas.
- `src/pages/Dashboard.jsx`: `warmDialogChunks()` pré-carrega três diálogos no idle, consumindo tráfego/memória mesmo quando eles não são abertos.
- `src/features/home/useDailyBanner.js`, `src/utils/businessDate.js`, `src/hooks/useGreetingClock.js`: já existe lógica de dia de negócio em `America/Sao_Paulo`; não introduza relógios concorrentes nem polling.
- Referências de teste e observabilidade: `src/features/home/*.test.js`, `src/services/offline/*.test.js`, `src/hooks/useCachedQuery.test.js`, `supabase/tests/home_sheet_insights_test.sql`, `supabase/tests/workout_sheet_attribution_test.sql`, `supabase/tests/offline_workout_sync_test.sql`, `scripts/home-v2-browser-smoke.mjs`, `scripts/home-v2-sql-evidence.mjs` e workflow `.github/workflows/supabase-tests.yml`.

**Importante:** esses caminhos e comportamentos são do snapshot fornecido. Confirme a versão/estrutura real da branch antes de editar. Se já houve mudanças, adapte sem sobrescrever melhorias recentes.

## 2. Regras de negócio obrigatórias

Defina formalmente um estado para cada ficha elegível, na data de negócio:

1. `not_started`: nenhuma atividade atribuída à ficha hoje e nenhuma conclusão registrada hoje.
2. `in_progress`: há registro persistido para a ficha hoje, porém nenhuma conclusão validada. Atividade **não equivale a conclusão**.
3. `completed`: houve ação explícita de finalizar **esta ficha**, confirmada e persistida pelo servidor para o dia de negócio.
4. `unavailable`: ficha arquivada, vazia, com exercícios indisponíveis ou não acessível. Nunca recomendá-la para iniciar.

Não trate o retorno de EvoCoins, a quantidade de moedas, a existência de séries ou a simples visita à página como prova isolada de conclusão. Não invente conclusões retroativas para histórico anterior a esta implementação. Preserve historicamente a distinção entre "última ficha utilizada" e "última ficha concluída"; exiba apenas métricas que o banco realmente consegue comprovar.

### Ordem determinística de recomendação

1. **Em andamento hoje:** priorizar a continuidade de uma ficha iniciada e não concluída, observando primeiro as programadas para hoje. Se houver múltiplas, desempatar de modo estável e documentado.
2. **Programadas hoje, ainda não concluídas:** escolher a próxima elegível por histórico, atraso e ordem estável, mantendo o comportamento útil existente.
3. **Nada pendente hoje:** determinar a **próxima ocorrência futura** das fichas agendadas, levando em conta que a ocorrência de hoje foi cumprida. Recomendar a data cronologicamente mais próxima; nunca repetir uma ficha como "próximo treino de hoje" quando sua ocorrência de hoje já foi concluída.
4. **Sem agenda definida:** recomendar ficha elegível não concluída hoje por critério determinístico de recência/ordem; não forçar repetição de uma ficha já concluída hoje enquanto existir outra opção.
5. **Tudo concluído ou sem opção elegível:** mostrar estado explícito de "Treinos de hoje concluídos" e/ou "Próximo treino em [dia/data]", conforme o calendário real. Sem CTA "Iniciar ficha" incoerente. Se não houver próxima ficha, mostrar caminho adequado para gerenciar fichas.

Não usar aleatoriedade, IA generativa, polling, novos serviços externos nem cálculos custosos durante renderização. Preservar critério estável em empates (agenda, recência, `sort_order`, `id`). Não impor dias de descanso inexistentes na configuração: apenas indicar corretamente quando o próximo treino está agendado.

### Exemplo obrigatório

Em **segunda-feira, 26/10/2026**, com **Treino A** programado seg/qua/sex e **Treino B** ter/qui/sáb:

- Antes de A iniciar: recomendar A para hoje.
- Durante A, após registrar exercícios: "Continuar Treino A".
- Ao finalizar A com sucesso validado: **não** recomendar A novamente para hoje; exibir **Treino B — terça-feira, 27/10/2026** como próximo agendado.
- Na terça-feira: recomendar B para hoje, salvo se já estiver concluído.
- Se apenas A existir: indicar a próxima ocorrência real de A (quarta-feira), e não fingir que ele precisa ser repetido hoje.
- Se A teve séries registradas, mas a finalização não ocorreu ou foi rejeitada: **não** marcar A como concluído.

## 3. Persistência da conclusão por ficha (servidor é a autoridade)

Implemente uma solução **aditiva e simples** no PostgreSQL; a abordagem recomendada é uma tabela pequena, como `workout_sheet_completions`, com, no mínimo:

- `user_id`, `sheet_id`, `business_day`, `completed_at` (data/hora do servidor);
- unicidade `(user_id, sheet_id, business_day)`;
- vínculo seguro com a ficha do **mesmo usuário**, índices somente para consultas necessárias e limpeza consistente na exclusão de conta;
- RLS habilitado e **sem INSERT/UPDATE/DELETE direto por clientes**. Escrita apenas via RPC validada; leitura apenas pelo próprio usuário ou pela RPC de resumo.

Crie uma RPC autenticada para finalizar a ficha, com `p_sheet_id` como argumento e **usuário e dia determinados no servidor**, reutilizando `private.sheet_actor()`, `private.sp_today()` e as regras reais de acesso/sessão. A RPC deve:

- validar titularidade, disponibilidade aplicável e existência de **atividade efetivamente persistida, datada de hoje e atribuída àquela ficha**, sem aceitar IDs de outro usuário;
- não aceitar do cliente flags de conclusão, horário arbitrário, valor de moedas ou esforço declarado;
- preservar o critério atual de esforço mínimo para a conclusão diária e as regras de EvoCoins. Preferir uma transação atômica que combine a validação e conclusão da ficha com a chamada segura da funcionalidade existente de conclusão/recompensa; **não duplicar o motor econômico**;
- distinguir `not_enough_activity` de um resultado realmente concluído, mesmo quando o retorno da RPC não lança exceção;
- permitir conclusão válida com `awardedCoins = 0` caso a recompensa já tenha sido concedida ou o limite diário esteja esgotado (não confundir falta de moedas com falha);
- ser idempotente sob clique duplo, resposta perdida, repetição, duas abas e requisições simultâneas; a mesma ficha/dia não pode gerar duas conclusões nem pagamento extra;
- retornar um contrato tipado/estável, por exemplo `completed`, `already_completed`, `insufficient_activity`, `not_allowed`, com metadados estritamente necessários;
- manter compatibilidade da RPC existente de treino livre e de clientes antigos; evitar substituir a API global por algo que quebre outros chamadores.

**Definição de esforço:** não imponha a obrigatoriedade de registrar cada exercício planejado sem especificação prévia do produto. A ação explícita de finalizar, a comprovação de registros atribuídos à ficha e os critérios atuais do servidor são a base de conclusão. Documente esse contrato e teste que atividade em **outra ficha** ou apenas histórico antigo não conclui a ficha selecionada.

Se a conclusão gravar mas a resposta se perder, o retry precisa reconhecer o fato, sem erro duplicado e sem pagamento duplicado. Se houver falha em qualquer etapa da transação, nenhum estado parcial incoerente deve persistir.

Todas as mudanças SQL devem estar em **novas migrations** em ordem lexicográfica posterior às existentes, sem editar migrations já aplicadas. Evitar `DROP`, renomeações destrutivas, backfill especulativo e mudanças de RLS de outros módulos. Examinar locks e concorrência; manter `SECURITY DEFINER` com `search_path` seguro, privilégios mínimos e revogações explícitas.

## 4. Fluxo de finalização no frontend

Corrija de ponta a ponta `NewWorkout.jsx`, `finishWorkout.js`, chamadas de serviço e estados de erro:

- Quando a página estiver no contexto `?ficha=...`, finalizar **a ficha correta** via novo contrato do servidor; no treino livre, manter fluxo e regras existentes.
- Antes de finalizar, sincronizar registros relevantes do dia; registrar claramente o que está pendente, com erro ou sem conexão. Nunca declarar sucesso baseado só na gravação local.
- **Nunca navegar para `/historico`** se o servidor retornar `not_enough_activity`, `insufficient_activity`, rejeição, falha, offline ou pendências.
- Em sucesso/`already_completed`, limpar apenas o cache relevante, refletir a conclusão na Home sem reload manual e preservar a navegação de retorno.
- Exibir mensagens curtas e corretas para: sem atividade suficiente, offline, sync pendente, conflito, ficha inválida e erro inesperado. Não exibir `undefined` em toasts.
- Bloquear cliques duplicados por estado/ref; em erro, liberar o botão para retry; não deixar o formulário eternamente travado.
- Não alterar saldo, emissão, limites, idempotência nem eventos de EvoCoins por atalhos do cliente.

## 5. Home Inteligente e UX

Atualize `recommendSheet.js`, `useSheetInsights.js`, `RecommendedSheetPanel.jsx` e componentes necessários, **preservando o visual atual da Home** (foto responsiva, gradiente, layout desktop/mobile, cartões, acessibilidade e temas).

Exibir:

- **Não iniciado:** "Iniciar ficha".
- **Em andamento:** "Continuar ficha" e indicação discreta de atividade salva (sem dizer que concluiu).
- **Concluído:** confirmação inequívoca "Treino de hoje concluído"; recomendação futura com data correta e CTA que não induza a repetir o treino de hoje.
- **Próximo dia:** texto "Próximo treino: terça-feira" / data absoluta conforme contexto, distinguindo "hoje" de "amanhã".
- **Sem fichas ou fichas indisponíveis:** estados vazios já existentes, adaptados ao novo algoritmo.
- **Offline:** não inventar conclusão; se houver resumo confiável do usuário/dia no cache existente, pode exibir como **última informação conhecida** com aviso de desatualização; sem cache, manter fallback simples e funcional. Não adicionar uma segunda fonte de verdade local.

Os cartões auxiliares devem continuar distinguindo **atividade** de **conclusão**. Só renomeie métricas para "concluídas" se seus dados forem de fato eventos de conclusão persistidos. Não perder a possibilidade de acessar uma ficha concluída pela lista de fichas, mesmo que ela não seja a recomendação do dia.

Regra de troca de dia: a Home aberta durante a meia-noite de `America/Sao_Paulo` atualiza os estados e a recomendação no evento de virada já existente, sem timer redundante ou polling. Evitar conteúdo de outro usuário em logout/troca de conta. Erro transitório não deve provocar tempestade de requests.

## 6. Banco de dados: economizar CPU, I/O e tráfego

Revisar `get_my_sheet_insights()` com execução e plano reais.

- Manter **uma única RPC de resumo** para a Home; incluir nela, quando necessário, o estado de conclusão hoje e dados mínimos para decidir próximos agendamentos. Nunca usar uma consulta por ficha ou transferir registros brutos para o browser.
- Otimizar separadamente a busca da **última atividade histórica** e a contagem dos **dias distintos do mês corrente**. A implementação atual agrupa todo o histórico por ficha/data; procure um plano mais barato com índices e filtros adequados, preservando precisão.
- Respeitar limite existente de 40 fichas ativas e candidatos históricos, sem excluir indevidamente fichas arquivadas dos cartões de atividade. Verificar semântica dos casos com muita história e poucas fichas.
- Usar `EXPLAIN (ANALYZE, BUFFERS)` na instância de teste, comparando antes/depois com massa representativa (ex.: 2 mil e 10 mil registros por usuário, fichas variadas), e registrar leituras, tempo/plano e tamanho do payload. **Não afirmar ganho sem medição**.
- Índices devem ter justificativa pelo plano. Evitar índices redundantes, triggers desnecessários, funções executadas linha a linha sem necessidade, scans globais e agregações históricas completas a cada acesso.
- Não cachear autorização/RLS no cliente. Continuar validando permissões em operações sensíveis.
- Preservar separação e segurança entre usuários; testar usuários com muitos registros, mês sem atividade, primeiro acesso, ficha removida/arquivada e troca de mês.

## 7. Cache, renderização e celulares fracos

- Reutilizar `useCachedQuery`, `pageCache` e eventos atuais; manter deduplicação e invalidação após conclusão, alterações de ficha, criação/edição/exclusão de registros, ACK de sincronização, troca de conta e troca de dia.
- Evitar refetch em loop por mudança de estado, múltiplas invalidações para o mesmo evento, renderizações em cascata e refresh a cada navegação quando cache válido.
- Preservar o cálculo do recomendador como função **pura**, rápida, com `useMemo` apenas onde trouxer benefício comprovável. Não adicionar dependências pesadas.
- Examinar `warmDialogChunks()` em `Dashboard.jsx`: **não baixar automaticamente os três diálogos pesados em conexões/aparelhos restritos**; preferir import sob demanda e eventual pré-carregamento seletivo condicionado a intenção do usuário ou sinais confiáveis de rede/economia de dados. Não usar detecção frágil de modelo do celular.
- Preservar imagens `AVIF/WebP`, `srcset/sizes` e rotação determinística diária; verificar dimensões, prioridades e impacto de decode/carga na primeira dobra sem degradar a composição visual.
- Medir bundle e interações no browser com CPU limitada, mobile e tema claro/escuro. Não elevar limites de budget para fazer CI passar; corrigir regressões introduzidas.
- Não introduzir polling, WebSockets, listeners globais sem cleanup, intervalos permanentes, armazenamento local redundante ou processamento O(n) sobre histórico bruto no navegador.

## 8. Offline e sincronização: preservar dados e associação à ficha

Existe uma limitação conhecida: inserções criadas offline entram na outbox sem `sheet_id` e perdem vínculo ao serem sincronizadas. **Investigue e corrija essa limitação dentro desta entrega**, sem fragilizar o sistema.

- Levar a identidade da ficha para a **criação** de registros offline e seu ACK, preservando a associação na representação local, na compactação e na reconciliação.
- Evoluir em conjunto os contratos permitidos da outbox, `private.apply_workout_mutation` / `sync_workout_mutations`, validação server-side, receipts e testes, se necessário. **Nunca** confiar no `sheet_id` de um usuário como autorização; usar as validações de titularidade, disponibilidade e pertinência do exercício já existentes.
- Preservar imutabilidade do `sheet_id` após INSERT, FK composta e proteções de exercícios do catálogo. Updates/deletes offline não podem trocar ou forjar associação.
- Manter leitura e processamento de mutações emitidas por clientes antigos, inclusive sem `sheet_id`, sem reclassificá-las como mutações inválidas. O protocolo deve ser backward-compatible ou ter migração de dados local rigorosamente testada.
- Garantir mesmo UUID/idempotência, deduplicação por `mutation_id`, ACK perdido, conflito de versões, rollback e isolamento de usuário. Pendências nunca devem desaparecer sem ACK ou descarte explícito.
- Se uma ficha ficar arquivada ou inválida durante a desconexão, **não descartar silenciosamente o treino**: manter os registros locais e um erro recuperável/visível, ou aplicar fallback sem vínculo somente se houver uma regra segura, explícita e testada que não falseie os indicadores. Documentar a escolha.
- Finalização da ficha continua **online-only**; enquanto houver mutação pertinente não sincronizada, não registrar conclusão nem moedas localmente.
- Registros offline sincronizados após a virada do dia não devem ser reclassificados falsamente como conclusões de ontem. Preservar a diferença entre data de atividade informada e carimbo servidor exigido para recompensas.

Caso encontre impedimento técnico concreto que torne inseguro entregar a mudança offline junto da conclusão, **não faça um remendo**: implemente o núcleo seguro, isole a limitação com testes e reporte o bloqueio e o plano preciso no PR. Não afirme que a limitação foi resolvida se não foi.

## 9. Testes obrigatórios

Criar/atualizar testes unitários, de integração SQL e browser. Testar no mínimo a matriz:

| Cenário | Resultado esperado |
| --- | --- |
| A agendada hoje, sem registros | A — Iniciar |
| A com registros hoje, sem conclusão | A — Continuar |
| A validamente concluída hoje; B amanhã | B — Próximo treino amanhã |
| A concluída hoje; nova ocorrência de A depois de amanhã | A aparece na data futura correta, não hoje |
| A concluída e B também programada hoje sem conclusão | Recomendar B hoje |
| Todas as fichas sem agenda concluídas hoje | Estado de concluído, sem repetir recomendação indevida |
| Registro de A hoje, clique de finalizar rejeitado por esforço insuficiente | A não concluída; sem navegação nem moedas indevidas |
| Sem registros da ficha, mas com treinos livres/de outra ficha no dia | Não concluir a ficha |
| Recompensa já recebida/limite de moedas atingido, esforço válido | Permitir conclusão real sem exigir `awardedCoins > 0` |
| Clique duplo, retry após resposta perdida, duas abas | Uma conclusão por ficha/dia; sem prêmio extra |
| Outra conta tenta concluir/ler ficha | Acesso negado, sem vazamento |
| Ficha arquivada/vazia/exercício indisponível | Não recomendar nem aceitar início indevido |
| Dados antigos sem evento de conclusão | Mostrar atividade, não concluir retroativamente |
| Virada do dia de São Paulo, inclusive fronteira de mês | Atualiza recomendação e contagem; sem F5/polling |
| Falha de conexão, pendências, conflitos | Sem falso sucesso; registro local preservado |
| Criação offline em ficha + ACK | `sheet_id` consistente, indicadores corretos após sync |
| Cliente antigo sincronizando payload sem ficha | Continua funcionando |
| Sessão revogada, logout e troca de conta | Sem leitura/criação cruzada e sem cache compartilhado |
| Sem fichas, 40 fichas, arquivo grande de treinos | Resposta correta e limitada; consulta econômica |
| Mobile 320–430 px, tela grande, ambos os temas, CPU lenta | Layout sem overflow; CTAs acessíveis; sem regressão de bundle |

Adicione pgTAP para RLS/privilégios/concorrência/idempotência e cenários reais de conclusão. Mantenha testes existentes de `recommendSheet`, `RecommendedSheetPanel`, `useCachedQuery`, `finishWorkout`, outbox e sincronização; atualize testes que expressam intencionalmente a lógica antiga, sem desativá-los. Estenda, quando necessário, os scripts de evidência SQL e browser já usados no CI.

## 10. Restrições de segurança e escopo

**Não quebrar**: autenticação, `has_app_access()`, revogação de sessão, RLS, catálogo oficial, fichas, histórico, outbox, EvoCoins, premiações, agenda, fotos da Home, anúncios, analytics e navegação.

- Sem `service_role` no frontend, sem bypass de RLS, sem secrets no código, sem depender do relógio do usuário como autoridade de conclusão.
- Sem apagamentos de dados ou migrations destrutivas. Sem alterar migrations já aplicadas; escrever novas e reversíveis na medida do possível.
- Sem mudanças de produto fora do escopo, dependências desnecessárias, armazenamento duplicado de estado ou consultas adicionais em cascata.
- Respeitar convenções React 18, JavaScript do projeto, Prettier, ESLint, pgTAP e migrations Supabase.
- Manter a Home visualmente coerente, com conteúdo curto, acessível e responsivo, incluindo estados de loading/error/offline.
- Separar responsabilidades: política de recomendação pura; hooks para dados; serviços para RPCs; banco para validação/autorização/concorrência.
- Implementar de forma progressiva e com commits claros; não fazer refatorações massivas de código não relacionado.

## 11. Validação antes de entregar

Execute, conforme ambiente disponível:

```bash
npm ci
npm run lint
npm run format:check
npm test
npm run build
npm run budget
node scripts/home-v2-browser-smoke.mjs
node scripts/workout-sheets-browser-smoke.mjs
node scripts/home-v2-sql-evidence.mjs
node scripts/workout-sheets-sql-evidence.mjs
npm run release:offline-check
```

Com Supabase local disponível:

```bash
npx supabase start
npx supabase test db supabase/tests/*_test.sql
npm run test:functions
```

Também rode os testes de integração/offline afetados, smoke específico novo da Home e a verificação de migração de banco **vazio e migrado**. Revise o workflow de CI e não masque falhas (nada de `|| true`, `set +e`, exclusão de testes ou aumento artificial de thresholds).

Se houver Docker/credenciais ausentes, **não simule resultado**: registre os comandos executados, o que passou, o que não pôde ser executado e a razão, e mantenha o PR sem declarar validação completa.

## 12. Entrega esperada

1. Código e migrations implementados e compatíveis com a base existente.
2. Testes automatizados dos cenários críticos, especialmente o bug de **Treino A concluído hoje → Treino B amanhã**.
3. Evidência objetiva antes/depois de consulta SQL e custo de rede/bundle/CPU, com resultados medidos e limitações explícitas.
4. Documento conciso `docs/HOME_INTELIGENTE_V4.md` com regras, estados, contratos RPC, fluxo offline, segurança, índices, motivos das decisões e plano de rollout/rollback seguro.
5. PR em branch específica, se Git/`gh` estiverem disponíveis, com resumo, arquivos afetados, testes, migrações e riscos conhecidos. **Não fazer merge/deploy/`db push` em produção sem autorização.**

### Critérios finais de aceite

A implementação só está pronta quando:

- a Home muda corretamente de A para B após conclusão **real e confirmada** de A;
- série registrada não é confundida com treino concluído;
- `not_enough_activity` nunca produz sucesso falso;
- concluir a mesma ficha duas vezes é idempotente e não duplica moedas;
- o recomendador trabalha sobre resumos mínimos, sem histórico bruto;
- nenhuma regressão é introduzida em offline, RLS, sync, EvoCoins e navegação;
- a experiência mobile continua rápida e legível;
- os testes e gates necessários estão verdes, com evidências verificáveis.

**Implemente agora. Ao finalizar, entregue um relatório objetivo contendo: arquivos alterados, comportamento corrigido, evidências e testes, migrações criadas, riscos/limitações e link do PR.**
