# Fichas de Treino — V1

Implementação na branch `feat/workout-sheets`, PR #74, baseada na Fase 4 do catálogo (PR #73). Nenhum merge ou banco de produção autorizado/aplicado nesta tarefa.

## Arquitetura e arquivos

- `supabase/migrations/20261122000001_workout_sheets.sql`: planejamento separado de `workouts`, FKs compostas de proprietário, RLS, leitura resumida/paginada e RPCs transacionais. Escritas diretas negadas; autorização exige conta com acesso e sessão ativa. Helpers privados continuam sem EXECUTE público. A disponibilidade oficial é validada sob bloqueio antes de novas associações; copiar itens retirados exige substituição.
- `src/features/workoutSheets/`: lista, detalhe, editor, picker reutilizando catálogo, serviço, hook e normalização. Metas compatíveis com limites atuais de execução: 10 séries, 600 minutos, 500 km. Nome, descrição, dias, notas e ordem são normalizados. Rascunhos contam para o teto de 40 fichas ativas; arquivadas são paginadas de 40 em 40.
- `src/App.jsx`, `src/routeLoaders.js`, `src/pages/ExercisesArea.jsx`, `vercel.json`: rotas protegidas e lazy, três áreas navegáveis e refresh de URLs. O data router mantém as rotas existentes e fornece `useBlocker` para impedir perda de rascunho por Voltar/Avançar, links e navegação programática.
- `src/components/ExercisesRouteProvider.jsx` e `ExercisesContext.jsx`: suspendem a consulta da biblioteca nas listas/detalhes/execução de fichas. A biblioteca continua íntegra nas suas rotas e no editor.
- `NewWorkout.jsx` e `WorkoutForm.jsx`: `sheetScope` explícito, ordem da ficha e metas como referências. Os snapshots limitados da ficha evitam carregar exercícios alheios ao escopo. Não altera biblioteca global, contratos de rowSaver, outbox, histórico, finalização ou economia.
- `supabase/tests/workout_sheets_test.sql`, testes JS e `scripts/workout-sheets-*-smoke.mjs`/`workout-sheets-sql-evidence.mjs`: evidências de segurança, retries, limites, desempenho e fluxos no navegador. Os passos novos também fazem parte do CI oficial.

## Editor mobile e catálogo delimitado

O editor usa componentes e tokens do GitHub Primer: quatro blocos (Identificação, Objetivo e descrição, Dias sugeridos, Exercícios da ficha), sem a moldura genérica de formulário. Na criação, blocos opcionais e seletor começam fechados. Na edição, objetivo/dias existentes ficam visíveis. Abrir/fechar blocos preserva todos os valores. As ações ficam no fluxo da página, sem sobrepor campos.

A seleção abre sob demanda e alterna Biblioteca/Catálogo em SegmentedControl. O painel mantém a mesma altura para as duas fontes: 26 rem no mobile, 32 rem em telas maiores, sempre limitado a 60 dvh, com `overflow-y: auto` e `overscroll-behavior: contain`. Paginação aumenta somente o conteúdo interno. O teste mede documento e painel antes/depois, exige crescimento de **0 px** na página e confirma que rolar o catálogo não rola o documento.

O Catálogo Evolutus original é importado apenas no primeiro acesso e preservado enquanto se alterna a fonte. Busca, paginação e posição de rolagem não são descartadas, e a troca não repete consultas. Os botões Voltar à biblioteca e Meus exercícios retornam à mesma seleção; o foco volta à busca. O rótulo acessível da busca do catálogo é explícito e permanece estável quando aparece o botão Limpar busca.

Linhas de exercícios são memoizadas. Metas fechadas não montam os campos; a fixture de 40 exercícios exige zero inputs/textareas de metas enquanto fechados. Callbacks estáveis evitam renderizar essas linhas ao digitar nome/descrição. Não há bibliotecas ou dependências novas. O smoke final passou nos 10 cenários (cinco tamanhos × dois temas): sem overflow, crescimento de 0 px do documento após paginação e nenhum refetch por alternar a fonte. Digitação até o próximo frame ficou em até 27,2 ms com CPU 4×; no editor de 40 exercícios, até 15,9 ms e zero campos de metas montados enquanto fechados.

Arquivos deste refinamento: `WorkoutSheetEditorPage.jsx`, `WorkoutSheetExercisePicker.jsx`, novo `WorkoutSheetItemEditor.jsx`, `workoutSheets.css` (remoção de regras substituídas por Primer), `ExerciseCatalog.jsx` (rótulo), novo `workoutSheetEditor.test.js` e ampliação do smoke. Não altera tabelas, migrações ou RPCs.

## Rede, concorrência e dados

Acesso inicial a fichas exige rede; não foi criado cache persistente nem fila de edição de fichas. O editor retém alterações durante perda de conexão, desabilita edição/salvar offline e confirma gravação somente após resposta do servidor. Uma execução validada online continua montada quando a rede cai e conserva o mecanismo existente de registro offline de séries.

Criação/duplicação usam request UUID estável por tentativa. Save usa revisão otimista; conflito carrega a versão atual para comparação sem sobrescrever a edição. Perda de ACK de save provoca leitura e comparação normalizada, nunca replay automático com revisão nova. A criação também confere o proprietário esperado do formulário para impedir envio na conta errada durante troca de sessão. Respostas de saves de editores desmontados não redirecionam a conta nova. Saves equivalentes não incrementam revisão; UPSERT preserva IDs de itens e evita atualizar itens inalterados.

Exercícios retirados permanecem legíveis em fichas existentes, mas bloqueiam início; a guarda existente de `workouts` continua sendo a última barreira. A exclusão de exercício referenciado usa RESTRICT e mensagem tratável. Um trigger aditivo em exclusão autorizada de conta remove somente seu planejamento antes das cascatas existentes de exercícios, evitando bloquear o ciclo de exclusão de conta.

Concluído hoje continua sendo exercício/dia. Não existem sessões históricas independentes nem métricas por ficha nesta V1.

## Validação e desempenho

As medidas e os resultados finais estão em `docs/workout-sheets-evidence/`. O smoke utiliza páginas/componentes/hooks reais, o cliente HTTP real do Supabase e uma API RPC sintética local. Segurança e atomicidade são verificadas separadamente contra PostgreSQL real no runner oficial, com migrations desde a base limpa. Isso não equivale a teste integrado em produção.

Matriz do smoke: 320×568, 360×740, 390×900, 768×900 e 1280×900, claro/escuro; toque nas três larguras menores, CPU 4× mais lenta, RTT 150 ms e 200 KB/s de download. Confere ordem, exclusão de exercícios externos ao escopo, nenhuma gravação ao iniciar, registro verdadeiro de uma série pelo rowSaver, perda de conexão durante execução, dirty-check/desfazer, confirmação de Voltar, rolagem interna e paginação sem crescimento da página, alternância de fontes, adição pelo catálogo, falha de save, conflito e recuperação, troca de conta, duplicação, arquivo/restauração e criação de rascunho. Guias e catálogo existentes são reutilizados; não há download obrigatório de imagens em lista/detalhe. Rewrites do arquivo real da Vercel são usados pelo servidor do smoke.

Limites da medição: fluxos com dois exercícios e um cenário de volume com 40 fichas/40 exercícios, sem aparelho físico. O tempo de abertura inclui o bundle agregado do harness, que difere dos chunks lazy de produção. Heap representa apenas V8. As medidas de abertura, digitação e heap V8 do cenário com 40 fichas/40 exercícios estão em `browser-results.json`; as metas fechadas mantêm zero campos montados. Os números são sintéticos, não resultados de produção. O CI aprovou 76 suítes/3.305 assertivas pgTAP, incluindo 74 assertivas de fichas. EXPLAIN ANALYZE/BUFFERS com 40 fichas e RLS usou `workout_sheets_list_idx` (0,541 ms) e `workout_sheet_items_order_idx` (0,432 ms) nesse runner; veja `sql-results.json`. A suíte local de frontend passou com 2.159 testes, incluindo dois novos testes de componentes. Não foi feito benchmark comparativo de CPU/memória de um aparelho real antes/depois; o comparativo de bundle usa build real anterior/posterior.

Comparativo dos builds reais (gzip):

| Medida | Antes | Depois | Variação |
|---|---:|---:|---:|
| Todos os chunks JS | 829.538 B | 865.805 B | +36.267 B |
| JS do boot/PWA (nível 9) | 355.512 B | 374.920 B | +19.408 B |
| Arquivos no boot | 13 | 13 | 0 |
| Chunk principal JS | 81.179 B | 100.231 B | +19.052 B |

Novos chunks gzip: lista 1.688 B, detalhe 1.277 B, editor 6.112 B, validação 1.217 B e hook/serviço 1.694 B. Mesmo somando incremento do principal e novos chunks do editor, o incremento fica abaixo de 35 KB gzip por rota. O aumento do principal inclui o suporte real de bloqueio de navegação pelo data router. O CSS de boot não aumentou. Os números brutos reproduzíveis estão em `bundle-comparison.json`.

O comando `npm run budget` tem baseline anterior já excedido na base da Fase 4. O relatório registra medidas dos dois builds; não foi aumentado esse orçamento para esconder o desvio existente.

## Revisão e deploy posterior

1. Revisar PR #73 e depois PR #74; a base de #74 é a branch da Fase 4, para evitar repetir seu diff. Exigir todos os jobs do CI no commit final.
2. Conferir versões realmente instaladas no banco vinculado. A tentativa de `supabase migration list --linked` não conseguiu autenticar (token ausente); nenhuma alteração remota foi feita.
3. Antes de aprovar migração, produzir backup recuperável e verificar restauração em ambiente isolado. Backup/restore de produção não foram executados nesta tarefa.
4. Após aprovação explícita do PR/migração, aplicar banco antes do frontend. Até lá, não promover o preview nem fazer merge.
5. Rollback operacional: reverter o frontend e, se necessário, executar o script revisado `supabase/rollbacks/20261122000001_freeze_workout_sheets.sql` para suspender RPCs de escrita. Não remover tabelas, fichas novas, exercícios ou histórico. O script de rollback não foi aplicado em produção.
