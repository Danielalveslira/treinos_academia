# EVOLUTUS — Arquitetura e implementação de Fichas de Treino

**Status:** especificação técnica para implementação (não representa código já entregue)  
**Etapa:** nova fase independente, antes da Fase 5 (offline seletivo)  
**Prioridade:** segurança, compatibilidade, desempenho em celulares de entrada e UX mobile-first  
**Base analisada:** código de exercícios, treino e sincronização disponível na `main` do repositório `Danielalveslira/treinos_academia`, mais a tela mobile fornecida. Validar diferenças com a branch mais recente antes de modificar arquivos.

## 1. Objetivo e decisão arquitetural

Criar **Fichas de Treino**: planos pessoais reutilizáveis (A/B/C ou nomes livres) com objetivo, descrição, exercícios oficiais ordenados e prescrições opcionais. Ao abrir uma ficha, o usuário vê **somente os exercícios daquela ficha**; ao iniciar, registra séries e resultados no fluxo existente de treino.

**Separação obrigatória:**

1. `exercise_catalog` = conteúdo oficial administrado por superadmin.
2. `exercises` = biblioteca pessoal de vínculos com exercícios oficiais, mais legado preservado.
3. `workout_sheets` + `workout_sheet_exercises` = planejamento **do usuário** (novas estruturas).
4. `workouts` = execução efetiva/histórico; permanece a fonte de verdade dos registros realizados.

**Uma ficha não é um exercício, uma sessão nem um histórico.** Alterar, arquivar ou duplicar fichas nunca apaga, recria ou recontabiliza treinos, EvoCoins ou estatísticas. Criar fichas pessoais **não reintroduz** a criação personalizada de exercícios encerrada na Fase 3.

**Decisão para V1:** implementar planejamento completo e **iniciar treino filtrado por ficha**, sem remodelar a persistência de `workouts` nem criar falsos registros de “sessões por ficha”. Hoje o aplicativo guarda uma linha por exercício/dia, salva série a série, marca conclusões visuais por exercício/dia no dispositivo e finaliza o dia via RPC econômica. A V1 deve respeitar essas limitações. Histórico e métricas *por ficha/sessão* exigirão uma evolução de dados separada, explicitamente fora do escopo. Não alegar que duas execuções da mesma ficha/exercício no mesmo dia sejam sessões independentes.

## 2. Requisitos funcionais e fluxos

### 2.1 Navegação da área Exercícios

- Em `/exercicios`, oferecer navegação clara entre **Minhas fichas**, **Biblioteca** e **Catálogo Evolutus** (ou rota equivalente na implementação vigente), sem três árvores pesadas montadas simultaneamente.
- `Minhas fichas` é a primeira aba para quem possui fichas; sem fichas, mostrar estado vazio útil com CTA **Criar ficha** e acesso direto à biblioteca/catálogo. Não esconder o catálogo atual.
- Cards compactos: nome, objetivo opcional, grupos musculares derivados, número de exercícios, dias opcionais e ação principal **Abrir / Iniciar**; ações secundárias em menu acessível: editar, duplicar, arquivar.
- Ficha aberta em rota navegável, por exemplo `/fichas/:id`; editor em `/fichas/nova` e `/fichas/:id/editar`. Manter navegação de volta, links diretos, estados vazios e proteção autenticada. Registrar os rewrites necessários na Vercel e teste de refresh/entrada direta.
- No celular: uma coluna, campos essenciais à vista, ações principais alcançáveis, edição sem scroll horizontal; em desktop ampliar largura somente quando útil.
- A biblioteca continua mostrando exercícios oficiais e antigos, notas pessoais, reordenação e histórico; a ficha não substitui sua funcionalidade.

### 2.2 Criar / editar uma ficha

**Obrigatório:** nome (1–80 caracteres após normalização) e pelo menos 1 exercício **para ativar/iniciar**. Permitir **rascunho sem exercícios** para não perder trabalho parcial; exibir status e impedir botão **Iniciar treino** enquanto não estiver pronta.

**Opcional:**

- Objetivo predefinido: `hipertrofia`, `forca`, `resistencia`, `condicionamento`, `mobilidade` ou `outro` (campo descritivo livre para `outro`; não há prescrição automatizada).
- Descrição do que pretende alcançar (até 500 caracteres).
- Dias da semana sugeridos (0 = domingo … 6 = sábado), somente organização na V1: **não criar lembretes/calendário automático**.
- Por exercício: ordem, séries-alvo (1–10), faixa de repetições, descanso em segundos, observação pessoal, e, quando compatível com cardio, duração/distância-alvo opcionais. Valores da ficha são **metas**: não equivalem a séries realizadas.

**Ações:** adicionar da biblioteca; encontrar item no Catálogo Evolutus, adicioná-lo oficialmente à biblioteca e depois à ficha; remover da ficha sem excluí-lo da biblioteca; reordenar; salvar; duplicar; arquivar/restaurar. Reutilizar busca paginada e fluxo de inclusão do catálogo, nunca inserir diretamente exercícios `source='custom'`.

**Comportamentos seguros:**

- Impedir exercício repetido **na mesma ficha** na V1; o mesmo exercício pode existir em diversas fichas.
- Não permitir anexar exercícios pessoais de outra conta, legados, ou oficiais retirados/não publicados. Um item já incluído que tenha sido retirado permanece **visível, mas bloqueado** para novos treinos e marcado com orientação para substituição.
- Ao fechar o editor com mudanças reais, pedir confirmação. Se nada mudou, **Salvar desabilitado**; reverter os valores ao estado original desabilita novamente. Não gerar gravações/auditoria desnecessárias.
- Evitar salvar no servidor a cada tecla, reorder ou alteração de campo. Um envio transacional explícito de salvar; debounce somente para pesquisa.
- Caso o usuário já tenha inserido um exercício na biblioteca mas falhe a associação à ficha, manter a inclusão na biblioteca, informar o erro e permitir tentar novamente sem duplicar vínculo.

### 2.3 Abrir ficha e iniciar treino

- Abrir exibe cabeçalho da ficha e **somente os exercícios vinculados**, na ordem própria da ficha; título, prescrição, instruções START/END sob demanda e indicação de disponibilidade.
- Ação **Iniciar treino** leva ao fluxo atual `/novo-treino?ficha=<uuid>` ou equivalente. Servidor confirma propriedade da ficha e disponibilidade dos exercícios antes de habilitar execução online.
- No `NewWorkout`/`WorkoutForm`, introduzir modo opcional `sheetScope`: IDs pessoais permitidos, ordem da ficha e metas exibidas; **não filtrar nem modificar globalmente** `ExercisesContext` ou a biblioteca.
- Sem ficha, `/novo-treino` continua como hoje. Edição de histórico continua independente da ficha e preserva as exceções existentes para registros antigos.
- A prescrição aparece como referência, mas o usuário continua informando **séries executadas, carga e repetições reais**. Não converter metas em séries `done`, não criar treino ao tocar em “Iniciar”, não duplicar as linhas `workouts`.
- Manter `createRowSaver`, `useWorkouts`, sincronização da outbox, `runFinishWorkout`, `complete_workout_session`, limite diário/regras de EvoCoins, data de negócio e progresso **sem alteração de contrato**.
- Um exercício retirado pelo superadmin não pode começar um novo registro nem por UI, nem por request manipulado: continuar usando as guardas da Fase 1–3. Edição de histórico pré-existente permanece permitida conforme regras atuais.
- A conclusão visual de exercícios em `doneExercisesStorage` é atualmente por **exercício/dia**, não por ficha. Não chamá-la de “progresso desta ficha” nem usá-la para contabilizar sessões independentes. Rotular corretamente ou projetar avanço posterior como fase separada.

## 3. Modelo de dados (PostgreSQL / Supabase)

### 3.1 `public.workout_sheets`

| Coluna | Tipo lógico | Regra |
|---|---|---|
| `id` | `uuid` | PK, gerado no servidor |
| `user_id` | `uuid` | NOT NULL, proprietário, referência à conta conforme convenção existente |
| `name` | `text` | NOT NULL, trim, 1–80 caracteres |
| `goal` | `text` | enum por CHECK ou referência versionável; inclui `other` |
| `goal_description` | `text` | opcional, até 500 caracteres |
| `weekdays` | `smallint[]` | opcional; somente valores únicos entre 0 e 6 |
| `sort_order` | `integer` | >= 0, posição na lista pessoal |
| `archived_at` | `timestamptz` | NULL = ativa; arquivo lógico, sem apagar dados |
| `revision` | `bigint` | NOT NULL >= 1, incremento em mudanças confirmadas |
| `create_request_id` | `uuid` | identificação idempotente de criação/duplicação por proprietário |
| `created_at`, `updated_at` | `timestamptz` | preenchidos/atualizados pelo servidor |

**Limites iniciais, centralizados e testáveis:** máximo sugerido 40 fichas ativas/usuário; máximo 40 exercícios/ficha. Validar limites em transação no **servidor**, não só no frontend; ajustar somente com medição real. Não criar relações públicas ou compartilhamento nesta etapa.

### 3.2 `public.workout_sheet_exercises`

| Coluna | Tipo lógico | Regra |
|---|---|---|
| `id` | `uuid` | PK estável para edição e reorder |
| `sheet_id` | `uuid` | FK para `workout_sheets` |
| `user_id` | `uuid` | denormalizado para escopo/constraint de proprietário, obrigatório |
| `exercise_id` | `uuid` | referência a `public.exercises.id` **pessoal**, nunca diretamente ao `exercise_catalog.id` |
| `sort_order` | `integer` | >= 0, ordenação por ficha |
| `target_sets` | `smallint` | opcional, 1–10; compatível com `MAX_WORKOUT_SETS` atual |
| `reps_min`, `reps_max` | `integer` | opcionais, intervalo válido, mínimo <= máximo |
| `rest_seconds` | `integer` | opcional, 0–900 |
| `target_duration_minutes` | `integer` | opcional; cardio, validar limite |
| `target_distance_km` | `numeric` | opcional; cardio, validar limite |
| `note` | `text` | opcional, até 300 caracteres |
| `created_at`, `updated_at` | `timestamptz` | servidor |

**Integridade:**

- `UNIQUE (sheet_id, exercise_id)` evita duplicatas na mesma ficha; `exercise_id` repetido em fichas diferentes é válido.
- Garantir **mesmo proprietário** em ficha e exercício, idealmente por FKs compostas (`(sheet_id,user_id)` e `(exercise_id,user_id)` com UNIQUEs de apoio), depois de verificar os constraints reais; complementar com validação transacional na RPC. Não assumir que `exercises(user_id,id)` já tem UNIQUE sem inspecionar schema.
- **Não usar `ON DELETE CASCADE` sobre `exercises` ou `workouts`.** Quando exercício pessoal estiver referenciado numa ficha, preferir RESTRICT e orientar remoção prévia da ficha. `ON DELETE CASCADE` de *itens da ficha* somente ao destruir a própria ficha, caso exclusão física administrativa seja um dia necessária.
- Um exercício arquivado/retirado pode continuar referenciado para manter a ficha inteligível; a disponibilidade para execução sempre é validada novamente.
- Os campos de prescrição são independentes de `workouts.set_details`; nenhum backfill ou alteração do registro histórico.
- Regras específicas de musculação/cardio baseadas no **tipo oficial validado**, não em um `type` arbitrário enviado pelo cliente.

### 3.3 Índices e evolução

- Índice para lista: `(user_id, archived_at, sort_order, id)` (ou variação compatível com o plano de consulta real).
- Índice para itens: `(sheet_id, sort_order, id)` e constraint única `(sheet_id, exercise_id)`.
- Índice/constraint de idempotência: `(user_id, create_request_id)` quando `create_request_id` estiver preenchido.
- Evitar índices extras sem `EXPLAIN (ANALYZE, BUFFERS)` em consultas típicas.
- Migration **aditiva e reversível no sentido operacional**: não excluir `exercises`, `workouts`, triggers e RPCs existentes; não apagar legado; não reescrever dados de produção.

## 4. Segurança e contratos de servidor

### 4.1 Autorizações

1. Ativar RLS nas novas tabelas e deixar leitura/escrita anônima negada por padrão.
2. `SELECT` de fichas e itens apenas quando o proprietário é `auth.uid()` **e a sessão está ativa**, respeitando o padrão `has_app_access()`/`private.current_session_active()` do projeto. Não retornar fichas de terceiros nem por IDs conhecidos.
3. **Preferência:** leitura via queries com RLS; escritas complexas por RPCs transacionais mínimas. Revogar `INSERT/UPDATE/DELETE` diretos dos roles de usuário nessas tabelas se a implementação centralizar todas as escritas em RPCs.
4. Cada RPC de mutação valida `auth.uid()`, sessão ativa, acesso à aplicação e propriedade. Se `SECURITY DEFINER`, usar `SET search_path` seguro, nomes schema-qualificados onde cabível, `REVOKE EXECUTE FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated`, e nenhuma `service_role` no cliente.
5. Validar disponibilidade oficial: `source='catalog'`, provider permitido, `(provider, provider_exercise_id)` e `catalog_id` consistentes, status `published`, e ownership do vínculo em `exercises`. Não confiar em nome, imagem, `type` ou status fornecidos pelo frontend.
6. Servidor valida limites, comprimentos, arrays, tipos, posições e cardinalidade; payload inválido retorna erro de negócio padronizado, sem vazar detalhes de outras contas.
7. `archived_at` / item bloqueado nunca contorna a verificação de publicação na criação do treino; restrição já existente em `workouts` continua sendo última barreira.

### 4.2 RPCs e atomicidade

**Contratos propostos** (nomes finais conforme convenções do repositório):

- `create_workout_sheet(p_request_id, p_name, p_goal, p_description, p_weekdays)` -> `{id, revision}`; transação, idempotência de retries por `(auth.uid(), p_request_id)`.
- `save_workout_sheet(p_sheet_id, p_expected_revision, p_metadata, p_items)` -> `{id, revision}`; `SELECT ... FOR UPDATE` na ficha, ownership, validação integral do array, normalização de posições, diff/upsert de itens e remoção das associações excluídas, **tudo na mesma transação**.
- `duplicate_workout_sheet(p_source_id, p_request_id)` -> ficha e itens clonados atomicamente, novo nome editável; nunca copia treinos/históricos.
- `set_workout_sheet_archived(p_sheet_id, p_archived, p_expected_revision)` -> arquivo/restauração idempotente e versionado.
- `reorder_workout_sheets(p_ids)` -> valida que IDs são exatamente o conjunto esperado de fichas reordenáveis do usuário; grava posições em uma transação (não N updates pelo browser).
- `list_my_workout_sheets` ou consulta de leitura com RLS -> cards resumidos em lote, incluindo contagem; `get_my_workout_sheet` ou query RLS -> metadados + itens ordenados em até duas consultas, nunca N+1.

**Concorrência:** `revision` é controle otimista. Se outra aba alterou a ficha, recusar com código `SHEET_VERSION_CONFLICT`, recarregar dados, mostrar conflito sem apagar edição local. Em timeout após `save`, comparar estado efetivo do servidor com o payload normalizado antes de tentar reaplicar. Criar/duplicar exige `request_id` estável para não criar fichas duplicadas quando o ACK é perdido. Ordenação sempre normalizada e determinística.

**Arquivar, não deletar:** UI usa arquivamento lógico. Prescrição ou dados já registrados não se perdem. Rejeitar início de ficha arquivada até restaurar, sem prejudicar acesso ao histórico externo à ficha.

## 5. Arquitetura de frontend (React + GitHub Primer)

### Componentes sugeridos

- `WorkoutSheetsPage` / área `Minhas fichas`: lista resumida e estado vazio.
- `WorkoutSheetCard`: renderização leve; nenhuma imagem obrigatória em cards.
- `WorkoutSheetDetailPage`: itens, metas, imagens/instruções carregadas **sob demanda**, CTA Iniciar.
- `WorkoutSheetEditorPage` ou `WorkoutSheetEditor`: formulário progressivo, seleção de exercícios, reorder e comparação dirty.
- `WorkoutSheetExercisePicker`: busca na biblioteca e atalho para catálogo oficial, reutilizando serviços existentes.
- `workoutSheetsService.js` e `useWorkoutSheets.js`: acesso a dados; sem queries nos componentes de apresentação.
- `workoutSheetValidation.js`: validação pura e normalização compartilháveis em testes.
- Integração pontual em `Exercises.jsx`, `NewWorkout.jsx`, `WorkoutForm.jsx`, roteamento/lazy-loaders e testes existentes.

**Não copiar** `ExerciseCatalog`, `WorkoutExerciseGuide`, `ExerciseCatalogImage`, `ExercisePreferencesForm` ou infraestrutura offline. Reaproveitar esses contratos, corrigindo-os somente se necessário. UI GitHub Primer + tokens CSS; sem cores hardcoded, bibliotecas de drag/drop pesadas, `!important` ou componentes duplicados. Suportar teclado/touch para mover item; botões subir/descer acessíveis são fallback obrigatório (não depender exclusivamente de arrastar).

### Estados e UX

- Estados explícitos: loading, vazio, sem rede (cache disponível ou não), ficha arquivada, exercício retirado, permissão negada, conflito, erro ao salvar, salvando, salvo.
- Formulário dividido visualmente em: **Identificação → Exercícios → Metas opcionais**. No mobile, revelar campos avançados ao tocar em cada exercício; não renderizar 40 editores expandidos.
- Tabs com semântica correta, foco visível, rótulos, botão Voltar, confirmação de descarte, suporte a leitor de tela e toque mínimo ~44 px quando possível.
- Ao retornar do Catálogo, preservar ficha em edição sem gravar referências temporárias indevidamente.
- Search e inclusão desacoplados da execução; não carregar conteúdos e thumbnails de toda a biblioteca só porque o usuário abriu a página de fichas.
- Dark/light devem funcionar em todos os estados, overlays e portais.

## 6. Offline e integridade de sessão

**Escopo V1:** leitura opcional offline de fichas já abertas/preparadas; **criar/editar/duplicar/arquivar fichas exige rede**. Essa limitação deve aparecer de forma clara e não pode causar perda silenciosa de alterações. O registro de séries segue o mecanismo offline existente de `workouts` quando habilitado.

- Se oferecer cache offline, incluir novas object stores por **migration incremental** do IndexedDB (`schema.js`; não editar versões anteriores), por usuário, para ficha e itens. Atualizar `DISPOSABLE_STORES` e regras de isolamento/limpeza de conta, sem apagar outbox pendente.
- As novas fichas armazenadas são cache **descartável**, não fila de trabalho. Escrita local de formulário só como rascunho transitório isolado do usuário, se implementada; **não informar “salvo” enquanto servidor não confirmar**.
- Offline: permitir abrir uma ficha já cacheada, mas rotular que a disponibilidade do exercício é da última sincronização. Não afirmar que exercício retirado continua seguro/ativo; o backend decide quando as mutações forem enviadas.
- Não criar fila paralela de sincronização de fichas; Fase 5 cuidará do cache seletivo de mídia/exercícios, e suporte a edição offline de fichas exige desenho específico de conflitos.
- Nunca guardar JWT, `service_role` ou dados privados de outra conta no cache de fichas.

## 7. Orçamento de desempenho — aparelhos de entrada

**Metas de engenharia, a aferir em Chromium com CPU 4× mais lenta, rede lenta e dispositivo real quando possível (não são resultados já medidos):**

| Recurso | Diretriz |
|---|---|
| Primeira tela de fichas | 1 consulta resumida; sem carregar todos os itens, instruções ou imagens |
| Abrir ficha | até 2 round-trips tipicamente: ficha + itens com dados pessoais associados em lote |
| Lista | até 40 cards; paginação simples se o teto evoluir |
| Editor | até 40 itens; campos detalhados colapsados, atualização local antes do envio |
| Scripts | lazy-load da rota/editor; evitar novas dependências pesadas; meta de incremento < 35 KB gzip por rota, aferida no build |
| Renderização | evitar re-renderização da lista inteira por digitação em um item; usar componentes memoizados quando medição justificar |
| Imagens | zero download obrigatório nos cards de fichas; START/END somente ao solicitar detalhes; `loading="lazy"`, dimensões reservadas |
| Interação | objetivo de resposta visual < 200 ms em aparelho fraco; nenhuma operação de rede em handler de digitação/reorder |
| Layout | sem overflow horizontal a 320, 360, 390, 768 e 1280 px; foco/menus acessíveis |
| Consultas | índices relevantes + `EXPLAIN (ANALYZE, BUFFERS)` com usuário com dezenas de fichas |

Evitar `SELECT *` de imagens, instruções completas ou histórico na lista de fichas. Na tela de detalhes, carregar **somente** os itens da ficha e dados necessários para display; guias com START/END usam busca já existente sob demanda. Não usar subscriptions Realtime globais para tudo; invalidar apenas cache da ficha alterada.

## 8. Plano de implementação — um PR, entregas internas verificáveis

### Entrega A — banco e segurança

1. Verificar migrations vigentes de `exercises`, `workouts`, RLS, sessões e catálogo, inclusive o último deploy; gerar migration aditiva.
2. Criar tabelas, constraints, índices mínimos e políticas RLS; RPCs transacionais e códigos de erro.
3. Testar escrita direta negada, sessão revogada, troca de usuário, UUID de outro usuário, exercício retirado, legado, conflito, duplicação idempotente e limites.
4. Comprovar que triggers de `workouts` e saldos financeiros permanecem inalterados.

### Entrega B — páginas mobile-first

1. Lista/abas, criação, editor, detalhe e estados vazios com Primer.
2. Seleção via biblioteca/catálogo; ordenação acessível; metas opcionais e salvar com dirty-check.
3. Ações duplicar/arquivar/restaurar, sem exclusão de histórico.
4. Rotas lazy-loaded e rewrites; regressão em navegação, tema e foco.

### Entrega C — execução

1. Passar escopo de ficha de forma explícita para `/novo-treino` e `WorkoutForm`.
2. Exibir só exercícios da ficha no modo ficha; apresentar metas sem registrar séries automaticamente.
3. Preservar modo livre, histórico, rowSaver, offline/outbox, finalização e EvoCoins.
4. Testar exercícios retirados/indisponíveis, ficha arquivada, ficha vazia e reload da rota.

### Entrega D — cache de leitura e QA

1. Se necessária, introduzir IndexedDB aditivo apenas para **leitura de fichas**, sem mutações offline.
2. Exercitar abertura sem rede após cache, troca de conta, dados obsoletos e recuperação online.
3. Rodar testes completos, `pgTAP`, `npm test`, `npm run lint`, `npm run build`, scanner de segredos e smoke browser de 320/360/390/768/1280 px.
4. Comparar bundle, consultas, renderização, memory/CPU e carga de imagens **antes/depois**, registrando números reais.

## 9. Matriz mínima de testes e aceite

**Servidor / pgTAP**

- Conta A não lê, edita, duplica, arquiva ou inicia ficha de B.
- Sessão revogada não muta nem lê dados privados via caminhos autorizados.
- Inclusão de `custom`, item não publicado/retirado, referência divergente, item de outro usuário e payload manipulado são rejeitados.
- Arquivamento não remove `workouts`; apagar exercício referenciado falha com mensagem tratável.
- `save` com `expected_revision` correto atualiza ficha+itens atomicamente; versão antiga gera conflito sem escrita parcial.
- Request repetido de criação/duplicação gera **uma** ficha; reorder não duplica IDs/posições.
- Constraints de caracteres, metas e máximo de exercícios são enforce server-side.

**JS / UI / integração**

- Abrir ficha mostra somente seus exercícios, na ordem persistida; outro modo de treino continua funcionando.
- Ao iniciar, nenhuma série é criada nem marcada concluída automaticamente; os lançamentos reais continuam gravados pelo fluxo existente.
- Exercício retirado é visível como indisponível e bloqueado para nova execução; histórico permanece consultável.
- Duplicar/arquivar/editar não altera `workouts`, EvoCoins, histórico ou outras fichas.
- Dirty-check impede envio sem mudança, mesmo após editar e desfazer; erro de rede mantém formulário.
- Saída/retorno do catálogo preserva estado válido; busca, teclado, foco, dark/light, menus, browser back e links diretos funcionam.
- Sem rede: ficha cacheada sinalizada; edição bloqueada; registro offline existente preservado e reenviado segundo regras atuais.
- Troca de conta no mesmo dispositivo não exibe dados privados da conta anterior.
- Smoke em aparelhos/tamanhos pequenos sem overflow horizontal e sem carregamento massivo de imagens.

**Critérios inegociáveis:**

1. A ficha existe e é persistida no Supabase, com RLS e validações no backend.
2. Nome/objetivo/metas/ordem podem ser editados; duplicação/arquivamento funcionam.
3. A tela de ficha filtra corretamente os exercícios sem afetar a biblioteca ou catálogo.
4. “Iniciar treino” reutiliza registro verdadeiro de treino, sem comprometer séries, offline e recompensas.
5. Histórico prévio e conteúdo de exercícios oficiais/legados não são excluídos.
6. Carregamento responsivo em aparelhos fracos, com medição e testes reais.
7. CI integral aprovado; migração aplicada somente após revisão explícita do PR.

## 10. Deploy e riscos

- Desenvolver em branch própria, abrir PR com descrição, migration, evidências do CI, screenshots mobile e relatório de performance. **Não fazer merge nem publicar em produção nesta tarefa sem autorização explícita.**
- Como não há homologação, exigir verificação rigorosa da migração, backup recuperável, execução de pgTAP/CI oficial e estratégia de rollback **sem apagar dados novos**; em produção, aplicar banco antes do frontend, conforme decisão de deploy posterior.
- Riscos a monitorar: exercício retirado após inclusão na ficha; conflito entre abas; navegação durante edição; compatibilidade PWA/offline; item retirado da biblioteca; controle de “concluído hoje” compartilhado entre fichas; duplicação por retry.
- Limitação funcional deliberada: **não há sessões históricas independentes por ficha** na V1. Qualquer relatório “progresso por ficha” ou múltiplas execuções com o mesmo exercício no mesmo dia precisa de arquitetura própria de sessões e migração específica.

## 11. Instrução de execução ao Codex

Implemente esta arquitetura no repositório **atual**, conferindo previamente as migrations, rotas, componentes e contratos que de fato estiverem na branch de trabalho. Não devolva apenas wireframes ou planejamento; entregue código, migrations aditivas, testes e PR. Respeite os contratos existentes, padrões GitHub Primer e limites de celulares fracos. Corrija divergências descobertas sem enfraquecer segurança. Não introduza funcionalidades fora do escopo (IA, compartilhamento, assinatura, periodização, notificações ou edição offline de fichas). Ao finalizar, entregue relatório curto: arquivos, migrações, testes efetivamente rodados, medições de performance, riscos e pendências. Não declarar como validado nada que não tenha sido executado.
