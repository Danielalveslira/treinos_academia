# Anexo — Varredura completa de RLS policies e RPCs vs. `has_app_access()`

Anexo do relatório [`AUDITORIA_EXCLUSAO_CONTAS.md`](AUDITORIA_EXCLUSAO_CONTAS.md) (seção "Revisão de 2026-10-16", achado P18). Levantamento somente leitura — nenhum código, migration ou teste foi alterado.

**Metodologia:** grep exaustivo de `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`, `SECURITY DEFINER`, `GRANT`/`REVOKE EXECUTE` em todas as 137 migrations de `supabase/migrations/*.sql`, com extração dos corpos completos e resolução cronológica da versão vigente de cada objeto (quando uma policy/função é recriada em migration posterior com o mesmo nome, só a versão final é listada). Universo: ~93 `CREATE POLICY` e ~156 funções `SECURITY DEFINER`, das quais 119 permanecem acessíveis a `authenticated` (37 têm `REVOKE` explícito e ficam fora desta lista; funções puramente administrativas já gated por `is_superadmin()` e funções de trigger, não invocáveis via RPC direta, também foram excluídas da tabela de RPCs — citadas na introdução da tabela 2).

**`has_app_access()` vigente:** `supabase/migrations/20260926000023_users_new_fields.sql:33-50` (substitui a v1 de `20260926000009_rls_functions.sql:13-29`). Nega acesso se `account_status` for `deleting`/`disabled` (exceto superadmin), nega se há `account_restrictions` ativa, exige e-mail verificado (`email_verified_ok()`, exceto superadmin/contas pré-2026-09-11) e termos aceitos (`legal_policy` vigente). Não há terceira versão nas 137 migrations.

**Coluna "exige has_app_access":**
- **sim** — chama `has_app_access()` diretamente.
- **sim (indireto)** — chama uma função auxiliar que por sua vez chama `has_app_access()` (ex.: `is_community_member()`, `can_post_in_community()`, `can_view_status()`, `can_access_poll()`, `_can_view_workout_status()`).
- **não (parcial)** — tem alguma checagem de estado de conta, mas incompleta (ex.: só `account_status='deleting'`, sem checar `disabled`/`account_restrictions`).
- **não** — nenhuma checagem de estado de conta.

**Coluna "comentário explícito ou inferência" (só para os "não"/"não (parcial)" classificados como intencionais/baixo risco):** indica se o código tem um comentário SQL explícito justificando a ausência do check, ou se a classificação de "intencional/baixo risco" é uma inferência do agente que fez a varredura (lendo o propósito da ação), sem comentário explícito no código confirmando a intenção. **Na prática, não foi encontrado nenhum comentário SQL explícito do tipo "-- intencionalmente sem has_app_access" em nenhum dos objetos abaixo — toda classificação de "baixo risco/intencional" é inferência, não comprovação textual.** Isso está sinalizado em cada linha para evitar a leitura de que a intenção foi confirmada no código.

---

## 1. RLS Policies (versão final de cada uma, 137 migrations)

| Policy | Tabela | Migration:linha (final) | Exige has_app_access | Classificação de risco | Justificativa / comentário explícito ou inferência |
|---|---|---|---|---|---|
| users_select | users | `20260926000010:6` | não | Baixo | `id=auth.uid() OR is_superadmin()` — self-read necessário mesmo banido. Inferência (sem comentário explícito). |
| usernames_select | usernames | `20260926000010:16` | não | Baixo | `using(true)` — público por design (checar disponibilidade de username). Inferência. |
| public_profiles_select | public_profiles | `20260926000010:20` | não | Baixo | `using(true)` — perfil público por design. Inferência. |
| public_profile_statistics_select | public_profile_statistics | `20260926000010:23` | não | Baixo | Gate é `share_statistics` (opt-in), não account_status. Inferência. |
| exercises_all | exercises | `20260926000010:31` | **sim** | — | `user_id=auth.uid() AND has_app_access()` no USING e WITH CHECK. Fato comprovado. |
| workouts_all | workouts | `20260926000010:36` | **sim** | — | Idem exercises_all. Fato comprovado. |
| communities_select | communities | `20260926000010:42` | **sim** | — | `using(has_app_access())`. Fato comprovado. |
| community_members_select | community_members | `20260926000027:44` | não | Baixo/Médio | `user_id=auth.uid() OR is_superadmin() OR is_community_owner(community_id)` — nenhum braço checa status. Dono banido ainda vê lista de membros (leitura, não escrita). Inferência. |
| community_members_insert | community_members | `20260926000010:51` | **sim** | — | `user_id=auth.uid() AND has_app_access() AND community_access_allowed(cid)`. Fato comprovado. |
| community_members_delete | community_members | `20260926000010:53` | não | Baixo | Só `user_id=auth.uid()` — autodestrutivo (saída da comunidade). Inferência. |
| statuses_select | statuses | `20260926000010:58` | **sim (indireto)** | — | `is_community_member(cid) OR is_superadmin()`. Fato comprovado. |
| statuses_insert | statuses | `20260926000029:16` | **sim (indireto)** | — | `author_id=auth.uid() AND can_post_in_community(cid)` → `is_community_member` → `has_app_access`. Fato comprovado. |
| statuses_delete | statuses | `20260926000029:21` | não | **Médio (P18-g)** | `author_id=auth.uid() OR is_superadmin() OR is_community_owner(community_id)`. Braço autor: autodestrutivo (baixo risco). Braço dono-de-comunidade: modera conteúdo de terceiro sem revalidar app-access. Risco real, não inferência de baixo risco. |
| status_votes_select/insert/update | status_votes | `20261031000001:66-72` | **sim (indireto)** | — | `user_id=(select auth.uid()) AND private.can_access_poll(status_id)` → `is_community_member`. Fato comprovado. |
| status_votes_delete | status_votes | `20261031000001:73` | não | Baixo | Só `user_id=(select auth.uid())` — remover o próprio voto, autodestrutivo. Inferência. |
| status_participants_select/insert/delete | status_participants | `20260930000003:14-33` | **sim (indireto)** | — | Todas usam `is_community_member(cid)`. Fato comprovado. |
| support_requests_select | support_requests | `20260926000010:82` | não | Baixo | `user_id=auth.uid() OR is_superadmin()` — precisa funcionar banido (acompanhar o próprio recurso). Inferência. |
| moderation_decisions_select | moderation_decisions | `20260926000010:86` | n/a | — | Só `is_superadmin()` — não acessível por usuário comum. |
| account_restrictions_select | account_restrictions | `20260926000010:90` | não | Baixo | `user_id=auth.uid() OR is_superadmin()` — precisa funcionar banido (ver motivo da própria restrição). Inferência. |
| community_restrictions_select | community_restrictions | `20260926000010:94` | não | Baixo | Idem. Inferência. |
| legal_acceptances_select | legal_acceptances | `20260926000010:98` | não | Baixo | Self-read. Inferência. |
| notices_select | notices | `20260926000010:102` | não | Baixo | `user_id=auth.uid()` — precisa funcionar banido (ver aviso do próprio banimento). Inferência. |
| legal_policy_select / legal_versions_select | legal_policy / legal_versions | `20260926000010:107/110` | não | Baixo | `using(true)` — público por design. Inferência. |
| status_photos_read | storage.objects | `20261028000001:43` | **sim (indireto)** | — | Exige `is_community_member(s.community_id)`. Fato comprovado. |
| status_photos_insert | storage.objects | `20260926000016:20` | não | Baixo | Valida `author_id=auth.uid()` + janela de 10min; depende transitivamente de `statuses_insert` já ter criado a linha pai (que exige `can_post_in_community`). Checagem indireta via outra tabela, não via função direta. Inferência. |
| communities_insert / communities_delete | communities | `20260926000027:17/22` | n/a | — | Só `is_superadmin()` — admin. |
| communities_update | communities | `20260926000027:19` | não | **Médio (P18-f)** | `is_superadmin() OR is_community_owner(id)` — `is_community_owner()` não checa status. Dono banido/desativado edita config da comunidade. Risco real, não inferência de baixo risco. |
| moderation_evidence_insert | storage.objects | `20260926000030:17` | não | Baixo | Ligado a `support_requests` próprio (kind='report') — precisa funcionar banido (enviar prova no próprio recurso). Inferência. |
| moderation_evidence_select | storage.objects | `20260926000030:28` | n/a | — | `is_superadmin()` — admin. |
| wallets_select | wallets | `20260926000035:14` | não | Baixo | Self-read, precisa funcionar banido (ver saldo para disputa). Inferência. |
| economy_transactions_select | economy_transactions | `20260927000001:25` | não | Baixo | Self-read. Inferência. |
| economy_config_select | economy_config | `20260927000001:38` | não | Baixo | `auth.uid() is not null` — config de preços pública para logados, não é dado de usuário. Inferência. |
| economy_daily_select | economy_daily | `20260927000001:56` | não | Baixo | Self-read. Inferência. |
| status_economy_votes_select | status_economy_votes | `20261006000001:20` | não | Baixo | `user_id=auth.uid()` — self-read. Inferência. |
| economy_daily_author_rewards_select | economy_daily_author_rewards | `20260927000002:50` | não | Baixo | Self-read. Inferência. |
| status_economy_reward_daily_select | status_economy_reward_daily | `20260927000002:61` | n/a | — | `is_superadmin()` — admin. |
| community_creation_requests_select | community_creation_requests | `20260927000005:19` | não | Baixo | Self-read. Inferência. |
| cash_purchases_select | cash_purchases | `20260928000001:80` | não | Baixo | Self-read — acompanhar a própria compra mesmo banido. Inferência. |
| promotions_select | promotions | `20260928000001:335` | não | Baixo | Self-read (owner_id). Inferência. |
| promotion_event_limits_select | promotion_event_limits | `20260928000001:355` | não | Baixo | Self-read trivial. Inferência. |
| body_measurements_select | body_measurements | `20260929000002:28` | não | Baixo | Self-read. Inferência. |
| profile_avatar_media_select | profile_avatar_media | `20260929000004:43` | não | Baixo | Self-read. Inferência. |
| profile_avatars_read | storage.objects | `20260929000004:66` | não | Baixo | `auth.uid() is not null` — avatar é conteúdo público por design. Inferência. |
| profile_avatars_insert | storage.objects | `20260929000004:72` | não (parcial) | **Médio (P18-e)** | Exige linha `profile_avatar_media` com `state='allocated'` e <1h, criada por `allocate_profile_avatar()`, que só bloqueia `deleting`. Conta desativada/restrita troca avatar público. Risco real. |
| professional_listings_select / professional_listing_drafts_select | professional_listings / drafts | `20260929000005:42/73` | não | Baixo | Self-read (owner_id). Inferência. |
| published_professional_listings_select | published_professional_listings | `20260929000005:105` | **sim** | — | `using(has_app_access())`. Fato comprovado. |
| showcase_legal_policy_select / showcase_legal_versions_select | — | `20260929000005:121/131` | não | Baixo | `using(true)` — público. Inferência. |
| showcase_legal_acceptances_select / showcase_legal_acknowledgements_select | — | `20260929000005:146` / `20261001000002:17` | não | Baixo | Self-read. Inferência. |
| sponsored_ads_select | sponsored_ads | `20260929000006:59` | não | **Baixo (P18-h)** | Nem o braço global nem o braço "membro" checam app-access. Risco predominantemente cosmético (leitura de anúncio, não dado sensível) — listado como achado formal (P18-h) por completude, não como "intencional sem comentário". |
| sponsored_ads_insert/update/delete | sponsored_ads | `20260929000006:68-73` | n/a | — | `is_superadmin()` — admin. |
| exercise_catalog_public_read | exercise_catalog | `20260930000001:62` | não | Baixo | Catálogo público (`is_active`), não é dado de usuário. Inferência. |
| post_comments_select | post_comments | `20261002000005:4` | **sim (indireto)** | — | `private.can_view_status(...)` → `is_community_member`. Fato comprovado. |
| comment_likes_select_own | comment_likes | `20261002000005:9` | **sim (indireto)** | — | Idem, via `can_view_status`. Fato comprovado. |
| notifications_select_own | notifications | `20261002000005:21` | não | Baixo | `recipient_id=auth.uid()` — precisa funcionar banido (ver notificação do próprio banimento). Inferência. |
| sponsored_ad_daily_stats_select | sponsored_ad_daily_stats | `20261018000001:73` | n/a | — | `is_superadmin()` — admin. |
| exercise_visual_* (style_profiles_select, sets_select, assets_select, drafts_read/insert, references_read, reference_sets_select, reference_assets_select, audit_log_select, deletions_read) | vários | vários (`20261020000001:178-182` e outras) | n/a | — | Todas `is_superadmin()` (+ownership no insert) — ferramenta admin interna. |
| community_covers_read | storage.objects | `20261104000001:18` | não | Baixo | `auth.uid() is not null` — capa de comunidade é conteúdo público/cosmético. Inferência. |
| community_covers_insert / community_covers_update | storage.objects | `20261104000001:23/32` | não | **Médio (P18-f)** | `is_superadmin() OR is_community_owner(c.id)` — mesma lacuna de `communities_update`. Risco real. |

## 2. RPCs `SECURITY DEFINER` acessíveis a `authenticated`

Excluídas desta tabela: ~35 funções puramente administrativas já gated por `is_superadmin()` no corpo (prefixo `admin_*`, `set_account_status`, `queue_deletion`, `set_community_member_ban`, `decide_support_request`, `cancel_promotion`, `resolve_account_financial_case`, `separate_financial_case_and_resume_deletion`, funções de exercise-visual admin, etc. — confirmadas com `is_superadmin()` no corpo); 5 funções-trigger (`returns trigger`: `bump_member_count`, `enforce_status_author_badge`, `queue_deletion_on_delete`, `handle_new_user`, `mark_promotions_target_removed`), não invocáveis via RPC direta pelo cliente.

| RPC | Migration:linha (final) | Exige has_app_access | Classificação de risco | Justificativa / comentário explícito ou inferência |
|---|---|---|---|---|
| accept_legal_documents(jsonb) | `20260926000019:15` | não | Baixo | Self-write (aceite de termos). Inferência. |
| acknowledge_showcase_terms() | `20261001000002:25` | não | Baixo | Self-write. Inferência. |
| ack_greeting_welcome() | `20261024000001:49` | **sim** | — | Chama `has_app_access()` direto. Fato comprovado. |
| allocate_profile_avatar() | `20260929000004:88` | não (parcial) | **Médio (P18-e)** | Só checa `deleting`. Risco real (ver policy correspondente acima). |
| can_post_in_community(uuid) | `20260926000029:4` | **sim (indireto)** | — | Via `is_community_member`. Fato comprovado. |
| cancel_my_cash_purchase(uuid) / request_infinitepay_cash_purchase_cancellation(uuid) | `20261015000004:11/36` | não | Baixo | Só ownership — cancela a própria compra pendente, autodestrutivo. Inferência. |
| cancel_support_request(uuid) | `20260926000019:140` | não | Baixo | Self-close de ticket próprio — precisa funcionar banido. Inferência. |
| cast_vote(uuid, smallint) | `20261028000001:324` | não (parcial) | **Médio (P18-d)** | Checa `deleting` e `account_restrictions`, mas não `disabled`. Risco real. |
| comment_create / comment_edit / comment_set_like / comment_report | `20261002000004` | **sim (indireto)** | — | Todas via `private.can_view_status()` → `is_community_member`. Fato comprovado. |
| comment_delete | `20261002000004:239` | não | **Médio (P18-g)** | Braço autor: autodestrutivo (baixo risco). Braço `can_moderate_status` (superadmin ou dono de comunidade): não checa app-access do moderador. Risco real. |
| count_workout_participants / count_workout_participants_batch | `20261006000003:78` / `20261017000001:32` | **sim (indireto)** | — | Via `_can_view_workout_status` → `is_community_member`. Fato comprovado. |
| create_community(...) | `20261008000003:139` | **sim (indireto, custom)** | Baixo | Via `private.community_creation_state()` (account_status='active' + sem restrição + email verificado) — falta só o braço de `legal_policy` comparado ao `has_app_access()` oficial. Inferência de baixo risco residual. |
| create_community_with_cash(...) | — | — | — | **Removida** (`drop function` em `20261008000003`) — substituída por `create_community`. Não acessível hoje; citada só para registro histórico. |
| create_professional_listing(text) | `20260929000005:160` | não (parcial) | **Alta (P18-c)** | Só checa `deleting`. Risco real. |
| create_promotion(...) | `20261028000001:194` | não (indireto, custom quase completo) | Baixo | Checa `deleting`, `disabled` e `account_restrictions` explicitamente — equivalente manual ao `has_app_access`, só sem `legal_policy`/email. Inferência de baixo risco residual. |
| delete_professional_listing(uuid) | `20260929000005:568` | não | Baixo | Autodestrutivo (deleta a própria vitrine), sem check. Inferência. |
| ensure_user_profile() | `20260926000021:5` | não | Baixo | Bootstrap idempotente do próprio perfil, sem check — precisa funcionar mesmo sem app-access (é o que detecta o estado). Inferência. |
| get_community_access(uuid) | `20261022000001:177` | **sim** | — | Chama `has_app_access()` direto. Fato comprovado. |
| get_my_* (deletion_status, deletion_review, evocoin_day, professional_listing, push_status, wallet) | vários | não | Baixo | Leitura pura do próprio dado — precisa funcionar mesmo banido (ex.: ver status da própria exclusão). Inferência. |
| get_offline_feature_flags() | `20261016000003:20` | não | Baixo | Config global, não é dado de usuário. Inferência. |
| get_poll_results / get_poll_results_batch | `20261031000001:90/101` | **sim (indireto)** | — | Via `private.can_access_poll()` → `is_community_member`. Fato comprovado. |
| join_community(uuid) | `20261023000001:12` | **sim** | — | Chama `has_app_access()` direto. Fato comprovado. |
| list_community_creation_products() | `20261008000003:122` | não | Baixo | Catálogo público de preços. Inferência. |
| list_post_economy_voters(...) | — | — | — | **Removida** (2026-11-05, verificação F1.1: `drop function if exists public.list_post_economy_voters(uuid, smallint, timestamptz, integer)` em `supabase/migrations/20261006000001_post_support_reactions.sql:17`, por privacidade — devolvia a direção do voto de qualquer membro). Substituída por `list_post_supporters(...)`, já listada abaixo. Confirmado: `to_regprocedure` não encontra a função em banco com as 138 migrations aplicadas. Citada só para registro histórico. |
| list_post_supporters(...) | `20261006000002:12` | **sim** | — | Chama `has_app_access()` direto (nome da migration sugere desenho "fail-closed"). Fato comprovado. |
| list_progress_days(...) | `20260929000003:14` | **sim** | — | Chama `has_app_access()` direto. Fato comprovado. |
| list_published_professional_listings(...) | `20260929000005:659` | **sim** | — | Chama `has_app_access()` direto. Fato comprovado. |
| list_workout_participants(...) | `20261006000003:31` | **sim (indireto)** | — | Via `_can_view_workout_status`. Fato comprovado. |
| notifications_mark_read / notifications_archive | `20261014000005:104/126` | não | Baixo | Self-write em notifications — precisa funcionar banido (marcar como lida a notif. do próprio banimento). Inferência. |
| prepare_professional_listing_publish(...) | `20261002000001:26` | não (parcial) | **Alta (P18-c)** | Só checa `deleting`. Risco real. |
| push_delivery_ack(...) | `20261014000007:226` | não | Baixo | Não usa `auth.uid()` — chaveada por hash de token opaco, desenhada para rodar sem sessão de usuário. Inferência. |
| record_ad_events(jsonb) | `20261019000001:20` | **sim** | — | Chama `has_app_access()` (confirmado no corpo). Fato comprovado. |
| record_offline_telemetry(jsonb, uuid) | `20261016000003:61` | não | Baixo | Telemetria própria, rate-limited, não sensível. Inferência. |
| record_promotion_event(...) | `20260928000001:532` | não | Baixo | Grava clique/visualização em promoção — não sensível. Inferência. |
| record_support_evidence(uuid) | `20260926000030:36` | não | Baixo | Ligado a support_request próprio — precisa funcionar banido (enviar prova no recurso). Inferência. |
| refresh_public_statistics() | `20260926000014:15` | não | Baixo | Recalcula estatística pública do próprio usuário — cosmético. Inferência. |
| register_push_subscription(...) | `20261102000002:96` | não (indireto, custom) | Baixo | Delega a `private.write_push_subscription`, que checa `account_status not in ('disabled','deleting')` — mais fraco que `has_app_access` (sem restrictions/legal/email) mas cobre o caso mais importante (`disabled`). Inferência de baixo risco residual. |
| register_qualified_activity() | `20261009000003:71` | **sim** | — | Chama `has_app_access()` direto. Fato comprovado. |
| remove_community_member(uuid, uuid) | `20261022000001:135` | **sim** | — | Chama `has_app_access()` direto, além de `is_superadmin()`/`is_community_owner()` para a permissão de ação. Fato comprovado. |
| remove_profile_avatar() | `20260929000004:174` | não | Baixo | Autodestrutivo (remove o próprio avatar), sem check. Inferência. |
| request_cash_purchase(...) | — | — | — | **Removida** (2026-11-05, verificação F1.1: `drop function if exists public.request_cash_purchase(text, text)` em `supabase/migrations/20261015000005_remove_mercadopago_runtime.sql:17`, junto com o runtime do Mercado Pago). Confirmado: `to_regprocedure` não encontra a função em banco com as 138 migrations aplicadas. O fluxo atual é `reserve_infinitepay_cash_purchase(uuid,text)` — `revoke all` de clientes, só chamada pela Edge Function `infinitepay-create-checkout`, que já exige `has_app_access()` antes de chamá-la (`supabase/functions/infinitepay-create-checkout/core.js:23-24`). Ver P18-b reclassificado em `AUDITORIA_EXCLUSAO_CONTAS.md` — a RPC em si só checa `deleting` internamente (`20261015000002_infinitepay_checkout_failure.sql:53-54`), um residual de defesa em profundidade de gravidade Baixa, não Alta, já que não é alcançável diretamente por cliente hoje. |
| save_body_check_in(jsonb) | `20260929000002:37` | não (parcial) | Baixo | Só checa `deleting`. Dado próprio (peso/medidas) — mesma lacuna estrutural, mas sem efeito sobre terceiros/dinheiro/conteúdo público. Inferência. |
| save_exercise_order(uuid[]) | `20260926000032:3` | não | Baixo | Reordena os próprios exercícios, sem check. Inferência. |
| save_professional_listing_draft(...) | `20260929000005:201` | não (parcial) | **Alta (P18-c)** | Só checa `deleting`. Mesma lacuna de create/prepare. Risco real. |
| set_birth_info(jsonb) | `20260926000021:141` | não | Baixo | Self-write de sexo/nascimento, sem check. Inferência. |
| set_greeting_voice(text) / set_training_preferences(jsonb) | `20261024000001:26` / `20261001000001:14` | **sim** | — | Ambas chamam `has_app_access()` direto. Fato comprovado. |
| set_usage_profile(text) | `20260926000023:57` | não | Baixo | Self-write, sem check. Inferência. |
| set_username(text) / update_user_profile(jsonb) | `20260926000021:33` / `20260926000024:3` | não | **Alta (P18-a)** | Nenhum check de `account_status`. Risco real. |
| submit_support_request(jsonb) | `20261003000001:42` | não (parcial) | Baixo | Só checa `deleting` — precisa funcionar banido/restrito (é o canal de recurso). Inferência (embora também permita abrir denúncia contra terceiro enquanto banido, não classificado como achado formal por ser o canal de defesa do próprio usuário). |
| sync_workout_mutations(jsonb, uuid) | `20261016000001:289` | **sim** | — | Chama `has_app_access()` direto. Fato comprovado. |
| touch_user_activity() | `20261011000001:30` | não | Baixo | Heartbeat de atividade, sem check, trivial. Inferência. |
| unregister_push_subscription(text) | `20261102000002:105` | não | Baixo | Autodestrutivo (revoga a própria inscrição push), sem check. Inferência. |
| upgrade_community_tier(...) | `20261008000003:240` | **sim (indireto, custom)** | Baixo | Via `private.community_creation_state()`, mesmo padrão de `create_community`. Inferência de baixo risco residual. |

## 3. Lista destacada — os 8 objetos de risco real (= achado P18 do relatório principal)

| # | Objeto(s) | Gravidade proposta | Ref. no relatório |
|---|---|---|---|
| 1 | `set_username`, `update_user_profile` | Alta | P18-a |
| 2 | `request_cash_purchase` | Alta | P18-b |
| 3 | `create_professional_listing`, `prepare_professional_listing_publish`, `save_professional_listing_draft` | Alta | P18-c |
| 4 | `cast_vote` | Média | P18-d |
| 5 | `allocate_profile_avatar` + policy `profile_avatars_insert` | Média | P18-e |
| 6 | `communities_update`, `community_covers_insert`/`update` | Média | P18-f |
| 7 | `statuses_delete`, `comment_delete` (braço de moderação por dono de comunidade) | Média | P18-g |
| 8 | `sponsored_ads_select` | Baixa | P18-h |

Todos os demais objetos "não"/"não (parcial)" desta varredura foram classificados como baixo risco por **inferência** (leitura do propósito da ação: self-read necessário para o próprio usuário acompanhar seu banimento/recurso, ação autodestrutiva, ou dado público por design) — **nenhum deles tem um comentário SQL explícito no código confirmando essa intenção**. Isso significa que a classificação de "baixo risco" é uma avaliação desta auditoria, não uma garantia documentada pelo time que escreveu o código.

Nenhuma correção foi proposta ou implementada neste anexo — é só o levantamento de fatos, conforme solicitado.
