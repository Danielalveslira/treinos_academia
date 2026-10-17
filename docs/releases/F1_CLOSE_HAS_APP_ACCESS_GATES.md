# F1 — Fechamento dos gates de has_app_access() e do search_path (P18 + P20)

Decisão do responsável que define o comportamento esperado: **conta `disabled`, com restrição ativa (`temporary_suspension`/`system_ban`) ou banida perde acesso a tudo, exceto** ver o aviso do próprio bloqueio (`notices`), abrir co com as 137 migrations aplicadas, e por busca exaustiva não encontrando nenhuma redefinição posterior. O fluxo atual de compra de EvoCash é `public.reserve_infinitepay_cash_purchase(uuid, text)`, que já tem `revoke all on function ... from public, anon, authenticated` — só a Edge Function `infinitepay-create-checkout` (com `service_role`) a chama; não há RPC cliente para fechar aqui. **P18-b está resolvido sem nenhuma ação nesta migration.**
chamados de suporte (`submit_support_request`) e fazer logout. Nada dessas três exceções foi tocado nesta migration.

Escopo desta fase: só `supabase/migrations/20261105000001_close_has_app_access_gates.sql`, `supabase/rollbacks/20261105000001_close_has_app_access_gates.sql`, `supabase/tests/aud_has_app_access_gates_test.sql` e esta documentação. Nenhum arquivo em `src/`, `supabase/functions/` foi alterado. Nenhuma conexão com banco remoto (dev/produção) foi feita. Nenhum commit foi feito.

## 1. Correção a um achado anterior: `request_cash_purchase` (P18-b) não existe mais

Antes de desenhar a migration, reli o código real de cada objeto listado. `public.request_cash_purchase(text, text)` — que o achado P18-b descrevia como "só checa `deleting`" — **foi removida** por `supabase/migrations/20261015000005_remove_mercadopago_runtime.sql:17` (`drop function if exists public.request_cash_purchase(text, text);`), quando o runtime do Mercado Pago foi desativado. Confirmado por `to_regprocedure('public.request_cash_purchase(text,text)')` retornando `NULL` num ban
## 2. Análise prévia — definição vigente, migration:linha, grants, dependentes

| Objeto | Tipo | Migration:linha vigente (antes) | Grants atuais | Dependentes/impacto de alterar a função auxiliar em vez do objeto |
|---|---|---|---|---|
| `set_username(text)` | RPC | `20260926000021_auth_uid_guards.sql:33` (redefine a de `20260926000011`) | Sem REVOKE — acessível por padrão a `authenticated`/`anon` (bloqueado na prática por `auth.uid() is null`) | — |
| `update_user_profile(jsonb)` | RPC | `20260926000024_update_user_profile_height.sql:3` (redefine a de `20260926000021`, acrescenta `heightCm`) | Idem | — |
| `create_professional_listing(text)` | RPC | `20260929000005_professional_listings.sql:160` | Idem | — |
| `save_professional_listing_draft(uuid,jsonb)` | RPC | `20260929000005_professional_listings.sql:201` | Idem | — |
| `prepare_professional_listing_publish(uuid,text)` | RPC | `20261002000001_professional_listing_publish_recovery.sql:26` (3ª definição; a 1ª em `20260929000005:345` tinha assinatura antiga com `p_terms_accepted`/`p_terms_version`, já substituída) | Idem | — |
| `allocate_profile_avatar()` | RPC | `20260929000004_profile_avatar.sql:88` | Idem | — |
| `profile_avatars_insert` | Policy (`storage.objects`) | `20260929000004_profile_avatar.sql:72` | — | Depende de `allocate_profile_avatar()` ter criado a linha `allocated`; corrigida nas duas pontas |
| `cast_vote(uuid,smallint)` | RPC | `20261028000001_status_expiration.sql:324` (redefine a de `20260927000003`) | Idem | — |
| `create_promotion(text,uuid,text,text)` | RPC | `20261028000001_status_expiration.sql:194` (redefine a de `20260928000001`) | Idem | — |
| `communities_update` | Policy (`public.communities`) | `20260926000027_communities_owner.sql:19-21` | — | Usa `is_community_owner(uuid)` |
| `community_covers_insert`/`update` | Policy (`storage.objects`) | `20261104000001_community_cover_image.sql:23-40` | — | Usa `is_community_owner(uuid)` |
| `statuses_delete` (braço do dono) | Policy (`public.statuses`) | `20260926000029_statuses_owner_and_post_access.sql:21-22` | — | Usa `is_community_owner(uuid)` |
| `comment_delete(uuid)` (braço do dono, via `private.can_moderate_status`) | RPC (wrapper sql → `private.comment_delete` → `private.can_moderate_status`) | `20261002000004_comments_functions.sql:22-37` (`can_moderate_status`), `:209-237` (`comment_delete`) | `can_moderate_status` já tinha `revoke` do blanket `20261014000005`; 1 único chamador | `can_moderate_status` só é usada por `private.comment_delete` — confirmado por grep exaustivo |
| `sponsored_ads_select` | Policy (`public.sponsored_ads`) | `20260929000006_sponsored_ads.sql:59-67` | — | — |

**`is_community_owner(uuid)`** (`20260926000027_communities_owner.sql:7-10`) tem **6 chamadores** além dos 3 objetos acima no escopo: `set_community_member_ban` (2x, `20260926000028`), `community_members_select` (`20260926000027:45`), `remove_community_member` (2x, `20261022000001`, já tem `has_app_access()` próprio). Alterar `is_community_owner()` globalmente afetaria esses 3 objetos **fora do escopo autorizado**. Por isso o gate foi aplicado em cada policy/RPC individualmente — maior número de linhas alteradas, mas raio de impacto restrito exatamente aos 8 objetos do P18. Pelo mesmo raciocínio, `private.can_moderate_status` **foi** alterada diretamente (não só no call site): como só tem 1 chamador, o raio de impacto é idêntico a alterar o call site, mas o diff é menor e mais legível.

## 3. P20 — achado adicional durante a implementação: a migration de hardening já tinha corrigido 6 destes objetos, e minha primeira versão os regrediu

Ao escrever a `CREATE OR REPLACE FUNCTION` para os 6 objetos que não tinham gate (`set_username`, `update_user_profile`, `create_professional_listing`, `save_professional_listing_draft`, `prepare_professional_listing_publish`, `allocate_profile_avatar`), copiei o `search_path = public` do texto-fonte original que eu tinha lido. Rodei a suíte de invariante de search_path (a mesma de `notification_security_test.sql`/`security_followup_test.sql`) depois de aplicar e ela voltou **6 violações**, não 0.

Investigando: `supabase/migrations/20261014000005_security_hardening.sql:13-24` é uma migration de hardening que varre `pg_proc` dinamicamente e aplica `ALTER FUNCTION ... SET search_path = public, pg_temp` em toda função com `proconfig` exatamente `search_path=public` — ela já tinha corrigido esses 6 objetos (todos definidos antes de 2026-10-14) em algum momento da cadeia de migrations. Como meu `CREATE OR REPLACE FUNCTION` usa o texto-fonte original (`search_path = public`, sem `pg_temp`), ele **sobrescreveu e revogou essa correção já aplicada** — exatamente o mesmo tipo de regressão que já tinha acontecido antes com `cast_vote`/`create_promotion` (migration `20261028000001` recriou as duas sem o `pg_temp` que o hardening já tinha adicionado, causando o achado P20 original). Corrigido: os 6 objetos agora usam `search_path = public, pg_temp` (preservando o hardening existente); `cast_vote`/`create_promotion` usam `search_path = ''` (vazio — mais forte que `public, pg_temp`, possível porque toda referência em ambos os corpos já é schema-qualificada, confirmado por varredura programática).

## 4. Objetos alterados — antes/depois

| # | Objeto | Antes | Depois |
|---|---|---|---|
| 1 | `set_username(text)` | Nenhum check de `account_status`/restrição | `if not coalesce(public.has_app_access(), false) then raise exception 'PERMISSION_DENIED'` logo após `NOT_AUTHENTICATED` |
| 2 | `update_user_profile(jsonb)` | Idem | Idem |
| 3 | `create_professional_listing(text)` | Só `account_status='deleting'` → `ACCOUNT_DELETING` | Checagem trocada por `has_app_access()` → `PERMISSION_DENIED` (cobre também `disabled`/restrição/banimento) |
| 4 | `save_professional_listing_draft(uuid,jsonb)` | Idem | Idem |
| 5 | `prepare_professional_listing_publish(uuid,text)` | Idem | Idem |
| 6 | `allocate_profile_avatar()` | Idem | Idem |
| 7 | `profile_avatars_insert` (policy) | `WITH CHECK` só exigia uma linha `allocated` recente do próprio dono | Acrescenta `and (select coalesce(public.has_app_access(), false))` — fecha a janela de até 1h em que uma alocação feita **antes** do bloqueio ainda autorizava o upload **depois** |
| 8 | `cast_vote(uuid,smallint)` | Checava `deleting` e `account_restrictions` manualmente; não checava `disabled`; `search_path=public` | Checagem unificada em `has_app_access()` (cobre `disabled`, que antes vazava — era o próprio achado P18-d original); `COMMUNITY_RESTRICTED` (restrição na comunidade, não na conta) mantido separado; `search_path=''` |
| 9 | `create_promotion(text,uuid,text,text)` | Checava `deleting`, `disabled`, `account_restrictions` manualmente (3 checks, 3 mensagens distintas) | Unificado em `has_app_access()` → `PERMISSION_DENIED` (as 3 mensagens antigas somem; `COMMUNITY_RESTRICTED` mantido); `search_path=''` |
| 10 | `communities_update` (policy) | `is_superadmin() or is_community_owner(id)` | `is_superadmin() or (is_community_owner(id) and (select coalesce(public.has_app_access(), false)))`, em `USING` e `WITH CHECK` |
| 11 | `community_covers_insert`/`update` (policy) | Mesmo padrão de `is_community_owner` sem gate | Mesmo acréscimo de `has_app_access()` ao braço do dono |
| 12 | `statuses_delete` (policy) | `author_id=auth.uid() or is_superadmin() or is_community_owner(community_id)` | Braço do dono ganha `and (select coalesce(public.has_app_access(), false))`; braço do autor (autoexclusão) e do superadmin **não mudam** |
| 13 | `private.can_moderate_status` (usada por `comment_delete`) | `is_superadmin() or c.owner_id=p_uid` | `is_superadmin() or (c.owner_id=p_uid and coalesce(public.has_app_access(), false))` |
| 14 | `sponsored_ads_select` (policy) | `is_superadmin() or (is_global and auth.uid() is not null) or exists(membro)` | Braços de leitura não-admin exigem `(select coalesce(public.has_app_access(), false))` adicionalmente; braço do superadmin não muda |

**Assinaturas, tipos de retorno e grants de todos os 14 preservados** — nenhuma função mudou parâmetros/retorno; nenhuma policy mudou de nome; nenhum GRANT/REVOKE novo foi necessário (CREATE OR REPLACE preserva os existentes).

## 5. Testes — `supabase/tests/aud_has_app_access_gates_test.sql`

79 asserções, organizadas em 15 blocos. Tabela de cobertura por objeto × cenário (✅ = testado e verde nesta sessão):

| Objeto | Ativa (permitido) | `disabled` | `deleting` | `temporary_suspension` | `system_ban` | Superadmin (preservado) |
|---|---|---|---|---|---|---|
| `set_username` | ✅ | ✅ nega | ✅ nega | ✅ nega | ✅ nega | ✅ permite |
| `update_user_profile` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `create_professional_listing` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `save_professional_listing_draft` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `prepare_professional_listing_publish` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `allocate_profile_avatar` + `profile_avatars_insert` | ✅ | ✅ (+ janela residual de 1h fechada, testada à parte) | ✅ | ✅ | ✅ | ✅ |
| `communities_update` (dono) | ✅ | ✅ (0 linhas, sem erro) | ✅ | ✅ | ✅ | ✅ (atualiza comunidade de dono `disabled`) |
| `statuses_delete` (moderação) | ✅ | ✅ (0 linhas) | ✅ | ✅ | ✅ | ✅ |
| `comment_delete` (moderação) | ✅ | ✅ nega (`PERMISSION_DENIED`) | ✅ | ✅ | ✅ | ✅ |
| `cast_vote` | ✅ | ✅ nega (achado P18-d original) | ✅ | ✅ | ✅ | ✅ |
| `create_promotion` | ✅ | ✅ | ✅ | ✅ | ✅ | não testado (ver seção 7) |
| `sponsored_ads_select` | ✅ (2 anúncios) | ✅ (0, sem erro) | ✅ (0) | ✅ (0) | ✅ (0) | ✅ (2) |

Mais:
- `community_covers_insert`/`update` **não têm teste próprio dedicado** nesta suíte (ver seção 7 — risco residual não coberto).
- P20: `select count(*) ... where ... search_path=public isolado` → **0** (era 2 antes; os dois testes de invariante, `notification_security_test.sql` e `security_followup_test.sql`, passam a verde — confirmado na suíte completa).
- `status_expiration_control.enabled` nasce pausado via **DEFAULT da coluna** (`col_default_is`), não por posição na cadeia de migrations.
- `authenticated` inserindo `expires_at` em `public.statuses` → `42501` (confirma o grant por coluna do F0b).
- Mínimo preservado: `disabled`/banida ainda veem o próprio aviso em `notices`, ainda abrem chamado via `submit_support_request` (não há `INSERT` direto do cliente em `support_requests` — achado durante a escrita do teste, mesma classe do achado de `statuses`/F0b: a tabela não tem grant de `INSERT` para `authenticated`, só a RPC tem `search_path` próprio e roda como `security definer`), e ainda leem a própria linha em `public.users`.

## 6. Erros novos visíveis ao frontend (relato, nenhum arquivo em `src/` alterado)

| Objeto | Caminho no frontend | Erro antes | Erro novo para conta bloqueada |
|---|---|---|---|
| `set_username` | `src/services/usersService.js:setUsername` | passava | `Error('PERMISSION_DENIED')` — sem mapeamento especial, mensagem crua (mesmo padrão já usado para qualquer código não listado) |
| `update_user_profile` | `src/services/usersService.js:updateUserProfile` | passava | Idem — `PERMISSION_DENIED` não está na lista `KNOWN`, cai no `|| error.message` |
| `create_professional_listing`/`save_professional_listing_draft`/`prepare_professional_listing_publish` | `src/services/professionalListingsService.js` (`unwrap`) | `ACCOUNT_DELETING` só para `deleting` | `PERMISSION_DENIED` para `disabled`/restrição/banimento também (rethrow puro, sem mapeamento) |
| `allocate_profile_avatar` | `src/services/profileAvatarService.js` | `ACCOUNT_DELETING` só para `deleting` | `PERMISSION_DENIED` mais amplo (rethrow puro) |
| `cast_vote` | `src/services/economyService.js:castVote` | sem erro para `disabled` (bug original P18-d); `ACCOUNT_DELETING`/`ACCOUNT_RESTRICTED` para os outros | `PERMISSION_DENIED` uniforme para todos os estados bloqueados (rethrow puro) |
| `create_promotion` | `src/services/promotionsService.js` | `ACCOUNT_DELETING`/`ACCOUNT_DISABLED`/`ACCOUNT_RESTRICTED` (3 mensagens distintas) | `PERMISSION_DENIED` único (rethrow puro) — **a UI que hoje distinguir essas 3 mensagens para o usuário perde essa distinção**; não encontrei esse mapeamento em `src/` (busca por essas 3 strings fora de `supabase/` não encontrou uso em `promotionsService.js` nem nos componentes que o chamam, então o impacto visível aparenta ser só a mensagem genérica de erro, mas não confirmei todos os pontos de UI que exibem esse erro) |
| `communities_update` (`updateCommunity`/`setCommunityActive`) | `src/services/communitiesService.js` | 0 linhas afetadas por RLS já era possível antes (dono != auth.uid()); agora também ocorre para dono bloqueado | **Sem erro algum** — `.update(...).eq('id', ...)` sem `.select()`/`.single()`; a chamada "sucede" silenciosamente sem persistir nada. Um dono que foi desativado não vê mensagem de erro ao tentar editar a própria comunidade — a tela precisaria reler o estado para notar que nada mudou |
| `community_covers_insert`/`update` | `src/services/communitiesService.js:uploadCommunityCover` | — | O **upload no Storage** falha primeiro (`uploadErr`, 403/42501), antes de chegar ao `update` da tabela — esse sim lança erro (`supabase.storage...upload` propaga o erro do Storage) |
| `statuses_delete` (moderação) | `src/services/statusesService.js:deleteStatus` | 0 linhas se já não fosse autor/dono | Mesmo padrão de `communities_update`: **sem erro**, `.delete().eq('id', statusId)` sem `.select()` — um moderador bloqueado que tenta apagar um post de terceiro não vê erro, o post simplesmente continua lá |
| `comment_delete` | `src/features/comments/api/comments.api.js` | `PERMISSION_DENIED` já existia para não-autor/não-moderador | Mesmo código, agora também disparado para o dono bloqueado tentando moderar — sem mudança de comportamento visível (já era tratado) |
| `sponsored_ads_select` | `src/services/sponsoredAdsService.js` | — | **Sem erro** — é uma policy de `SELECT`; a lista de anúncios simplesmente vem vazia para a conta bloqueada |

**Padrão geral:** nenhum dos serviços de RPC faz mapeamento especial de `PERMISSION_DENIED` hoje — o erro é sempre repassado (`throw error`) tal como os outros códigos não tratados, então não há risco de "tela em branco" ou crash não tratado, mas também não há mensagem amigável explicando "sua conta foi bloqueada" nesses pontos — é um `Error` genérico. Os casos de **policy pura** (`communities_update`, `statuses_delete`, `sponsored_ads_select`) têm uma particularidade importante: como os métodos de serviço usados não chamam `.select()`/`.single()`, **o cliente não recebe nenhum erro** quando a policy nega — a ação simplesmente não tem efeito, silenciosamente. Isso já era verdade antes desta migration para outros casos de negação de RLS (não é uma mudança de comportamento introduzida aqui), mas agora também se aplica à conta bloqueada tentando agir como dona/moderadora.

## 7. Riscos restantes e o que não pôde ser comprovado

- **`create_promotion`**: não testei o cenário de superadmin nesta suíte (criaria uma promoção real debitando EvoCash de uma conta superadmin de teste; decidi não adicionar esse caso para não aumentar ainda mais o fixture só para repetir uma garantia já coberta, de forma equivalente, pelos outros 8 testes de "superadmin permitida" desta mesma suíte). Isso não foi verificado experimentalmente para este objeto específico.
- **`community_covers_insert`/`update`**: não há teste pgTAP dedicado nesta suíte nova (os outros objetos de Storage, `profile_avatars_insert`, têm teste; este não). A lógica é idêntica à de `communities_update` (mesmo padrão `is_community_owner() and has_app_access()`), então a confiança é alta por analogia direta, mas **não foi exercitada por um teste automatizado**.
- **Mensagens de erro específicas perdidas**: `create_promotion` tinha 3 mensagens distintas (`ACCOUNT_DELETING`/`ACCOUNT_DISABLED`/`ACCOUNT_RESTRICTED`); agora é uma só (`PERMISSION_DENIED`). Não confirmei, em todo `src/`, se alguma tela faz `if (error.message === 'ACCOUNT_DISABLED')` ou similar para essas 3 strings especificamente em `create_promotion` — a busca que fiz foi ampla mas não exaustiva por todos os componentes que chamam `boostStatus`/`createPromotion` na árvore de UI.
- **Ambiente de dev/produção**: nada disto foi executado contra nenhum projeto Supabase remoto. A Pendência #1 (se dev é um projeto Supabase separado com as 137+1 migrations aplicadas) continua em aberto — só o responsável pode confirmar e só então validar esta migration lá antes de produção.
- **`profile_avatars_insert` — teste da janela residual**: testei que uma alocação feita **antes** do bloqueio não autoriza mais o upload depois (via tentativa de `INSERT` direto em `storage.objects` simulando o upload) — isso confirma a policy, mas não testei o caminho completo via Storage real (upload de bytes), só a policy em si.

## 8. Validação executada (fatos, não suposição)

Container novo e vazio, mesmo procedimento da F0b (Storage real primeiro, depois baseline — que virou no-op nas partes de Storage —, depois as migrations):
- **138 migrations** (as 137 anteriores + `20261105000001_close_has_app_access_gates.sql`) aplicadas em ordem, sem nenhuma correção manual: **todas OK**.
- Suíte pgTAP completa, **56 arquivos** (55 + o novo): **56/56 limpos** — 0 `not ok`, 0 arquivo interrompido por erro de SQL. Isso inclui `notification_security_test.sql` (61/61, antes 60/61) e `security_followup_test.sql` (19/19, antes 18/19) — as 2 falhas conhecidas da F0b **agora passam**, confirmando P20 resolvido.
- `npm test`: 1951/1951.
- `npm run test:functions` (contra este mesmo container): 156/156.

Nenhum teste foi reportado como tendo rodado sem ter rodado de fato.
