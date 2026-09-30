# Status da migração Firebase → Supabase

Documento de handoff, última atualização 2026-09-29 (sessão de integração da ExerciseAPI). Lê isto antes de mexer em qualquer coisa relacionada a auth, economia (EvoCoins/EvoCash), exercícios ou dados.

## Visão geral

O **frontend** já não importa nada de `firebase/*` — as 5 features que ainda dependiam dele (Vitrine, profissionais, avatar de perfil, medidas corporais, progresso) foram portadas pra Supabase, e a dependência `firebase` + `src/firebase/config.js` foram removidas do app (confirmado: o chunk `firebase` sumiu do build de produção). `functions/` (Cloud Functions), `firestore.rules`, `storage.rules` e seus testes **continuam no repo de propósito** — é a Fase 7 (descomissionar de vez a infra Firebase) que ainda não rodou, só o consumo do frontend foi cortado.

Projeto Supabase Cloud: ref `ywrjojrjgozdfpddkkuy` (`https://ywrjojrjgozdfpddkkuy.supabase.co`).

## O que já está 100% em Supabase

### Núcleo
Auth (email/senha), perfis, treinos, exercícios, comunidades (incl. dono/moderação/banimento), statuses/feed (incl. fotos via Storage), suporte/denúncias/apelações, moderação, aceite de termos legais, admin de contas, exclusão de conta/comunidade (fila `deletion_jobs`, mas **sem worker ainda** — ver pendências), **painel "Exclusão de contas" / revisão de bloqueio financeiro** (ver abaixo).

### Painel "Exclusão de contas" (PR #55, portado nesta sessão)
`deletion_financial_reviews` (histórico de revisão, equivalente a `deletionJobs/{jobId}/financialReviews`), RPCs `list_blocked_account_deletions()`/`review_blocked_account_deletion()` (security definer, superadmin-only, mesma lógica de `_reactivate_deletion_if_clear`: nunca altera saldo/ledger, só reavalia o bloqueio com os valores reais e atuais). `src/services/adminAccountDeletionsService.js` reescrito para `supabase.rpc(...)`; `AdminAccountDeletions.jsx` só teve o mapeamento de erro ajustado (código Firebase → `err.message` de exceção Postgres). Validado rodando as 43 migrations do zero contra a imagem `supabase/postgres` (Docker) e exercitando as duas RPCs manualmente via `psql` (listagem, bloqueio mantido, bloqueio liberado, corrida `NOT_BLOCKED`, `PERMISSION_DENIED`) — não deu para rodar `supabase start` completo neste ambiente (o container do Realtime não conecta ao Postgres a tempo, aparentemente limitação de recursos do sandbox), mas a base de dados/RPCs em si foram confirmadas.

### Economia — Fase 1 (carteira, ledger, atividade)
`wallets`, `economy_transactions` (ledger idempotente por `natural_key`), `economy_config` (config jsonb), `register_qualified_activity()`.

### Economia — Fase 2 (votação)
`status_economy_votes`, `cast_vote()`, `settle_vote_rewards()` (pg_cron a cada 5min), antifraude com 4 limites.

### Economia — Fase 3 (criação de comunidade paga)
`community_creation_requests`, `create_community_with_cash()`.

### Economia — Fase 4 (compra de EvoCash + promoções) — recém-implementada
- **Compra de EvoCash via Mercado Pago**: `cash_purchases`, RPC `request_cash_purchase()` (reserva idempotente, 1 pendente por vez, preço fail-closed de `economy_config.cashPackages`), Edge Function `mercadopago-create-payment` (gera o pagamento PIX na API do Mercado Pago) e `mercadopago-webhook` (credita automaticamente após revalidar o pagamento direto na API — nunca confia no payload do webhook). `confirm_cash_purchase()`/`cancel_cash_purchase()` continuam como fallback manual do superadmin.
- **Promoções** (destacar post/comunidade): `promotions`, `promotion_event_limits`, RPCs `create_promotion()`/`cancel_promotion()`/`record_promotion_event()`. 4 pacotes reais em `economy_config.promotionPackages`: `post_boost_3d` (25 EvoCash/3 dias), `post_boost_7d` (50/7 dias), `community_boost_7d` (100/7 dias), `community_boost_30d` (300/30 dias).

## ⚠️ AÇÃO NECESSÁRIA: Mercado Pago ainda não está configurado

O código está pronto e implantado (`mercadopago-create-payment`/`mercadopago-webhook` já estão publicadas no projeto Supabase), mas **sem credenciais reais nenhuma compra funciona** — o app mostra "Pagamentos estão temporariamente indisponíveis" de forma graciosa (testado e confirmado, não quebra a tela).

Para ativar:

1. Pegar no painel do Mercado Pago (conta do Daniel, "já tenho conta"): **Access Token** de produção e, se for usar validação de assinatura do webhook (recomendado), o **Webhook Secret**.
2. Configurar como secrets do projeto Supabase:
   ```bash
   npx supabase secrets set MERCADOPAGO_ACCESS_TOKEN=xxxxx MERCADOPAGO_WEBHOOK_SECRET=xxxxx --project-ref ywrjojrjgozdfpddkkuy
   ```
3. Cadastrar no painel do Mercado Pago a URL do webhook:
   `https://ywrjojrjgozdfpddkkuy.supabase.co/functions/v1/mercadopago-webhook`
4. Testar uma compra de verdade em `/evocash` e conferir se o crédito chega sozinho (sem precisar do fallback manual em `/admin/compras-evocash`).

Sem isso, o painel `/admin/compras-evocash` (confirmar/cancelar manualmente) continua funcionando como já funcionava nas fases anteriores — é só o caminho automático que depende dessas credenciais.

## Migração do frontend: concluída

Todas as features que ainda dependiam de `firebase/*` foram portadas pra Supabase (migrations `20260929000001` a `20260929000006`): exclusão de contas, medidas corporais, progresso (virou uma RPC de agregação ao vivo em vez de rollup denormalizado), avatar de perfil (+ Edge Function `profile-avatar-confirm`), profissionais/Vitrine (publish() fica atrás de um portão de termos legais ainda não aprovados — ver seção própria) e anúncios patrocinados (tetos agora são trigger de banco, não checagem best-effort do client). `src/firebase/config.js` foi removido, a dependência `firebase` saiu do `package.json`, o chunk manual `firebase` saiu do `vite.config.js`.

**Pendente**: as 4 primeiras migrations dessa leva (`...0001` a `...0004`) já foram aplicadas no cloud (`supabase db push` rodado nesta sessão); confirmar se `...0005`/`...0006` (profissionais/anúncios) também foram, e se a Edge Function `profile-avatar-confirm` foi implantada (o deploy dela falhou num ambiente sem rota IPv6 pra `jsr.io` — rodar `supabase functions deploy profile-avatar-confirm` de um ambiente com rede normal).

### Worker de exclusão (nunca implementado em Supabase)
`deletion_jobs` (fila) existe e é escrita corretamente (`queue_deletion`, triggers `queue_deletion_on_delete`), mas **não há nenhum processo que efetivamente execute a exclusão** (apagar de verdade linhas/arquivos de Storage) — equivalente a `processDeletionJobs` (Firebase, scheduled). Precisa de uma Edge Function + `pg_cron` chamando-a, replicando a máquina de estados de `functions/deletion-service.js` (a mesma que ganhou 120 linhas novas no PR #55 mesclado agora — vale reler o Firebase atualizado antes de portar, para não perder a lógica de bloqueio financeiro que acabou de ser adicionada lá).

### Outras rotinas agendadas (Firebase `onSchedule`) sem equivalente Postgres
- `purgeExpiredPhotos` — apagar fotos de status expiradas (com proteção para as que estão promovidas — a Fase 4 já cuidou da lógica de "nunca apagar se `isTargetCurrentlyPromoted`", só falta o job em si).
- `purgeOrphanedPhotos` — limpar Storage órfão.
- `purgeExpiredModerationEvidence` — expirar evidência de denúncia.
- `purgeExpiredProfileAvatars` — depende do avatar de perfil ser migrado primeiro.

## Bugs/dívida técnica encontrados durante a Fase 4 (não corrigidos, fora do escopo)

1. **`.toDate()` chamado em strings ISO simples** — várias páginas já migradas (`Support.jsx`, `AdminModeration.jsx`, `CreateCommunity.jsx`) ainda chamam `campo?.toDate()` como se fosse um Timestamp do Firestore. Como o Postgres devolve string ISO pura (sem `.toDate`), isso sempre cai em `undefined` silenciosamente — a tela mostra "—" no lugar da data em vez de quebrar, então passou despercebido. Precisa de um grep por `.toDate()` no repo e trocar por `new Date(valor)` (padrão já usado nos arquivos que EU reescrevi nesta sessão).
2. **Testes de service quebrados desde a reescrita do núcleo** — `economyService.test.js`, `statusesService.test.js`, `workoutsService.test.js`, `communityMembersService.test.js`, `privilegeService.test.js`, `professionalListingsService.test.js` ainda mockam `firebase/firestore`/`firebase/functions`, mas os services de verdade já usam só `../supabase/config` — os testes falham com `TypeError: Cannot read properties of undefined (reading 'VITE_SUPABASE_URL')`. Isso é dívida **pré-existente**, não foi introduzido nesta sessão. Precisa de um mock de `supabase/config.js` (client fake `.from().select()...` encadeável, sem bundler) — ou do padrão de stub via esbuild já usado em `ProfileAvatar.test.js`/`exerciseCatalogService.test.js`/`WorkoutExerciseGuide.test.js` (troca só o módulo que importa `supabase/config`, não o `supabase/config` em si). `exerciseCatalogService.test.js` foi reescrito nesta sessão (não mocka mais Firebase, testa o cache-first/stale-while-revalidate de verdade) e não está mais nessa lista.
3. **Política de verificação de e-mail** — decisão de produto explicitamente adiada pelo usuário ("vemos a questão do email depois"). Hoje `mailer_autoconfirm=true` está ligado no projeto cloud (login funciona sem confirmar e-mail, igual ao Firebase antes) — só o bug mecânico de tradução (`emailVerified` no `toAppUser`) foi corrigido.

## Como testar localmente

```bash
npx supabase start              # sobe Postgres/Auth/Storage local (Docker)
npx supabase db reset           # aplica todas as migrations do zero
npx supabase functions serve    # serve as Edge Functions localmente
npm run dev                     # com um .env.local apontando VITE_SUPABASE_URL/ANON_KEY pro local
```

Cadência usada em toda a migração: **testar local → `supabase db push`/`functions deploy` pro cloud → commit git**. Nunca editar uma migration já enviada ao cloud — sempre criar uma nova.

## Catálogo de exercícios: base própria (imports/exercicios_ptbr.json)

**Segunda virada de estratégia** (a primeira foi migrar do catálogo estático pra ExerciseAPI; esta reverte a ExerciseAPI e adota nosso próprio dataset como fonte). Motivo: controle de qualidade sobre o que entra no catálogo, custo zero por consulta, sem dependência de disponibilidade/cota de terceiro, e (bônus) o dataset já está traduzido pra pt-BR. Arquitetura final:

```
imports/exercicios_ptbr.json (free-exercise-db, licença Unlicense, traduzido)
  → scripts/import-exercise-catalog.mjs (valida, normaliza, upsert idempotente)
  → public.exercise_catalog no Supabase
  → exerciseCatalogService.js (RPC search_exercise_catalog + select direto)
  → Evolutus
```

### O que existe (implementado, migration não deployada ainda)
- **Migration `20260930000001_exercise_catalog.sql`**: tabela `public.exercise_catalog` (uuid interno, `provider='evolutus_dataset'`, `provider_exercise_id` preserva o ID original do dataset, `muscles`/`instructions` como arrays, `equipment`/`difficulty`/`force`/`mechanic` nullable, `media_refs` jsonb só com referências), índice trigram (`pg_trgm` + normalização já usada em `professional_listings`) pra busca tolerante a acento/digitação, índices btree/GIN pra categoria/equipamento/músculo/is_active, RLS com leitura pública e escrita só por `service_role`. RPC `search_exercise_catalog` (paginada, com `total_count`). `public.exercises` ganha `catalog_id` (FK opcional, `ON DELETE SET NULL` — nunca quebra histórico) e o check de `provider` passa a aceitar `'evolutus_dataset'` além de `'exerciseapi'`.
- **Importador** `scripts/import-exercise-catalog.mjs` + `exercise-catalog-import-core.mjs` (lógica pura, testável): `isExerciseComplete` exige id/name/primaryMuscles/category/instructions (equipment é opcional — nem todo exercício tem); `--dry-run` por padrão, `--apply` grava; upsert por `(provider, provider_exercise_id)`, nunca apaga nada automaticamente; relatório com encontrados/válidos/descartados+motivo/duplicados/insert-update-unchanged.
- **Camada de serviço/hooks reescritos** pra consultar `exercise_catalog` direto (sem proxy, sem cache IndexedDB — não faz mais sentido com banco próprio e barato): `exerciseCatalogService.js`, `useExerciseCatalogSearch`, `useExerciseCatalogDetail` (prefere `catalog_id`, cai pra `provider`+`provider_exercise_id`), `useExerciseCatalogTaxonomy`.
- **ExerciseAPI**: intencionalmente **não usada mais** nesta arquitetura, mas os arquivos (`supabase/functions/exercise-catalog-proxy/`, `exerciseCatalogClient.js`, `exerciseCatalogCache.js`, secrets `EXERCISEAPI_*`) continuam no repositório/projeto por enquanto — remoção fica pra depois que a base própria estiver validada em produção.

### Pendente antes de funcionar de verdade
1. Validação local completa (migration + importação real + testes) — feita nesta sessão via container Postgres descartável, não em produção.
2. `npx supabase db push` (migration `...0001` ainda não foi ao cloud, a pedido).
3. `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-exercise-catalog.mjs --apply` contra produção.
4. Deploy do frontend e teste manual (busca, filtro, detalhe, adicionar, "Ver execução").
5. Só depois de tudo confirmado: remover a integração ExerciseAPI (Edge Function, client, cache, secrets, hooks órfãos) numa limpeza dedicada.

## Próximos passos sugeridos (em ordem de custo/benefício)

1. Aplicar a migration do catálogo próprio e rodar a importação real em produção (ver seção acima).
2. Implementar o worker de exclusão (`process_deletion_jobs`, Edge Function + `pg_cron`) — desbloqueia exclusão de conta/comunidade/status de fato acontecer.
3. Corrigir os bugs de dívida técnica listados acima (`.toDate()`, testes quebrados) — não bloqueiam nada, mas valem uma sessão dedicada.
4. Fase 7 do plano original: remover Firebase de vez (`functions/`, `firestore.rules`/`storage.rules` e seus testes) — só depois de tudo acima estar migrado/confirmado.
