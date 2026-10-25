# Home V2 — integridade e métricas

Esta alteração pertence ao PR #76, cuja base permanece `feat/workout-sheets` (#75).
Não requer alteração de produção nesta rodada. A migration original ainda inédita em produção foi corrigida.

## Associação histórica

`workouts.sheet_id` é um fato do INSERT, não um campo editável. A FK composta mantém
`(sheet_id,user_id)` e usa `ON DELETE SET NULL (sheet_id)` (PostgreSQL 17): nunca anula
`user_id`. O trigger de imutabilidade bloqueia atribuir, trocar e limpar a ficha por UPDATE,
e também bloqueia trocar o exercício de um registro atribuído. Peso, repetições e nota
continuam editáveis mesmo depois de arquivar ou retirar um exercício oficial.

A API pública só permite arquivar fichas, preservando os vínculos históricos. Se uma manutenção
privilegiada excluir fisicamente uma ficha, apenas a ação da FK pode limpar a referência:
a guarda SECURITY DEFINER verifica que o pai já não existe, independentemente de RLS ou JWT.
Não há flag de sessão configurável pelo cliente, nem triggers desativados. O trigger existente
de exclusão da conta continua removendo as fichas antes da biblioteca; a limpeza da FK é
compatível com essa ordem e as cascatas de exclusão dos treinos da conta.

A validação de INSERT usa `private.sheet_actor()` (JWT, sessão ativa e acesso), a biblioteca
do próprio dono, a associação real e a disponibilidade do catálogo oficial. Locks SHARE seguem
a ordem ficha → exercício da biblioteca → catálogo. O nome do trigger faz essa guarda rodar
antes da validação oficial preexistente (que bloqueia o catálogo), evitando ordem inversa.
Os RPCs de edição/arquivamento já bloqueiam a ficha com FOR UPDATE; retirar itens e arquivar
não podem ocorrer entre a validação e o commit do registro. Despublicar/desativar o exercício
também conflita com os locks. Nenhuma guarda nova é exigida em edições históricas legítimas.

## Significado dos indicadores

- Planejamento: itens e metas cadastrados na ficha.
- Utilização: registros persistidos com `sheet_id` validado no INSERT.
- Conclusão: `complete_workout_session()` continua sendo um evento diário, com esforço e
  recompensa validados pelo servidor, sem identificador de sessão por ficha. Não comprova
  conclusão individual e não é usado para inferir esse fato.

A Home mostra **Última ficha utilizada**, **Última atividade** e **Mais dias com registros**.
Um dia com vários exercícios conta uma vez. A interface informa que atividade não comprova
conclusão. Quando a recomendada já tem atividade no dia, informa isso e não mostra o selo
"Recomendado para hoje". Recência usa a data real do registro (`workouts.date`), com carimbo
servidor como desempate; são datas autodeclaradas de atividade, nunca evidência de conclusão.
O mês e o limite de hoje são calculados no PostgreSQL em `America/Sao_Paulo`; datas futuras
não inflam os indicadores. Não há associação retroativa com registros livres antigos.

`get_my_sheet_insights()` retorna numa consulta até 40 fichas ativas, mais os dois candidatos
históricos (última utilização e maior atividade mensal), inclusive arquivados. Transfere apenas
resumos; nenhuma janela de 60 dias, histórico bruto ou consulta por ficha no navegador. O índice
parcial `(user_id,sheet_id,date DESC) INCLUDE(created_at)` suporta a leitura por usuário. O script
`home-v2-sql-evidence.mjs` mede planos reais com 2.001 registros e exercita duas conexões reais
competindo por arquivamento, retirada de item, retirada oficial e INSERT.

## Offline e cache

O protocolo da outbox é uma lista fechada de campos, com compactação de create/update,
recibos idempotentes, reconciliação de ACK perdido e controle de versões. Incluir `sheet_id`
com segurança exigiria migrar em conjunto o payload, a compactação e a reconciliação entre
clientes antigos/novos, inclusive quando uma ficha for arquivada antes do envio. Essa mudança
fica fora desta correção. Novos registros que só existem offline continuam sincronizando como treino livre. Atualizações de
registros já atribuídos preservam o vínculo, inclusive na representação local, sem duplicar
registros ou recompensas. A Home avisa essa exclusão dos indicadores e o registro pendente
numa ficha emite aviso específico. Os indicadores não representam todas as execuções do usuário.

A chave `home-sheet-activity:{uid}:{dia-SP}` integra `invalidateWorkoutCache`. O hook observa
invalidações e agrupa um lote de eventos numa microtask; `fetchCached` deduplica consumidores.
Isso atualiza também a interface montada, sem polling. Registro/edição/exclusão, confirmação de
finalização, mutações de ficha e ACKs da outbox invalidam a consulta. A notificação de sincronização
entre abas invalida apenas o usuário correspondente. Mudança de conta troca o escopo sem reusar
os dados da conta anterior. Mudar o dia troca a chave usando a renderização do relógio já existente
da foto, sem adicionar timer.

## Fotografias e desempenho

As duas fotos aprovadas e os assets AVIF/WebP permanecem. Há um único timeout para meia-noite
SP e revalidação em visibilitychange/pageshow; suspensão prolongada recalcula o dia diretamente.
Só a foto necessária é carregada. Falha tenta a outra aprovada; se ambas falharem, permanece um
fundo fixo com contraste, sem loop nem layout shift. Tokens próprios de contraste sobre fotografia
são compartilhados pelos temas, sem usar texto escuro do tema claro sobre o fundo fotográfico.

O budget existente já falha no HEAD anterior: 374.456 B JS gzip, 78.145 B CSS gzip e 13 arquivos,
contra baseline antigo de 320.749 B / 75.572 B / 6 arquivos. A build inicial desta correção mediu
375.168 B / 78.269 B / 13 arquivos: +712 B JS e +124 B CSS (sem aumentar arquivos nem limites).
Parte do custo herdado vem das entradas públicas incluídas no precache. O baseline não foi
alterado para ocultar a diferença. As medições finais e resultados oficiais são registrados no PR.

## Arquivos da correção

- Banco: `supabase/migrations/20261123000001_workout_sheet_attribution.sql`,
  `supabase/tests/workout_sheet_attribution_test.sql`, `supabase/tests/home_sheet_insights_test.sql`.
- Home: `src/features/home/RecommendedSheetPanel.jsx`, `recommendSheet.js`, `useSheetInsights.js`
  e os testes de painel, recomendação e rotação (`useDailyBanner.test.js`).
- Cache: `src/hooks/useCachedQuery.js` e teste novo, `src/utils/pageCache.js` e teste,
  adaptação do stub em `src/hooks/useSponsoredAds.test.js`.
- Escrita/sincronização: `src/services/workoutsService.js`, `src/pages/NewWorkout.jsx`,
  `src/services/offline/syncScheduler.js`, `outbox.js` e teste de preservação local.
- Fichas: `src/features/workoutSheets/workoutSheetsService.js` e teste de RPC.
- Apresentação: `src/components/ResponsivePicture.jsx`, `src/styles/app.css`.
- Verificação: `scripts/home-v2-browser-smoke.mjs`, `scripts/home-v2-sql-evidence.mjs`,
  `.github/workflows/supabase-tests.yml` e este documento.

## Evidência oficial

A primeira execução corretiva no Actions (`40237032754`) aprovou o job SQL: 78 suítes,
3.349 assertions pgTAP, quatro cenários reais de concorrência e 207 testes de funções.
A RPC completa mediu 5,380 ms com 2.001 registros nessa execução. Uma consulta simplificada
feita sob RLS custou 353,339 ms; a evidência final passou a extrair e explicar o SQL exato da RPC,
executado no mesmo contexto privilegiado dela e com filtro explícito por dono. Não confundir
os dois planos nem usar o plano simplificado para avaliar o custo real da Home.

No Codespace, a inicialização dos serviços auxiliares e a rede Docker não são reproduzíveis:
foi possível aplicar todas as migrations em base descartável com ajuste temporário de DNS,
mas o health check do GoTrue encerrou a base antes da suíte completa local. O job SQL oficial,
isolado no runner GitHub, é a prova completa do banco; não foram usados mocks para validar
constraints, segurança, cascatas ou concorrência. Nenhuma conexão remota de produção foi usada.
