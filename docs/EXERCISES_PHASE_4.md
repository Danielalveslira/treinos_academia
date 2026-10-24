# Catálogo Evolutus — Fase 4

Redesenho mobile-first do Catálogo Evolutus (descoberta, busca, cards e ficha do exercício). Não altera o ciclo de vida administrativo, RLS, criação de treinos, histórico ou a Fase 3 (exercícios oficiais). Não implementa a Fase 5 (offline seletivo): o módulo "Uso offline" existente só foi reposicionado.

## O que mudou

**Vitrine sempre preenchida.** `useExerciseCatalogSearch` não trata mais "sem busca e sem filtro" como "sem intenção": a primeira página de exercícios publicados (até 20, via `search_exercise_catalog`) carrega sozinha ao abrir o catálogo. Limpar a busca ou os filtros volta a essa mesma vitrine, pelo mesmo caminho paginado -- nunca o catálogo inteiro.

**Separação de cabeçalho.** `Exercises.jsx` esconde o cabeçalho "Exercícios / Sua biblioteca" quando o catálogo está aberto -- `ExerciseCatalog.jsx` tem o seu próprio ("Catálogo Evolutus", descrição curta, "Meus exercícios" para voltar). Os dois nunca aparecem juntos.

**Busca e filtros compactos.** Busca por nome no topo, com botão de limpar. Logo abaixo, atalhos de músculo (`peito`, `dorsais`, `quadriceps`, `ombros`, `biceps`, `triceps`, `abdominais`, `gluteos`) -- só os que existem de fato na taxonomia do catálogo (`useExerciseCatalogTaxonomy`); nenhum grupo agrupado (tipo "Braços") foi inventado, porque a RPC só filtra por um músculo exato por vez. Músculo completo, equipamento, categoria e nível ficam dentro de "Mais filtros" (`<details>`, fechado por padrão, com contador de filtros ativos no resumo). Atalhos e filtros avançados leem/escrevem o mesmo estado (`filters.muscle`).

**Cards em primeiro plano.** Miniatura com proporção fixa (4:3, sem layout shift), nome em até duas linhas, músculo principal e um segundo metadado (equipamento ou categoria -- nunca os quatro juntos). Selo "Com demonstração" só aparece quando START **e** END estão publicados (nunca a partir de uma thumbnail sozinha). Placeholder de imagem ausente ganha o ícone do músculo (`ExerciseCatalogImage` agora aceita um `icon` opcional). Mobile = 1 coluna, tablet (≥600px) = 2, desktop (≥1024px) = 3. "Adicionar" é protegido contra clique duplicado/concorrente (trava por `addingId`) e mostra "Já adicionado" sem depender só de cor.

**Ficha do exercício numa folha, não numa troca de tela.** A ficha usa o `ModalSheet`/`ModalSheetFrame` já adotado no app (mesma base do "Compartilhar progresso" e do planejamento de treino) em vez de substituir a listagem inteira. Foco preso, Escape e restauração de foco ao elemento de origem vêm de lá, sem reimplementação. Como a listagem continua montada por baixo, fechar a ficha preserva busca, filtros, página carregada e posição de rolagem automaticamente. O botão "Adicionar aos meus exercícios" usa o mesmo estado do card (refletem a mudança juntos). Continua reaproveitando os dados já carregados na busca -- nenhuma consulta nova ao abrir a ficha.

**Revisão visual pós-preview.** Ao conferir a tela real (não só os smokes), dois ajustes: (1) o botão "Adicionar" do card não preenchia a largura disponível -- o Primer envolve `<Button loading={...}>` num `<div>` extra (`ConditionalWrapper`, usado pro anúncio de carregamento) mesmo com `loading=false`, e esse `<div>` não é alcançado por `button:last-child`; a correção mira a posição estrutural (`.catalog-card > div:last-child`) em vez de uma classe interna do Primer, que pode mudar. (2) os resumos "Mais filtros"/"Uso offline" eram só texto com `cursor:pointer`, sem nenhuma pista visual de que eram clicáveis -- agora têm aparência de botão de verdade (borda, fundo, ícone + texto + seta que gira ao abrir).

**"Uso offline" virou seção secundária.** `CatalogOfflineStatus` (preservado sem alteração de comportamento) agora mora dentro de um `<details>` "Uso offline", fechado por padrão, depois dos resultados -- não compete mais com o conteúdo na primeira dobra. Nenhum download começa sozinho; o texto do botão continua dizendo a verdade (baixa o catálogo completo).

**Cache offline tratado como parcial quando é parcial.** A UI agora lê `fromCache`/`isPartialCache` (já calculados pelo hook) e mostra um aviso -- "resultados salvos neste aparelho, podem ser só parte do catálogo" quando o snapshot local está incompleto, ou "catálogo completo salvo" quando não está. Nunca finge uma consulta ao vivo quando o resultado veio do IndexedDB.

## Migration (RPC)

`search_exercise_catalog` ordenava por similaridade/nome sem nenhum desempate -- com `limit`/`offset` (não keyset), dois exercícios de mesmo nome não tinham ordem relativa garantida entre uma página e a próxima. `20261121000001_catalog_search_order_tiebreak.sql` acrescenta `ec.id asc` como último critério: aditiva, mesmos parâmetros/retorno/permissões, só o desempate final muda.

## Testes

- `src/hooks/useExerciseCatalogSearch.test.js`: cobre a vitrine automática sem busca/filtro e o retorno a ela depois de limpar o campo, sem travar em branco.
- `src/components/ExerciseCatalog.test.js` (novo): vitrine inicial, atalhos limitados à taxonomia real, estado compartilhado entre atalho/filtro avançado, filtro sem opções nunca renderiza, limpar busca, selo "Com demonstração" só com as duas imagens, "Já adicionado", trava de clique duplicado em "Adicionar", abrir/fechar a ficha preserva a listagem, aviso de cache parcial vs. completo, estados de carregando/erro/vazio, "Uso offline" como seção secundária.
- `supabase/tests/catalog_search_order_test.sql` (novo): paginação sem perder/duplicar exercício em empate de nome e de similaridade, determinismo entre chamadas repetidas, desempate final por id ascendente, `total_count` correto.
- `scripts/phase4-catalog-browser-smoke.mjs` (novo): interface real (`Exercises.jsx`/`ExerciseCatalog.jsx` reais, hooks de catálogo sintéticos) em 320/360/390/430/768/1280px, claro e escuro -- confirma vitrine automática, atalhos reais, "Mais filtros"/"Uso offline" fechados por padrão, selo de demonstração, busca/limpar, abrir/fechar ficha com Escape preservando a lista, e **nenhuma rolagem horizontal em nenhuma largura/tema** (achou e corrigiu uma regressão real: o cabeçalho "Catálogo Evolutus" + botão "Meus exercícios" vazava a tela em 320px antes de `.catalog-heading` virar mobile-first de verdade -- empilhado por padrão, lado a lado só a partir de 600px).

### Execução

- `npm test`: suíte completa.
- `npm run lint`: sem erros novos.
- `npm run build`: aprovado (mesmo aviso pré-existente de chunk acima de 500 kB).
- `node scripts/phase3-exercises-browser-smoke.mjs`: continua aprovado (sem regressão na Fase 3).
- `node scripts/phase4-catalog-browser-smoke.mjs`: aprovado nas 12 combinações de largura × tema.
- Supabase local oficial (`supabase start`): falhou na inicialização do schema neste ambiente (conexão indisponível durante a migração do Realtime) -- mesma limitação já registrada em `docs/EXERCISES_PHASE_3.md`, não relacionada a este código.
- pgTAP PostgreSQL isolado (mesmo método do `scripts/finance-prepare-local.sh`, container único com `scripts/offline-local-supabase-baseline.sql`): todas as 168 migrations do projeto aplicadas em sequência, incluindo a nova. 75 suítes executadas; `catalog_search_order_test.sql` e as demais suítes de catálogo/exercícios (`exercise_catalog_lifecycle_test.sql`, `exercise_catalog_offline_sync_test.sql`, `exercise_reference_integrity_test.sql`, `official_exercises_only_test.sql`) passaram. 4 suítes não relacionadas (`community_member_removal_test.sql`, `exercise_visuals_test.sql`, `exercise_visuals_v2_test.sql`) falharam só por uma lacuna conhecida e documentada do baseline local (`storage.objects` sem o grant que o serviço Storage real concede) -- nada ligado à Fase 4.

## Limitações conhecidas

- A Fase 5 (cache seletivo, download de imagens em lote, sincronização incremental) não foi implementada; só a reorganização visual do módulo offline existente.
- O resultado oficial do CI (GitHub Actions) e o commit efetivamente mesclado são registrados na descrição do PR, não aqui.

## Arquivos

- `docs/EXERCISES_PHASE_4.md`
- `scripts/phase4-catalog-browser-smoke.mjs`
- `src/components/ExerciseCatalog.jsx`
- `src/components/ExerciseCatalog.test.js`
- `src/components/ExerciseCatalogImage.jsx`
- `src/hooks/useExerciseCatalogSearch.js`
- `src/hooks/useExerciseCatalogSearch.test.js`
- `src/pages/Exercises.jsx`
- `src/styles/app.css`
- `supabase/migrations/20261121000001_catalog_search_order_tiebreak.sql`
- `supabase/tests/catalog_search_order_test.sql`
