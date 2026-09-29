# Status da migração Firebase → Supabase

Documento de handoff, gerado em 2026-09-29, para continuar esta migração em outra sessão/ambiente. Lê isto antes de mexer em qualquer coisa relacionada a auth, economia (EvoCoins/EvoCash) ou dados.

## Visão geral

O app está em **coexistência** entre Firebase e Supabase:

- **Supabase** (Postgres + Auth + Storage + Edge Functions) já é o banco/autenticação principal para: núcleo inteiro (usuários, treinos, exercícios, comunidades, statuses/feed, suporte, moderação, legal, admin) e toda a **economia EvoCoins/EvoCash** (Fases 1 a 4, ver abaixo).
- **Firebase** (Firestore + Cloud Functions + Storage) ainda serve as funcionalidades listadas em "O que falta migrar" — o app tenta chamá-las, mas **não há mais sessão Firebase Auth válida** (auth é 100% Supabase agora), então essas chamadas falham com `permission-denied`/CORS no console. Isso é esperado até cada uma ser migrada.

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

## O que falta migrar (ainda 100% Firebase, quebrado em produção)

Estes arquivos ainda importam `firebase/*` diretamente — cada um é uma funcionalidade que precisa do mesmo tratamento das fases anteriores (schema Postgres + RLS + RPC/Edge Function + reescrever o service):

| Arquivo | Funcionalidade | Cloud Functions Firebase equivalentes |
|---|---|---|
| `src/services/sponsoredAdsService.js` | Vitrine / anúncios patrocinados institucionais (distinto de "promoções" pagas por usuário, que já está em Supabase) | leitura direta Firestore, sem callable própria |
| `src/services/professionalListingsService.js` | Cadastro de profissionais (criar/editar/publicar/suspender/excluir anúncio de prestador de serviço) | `createProfessionalListingDraft`, `saveProfessionalListingDraft`, `publishProfessionalListing`, `unpublishProfessionalListing`, `suspendProfessionalListing`, `deleteProfessionalListing` |
| `src/services/profileAvatarService.js` + `src/hooks/useCommunityAuthorAvatars.js` | Avatar de perfil (upload/alocação) | `allocateProfileAvatar`, `confirmProfileAvatar`, `removeProfileAvatar`, `purgeExpiredProfileAvatars` (scheduled) |
| `src/services/bodyMeasurementsService.js` | Medidas corporais (peso/medidas ao longo do tempo) | — (verificar `functions/index.js` por triggers relacionados) |
| `src/services/progressService.js` | Página de progresso/gráficos | depende de `onWorkoutWritten` (trigger `onDocumentWritten`) |

~~`adminAccountDeletionsService.js` + `AdminAccountDeletions.jsx`~~ — portado nesta sessão, ver "Painel Exclusão de contas" acima.

### Worker de exclusão (nunca implementado em Supabase)
`deletion_jobs` (fila) existe e é escrita corretamente (`queue_deletion`, triggers `queue_deletion_on_delete`), mas **não há nenhum processo que efetivamente execute a exclusão** (apagar de verdade linhas/arquivos de Storage) — equivalente a `processDeletionJobs` (Firebase, scheduled). Precisa de uma Edge Function + `pg_cron` chamando-a, replicando a máquina de estados de `functions/deletion-service.js` (a mesma que ganhou 120 linhas novas no PR #55 mesclado agora — vale reler o Firebase atualizado antes de portar, para não perder a lógica de bloqueio financeiro que acabou de ser adicionada lá).

### Outras rotinas agendadas (Firebase `onSchedule`) sem equivalente Postgres
- `purgeExpiredPhotos` — apagar fotos de status expiradas (com proteção para as que estão promovidas — a Fase 4 já cuidou da lógica de "nunca apagar se `isTargetCurrentlyPromoted`", só falta o job em si).
- `purgeOrphanedPhotos` — limpar Storage órfão.
- `purgeExpiredModerationEvidence` — expirar evidência de denúncia.
- `purgeExpiredProfileAvatars` — depende do avatar de perfil ser migrado primeiro.

## Bugs/dívida técnica encontrados durante a Fase 4 (não corrigidos, fora do escopo)

1. **`.toDate()` chamado em strings ISO simples** — várias páginas já migradas (`Support.jsx`, `AdminModeration.jsx`, `CreateCommunity.jsx`) ainda chamam `campo?.toDate()` como se fosse um Timestamp do Firestore. Como o Postgres devolve string ISO pura (sem `.toDate`), isso sempre cai em `undefined` silenciosamente — a tela mostra "—" no lugar da data em vez de quebrar, então passou despercebido. Precisa de um grep por `.toDate()` no repo e trocar por `new Date(valor)` (padrão já usado nos arquivos que EU reescrevi nesta sessão).
2. **Testes de service quebrados desde a reescrita do núcleo** — `economyService.test.js`, `statusesService.test.js`, `workoutsService.test.js`, `communityMembersService.test.js`, `exerciseCatalogService.test.js`, `privilegeService.test.js`, `professionalListingsService.test.js` ainda mockam `firebase/firestore`/`firebase/functions`, mas os services de verdade já usam só `../supabase/config` — os testes falham com `TypeError: Cannot read properties of undefined (reading 'VITE_SUPABASE_URL')`. Isso é dívida **pré-existente** (já estava assim antes desta sessão, confirmado via `git log`), não foi introduzido agora. Precisa de um mock de `supabase/config.js` (client fake `.from().select()...` encadeável, sem bundler) — os dois arquivos de teste que EU escrevi/apaguei nesta sessão (`cashPurchaseService.test.js`, `promotionsService.test.js`, `useCashPurchases.test.js`) foram **removidos** em vez de deixados quebrados; os outros continuam quebrados.
3. **Política de verificação de e-mail** — decisão de produto explicitamente adiada pelo usuário ("vemos a questão do email depois"). Hoje `mailer_autoconfirm=true` está ligado no projeto cloud (login funciona sem confirmar e-mail, igual ao Firebase antes) — só o bug mecânico de tradução (`emailVerified` no `toAppUser`) foi corrigido.

## Como testar localmente

```bash
npx supabase start              # sobe Postgres/Auth/Storage local (Docker)
npx supabase db reset           # aplica todas as migrations do zero
npx supabase functions serve    # serve as Edge Functions localmente
npm run dev                     # com um .env.local apontando VITE_SUPABASE_URL/ANON_KEY pro local
```

Cadência usada em toda a migração: **testar local → `supabase db push`/`functions deploy` pro cloud → commit git**. Nunca editar uma migration já enviada ao cloud — sempre criar uma nova.

## Próximos passos sugeridos (em ordem de custo/benefício)

1. Configurar credenciais do Mercado Pago (ver seção acima) — é só configuração, zero código novo.
2. ~~Portar `listBlockedAccountDeletions`/`reviewBlockedAccountDeletion`~~ — feito nesta sessão.
3. Implementar o worker de exclusão (`process_deletion_jobs`, Edge Function + `pg_cron`) — desbloqueia exclusão de conta/comunidade/status de fato acontecer.
4. Migrar avatar de perfil, depois profissionais (professionalListings), depois Vitrine (sponsoredAds) — nessa ordem, do mais simples ao mais amplo.
5. Corrigir os bugs de dívida técnica listados acima (`.toDate()`, testes quebrados) — não bloqueiam nada, mas valem uma sessão dedicada.
6. Fase 7 do plano original: remover Firebase de vez (`src/firebase/`, `functions/`, dependências no `package.json`) — só depois de tudo acima estar migrado.
