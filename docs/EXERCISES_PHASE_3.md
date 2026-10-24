# Exercícios — Fase 3

A biblioteca pessoal agora seleciona apenas exercícios oficiais; treinos continuam sendo atividades do usuário. Esta fase não altera o painel superadmin, não redesenha o catálogo público e não muda a arquitetura de cache.

## Inventário e comportamento

Antes, `Exercises` abria um seletor de origem e o `ExerciseForm`; `ExercisesProvider.add` chamava `exercisesService.createExercise`, que inseria `source=custom`. A edição reenviava nome, grupo e tipo. `WorkoutForm` aceitava todos os exercícios ativos. A outbox sempre suportou somente `workout.create/update/delete`: não havia criação pessoal offline implementada.

Agora “Adicionar” abre diretamente o catálogo. O formulário de preferências envia somente nota e ativo; a ordenação continua na RPC existente. Inclusão oficial usa a linha confirmada pelo servidor e a unicidade existente em `(user_id, provider, provider_exercise_id)`; uma corrida de inclusão retorna o vínculo existente. Nome, grupo, tipo, equipamento e referências não são editáveis. Remoção respeita a FK `workouts.exercise_id ON DELETE RESTRICT`, com orientação para inativar quando há histórico.

A lista privada aproveita a mesma consulta e inclui a relação completa do catálogo para obter disponibilidade. Vínculos antigos sem `catalog_id` são resolvidos por `(provider, provider_exercise_id)` em lotes limitados a 40 referências, sem N+1 e sem reescrever o vínculo. Esta informação acompanha o cache privado existente. Dados de uma conta não são reutilizados por outra.

## Migração incremental

`20261119000001_official_exercises_only.sql` e a correção incremental `20261120000001_strict_exercise_references.sql` não modificam nem apagam linhas existentes e não criam tabelas. A segunda exige que a tupla de provedor exista e esteja publicada; quando `catalog_id` é fornecido, ele também precisa resolver a mesma linha publicada. Uma referência válida não encobre outra inexistente ou inconsistente. A ausência do FK continua permitida para vínculos antigos com tupla válida.

- `exercises_guard_personal_write` bloqueia criação personalizada e alterações de identidade/snapshots. Mantém RLS `exercises_all`, ownership e `has_app_access()` com sessão ativa. Somente uma conexão privilegiada de manutenção, sem JWT de usuário, pode importar fixtures/dados legados; isso não é uma exceção acessível a clientes autenticados.
- `_validate_catalog_exercise_reference` da Fase 1+2 é preservada e ampliada: referência precisa resolver um publicado, o `catalog_id` precisa concordar e os snapshots de uma inclusão são derivados da linha oficial. Um lock de leitura serializa a inclusão com retirada concorrente. O mapeamento do grupo segue `exerciseCatalog.js`.
- `_validate_workout_exercise_published` preserva a proteção de publicação e verifica a propriedade do exercício. Novas sessões/realocações para personalizados são rejeitadas com `LEGACY_EXERCISE_READ_ONLY`. Edição de um treino existente mantendo seu exercício continua permitida, inclusive para retirados e antigos.
- `sync_workout_mutations` mantém guardas de sessão, acesso, ownership, recibos e limites. Apenas acrescenta o erro de legado e a rejeição explícita `CUSTOM_EXERCISES_DISABLED` para uma eventual criação pessoal antiga/manipulada.
- Todas as funções privilegiadas têm `search_path` explícito e grants/revogações explícitos. Não há chave privilegiada no frontend.

## Legado e offline

Personalizados existentes permanecem na biblioteca, marcados “Exercício antigo”, e nos históricos, relatórios e caches. Nota, ativo e ordem seguem permitidos. Para uma sessão nova, o usuário deve escolher um oficial; não há conversão por nome nem exclusão automática. A edição de histórico mantém o vínculo original.

Não foi criado nenhum caminho de criação personalizada offline. Uma mutação antiga rejeitada permanece na outbox com payload e erro legíveis; as demais entidades continuam sincronizando. O botão de repetir é omitido para esses erros permanentes e `retryFailed` não os recoloca na fila. O descarte continua sendo uma ação explícita do usuário.

Sem rede, oficiais já guardados continuam selecionáveis pela última disponibilidade conhecida. Uma retirada posterior só pode ser confirmada pelo servidor ao reconectar, quando a mutação é rejeitada e preservada localmente. Esta limitação é deliberada; não se implementa a Fase 5 aqui.

## Validação

- Revisão final: `npm test` com 2.129 testes aprovados, executados fora do sandbox para permitir os subprocessos do teste de fusos.
- Testes direcionados de biblioteca, treino, serviços e fila aprovados.
- `npm run lint`: zero erros, 16 avisos já existentes.
- `npm run build`: aprovado; aviso de chunks acima de 500 kB já existente.
- `node scripts/phase3-exercises-browser-smoke.mjs`: aprovado em 390 e 1280 px, com interface/contexto reais e serviços sintéticos. Confirma catálogo direto, preferências restritas, navegação da biblioteca vazia, legado preservado e seleção oficial, sem erro de página ou overflow horizontal.
- Supabase local oficial: falhou na inicialização de schema; o diagnóstico mostrou conexão indisponível durante a migração do Realtime. A tentativa sem serviços opcionais também falhou. A base alternativa e o CI são reportados separadamente abaixo.
- pgTAP PostgreSQL isolado: 74 suítes e 3.224 asserções aprovadas, incluindo 46 asserções da Fase 3 e 18 da revisão de integridade de referências. Todas as migrações do projeto, incluindo a nova, foram aplicadas em sequência nessa base.
- `npm run test:functions` com `PG_TEST_CONTAINER=phase3-exercises-db PG_TEST_USER=supabase_admin`: 207 testes aprovados, incluindo integrações PostgreSQL.
- As regressões cobrem resolução em lotes, colisões de ID externo entre provedores, cache offline, erro de consulta sem persistir disponibilidade falsa, duplicatas e preservação da fila rejeitada.
- CI oficial: os resultados finais são apresentados no PR e na entrega, sem merge automático.

## Publicação

Após a aprovação inicial, o usuário autorizou expressamente a publicação desta revisão: CI oficial completo aprovado, aplicação das duas migrações antes do frontend, validação transacional em produção, merge respeitando as proteções do GitHub e conferência do deployment oficial. Falha crítica interrompe a publicação. Clientes antigos que tentem criar personalizados receberão rejeição do servidor.

## Arquivos

- `.github/workflows/supabase-tests.yml`
- `docs/EXERCISES_PHASE_3.md`
- `docs/prompts/PROMPT_EVOLUTUS_CATALOGO_EXERCICIOS_V2.md` (restaurado integralmente; planejamento das Fases 4 e 5 preservado)
- `docs/prompts/PROMPT_EVOLUTUS_FASE_3_EXERCICIOS.md`
- `scripts/phase3-exercises-browser-smoke.mjs`
- `src/components/ExerciseCatalog.jsx`
- `src/components/ExerciseForm.jsx` (removido)
- `src/components/ExercisePreferencesForm.jsx`
- `src/components/FormShell.jsx`
- `src/components/SyncStatus.jsx`
- `src/components/WorkoutForm.jsx`
- `src/components/workout.test.js`
- `src/components/workoutSession.interactions.test.js`
- `src/constants/muscleGroups.js`
- `src/constants/muscleGroups.test.js` (removido)
- `src/contexts/ExercisesContext.jsx`
- `src/contexts/ExercisesContext.test.js`
- `src/hooks/useFormState.js`
- `src/pages/ExerciseDetail.jsx`
- `src/pages/Exercises.jsx`
- `src/pages/Exercises.test.js`
- `src/pages/NewWorkout.jsx`
- `src/services/exercisesService.js`
- `src/services/offline/outbox.js`
- `src/services/offline/syncActions.js`
- `src/services/offline/syncEngine.test.js`
- `src/services/offlineReadServices.test.js`
- `src/services/offlineWriteServices.test.js`
- `src/utils/exerciseCatalog.js`
- `src/utils/personalExercises.js`
- `src/utils/personalExercises.test.js`
- `src/utils/validators.js`
- `src/utils/validators.test.js`
- `supabase/migrations/20261119000001_official_exercises_only.sql`
- `supabase/tests/evocoins_participation_test.sql`
- `supabase/tests/exercise_catalog_lifecycle_test.sql`
- `supabase/tests/official_exercises_only_test.sql`
- `supabase/tests/offline_workout_sync_test.sql`

## Complemento da revisão

- `src/services/exercisesService.js`: correspondência exata das referências, seleção da relação completa e resolução em lote para o FK ausente, inclusive na inclusão idempotente.
- `supabase/migrations/20261120000001_strict_exercise_references.sql`: impede que uma referência válida encubra outra ausente, divergente ou não publicada nos novos treinos.
- `supabase/tests/exercise_reference_integrity_test.sql`: 18 regressões de vínculos antigos, permissões existentes, históricos e sincronização.
- Os testes JavaScript de leitura, escrita e fila comprovam a resolução em lotes e a manutenção do cache privado, sem consultas remotas offline nem repetição automática das rejeições.

O resultado oficial do CI e o commit efetivamente publicado são registrados na descrição do PR e no relatório de entrega.
