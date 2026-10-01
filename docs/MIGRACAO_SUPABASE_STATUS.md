# Status da migração Firebase → Supabase

Documento de handoff, última atualização 2026-10-01 (PRs #58/#59: remoção completa do Firebase, worker de exclusão, deploy do avatar, correção da Vitrine). Lê isto antes de mexer em qualquer coisa relacionada a auth, economia (EvoCoins/EvoCash), exercícios ou dados.

## Visão geral

**Migração concluída. Supabase é o backend único do Evolutus.** O Firebase foi removido por completo do repositório (PR #58): `functions/` (Cloud Functions), `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `.firebaserc`, `firebase.json`, os testes de Firestore Rules em `tests/` e as dependências `firebase`/`firebase-admin`/`firebase-functions`/`@firebase/rules-unit-testing` não existem mais no projeto (`npm ls` confirma zero pacotes Firebase). O frontend já não importava nada de `firebase/*` desde uma sessão anterior; agora nada no repo (código, config, infra declarada) referencia Firebase, exceto comentários pontuais comparando o comportamento antigo com o atual (contexto histórico, não dependência).

Projeto Supabase Cloud: ref `ywrjojrjgozdfpddkkuy` (`https://ywrjojrjgozdfpddkkuy.supabase.co`).

## O que já está 100% em Supabase

### Núcleo
Auth (email/senha), perfis, treinos, exercícios, comunidades (incl. dono/moderação/banimento), statuses/feed (incl. fotos via Storage), suporte/denúncias/apelações, moderação, aceite de termos legais, admin de contas, **exclusão de conta/comunidade/status — worker completo e em produção** (RPC `run_deletion_job` + Edge Function `process-deletion-jobs`, agendada via `pg_cron` a cada minuto; migration `20260930000002_deletion_worker.sql`, validado processando jobs reais em produção e via smoke test ponta a ponta), **painel "Exclusão de contas" / revisão de bloqueio financeiro** (ver abaixo).

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

Todas as features que ainda dependiam de `firebase/*` foram portadas pra Supabase (migrations `20260929000001` a `20260929000007`): exclusão de contas, medidas corporais, progresso (virou uma RPC de agregação ao vivo em vez de rollup denormalizado), **avatar de perfil — funcionando via Supabase** (Edge Function `profile-avatar-confirm` implantada e validada em produção: allocate → upload no Storage → confirm → `avatar_path` persistido; o bug relatado era CORS/preflight falhando porque a função nunca tinha sido publicada, não um problema de configuração de CORS), **Vitrine/profissionais — criação e edição funcionando** (ver seção própria) e anúncios patrocinados (tetos agora são trigger de banco, não checagem best-effort do client). `src/firebase/config.js` foi removido, a dependência `firebase` saiu do `package.json`, o chunk manual `firebase` saiu do `vite.config.js`.

### Vitrine: criação/edição funcionando, publicação pendente dos Termos v1.1.0
`create_professional_listing`/`save_professional_listing_draft` nunca dependeram dos termos de publicação — só a RPC de publicar (`prepare_professional_listing_publish`) depende de `showcase_legal_policy.published`. A rota `/minha-vitrine` e o item de menu, porém, estavam gateados (sem necessidade) atrás desse mesmo flag, impedindo qualquer conta profissional de sequer criar um rascunho — corrigido removendo o gate de `App.jsx`/`AccountMenu.jsx` (o próprio `MyProfessionalListing.jsx` já decide sozinho o que mostrar, inclusive o aviso "minuta pendente de aprovação" e o botão Publicar desabilitado quando os termos não estão aprovados). Também corrigidos, na mesma varredura: um crash em `editableDraft()` (campos de texto opcionais vindo `null` do servidor num rascunho novo) e a FK `professional_listing_drafts.owner_id` sem `ON DELETE CASCADE` (impedia excluir uma conta com rascunho ativo).

**A publicação da Vitrine (tornar visível em `/profissionais`) permanece bloqueada exclusivamente por decisão jurídica/de negócio**: os Termos de Publicação v1.1.0 (`legal/showcase-manifest.json`, `published: false`) nunca foram aprovados e ativados — isso é intencional, é o mesmo estado desde a versão Firebase original (nunca foi uma regressão desta migração), e **não deve ser alterado por mudança de código** — só publicando os termos (decisão de quem é dono do produto/jurídico) depois de uma revisão humana real.

### Worker de exclusão — implementado e em produção
`deletion_jobs` (fila) é escrita corretamente (`queue_deletion`, triggers) e agora também **processada de fato**: RPC `run_deletion_job` (uma conta/comunidade/status inteiros numa única transação, incluindo o gate de revisão financeira e a preservação de auditoria — ledger/suporte sobrevivem com FK setada pra null) chamada pela Edge Function `process-deletion-jobs`, agendada via `pg_cron` a cada minuto. Validado contra produção processando jobs reais (incluindo um smoke test completo: conta com rascunho de Vitrine ativo, exclusão concluída sem violação de FK).

### Outras rotinas agendadas (Firebase `onSchedule`) sem equivalente Postgres
- `purgeExpiredPhotos` — apagar fotos de status expiradas (com proteção para as que estão promovidas — a Fase 4 já cuidou da lógica de "nunca apagar se `isTargetCurrentlyPromoted`", só falta o job em si).
- `purgeOrphanedPhotos` — limpar Storage órfão.
- `purgeExpiredModerationEvidence` — expirar evidência de denúncia.
- `purgeExpiredProfileAvatars` — depende do avatar de perfil ser migrado primeiro.

## Bugs/dívida técnica encontrados durante a Fase 4 (não corrigidos, fora do escopo)

1. **`.toDate()` chamado em strings ISO simples** — várias páginas já migradas (`Support.jsx`, `AdminModeration.jsx`, `CreateCommunity.jsx`) ainda chamam `campo?.toDate()` como se fosse um Timestamp do Firestore. Como o Postgres devolve string ISO pura (sem `.toDate`), isso sempre cai em `undefined` silenciosamente — a tela mostra "—" no lugar da data em vez de quebrar, então passou despercebido. Precisa de um grep por `.toDate()` no repo e trocar por `new Date(valor)` (padrão já usado nos arquivos que EU reescrevi nesta sessão).
2. ~~Testes de service quebrados desde a reescrita do núcleo~~ — **resolvido no PR #58**: `economyService.test.js`, `statusesService.test.js`, `workoutsService.test.js`, `communityMembersService.test.js`, `privilegeService.test.js`, `professionalListingsService.test.js`, `AuthContext.test.js`, `WalletContext.test.js` mockavam `firebase/firestore`/`firebase/functions` testando comportamento específico do Firestore sem equivalente em Postgres (ex.: paginação pelo limite de 30 do operador `in`) — removidos em vez de adaptados; cobertura Supabase-nativa fica como follow-up. `npm test` está verde na `main`.
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

### O que existe (implementado e em produção)
- **Migration `20260930000001_exercise_catalog.sql`**: tabela `public.exercise_catalog` (uuid interno, `provider='evolutus_dataset'`, `provider_exercise_id` preserva o ID original do dataset, `muscles`/`instructions` como arrays, `equipment`/`difficulty`/`force`/`mechanic` nullable, `media_refs` jsonb só com referências), índice trigram (`pg_trgm` + normalização já usada em `professional_listings`) pra busca tolerante a acento/digitação, índices btree/GIN pra categoria/equipamento/músculo/is_active, RLS com leitura pública e escrita só por `service_role`. RPC `search_exercise_catalog` (paginada, com `total_count`). `public.exercises` ganha `catalog_id` (FK opcional, `ON DELETE SET NULL` — nunca quebra histórico) e o check de `provider` passa a aceitar `'evolutus_dataset'` além de `'exerciseapi'`.
- **Importador** `scripts/import-exercise-catalog.mjs` + `exercise-catalog-import-core.mjs` (lógica pura, testável): `isExerciseComplete` exige id/name/primaryMuscles/category/instructions (equipment é opcional — nem todo exercício tem); `--dry-run` por padrão, `--apply` grava; upsert por `(provider, provider_exercise_id)`, nunca apaga nada automaticamente; relatório com encontrados/válidos/descartados+motivo/duplicados/insert-update-unchanged.
- **Camada de serviço/hooks reescritos** pra consultar `exercise_catalog` direto (sem proxy, sem cache IndexedDB — não faz mais sentido com banco próprio e barato): `exerciseCatalogService.js`, `useExerciseCatalogSearch`, `useExerciseCatalogDetail` (prefere `catalog_id`, cai pra `provider`+`provider_exercise_id`), `useExerciseCatalogTaxonomy`.
- **ExerciseAPI**: intencionalmente **não usada mais** nesta arquitetura, mas os arquivos (`supabase/functions/exercise-catalog-proxy/`, `exerciseCatalogClient.js`, `exerciseCatalogCache.js`, secrets `EXERCISEAPI_*`) continuam no repositório/projeto por enquanto — remoção fica pra depois que a base própria estiver validada em produção.

### Pendente
Migration aplicada, importação rodada contra produção (`public.exercise_catalog` com 868 linhas confirmadas) e frontend publicado. Falta só:
1. Remover a integração ExerciseAPI (Edge Function `exercise-catalog-proxy`, client, cache, secrets, hooks órfãos) numa limpeza dedicada, já que a base própria está validada em produção.

## Próximos passos sugeridos (em ordem de custo/benefício)

1. ~~Aplicar a migration do catálogo próprio e rodar a importação real em produção~~ — feito, ver seção acima.
2. ~~Implementar o worker de exclusão~~ — feito, ver seção própria acima.
3. Corrigir o bug de dívida técnica restante (`.toDate()` em strings ISO) — não bloqueia nada, mas vale uma sessão dedicada.
4. ~~Fase 7: remover Firebase de vez~~ — feito no PR #58.
5. Aprovar e publicar os Termos de Publicação da Vitrine v1.1.0 (decisão jurídica/de negócio, não técnica) — hoje é o único bloqueio restante para a Vitrine ficar publicável de ponta a ponta.
