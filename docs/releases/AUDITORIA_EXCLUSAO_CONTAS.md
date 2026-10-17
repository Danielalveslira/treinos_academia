# Auditoria completa do sistema de exclusão de contas — Evolutus

Auditoria somente leitura, conforme solicitado em `docs/prompts/Auditoria Completa do Sistema de Exclusão de Contas — Evolutus.txt`. Nenhum arquivo foi alterado, nenhuma migration foi executada, nenhum dado real foi consultado. Investigação feita por 5 frentes paralelas (fluxo de exclusão/integridade de dados, sessão/autenticação, EvoCoins/EvoCash, banimento/suspensão/LGPD, cobertura de testes), cada uma lendo o corpo completo das migrations/arquivos relevantes em ordem cronológica. Toda afirmação abaixo é rastreável a `arquivo:linha`; onde não foi possível confirmar algo no código, isso é dito explicitamente — não foram presumidas regras de negócio.

## A. Resumo executivo

**Estado geral.** A arquitetura de exclusão é mais madura do que o normal para este tipo de funcionalidade: há fila assíncrona (`deletion_jobs`) processada por um worker idempotente e tolerante a falhas, um gate financeiro dedicado para EvoCash com caso financeiro auditável e imutável, e autorização consistentemente restrita a superadmin em todos os pontos de entrada testados (nenhuma via de exclusão/banimento por usuário comum ou de terceiros foi encontrada). Já existiu uma falha grave (`delete_own_account` sem nenhuma validação, permitindo autoexclusão instantânea bypassando o gate financeiro e a preservação de auditoria) — **ela já foi corrigida e testada** (migration `20261026000005_aud_security_atomic.sql`), e é citada aqui só como contexto histórico.

**Não existe, hoje, um caminho de autoexclusão (self-service) real.** `delete_own_account` foi desativada; o único caminho é um admin executar `admin_request_account_deletion`, tipicamente a partir de um ticket de privacidade aberto pelo usuário (texto livre, sem vínculo de dados com o job de exclusão). Isso é um fato arquitetural, não um bug, mas tem implicações de processo e de LGPD (seção J).

**Principais riscos identificados (nenhum classificado como crítico; o mais alto é alta):**
1. **[Alta]** A sessão de um usuário já autenticado não é revogada/sincronizada em tempo real quando sua conta é banida, suspensa ou colocada em exclusão — ele pode continuar navegando com dados obsoletos por tempo indeterminado até a próxima ação que force revalidação (P01).
2. **[Média]** Depois que a exclusão física é concluída, atualizar a página (F5) repete o mesmo erro genérico indefinidamente até o JWT expirar — existe uma mensagem amigável pronta no código para esse caso, mas ela nunca é usada (P02).
3. **[Média]** Contas banidas/suspensas continuam autenticando normalmente no Supabase Auth — o bloqueio é só em RLS/RPC pós-login (P03).
4. **[Média]** Risco real (embora de baixa probabilidade) de deadlock entre `cancel_account_deletion` e os fluxos de webhook de pagamento, por ordens de lock invertidas (P05).
5. **[Média]** Não existe nenhum mecanismo para impedir que uma pessoa banida/excluída crie outra conta (P06) — e isso colide com a política deliberada de minimização de dados (nenhuma tabela de auditoria guarda e-mail/CPF).
6. **[Média]** EvoCoins não recebe nenhum tratamento/registro na exclusão (ao contrário de EvoCash, que tem um desenho completo de bloqueio + caso financeiro + retenção) — gera inconsistência estrutural entre o ledger histórico e a soma viva de carteiras (P07).

**O que está bem resolvido e não deveria ser tocado sem necessidade:** o gate financeiro de EvoCash (bloqueio → revisão → caso financeiro imutável → retenção de 1 ano), a resiliência do worker (retry idempotente, isolamento de falha por job, nunca duplica efeito financeiro), e a autorização (nenhuma falha de "exclusão de terceiro" ou "escalonamento de privilégio" foi encontrada).

## B. Arquitetura e fluxo atual

### B.1 Modalidades existentes

| Modalidade | Mecanismo | Reversível? | Hard delete? |
|---|---|---|---|
| Suspensão temporária | `account_restrictions(action='temporary_suspension', until=<data>)`, até 30 dias | Sim, expira automaticamente (lazy, sem cron) | Não |
| Banimento permanente (global) | `account_restrictions(action='system_ban', until=null)` | Só manualmente | Não |
| Banimento de comunidade | `community_restrictions` (tabela separada) | Só manualmente | Não |
| Desativação ("disabled") | `users.account_status='disabled'` via `set_account_status` | Sim (reativação) | Não |
| Exclusão administrativa de conta | `admin_request_account_deletion` → `queue_deletion` → `deletion_jobs` → worker | Sim, enquanto `pending`/`blocked_financial_review` | Sim, ao final |
| Autoexclusão pelo usuário | **Não existe.** `delete_own_account` foi desativada (`20261026000005_aud_security_atomic.sql:11-18`, lança `ACCOUNT_DELETION_REQUIRES_OFFICIAL_FLOW`) | — | — |

`suspensão`/`bloqueio preventivo`/`banimento por violação grave` **não têm categoria estruturada**: todas usam o mesmo campo de texto livre (`disabled_reason` ou `reason`, 5–500 caracteres). A única distinção de negócio efetivamente codificada é `temporary_suspension` vs `system_ban` (campo `action` + `until`), usada em pelo menos um fluxo real (`evaluate_author_eligibility`, `supabase/migrations/20260927000004_economy_reward_settlement.sql:13-31`).

### B.2 Fluxo ponta a ponta da exclusão administrativa de conta

1. **Solicitação** — `src/features/adminAccounts/api/adminAccounts.api.js:76-78` → RPC `admin_request_account_deletion` (`supabase/migrations/20261103000001_admin_accounts_integrity.sql:99-130`): exige `is_superadmin()`, motivo 5–500 chars, usa `pg_advisory_xact_lock` para serializar pedidos concorrentes no mesmo alvo, delega para `queue_deletion`, grava `admin_audit_log` apenas se o job não existia.
2. **Enfileiramento** — `queue_deletion` (`supabase/migrations/20261004000001_account_deletion_financial_case.sql:326-381`): `select ... for update` no job existente (lock por linha), recusa se o alvo é superadmin ou ainda é dono de comunidade ativa (`OWNS_ACTIVE_COMMUNITY`), marca `users.account_status='deleting'` **imediatamente** (o que já bloqueia o acesso do titular via `has_app_access()`), cria/reenfileira a linha em `deletion_jobs`.
3. **Gate financeiro** — `_compute_financial_block_reason` (`supabase/migrations/20260930000002_deletion_worker.sql:77-92`): bloqueia (`state='blocked_financial_review'`) se há `cash_purchases.status='pending'` ou `wallets.cash_balance>0`. Só olha EvoCash — nunca EvoCoins (deliberado, ver seção E).
4. **Decisão administrativa sobre o bloqueio** — 3 ações, todas superadmin + nota obrigatória: `review_blocked_account_deletion` (revalida), `separate_financial_case_and_resume_deletion` (cria `account_financial_cases` com snapshot, libera a exclusão), `cancel_account_deletion` (desiste, credita pagamentos retidos, restaura status anterior). Arquivos: `20261004000001...:514-720`, versões finais em `20261005000002_cancelled_case_retention.sql` e `20261005000003_case_items_traceability.sql`.
5. **Worker assíncrono** — `pg_cron` a cada 1 minuto chama a Edge Function `process-deletion-jobs` (via `net.http_post`, `supabase/migrations/20260930000002_deletion_worker.sql:214-224) com a `service_role` key. `processor.js:22-97` lista até 10 jobs pendentes, chama `run_deletion_job(job.id)` (RPC transacional), e se `deleteAuthUser:true`, chama `auth.admin.deleteUser` e confirma com `confirm_auth_deletion`.
6. **`run_deletion_job`** (versão vigente `supabase/migrations/20261030000001_aud05_status_deletion.sql:4-121`): `select ... for update` no job; corpo inteiro em `begin...exception when others` — qualquer falha grava `last_error` e devolve erro sem corromper nada, job permanece `pending` para retry; preserva auditoria (ledger, `support_requests`, `moderation_decisions`, `cash_purchases`, `promotions` nunca cascadeiam — só `user_id`/`*_by` são anulados); todo o resto é `ON DELETE CASCADE` de `users`; estado final só chega a `complete` depois de `confirm_auth_deletion`.
7. **Limpeza de Storage** — outbox independente via trigger (`supabase/migrations/20261027000001_storage_cleanup_outbox.sql`), com lease de 5 min, retry exponencial, `attempts>=8 → failed`. O campo `photoPaths` que `run_deletion_job` ainda devolve não é mais lido por `processor.js` (vestígio de uma implementação anterior).

### B.3 Entidades/arquivos envolvidos

- **Tabelas:** `users`, `deletion_jobs`, `account_restrictions`, `community_restrictions`, `moderation_decisions`, `support_requests`, `account_financial_cases` (+ `_items`, `_events`), `wallets`, `economy_transactions`, `cash_purchases`, `promotions`, `economy_pending_awards`, `status_economy_votes`, `admin_audit_log`, `admin_list_audit_log`, `storage_cleanup_tasks`.
- **Funções SQL-chave:** `admin_request_account_deletion`, `queue_deletion`, `run_deletion_job`, `confirm_auth_deletion`, `_compute_financial_block_reason`, `review_blocked_account_deletion`, `separate_financial_case_and_resume_deletion`, `cancel_account_deletion`, `resolve_account_financial_case`, `set_financial_case_retention_hold`, `admin_list_financial_cases_retention_due`, `set_account_status`, `admin_set_accounts_status`, `decide_support_request`, `has_app_access`, `is_superadmin`.
- **Edge Function:** `supabase/functions/process-deletion-jobs/` (`index.ts`, `processor.js`, `storage-cleanup.js`).
- **Frontend:** `src/contexts/AuthContext.jsx`, `src/components/ProtectedRoute.jsx`, `src/components/AccountDeletionBlockedGate.jsx`, `src/components/DisabledAccountGate.jsx`, `src/components/LegalGate.jsx`, `src/utils/{legal,accountDeletion,authSession,logoutReason}.js`, `src/services/{accountDeletionService,adminAccountDeletionsService}.js`, `src/hooks/useAdminAccountDeletions.js`, `src/pages/AdminAccountDeletions.jsx`, `src/features/adminAccounts/*`.

## C. Problemas encontrados

Cada item segue o formato pedido: identificador, descrição, evidência, arquivo/localização, reprodução/validação, impacto, gravidade, recomendação.

---
**P01 — Sessão ativa não é revogada/sincronizada em tempo real quando a conta é banida, suspensa ou entra em exclusão**
- **Descrição:** a única subscription Realtime existente (`users-changes-${uid}`) atualiza `profile`, mas não re-dispara `checkDeletionStatus` nem recalcula `serverAccessAllowed`; `ProtectedRoute` só trata explicitamente `account_status==='disabled'`, não `'deleting'`. `account_restrictions` (ban/suspensão) não tem nenhum canal Realtime — só é percebida na próxima revalidação de foco de aba (máx. 1×/30s) ou na próxima chamada que dependa de `has_app_access()`.
- **Evidência:** `src/contexts/AuthContext.jsx:188-203` (subscription só atualiza `profile`); `src/components/ProtectedRoute.jsx:71` (só checa `'disabled'`); `src/components/LegalGate.jsx:14,55-65` (revalidação só no foco, throttle 30s); busca ampla por `.channel(`/`postgres_changes` em `src/` não encontrou nenhum canal para `account_restrictions`.
- **Como reproduzir/validar:** abrir o app autenticado em uma aba sem trocar de foco; em outra sessão, um superadmin executa `admin_request_account_deletion` ou `decide_support_request` (ban) contra esse usuário; observar que a aba original continua renderizando telas protegidas normalmente até uma ação do usuário forçar revalidação.
- **Impacto:** usuário banido/em exclusão pode continuar operando funcionalidades protegidas por tempo indeterminado (limitado pela expiração do JWT e por quando o worker concluir o hard delete).
- **Gravidade:** Alta.
- **Recomendação:** tratar `account_status==='deleting'` explicitamente no `ProtectedRoute` (hoje só `'disabled'` tem gate dedicado); avaliar adicionar um canal Realtime para `account_restrictions` filtrado por `user_id`, ou reduzir o intervalo de revalidação de foco para esse caso.
- **Atualização (2026-10-16):** verificação detalhada confirmou e refinou este achado — ver seção "Revisão de 2026-10-16". Escopo restrito a `'deleting'` e ban/suspensão com **sessão já aberta, sem reload**; para `'disabled'` o Realtime já funciona corretamente (sem gap). Gravidade revisada para **Média** (é um gap de UI/UX, não de autorização — o servidor já nega as ações via `has_app_access()`); a gravidade **Alta** migra para o novo achado **P18** (gates de autorização ausentes/incompletos em objetos específicos).

---
**P02 — Após exclusão física concluída, F5 repete erro genérico indefinidamente; mensagem amigável nunca é usada**
- **Descrição:** enquanto o JWT antigo não expira, `ensure_user_profile()` lança violação de FK (linha-pai apagada) a cada reload, caindo na tela genérica "Não foi possível carregar sua conta / Tentar novamente", que ao ser clicada repete o mesmo ciclo. Existe uma mensagem pronta (`'account-deleted'`) para esse caso específico, mas nenhum `setLogoutReason` no código a invoca.
- **Evidência:** `src/components/ProtectedRoute.jsx:51-62`; `src/contexts/AuthContext.jsx:206-210`; `src/utils/logoutReason.js:20-24` (mensagem morta, confirmado por grep de `setLogoutReason` só encontrando `'account-deleting'`, `'session-expired'` e os dois casos de logout manual).
- **Como reproduzir/validar:** completar o hard delete de uma conta (ou simular `ensure_user_profile()` falhando por FK) com uma sessão ainda com JWT válido; recarregar a página e observar a tela de erro genérica se repetindo.
- **Impacto:** experiência ruim e confusa (parece que o app está com bug, não que a conta foi excluída); o usuário não recebe a informação real do que aconteceu.
- **Gravidade:** Média.
- **Recomendação:** detectar o erro de FK/"registro ausente" em `ensure_user_profile()` e disparar `setLogoutReason('account-deleted')` + logout local automático, em vez da tela genérica de "tentar novamente".

---
**P03 — Contas banidas/suspensas continuam autenticando normalmente no Supabase Auth**
- **Descrição:** todo bloqueio de ban/suspensão/desativação é feito via `has_app_access()` checado por RLS/RPCs — nunca há chamada a `auth.admin.updateUserById`/`banned_until` no Supabase Auth. A conta continua conseguindo obter um JWT válido via login normal; só é impedida de usar funcionalidades gateadas.
- **Evidência:** `supabase/migrations/20260926000023_users_new_fields.sql:33-50` (`has_app_access`); busca ampla por `auth.admin.*` só encontra uso para `deleteUser` (exclusão final), nunca para ban.
- **Como reproduzir/validar:** banir um usuário (`decide_support_request` com `action='system_ban'`) e, em seguida, tentar login com as credenciais dele — o login no Supabase Auth deve ter sucesso (o bloqueio só aparece depois, nas telas gateadas).
- **Impacto:** é o comportamento esperado hoje por desenho, mas é uma superfície de risco para qualquer policy/RPC nova que esqueça de checar `has_app_access()` — nesse caso a conta banida teria acesso efetivo.
- **Gravidade:** Média.
- **Recomendação:** decisão de produto/segurança sobre se banimento permanente deveria também impedir login diretamente no Auth (via `banned_until`), reduzindo a dependência de que toda policy futura lembre de checar `has_app_access()`.
- **Atualização (2026-10-16):** documentação oficial do Supabase consultada — ver seção "Revisão de 2026-10-16" para URLs e o que ficou **não verificado** (se o patch do GoTrue que endereça este tema já está no projeto hospedado, e o `jwt_expiry` real de produção).

---
**P04 — Cache offline pode mascarar banimento/exclusão durante janela sem rede**
- **Descrição:** o bootstrap offline (IndexedDB) grava um snapshot de "acesso permitido" na última confirmação online; enquanto o dispositivo estiver offline, o cold start usa esse snapshot sem contato com o servidor. Se a conta for banida/excluída depois do snapshot, o app abre offline normalmente até a reconexão disparar `revalidate()`.
- **Evidência:** `src/services/offline/bootstrap.js:7-11,42-73`; `src/contexts/AuthContext.jsx:410-452,550-561` (gatilhos de revalidação: evento `online`, `visibilitychange`, polling de 30s com aba visível).
- **Como reproduzir/validar:** colocar o dispositivo offline com uma sessão válida; banir/excluir a conta nesse intervalo; reabrir o app ainda offline e observar que o acesso offline é concedido com base no snapshot antigo.
- **Impacto:** é um comportamento intencional e documentado no próprio código (não é um bug silencioso), mas representa uma janela real cuja duração depende do tempo que o dispositivo passa offline.
- **Gravidade:** Média.
- **Recomendação:** nenhuma ação corretiva óbvia sem comprometer a funcionalidade offline em si — documentar formalmente como risco aceito, ou revisar o tempo máximo tolerável dessa janela como decisão de produto.

---
**P05 — Ordem de locks invertida entre `cancel_account_deletion` e webhooks de pagamento cria janela de deadlock**
- **Descrição:** `credit_cash_purchase_from_webhook`/`confirm_cash_purchase`/`cancel_cash_purchase` travam `cash_purchases` primeiro e `deletion_jobs` depois; `cancel_account_deletion` trava `deletion_jobs` primeiro e `cash_purchases` depois (no loop de pagamentos retidos). As duas ordens opostas podem colidir.
- **Evidência:** `supabase/migrations/20261004000001_account_deletion_financial_case.sql:207,264,304` (ordem compra→job) vs `supabase/migrations/20261005000002_cancelled_case_retention.sql:44,59` (ordem job→compra).
- **Como reproduzir/validar:** disparar `cancel_account_deletion` para um job com caso financeiro separado exatamente quando um webhook de pagamento chega para uma compra do mesmo usuário (requer harness de concorrência real; pgTAP sequencial não reproduz deadlock verdadeiro).
- **Impacto:** sem perda/corrupção de dados (o Postgres detecta e aborta uma das transações), mas o admin recebe um erro `deadlock_detected` não tratado, exigindo retry manual. Janela estreita e pouco provável, mas real.
- **Gravidade:** Média.
- **Recomendação:** padronizar a ordem de aquisição de locks entre os dois fluxos (ex.: sempre `deletion_jobs` antes de `cash_purchases`, ou vice-versa, em ambos os caminhos).

---
**P06 — Nenhum mecanismo de bloqueio de recriação de conta por usuário banido**
- **Descrição:** busca ampla por "blocklist", "banned_email", "fingerprint", "device_id", "cpf" não encontrou nenhum mecanismo de bloqueio de reabertura de conta. Depois do hard delete, não resta nenhum vestígio (e-mail/CPF/hash) que impeça recadastro com o mesmo e-mail.
- **Evidência:** ausência confirmada por busca dirigida no fluxo de registro (`src/pages/Register.jsx`) e em todas as migrations; reforçado pelo desenho deliberado de nunca guardar e-mail/nome em tabelas de auditoria (`supabase/migrations/20261004000001_account_deletion_financial_case.sql:35-40`, `supabase/migrations/20261010000001_admin_accounts_snapshot.sql:16-17`).
- **Como reproduzir/validar:** banir permanentemente uma conta por violação grave e, em seguida, criar uma nova conta com e-mail diferente mas mesma identidade real — nada no sistema detecta ou impede isso.
- **Impacto:** banimento permanente pode ser contornado trivialmente por reabertura de conta.
- **Gravidade:** Média.
- **Recomendação:** decisão de produto/jurídica explícita (seção J) — qualquer mecanismo de bloqueio por e-mail/documento colide com a política atual de minimização de dados, então a escolha entre "prevenir reincidência" e "minimizar dados retidos" precisa ser feita conscientemente antes de qualquer implementação.

---
**P07 — EvoCoins não recebe nenhum tratamento/registro na exclusão; EvoCash tem desenho completo**
- **Descrição:** o gate financeiro de exclusão (`_compute_financial_block_reason`) só avalia `cash_balance`/compras pendentes de EvoCash — nunca `coin_balance`. Ao excluir, a linha de `wallets` (incluindo `coin_balance` e `lifetime_coins_earned`) é destruída por `ON DELETE CASCADE`, sem nenhum snapshot equivalente ao `cash_balance_final` que existe para EvoCash.
- **Evidência:** `supabase/migrations/20260926000035_wallet_stub.sql:6` (cascade); `supabase/migrations/20261004000001_account_deletion_financial_case.sql:41-66` (sem coluna de snapshot para coin); `supabase/migrations/20260930000002_deletion_worker.sql:77-92` (gate só considera cash).
- **Como reproduzir/validar:** excluir uma conta com `coin_balance` alto e sem saldo de EvoCash — a exclusão prossegue sem bloqueio nem registro do saldo de moedas perdido.
- **Impacto:** se EvoCoins algum dia ganhar valor de resgate/conversão, essa perda sem trilha se torna um problema real; hoje é consistente com "EvoCoins é só gamificação sem conversão a dinheiro" (nenhuma função de resgate foi encontrada), mas essa é uma decisão implícita, nunca declarada.
- **Gravidade:** Média.
- **Recomendação:** confirmar com o responsável do produto se EvoCoins deveria receber ao menos um snapshot informativo do saldo final na exclusão (sem necessariamente bloquear o fluxo), por paridade de auditoria com EvoCash.

---
**P08 — Suspensão/bloqueio preventivo/violação grave sem categoria estruturada**
- **Descrição:** `set_account_status` (desativação) e `admin_request_account_deletion` usam um único campo de texto livre (`disabled_reason`/`reason`, 5–500 chars) sem taxonomia — não há flag `is_preventive`/`severity`/`category`. A rica taxonomia de `moderation_decisions.action` (`no_action, warning, remove_content, temporary_suspension, community_ban, system_ban, restore`) não se conecta à trilha de desativação/exclusão do Admin Accounts.
- **Evidência:** `supabase/migrations/20261103000001_admin_accounts_integrity.sql` (`set_account_status`, `admin_request_account_deletion`); `supabase/migrations/20260926000006_moderation.sql:27` (taxonomia de `moderation_decisions`, isolada).
- **Como reproduzir/validar:** gerar um relatório de "quantas exclusões foram a pedido do usuário vs. por violação grave" — hoje isso exigiria leitura manual do texto livre de cada `reason` em `admin_audit_log`.
- **Impacto:** dificulta auditoria regulatória/LGPD e relatórios de transparência; não é falha de segurança.
- **Gravidade:** Baixa/Média.
- **Recomendação:** avaliar introduzir um campo estruturado de categoria/origem (ex.: `requested_by_user` vs `violation`, e severidade) nas RPCs de desativação/exclusão.

---
**P09 — `queue_deletion` pode ser chamado diretamente, pulando o lock e a auditoria do wrapper**
- **Descrição:** `queue_deletion` nunca tem `revoke execute` — por padrão, qualquer `authenticated` pode chamá-la via RPC (internamente só superadmin passa do `is_superadmin()`, então não há escalonamento de privilégio). Mas um superadmin que a chame diretamente (em vez de `admin_request_account_deletion`) pula o `pg_advisory_xact_lock` e o registro em `admin_audit_log` específicos do wrapper. `src/services/communitiesService.js:130` já a chama diretamente para `kind='community'` (uso esperado, sem wrapper equivalente para comunidades).
- **Evidência:** `supabase/migrations/20261004000001_account_deletion_financial_case.sql:326` (sem revoke); `src/services/communitiesService.js:130`.
- **Como reproduzir/validar:** chamar `supabase.rpc('queue_deletion', {p_kind:'account', p_target_id:<uid>})` diretamente como superadmin autenticado e observar que o job é criado sem a entrada correspondente no fluxo auditado de `admin_request_account_deletion`.
- **Impacto:** trilha de auditoria de exclusão de conta pode ficar incompleta/inconsistente dependendo do caminho usado.
- **Gravidade:** Baixa/Média.
- **Recomendação:** considerar `revoke execute on function queue_deletion(text,uuid) from authenticated` quando `p_kind='account'`, ou documentar explicitamente que `queue_deletion` direta é só para uso interno de outros wrappers.

---
**P10 — Três estratégias diferentes de preservar referência a usuário excluído em tabelas de auditoria**
- **Descrição:** `admin_audit_log` não tem FK nenhuma (UUID solto, nunca removido); `moderation_decisions.target_user_id` tem FK mas é explicitamente anulada (`SET target_user_id = null`) antes do delete — perdendo a capacidade de consultar "todas as decisões contra o usuário X" após a exclusão; `account_financial_cases.original_user_id` também é UUID solto sem FK.
- **Evidência:** `supabase/migrations/20261010000001_admin_accounts_snapshot.sql:23-30`; `supabase/migrations/20261030000001_aud05_status_deletion.sql:70`; `supabase/migrations/20261004000001_account_deletion_financial_case.sql:45`.
- **Como reproduzir/validar:** excluir uma conta com histórico em `moderation_decisions` e tentar consultar decisões por `target_user_id` após a exclusão — o vínculo já estará nulo.
- **Impacto:** inconsistência de padrão, sem perda de dado crítico, mas dificulta correlação histórica.
- **Gravidade:** Baixa.
- **Recomendação:** padronizar a estratégia (preferencialmente manter o UUID sem FK, como já é feito em `admin_audit_log`/`account_financial_cases`, em vez de anular).

---
**P11 — Tratamento desigual de pendências de EvoCoins**
- **Descrição:** `economy_pending_awards` (recompensa de post/comentário) tem FK `ON DELETE CASCADE` — some sem trilha se a conta for excluída antes do cron de liquidação rodar. `status_economy_votes` (apoio recebido) recebe tratamento explícito, marcado `capped` com `reward_state` preservado.
- **Evidência:** `supabase/migrations/20261009000005_evocoins_pending_awards.sql:15`; `supabase/migrations/20261009000004_evocoins_support_rewards.sql:133-139`.
- **Impacto:** inconsistência de rastreabilidade entre dois tipos de pendência da mesma moeda; sem impacto financeiro real (nenhuma das duas é dinheiro).
- **Gravidade:** Baixa.
- **Recomendação:** uniformizar — ao menos registrar o descarte de `economy_pending_awards` de forma auditável, como já ocorre com os votos.

---
**P12 — Promoções ativas de EvoCash de conta excluída não são canceladas/reembolsadas**
- **Descrição:** `run_deletion_job` apenas anula `promotions.owner_id`; uma promoção `active` continua ativa até expirar naturalmente, sem dono.
- **Evidência:** `supabase/migrations/20260930000002_deletion_worker.sql:23`.
- **Impacto:** comportamento sem risco de integridade (campo nulável, leitura trata isso), mas é uma decisão de produto nunca declarada explicitamente.
- **Gravidade:** Baixa.
- **Recomendação:** decisão de produto sobre se promoções ativas deveriam ser canceladas (com ou sem reembolso) ao excluir a conta.

---
**P13 — Retenção/LGPD indefinida fora do domínio financeiro**
- **Descrição:** só `account_financial_cases` tem política de retenção codificada (1 ano após resolução, com legal hold). `admin_audit_log`, `moderation_decisions`, `account_restrictions`, `support_requests` são retidos indefinidamente, sem prazo formal — e o próprio código marca isso como pendência não resolvida.
- **Evidência:** `supabase/migrations/20261010000001_admin_accounts_snapshot.sql:15-16` (comentário "RETENÇÃO PENDENTE DE DEFINIÇÃO"); `supabase/migrations/20261005000001_financial_case_retention.sql:1-9,214` (retenção só para caso financeiro, sem purge automático).
- **Impacto:** risco de compliance (LGPD) não é tratado para a maior parte dos dados de auditoria/moderação.
- **Gravidade:** Baixa (hoje), mas é uma dívida que escala com o tempo.
- **Recomendação:** ver dúvidas de negócio na seção J — requer decisão jurídica antes de qualquer implementação.

---
**P14 — UI administrativa não expõe as RPCs de resolução/retenção do caso financeiro**
- **Descrição:** `resolve_account_financial_case`, `set_financial_case_retention_hold`, `admin_list_financial_cases_retention_due` existem no banco com grants para `authenticated`, mas nenhuma tela/serviço do frontend as chama.
- **Evidência:** ausência confirmada por grep em todo `src/`; `supabase/migrations/20261005000001_financial_case_retention.sql`.
- **Impacto:** essas ações só podem ser feitas hoje via SQL direto — não é uma falha de segurança, mas uma lacuna operacional.
- **Gravidade:** Baixa.
- **Recomendação:** avaliar se essas ações deveriam ganhar tela no painel admin, ou se o processo manual/jurídico fora do app é intencional (dúvida de negócio).

---
**P15 — Comentários/documentação referenciam função inexistente (`handlePossibleGhostSession`)**
- **Descrição:** múltiplos arquivos comentam uma função que foi substituída por `checkDeletionStatus` sem atualização cruzada dos comentários.
- **Evidência:** `src/components/ProtectedRoute.jsx:26,44,70`; `src/services/accountDeletionService.js:7`; `src/components/LegalGate.jsx:104`; `src/utils/logoutReason.js:5,27`; `src/components/DisabledAccountGate.jsx:7`.
- **Impacto:** nenhum funcional; risco de confundir manutenção futura.
- **Gravidade:** Baixa.
- **Recomendação:** atualizar os comentários na próxima vez que esses arquivos forem tocados.

---
**P16 / P17 — Achados menores (código morto / operacional)**
- `run_deletion_job` ainda devolve `photoPaths`, que `processor.js` não lê mais desde que o outbox de Storage (`20261027000001_storage_cleanup_outbox.sql`) assumiu essa responsabilidade — campo vestigial, gravidade muito baixa.
- A anon key do projeto está em texto puro em `cron.schedule(...)` (`supabase/migrations/20260930000002_deletion_worker.sql:220`) — intencional (anon key é pública por design), mas sem indireção via vault; se rotacionada, o cron para silenciosamente. Gravidade baixa, nota operacional.

## D. Comportamento de autenticação e sessão

- **Após desativação (`disabled`):** a linha em `users` continua existindo; nada no Supabase Auth é revogado. `DisabledAccountGate` trata isso com uma tela terminal (botão de logout), mas só é exibida quando o app revalida o perfil (login, F5, ou revalidação de foco — nunca em tempo real durante a sessão ativa, ver P01).
- **Após ban/suspensão (`account_restrictions`):** mesmo padrão — só RLS/RPC bloqueiam; sem nenhuma propagação Realtime (ver P01, P03).
- **Após exclusão em fila (`account_status='deleting'`):** `has_app_access()` já nega na hora; `checkDeletionStatus` detecta isso no próximo `loadSession`/revalidação e força logout local com mensagem explicativa (`'account-deleting'`, essa mensagem funciona corretamente).
- **Após exclusão física concluída:** o JWT de acesso continua assinaturalmente válido até expirar — nada o revoga ativamente. O que neutraliza isso é o fail-closed de RLS (`has_app_access()`/`ensure_user_profile()` fazendo `FROM users WHERE id=auth.uid()`, que retorna vazio/lança FK violation). Isso gera o ciclo de erro repetido descrito em P02.
- **Requisição iniciada antes da exclusão e concluída depois:** se ainda em `deleting` (antes do worker rodar), `has_app_access()` já nega. Depois do hard delete, qualquer escrita que referencie `user_id` falha por violação de FK; leituras em tabelas com RLS simples (sem usar `has_app_access()`) simplesmente retornam vazio porque a cascata já removeu as linhas.
- **Cache local:** há cache offline deliberado (bootstrap IndexedDB) que pode mascarar banimento/exclusão durante janela sem rede (P04); não há cache de "sessão" em `localStorage` que sobreviva a uma revalidação online bem-sucedida.
- **Diferença self vs. admin:** não existe mais diferença de tratamento — como não há autoexclusão real, todo caso (ban/suspensão/exclusão) passa pela mesma maquinaria de estado no banco + RLS fail-closed + (no melhor caso) Realtime/revalidação de foco.
- **Loop de redirecionamento / tela branca infinita:** não foi encontrado nenhum caminho que resulte nisso — todo "beco sem saída" identificado é uma tela terminal com algum botão de ação (reload ou logout). O risco real não é travamento de UI, é **acesso obsoleto por tempo indeterminado** (P01) ou **erro repetido sem explicação clara** (P02).

## E. Tratamento de EvoCoins e EvoCash

| | EvoCoins | EvoCash |
|---|---|---|
| Natureza | Gamificação (ganho por atividade: presença diária, treino concluído, posts/comentários, apoio recebido); nenhuma função de conversão/resgate em dinheiro foi encontrada | Dinheiro real pré-pago (PIX/cartão via InfinitePay, antes Mercado Pago), gasto em impulsionamento pago (`promotions`) |
| Armazenamento | `wallets.coin_balance` (agregado) + `economy_transactions` (ledger append-only, asset='coin') | `wallets.cash_balance` (agregado) + `economy_transactions` (asset='cash') + `cash_purchases` (tentativas de recarga) |
| Bloqueia a exclusão se saldo > 0? | **Não** | **Sim**, até decisão de superadmin (`blocked_financial_review`) |
| Snapshot do saldo final na exclusão? | **Não, nenhum registro** | Sim, se caso financeiro for aberto (`cash_balance_snapshot`/`_final`) |
| Ledger histórico sobrevive à exclusão? | Sim (`user_id` → null) | Sim (idem, vinculado ao caso financeiro) |
| Linha de carteira (contador) sobrevive? | Não (`ON DELETE CASCADE`) | Não (mesmo cascade — o que sobrevive é o caso + ledger + compras) |
| Operações pendentes | Descartadas silenciosamente (post/comentário) ou marcadas `capped` com trilha (apoio recebido) — ver P11 | Bloqueiam a exclusão até resolução; pagamento tardio é retido no caso financeiro, nunca creditado numa carteira inexistente |

**Alternativas avaliadas (sem recomendar confisco/conversão/transferência automática — nenhuma equivalência de valor entre as duas moedas foi encontrada no código):**
- *EvoCoins:* bloqueio de novas operações já implementado; preservação de ledger já implementada; um snapshot informativo do saldo final (análogo ao de EvoCash) poderia ser adicionado só para fins de auditoria/BI, sem implicar valor resgatável — decisão de produto (ver P07/J).
- *EvoCash:* bloqueio, preservação de histórico e caso financeiro imutável já implementados — é o desenho mais maduro do repositório. Estorno automático **não existe** (nenhuma integração de devolução ao provedor de pagamento foi encontrada); se o produto decidir estornar, é uma integração nova. Anonimização com preservação de registro já é o modelo adotado (caso financeiro guarda só UUID solto + protocolo, nunca dado pessoal copiado).

Dúvidas de negócio/legais específicas de EvoCash/EvoCoins estão consolidadas na seção J.

## F. Exclusão por violações graves

- **Diferenciação real:** `temporary_suspension` (até 30 dias, expira automaticamente por passagem do tempo) vs. `system_ban` (permanente, `until=null`) são distinguidos por dados e por pelo menos um efeito prático real (elegibilidade de recompensas). **Bloqueio preventivo vs. violação grave** não são diferenciados — ambos usam `account_status='disabled'` com o mesmo texto livre (P08). **Exclusão a pedido do usuário vs. por violação grave** também não são diferenciadas no schema — ambas passam por `admin_request_account_deletion`/`queue_deletion` com um único campo de texto livre, sem flag de origem (P08).
- **Exclusão lógica vs. física:** existe claramente — `account_status='deleting'` é o soft-delete imediato (bloqueia acesso na hora); o hard delete (remoção de linhas + `auth.admin.deleteUser`) só ocorre quando o worker assíncrono processa o job, de forma transacional e com preservação deliberada de tabelas de auditoria/ledger (nunca cascade nelas, só anulação de `user_id`).
- **Proteções existentes:** nenhuma conta banida/suspensa/em exclusão consegue burlar `has_app_access()` nos pontos testados; superadmin não pode ser alvo de desativação/exclusão em lote; `admin_audit_log` é imutável (UPDATE/DELETE/TRUNCATE bloqueados por trigger); `account_financial_cases` também é imutável.
- **Lacunas:** banimento não impede login no Supabase Auth, só ações pós-login (P03); nenhum mecanismo de bloqueio de recriação de conta por pessoa banida (P06) — "impedir contornar o banimento" criando outra conta **não está resolvido**, e o próprio código reconhece essa tensão com a política de minimização de dados (nenhuma tabela de auditoria guarda e-mail/CPF, o que torna um futuro bloqueio por identidade mais difícil de implementar sem mudar essa política).
- **Retenção para investigação/obrigação legal:** bem resolvida apenas para o caso financeiro (retenção de 1 ano + legal hold com motivo obrigatório, nunca listado para purge enquanto em hold); **ausente** para `admin_audit_log`/`moderation_decisions`/`account_restrictions` (retidos indefinidamente, sem prazo formal, com o próprio código marcando isso como "pendente de definição jurídica").

## G. Integridade dos dados e recuperação

- **Transacionalidade:** cada etapa destrutiva (`run_deletion_job`) é uma única transação por job, com tratamento de exceção que preserva o estado anterior em caso de falha (job permanece `pending`, `last_error` registrado, nada é corrompido — testado em `supabase/tests/account_deletion_hardening_test.sql:22-41`).
- **Idempotência:** confirmada por teste para `set_account_status`, `admin_request_account_deletion`, `separate_financial_case_and_resume_deletion`, retries do worker (nunca duplica efeito financeiro), e webhooks de pagamento reentregues após a exclusão (`already_held_in_case`).
- **Registros órfãos:** tratados explicitamente e testados apenas no domínio financeiro (`cash_purchases` sem dono e sem caso permanece rastreável, nunca credita ninguém). **Não há evidência de teste equivalente** para outras tabelas referenciando o `user_id` excluído fora do domínio financeiro (posts, comunidades, notificações) — o schema parece usar `ON DELETE CASCADE`/`SET NULL` de forma consistente, mas isso não foi verificado por asserção de teste.
- **Concorrência:** protegida por `pg_advisory_xact_lock` (pedidos de exclusão) e `SELECT ... FOR UPDATE` (job, compra); verificada por script manual de concorrência real (`scripts/verify-admin-accounts-concurrency.mjs`, requer Docker, não roda em CI) — confirma 1 único registro de auditoria para pedidos duplicados e bloqueio mútuo entre exclusão em andamento e tentativa de alterar status do mesmo alvo. Um risco real e não testado de deadlock foi identificado (P05).
- **Falha de serviço externo durante o processo:** bem coberta para o worker (Supabase Auth indisponível → retry com estado `auth_cleanup`) e para Storage (outbox com lease e retry exponencial); para webhooks de pagamento, tratada com revalidação contra a API do provedor antes de creditar (fail-closed).
- **Recuperação/cancelamento:** `cancel_account_deletion` permite desistir enquanto `pending`/`blocked_financial_review`, restaurando o status anterior corretamente (nunca promove uma conta que já estava `disabled` para `active`).

## H. Plano de testes

### H.1 Cobertura existente (confirmada por leitura das asserções, não pelo nome do arquivo)

- **Forte:** `supabase/tests/account_deletion_financial_case_test.sql`, `account_deletion_hardening_test.sql`, `admin_accounts_defensive_test.sql`, `admin_accounts_snapshot_test.sql`, `financial_case_retention_test.sql` (+ variantes de cancelamento/rastreabilidade), `aud_01_aud_02_security_test.sql` — todos executados contra PostgreSQL real via pgTAP, cobrindo autorização negativa, idempotência, bloqueio/separação/cancelamento financeiro, retenção/legal hold, imutabilidade de tabelas de auditoria.
- **Worker/infra:** `supabase/functions/process-deletion-jobs/processor.test.js` e `storage-cleanup.test.js` — Supabase admin fake, mas a lógica real de orquestração (retry, convergência, isolamento de falha) é exercida.
- **Frontend:** `src/pages/AdminAccounts.test.js` (integração real da tela de listagem/status), `src/contexts/authColdStart.test.js` (reconexão após perda de rede com estado do servidor prevalecendo), `src/hooks/useLogout.test.js`/`logoutScope.test.js`/`authSession.test.js` (logout voluntário).
- **Importante:** a suíte pgTAP completa só roda via `scripts/release-offline-check.mjs`, que exige um container PostgreSQL local (`PG_TEST_CONTAINER`) — **não está amarrada ao `npm test` padrão**; se não fizer parte do CI obrigatório, essa cobertura (a mais forte do repositório) pode não estar sendo verificada a cada PR.

### H.2 Lacunas de cobertura (por criticidade)

1. **Sincronização em tempo real de ban/exclusão para sessão ativa** — o stub de `.channel()` usado em `authColdStart.test.js` é no-op; nenhum teste dispara o callback real. Relacionado a P01.
2. **`WalletContext` com `deletionStatus` truthy** — nunca testado; o guard de produção que suspende a leitura de carteira durante exclusão está sem cobertura.
3. **Painel `AdminAccountDeletions`** — `useAdminAccountDeletions.js`, `adminAccountDeletionsService.js` e `AdminAccountDeletions.jsx` não têm nenhum teste (unitário, contrato ou integração), ao contrário do equivalente para a tela de listagem.
4. **Concorrência real só via script manual** (`verify-admin-accounts-concurrency.mjs`), não em CI automatizado.
5. **pgTAP não roda com `npm test`** — depende de Docker local; risco de regressão silenciosa se não estiver no pipeline obrigatório.
6. **Ban evasion** — não testado, porque o mecanismo em si não existe (P06).
7. **Órfãos fora do domínio financeiro** — só testado para `cash_purchases`; nenhuma asserção equivalente para posts/comentários/comunidades/notificações.
8. **Login com credenciais antigas após exclusão TOTAL** — só o estado intermediário ("banco limpo, Auth ainda vivo") é testado; o estado final depende do comportamento do Supabase Auth em si, sem verificação própria do app.

### H.3 Cenários do prompt (15) — status resumido

| # | Cenário | Status |
|---|---|---|
| 1 | Fecha navegador após solicitar exclusão | Parcial — não testado diretamente, mas design é resiliente (job assíncrono independente do cliente) |
| 2 | Excluída enquanto autenticado em outra aba | **Não testado** (relacionado a P01) |
| 3 | Falha de banco durante exclusão | Testado com evidência |
| 4 | Conta removida mas sessão válida | Parcial (só cenário de reconexão offline→online, não sessão ativa) |
| 5 | Saldo de EvoCoins/EvoCash no momento da exclusão | Testado com evidência para EvoCash; EvoCoins sem tratamento (P07) |
| 6 | Operações pendentes | Testado com evidência (compra pendente) |
| 7 | Duas solicitações simultâneas | Testado via script manual (não CI) |
| 8 | Admin bane durante operação do usuário | Parcial (só o inverso: exclusão em andamento bloqueia mudança de status) |
| 9 | Worker falha no meio | Testado com evidência, extensivamente |
| 10 | Serviço externo não responde | Testado com evidência (Auth, Storage, webhook de pagamento) |
| 11 | Acesso com credenciais antigas após exclusão | Parcial (só estado intermediário) |
| 12 | Criar outra conta para contornar banimento | **Não testado** — mecanismo não existe (P06) |
| 13 | Registros órfãos | Parcial — só testado no domínio financeiro |
| 14 | Exclusão parcial sem concluir etapas restantes | Testado com evidência (estado `auth_cleanup`) |
| 15 | Exclusão com dados sob obrigação legal | Testado com evidência, robustamente (retenção + legal hold) |

### H.4 Testes recomendados (proposta, não implementados)

1. Substituir o stub no-op de `channel()` em `authColdStart.test.js` (ou novo arquivo) por um fake que realmente invoca `.on('postgres_changes', ...)`, simulando ban/exclusão em sessão ativa.
2. Adicionar caso em `WalletContext.test.js` com `deletionStatus` truthy.
3. Criar `adminAccountDeletionsService.test.js` (padrão de `adminAccounts.api.test.js`) e `useAdminAccountDeletions.test.js`.
4. Criar teste de integração para `AdminAccountDeletions.jsx` no padrão de `AdminAccounts.test.js`.
5. Promover `verify-admin-accounts-concurrency.mjs` a gate de CI real, ou documentar explicitamente como gate manual pré-release; adicionar caso simétrico "admin desativa enquanto exclusão própria está em voo".
6. Estender `account_deletion_financial_case_test.sql` (ou criar nova suíte) verificando ausência de órfãos em pelo menos uma tabela não-financeira de alto volume.
7. Confirmar/documentar se algum workflow de CI de fato invoca `release-offline-check.mjs` com `PG_TEST_CONTAINER` definido.

## I. Plano de melhorias priorizado

**Urgente / curto prazo (correção pontual, sem redesenho):**
- P01 — tratar `account_status==='deleting'` explicitamente no `ProtectedRoute`; avaliar Realtime ou revalidação mais frequente para `account_restrictions`.
- P02 — disparar `setLogoutReason('account-deleted')` quando `ensure_user_profile()` falhar por FK/registro ausente, em vez da tela genérica de erro.
- P05 — padronizar a ordem de locks entre `cancel_account_deletion` e os fluxos de pagamento.
- P09 — decidir se `queue_deletion` deve ter `revoke` para `p_kind='account'` ou ser documentada como uso interno.

**Médio prazo (robustez/consistência, pode aguardar priorização):**
- P03 — avaliar bloquear login no Supabase Auth para banimento permanente.
- P07 / P11 — paridade de snapshot/registro de pendências para EvoCoins, por consistência de auditoria com EvoCash.
- P12 — decidir o que fazer com promoções ativas de conta excluída.
- P10 — padronizar estratégia de preservação de referência em tabelas de auditoria pós-exclusão.
- P20 — trocar `search_path=public` por `search_path=''` (ou equivalente) em `cast_vote` e `create_promotion`, por consistência com o padrão do resto do código (não explorável hoje, mas sem motivo para manter a exceção).
- Lacunas de teste do item H.4 (itens 1–6).

**Estrutural / requer decisão de produto ou jurídica antes de qualquer código:**
- P06 — ban evasion vs. minimização de dados (dúvida de negócio J, item sobre bloqueio de recriação de conta).
- P08 / P13 — categorização estruturada de motivo de exclusão/desativação; retenção formal de `admin_audit_log`/`moderation_decisions`/`account_restrictions`; validação jurídica do prazo de 1 ano do caso financeiro.
- Decisões sobre EvoCash: direito a estorno, prazo legal de retenção de saldo (seção E/J).
- P04 — janela de cache offline mascarando banimento/exclusão: risco aceito ou revisão de prazo, como decisão de produto.

**Baixa prioridade (cosmético/organizacional):**
- P14 — expor (ou não) as RPCs de retenção financeira na UI admin.
- P15, P16, P17 — comentários desatualizados, campo morto, indireção de chave no cron.

## J. Dúvidas de negócio que precisam ser respondidas

1. Deve existir uma categoria estruturada para exclusão/desativação ("a pedido do usuário" vs. "por violação grave", com nível de severidade), em vez de texto livre, para fins de relatório e auditoria regulatória?
2. Deve existir algum mecanismo de bloqueio de recriação de conta por pessoa banida (e-mail/CPF/device)? Isso colide diretamente com a política atual de nunca guardar e-mail/CPF nas tabelas de auditoria — qual princípio deve prevalecer?
3. Banimento permanente (`system_ban`) deveria também impedir login no Supabase Auth (via `banned_until`), em vez de só bloquear ações pós-login?
4. Qual o prazo de retenção legal para `admin_audit_log` (ações administrativas sobre contas)? O código reconhece isso como pendência não resolvida desde a migration que criou a tabela.
5. Qual prazo de retenção para `moderation_decisions`/`account_restrictions` (histórico de banimentos/suspensões)? Hoje é retido indefinidamente, sem coluna de prazo.
6. O prazo de 1 ano para `account_financial_cases` resolvidos/cancelados tem validação jurídica/contábil formal, ou ainda é um valor provisório? (Existe um precedente histórico no próprio código com "5 anos", divergente do valor atual.)
7. Após o prazo de retenção do caso financeiro, o que deve acontecer de fato — apagar, anonimizar, ou manter por obrigação fiscal mais longa? Hoje só existe a listagem de "elegível a descarte", nenhuma ação de purge foi implementada.
8. EvoCash: existe prazo legal/contratual para devolver ou extinguir saldo de uma conta excluída, ou retenção indefinida em caso aberto é aceitável?
9. O usuário tem direito a estorno em dinheiro de saldo de EvoCash positivo ao excluir a conta? Hoje o único caminho é reter o saldo em um caso financeiro, nunca devolver.
10. EvoCoins têm algum valor de resgate fora do código auditado (ex.: parceria externa, voucher)? Se sim, a perda total sem registro na exclusão (hoje aceitável como "mera gamificação") passaria a ser um risco relevante.
11. Promoções ativas (impulsionamento pago) de uma conta excluída devem ser canceladas automaticamente (com ou sem reembolso), ou podem continuar ativas até expirar sem dono, como hoje?
12. O fluxo de pedido de exclusão pelo próprio usuário (hoje um ticket de privacidade de texto livre, triado manualmente por um superadmin) deveria ter um SLA formal e um vínculo de dados explícito com `deletion_jobs`/`admin_audit_log`?
13. As RPCs de resolução/retenção de caso financeiro (`resolve_account_financial_case`, `set_financial_case_retention_hold`, `admin_list_financial_cases_retention_due`) foram deixadas sem tela de propósito (processo manual/jurídico fora do app), ou é um item pendente de roadmap do painel administrativo?
14. É aceitável, como política de produto, que `account_restrictions` (ban/suspensão) não tenha nenhuma propagação em tempo real para sessões já abertas — ao contrário de `account_status`, que ao menos tem um canal Realtime (ainda que incompleto, ver P01)?
15. Qual deveria ser o comportamento correto quando `account_status='deleting'` chega via evento em tempo real numa sessão já aberta — forçar logout imediato, ou deixar a próxima leitura de servidor resolver?
16. `submit_support_request` só checa `account_status='deleting'` (não `disabled`/restrita) — uma conta banida/desativada ainda consegue abrir denúncia (`kind='report'`) contra um terceiro. Isso é, ao mesmo tempo, o canal de defesa do próprio usuário (ele precisa conseguir recorrer do próprio banimento) e um possível vetor de abuso (denunciar terceiros enquanto banido). Deve continuar permitido sem distinção, ou deveria haver alguma restrição/sinalização para denúncias abertas por conta banida contra outra pessoa? **Não tratado como achado (P18 ou outro) nesta auditoria** — registrado aqui como dúvida de negócio, já que bloquear o canal de recurso seria pior do que a situação atual. Evidência: `supabase/migrations/20261003000001_reapply_admin_vitrines_denuncias.sql:42`.

## Revisão de 2026-10-16

Rodada de verificação sobre pontos não comprovados da versão original deste relatório. Somente leitura — nenhum código, migration ou teste foi alterado; esta seção só documenta o que foi confirmado, refinado ou permanece sem confirmação. O texto original das seções A–J **não foi apagado**; onde a verificação mudou uma conclusão, isso está registrado aqui e referenciado por um ponteiro inserido no achado original (P01, P03).

### Changelog desta revisão

- **P01** — escopo restringido e gravidade revisada de Alta para **Média**; a gravidade Alta migrou para o novo achado **P18**, mais específico.
- **P18 (novo)** — 8 objetos (policies RLS/RPCs) com gate de `has_app_access()` ausente ou incompleto, identificados por varredura exaustiva das 137 migrations (não mais por amostragem, como a limitação original declarava).
- **P03** — complementado com evidência de documentação oficial do Supabase e de um histórico de correção do próprio GoTrue; partes específicas permanecem explicitamente não verificadas.
- **P19 (novo)** — ausência de qualquer pipeline de CI no repositório, afetando a confiabilidade de toda a cobertura de testes (pgTAP, Edge Functions e frontend) descrita na seção H.
- **P20 (novo, mesma data, verificação subsequente)** — `cast_vote` e `create_promotion` (`SECURITY DEFINER`) usam `search_path=public` em vez do padrão do projeto (vazio ou terminando em `pg_temp`), violando um invariante que o próprio projeto declara e testa. Verificado e confirmado **não explorável hoje** (CREATE em `public` já é negado a `anon`/`authenticated`/`service_role`; nenhuma referência não-qualificada existe em nenhuma das duas funções). Gravidade Média. Detalhe completo, com evidência de código e da verificação de exploração, em `docs/releases/BASELINE_PGTAP.md` (achado #1).
- Anexo criado: [`ANEXO_VARREDURA_HAS_APP_ACCESS.md`](ANEXO_VARREDURA_HAS_APP_ACCESS.md) — tabela completa de todas as policies RLS e RPCs SECURITY DEFINER acessíveis a `authenticated`, com classificação de risco.

### P01 — reconciliação (resolvida, não era contradição)

Investigação dedicada traçou o caminho exato, linha a linha, para responder "o que acontece quando a conta é banida/excluída com uma aba já aberta, sem reload":

- O callback da subscription Realtime de `users` (`src/contexts/AuthContext.jsx:199-203`) contém **só** `setProfile(mapUserRow(payload.new))` — não chama `checkDeletionStatus`, `logoutUser` ou qualquer função de reavaliação de acesso. Fato comprovado por leitura direta.
- `checkDeletionStatus` só é invocado em dois pontos: dentro de `loadSession()` (login, reload, troca de identidade) e dentro de `revalidate()` (reconexão no modo offline-local) — nunca a partir do callback Realtime. Fato comprovado.
- Para `account_status==='disabled'`: o Realtime **já é suficiente** — `ProtectedRoute.jsx:71` lê `profile.accountStatus` a cada render, então a tela `DisabledAccountGate` aparece em tempo real, sem reload. **Não há gap aqui.**
- Para `account_status==='deleting'` ou para ban/suspensão (`account_restrictions`, sem canal Realtime nenhum): a aba já aberta **não** percebe sozinha. Só reage: (a) ao voltar o foco da aba, ≥30s depois da última checagem (`LegalGate.jsx:14,55-65`), mostrando uma tela genérica ("Acesso indisponível" ou "Acesso restrito", não o fluxo rico de `AccountDeletionBlockedGate`); (b) quando alguma ação do usuário disparar uma RPC que falhe por RLS, tratada localmente e sem padronização (não há interceptor global de erro de autorização); ou (c) em reload/relogin, onde `checkDeletionStatus` roda do zero e funciona corretamente (logout automático com a mensagem certa).

**Conclusão:** o achado original estava correto, mas sua manchete ("sessão ativa não é revogada/sincronizada") podia ser lida como "nada detecta a mudança", o que não é verdade para `'disabled'`. Gravidade revisada para **Média** porque o impacto real é de UX (telas genéricas, demora de até ~30s+foco para o usuário perceber) — o servidor já nega qualquer ação sensível via `has_app_access()` nesse intervalo, então não há janela de autorização indevida associada a P01 em si (essa janela existe, mas é o assunto do novo P18).

### P03 — complementação com documentação oficial

| Fonte | Conteúdo relevante | Status |
|---|---|---|
| [supabase.com/docs/reference/javascript/auth-admin-updateuserbyid](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid) | Documenta `ban_duration` (ex. `'876000h'`), mas não afirma nem nega revogação de tokens já emitidos | Verificado — ausência de menção é o fato |
| [supabase.com/docs/guides/auth/sessions](https://supabase.com/docs/guides/auth/sessions) | Confirma que limites de sessão/timeout só são checados "na próxima vez que a sessão é renovada" e que o access token "permanece usável até expirar"; não menciona checagem contra o banco a cada requisição | Verificado — documentação oficial |
| Achado de disclosure de segurança sobre `supabase/auth` (GoTrue), identificado como `ANT-2026-GQ8G77M4` | Relata que o middleware por requisição carregava o usuário do banco (com `banned_until` atualizado) mas não chamava a checagem de ban — ban só era aplicado na emissão de credencial (login/refresh/OTP). Relata um patch em `internal/api/auth.go` (commit `b6878c2fa63f805dbd27436c36ba7ebbc2b7e44d`, 2026-07-28) adicionando a checagem em `requireAuthentication`, disclosure pública em 2026-08-18 | **Não verificado de forma independente nesta rodada** — a página foi lida uma vez via fetch e não foi possível reabri-la para confirmação cruzada nesta revisão; tratar como evidência de uma única leitura, não como fato re-confirmado |
| Se o projeto hospedado do Evolutus (`ywrjojrjgozdfpddkkuy.supabase.co`) já roda a versão do GoTrue com esse patch | — | **Não verificado** — não é determinável a partir deste repositório; depende da versão do GoTrue hospedada pelo provedor no momento |
| `jwt_expiry` de produção | `supabase/config.toml:164` define `jwt_expiry = 3600` (1 hora) | Valor **local/CLI confirmado**; **não verificado** se o projeto de produção usa o mesmo valor (isso é configurado no painel do projeto e pode divergir do `config.toml` do repositório) |

### P18 (novo) — Gates de `has_app_access()` ausentes ou incompletos (8 objetos, varredura exaustiva)

Varredura de todas as ~93 policies RLS e ~119 RPCs `SECURITY DEFINER` acessíveis a `authenticated` nas 137 migrations (detalhe completo em [`ANEXO_VARREDURA_HAS_APP_ACCESS.md`](ANEXO_VARREDURA_HAS_APP_ACCESS.md)). Destes, 8 objetos têm um gate de autorização ausente ou incompleto em uma ação que afeta terceiros, dinheiro ou conteúdo público persistente (os demais "não" encontrados são leitura da própria linha, ações autodestrutivas ou dados públicos por design — tratados como baixo risco, ver anexo). Para cada um, o "comportamento esperado" está marcado como **a confirmar pelo responsável pelo produto** — não foi presumida nenhuma regra de negócio.

---
**P18-a — `set_username` / `update_user_profile` sem nenhum check de `account_status`**
- **Evidência:** `supabase/migrations/20260926000021_auth_uid_guards.sql:33` (`set_username`); `supabase/migrations/20260926000024_update_user_profile_height.sql:3` (`update_user_profile`).
- **Comportamento atual:** nenhuma checagem de `account_status`/`account_restrictions` — uma conta banida, suspensa ou desativada continua podendo alterar username e bio (conteúdo público).
- **Comportamento esperado:** a confirmar pelo responsável — se contas banidas/desativadas deveriam ser impedidas de alterar identidade pública.
- **Gravidade:** Alta.

---
**P18-b — RECLASSIFICADO (2026-11-05, verificação F1.1): `request_cash_purchase` não existe mais; residual de defesa em profundidade em `reserve_infinitepay_cash_purchase`**

**(Texto original preservado abaixo; ver correção.)**

~~`request_cash_purchase` só checa `deleting`, não `disabled`/`restricted`~~
- ~~**Evidência:** `supabase/migrations/20260928000001_economy_cash_purchases_promotions.sql:90`.~~
- ~~**Comportamento atual:** conta desativada ou com restrição ativa ainda consegue abrir um novo pedido de compra de EvoCash (dinheiro real).~~
- ~~**Gravidade:** Alta.~~

**Correção:** `public.request_cash_purchase(text, text)` foi **removida** por `supabase/migrations/20261015000005_remove_mercadopago_runtime.sql:17` junto com o runtime do Mercado Pago (confirmado: `to_regprocedure(...)` retorna `NULL` num banco com todas as migrations aplicadas). O fluxo atual de compra de EvoCash é `public.reserve_infinitepay_cash_purchase(uuid, text)`, acessível só a `service_role` (`revoke all ... from public, anon, authenticated`, `20261015000002_infinitepay_checkout_failure.sql:118-119`) — só a Edge Function `infinitepay-create-checkout` a chama, e **antes** disso essa função já exige `has_app_access()` explicitamente (`supabase/functions/infinitepay-create-checkout/core.js:23-24`: `const { data: access } = await userClient.rpc('has_app_access'); if (access !== true) throw new Error('APP_ACCESS_DENIED')`). Confirmado por teste direto do código: uma conta `disabled`, com restrição ativa ou `deleting` **não consegue iniciar um checkout hoje** — o bloqueio ocorre na Edge Function antes de `reserve_infinitepay_cash_purchase` ser alcançada.

**Residual real, gravidade Baixa (não Alta):** dentro da própria RPC `reserve_infinitepay_cash_purchase` (`supabase/migrations/20261015000002_infinitepay_checkout_failure.sql:53-54`), a única checagem de conta é `account_status <> 'deleting'` — não há checagem de `disabled` nem de `account_restrictions` **dentro do banco**. Hoje isso não é explorável (a função só é alcançável depois do gate de `has_app_access()` na Edge Function, e é `revoke all` de qualquer client direto). É uma lacuna de defesa em profundidade: se um caminho futuro (`service_role`, trigger, outra Edge Function) chamar essa RPC sem repassar pelo gate de `core.js`, não há segunda camada dentro do Postgres. Não corrigido nesta auditoria (fora do escopo desta migration, que lista objetos acessíveis a `authenticated`/`anon` — este não é).
- **Gravidade:** Baixa (defesa em profundidade ausente, não uma falha de autorização exercitável hoje).

---
**P18-c — Vitrine profissional: `create_professional_listing`, `prepare_professional_listing_publish`, `save_professional_listing_draft` só checam `deleting`**
- **Evidência:** `supabase/migrations/20260929000005_professional_listings.sql:160,201`; `supabase/migrations/20261002000001_professional_listing_publish_hardening.sql:26`.
- **Comportamento atual:** conta banida/desativada/restrita pode criar, editar e publicar uma vitrine profissional pública.
- **Comportamento esperado:** a confirmar pelo responsável — se uma conta sem `has_app_access()` deveria conseguir publicar conteúdo público novo.
- **Gravidade:** Alta.

---
**P18-d — `cast_vote` checa `deleting` e `account_restrictions`, mas não `disabled`**
- **Evidência:** `supabase/migrations/20261028000001_status_expiration.sql:324`.
- **Comportamento atual:** conta desativada (não banida, não em exclusão) ainda consegue votar em enquetes e gastar EvoCoins.
- **Comportamento esperado:** a confirmar pelo responsável — se desativação deveria bloquear também o gasto de EvoCoins em votação.
- **Gravidade:** Média.

---
**P18-e — Avatar: `allocate_profile_avatar` + policy `profile_avatars_insert` só checam `deleting`**
- **Evidência:** `supabase/migrations/20260929000004_profile_avatar.sql:88,66`.
- **Comportamento atual:** conta desativada/restrita ainda consegue trocar a foto de perfil pública.
- **Comportamento esperado:** a confirmar pelo responsável.
- **Gravidade:** Média.

---
**P18-f — Policies de dono de comunidade: `communities_update`, `community_covers_insert`/`update`**
- **Evidência:** `supabase/migrations/20260926000027_communities_owner.sql:19`; `supabase/migrations/20261104000001_community_cover_image.sql:23,32`.
- **Comportamento atual:** `is_superadmin() OR is_community_owner(id)` — nenhum dos dois braços checa o `account_status` do dono; um dono de comunidade banido/desativado continua editando a configuração e a capa da comunidade.
- **Comportamento esperado:** a confirmar pelo responsável — se `is_community_owner()` deveria incorporar `has_app_access()`.
- **Gravidade:** Média.

---
**P18-g — Moderação de conteúdo por dono de comunidade: `statuses_delete`, `comment_delete`**
- **Evidência:** `supabase/migrations/20260926000029_statuses_owner_and_post_access.sql:21`; `supabase/migrations/20261002000004_comments_functions.sql:239`.
- **Comportamento atual:** o braço "autor exclui o próprio conteúdo" é autodestrutivo (baixo risco); mas o braço "dono de comunidade modera conteúdo de terceiro" não revalida `has_app_access()` — um dono banido/desativado ainda modera (apaga posts/comentários de outros membros).
- **Comportamento esperado:** a confirmar pelo responsável.
- **Gravidade:** Média.

---
**P18-h — `sponsored_ads_select` sem checagem de app-access em nenhum braço**
- **Evidência:** `supabase/migrations/20260929000006_sponsored_ads.sql:59`.
- **Comportamento atual:** nem o braço "anúncio global" nem o braço "membro da comunidade" validam `has_app_access()` — uma conta banida/desativada ainda vê anúncios patrocinados.
- **Comportamento esperado:** a confirmar pelo responsável — é leitura de conteúdo não sensível, risco predominantemente cosmético.
- **Gravidade:** Baixa.

---

### P19 (novo) — Ausência de qualquer pipeline de CI

- **Descrição:** não existe `.github/workflows/`, nem `.gitlab-ci.yml`, `.circleci/`, `bitbucket-pipelines.yml`, `.travis.yml`, nem hook de pre-commit (`husky`/`.pre-commit-config.yaml`) em todo o repositório. `vercel.json` só define `rewrites`/`headers` — nenhum `buildCommand`/testCommand customizado (o build do Vercel roda só `vite build`, sem testes/lint).
- **Evidência:** busca exaustiva por esses arquivos/diretórios sem resultado; `vercel.json` completo; `package.json` (`scripts`: `test`, `test:functions`, `test:backfill`, `release:offline-check`, `lint`, `budget` — todos presentes, nenhum amarrado a um gatilho automatizado).
- **Como reproduzir/validar:** abrir um PR no repositório e observar que nenhum check automatizado roda; os scripts de teste (incluindo toda a suíte pgTAP descrita na seção H, que é a cobertura mais forte do repositório) só executam se alguém os rodar manualmente, localmente, com Docker para a parte SQL.
- **Impacto:** toda a cobertura de testes descrita na seção H (pgTAP de exclusão/financeiro/retenção, testes de Edge Functions, testes de frontend) depende inteiramente de disciplina manual — uma regressão em qualquer um desses fluxos críticos (exclusão de conta, EvoCash, autorização) pode chegar a produção sem que nenhum teste tenha rodado automaticamente.
- **Gravidade:** Média/Alta — não é uma falha de lógica de negócio, mas é um risco estrutural que amplia a probabilidade de qualquer outro achado deste relatório (P01–P18) regredir silenciosamente.
- **Recomendação:** a confirmar pelo responsável pelo produto/infra — decisão sobre se e quando configurar CI (ex.: GitHub Actions executando `npm test`, `npm run test:functions`, lint, e a suíte pgTAP via container Postgres efêmero) antes de mesclar PRs.

## Revisão de 2026-10-17 (F1.2) — novo achado P21 e tabela final consolidada

### P21 (novo) — Bloquear a conta não despublica a vitrine profissional; o avatar publicado continua público indefinidamente

- **Descrição:** a policy `profile_avatars_published_read` (`storage.objects`, leitura) é pública por desenho — nenhum `auth.uid()`, nenhum `has_app_access()` — porque a página da vitrine profissional precisa funcionar para visitantes sem conta (Termos da Vitrine, seção 2). Isso **não é o problema**. O problema real, descoberto ao avaliar se deveria ser: bloquear a conta do dono (`disabled`/`deleting`/banida/restrita) **não despublica** a vitrine (`published_professional_listings`) — nenhuma cascata entre `account_status`/`account_restrictions` e esse domínio foi encontrada em nenhuma migration. A vitrine completa (nome, bio, contatos, avatar) permanece publicamente visível depois do bloqueio, até uma ação administrativa explícita (o próprio dono não consegue mais despublicar sozinho, já que as RPCs de vitrine agora exigem `has_app_access()` desde a F1 — só resta o fluxo administrativo de `20261002000002_admin_vitrines_denuncias.sql`).
- **Evidência:** `supabase/migrations/20261001000003_professional_listing_avatar_publish.sql:18-23` (policy, comentário próprio confirma o desenho público intencional); grep exaustivo de `published_professional_listings` cruzado com `account_status`/`disable`/`ban`/`restrict` em todas as migrations — nenhuma cascata encontrada.
- **Comportamento atual:** conta bloqueada por qualquer motivo mantém sua vitrine (incluindo avatar) 100% pública até um admin agir manualmente.
- **Comportamento esperado:** a confirmar pelo responsável — se o bloqueio de uma conta deveria despublicar automaticamente sua vitrine profissional.
- **Impacto:** risco de produto/imagem (conteúdo de uma conta banida continua representando a marca Evolutus publicamente), não uma falha de autorização (o acesso de escrita já está corretamente fechado desde a F1).
- **Gravidade:** Média (pré-existente ao P18/F1, fora do domínio de exclusão de contas — não corrigido nesta migration).
- **Recomendação:** decisão de produto sobre adicionar uma cascata (trigger em `users`/`account_restrictions` ou passo explícito nas RPCs administrativas de bloqueio) que despublique a vitrine quando a conta do dono é bloqueada. Detalhe completo em `docs/releases/F1_2_CORRECAO_ONBOARDING.md`, seção 6.

### Tabela final consolidada — todos os achados (P01–P21)

| ID | Resumo | Status final | Gravidade final | Referência |
|---|---|---|---|---|
| P01 | Sessão ativa não revalida em tempo real (deleting/ban/suspensão) | Resolvido/reclassificado — não é gap de autorização (servidor já nega via `has_app_access()`); é gap de UX. A parte de autorização específica migrou para P18 (corrigido). Melhoria de UX em si **pendência aceita** (F4, não implementada) | Média | Seção "P01 — reconciliação" |
| P02 | F5 pós-exclusão física repete erro genérico; mensagem pronta nunca usada | Pendência aceita (F4, não implementada nesta migration) | Média | Achado original, seção C |
| P03 | Contas banidas/suspensas continuam autenticando no Supabase Auth (`banned_until` não usado) | Pendência aceita — decisão de produto/segurança não tomada (F7) | Média | Achado original + "P03 — complementação" |
| P04 | Cache offline pode mascarar bloqueio durante janela sem rede | Pendência aceita (comportamento intencional, documentado) | Média | Achado original, seção C |
| P05 | Ordem de locks invertida entre `cancel_account_deletion` e webhooks de pagamento | Pendência aceita (F5, não implementada) | Média | Achado original, seção C |
| P06 | Nenhum mecanismo de bloqueio de recriação de conta por pessoa banida | Pendência aceita — decisão jurídica/produto não tomada (F7, dúvida J2) | Média | Achado original, seção C |
| P07 | EvoCoins sem snapshot/registro na exclusão (EvoCash tem) | Pendência aceita (decisão de produto não tomada) | Média | Achado original, seção C |
| P08 | Suspensão/violação grave sem categoria estruturada | Pendência aceita — estrutural, requer decisão de produto | Baixa/Média | Achado original, seção C |
| P09 | `queue_deletion` chamável direto, pulando lock/auditoria do wrapper | Pendência aceita (F5, não implementada) | Baixa/Média | Achado original, seção C |
| P10 | 3 estratégias diferentes de preservar referência pós-exclusão | Pendência aceita (padronização não implementada) | Baixa | Achado original, seção C |
| P11 | Tratamento desigual de pendências de EvoCoins | Pendência aceita | Baixa | Achado original, seção C |
| P12 | Promoções ativas de conta excluída não são canceladas | Pendência aceita (decisão de produto) | Baixa | Achado original, seção C |
| P13 | Retenção/LGPD indefinida fora do domínio financeiro | Pendência aceita — decisão jurídica (F7, dúvidas J4-J7) | Baixa (hoje) | Achado original, seção C |
| P14 | UI admin não expõe RPCs de resolução/retenção financeira | Pendência aceita | Baixa | Achado original, seção C |
| P15 | Comentários referenciam função inexistente | Pendência aceita (cosmético) | Baixa | Achado original, seção C |
| P16/P17 | Código morto (`photoPaths`) / anon key em texto puro no cron | Pendência aceita (cosmético/operacional) | Baixa | Achado original, seção C |
| P18-a | `set_username`/`update_user_profile` sem check de `account_status` | **Corrigido na F1/F1.2** — `set_username` usa `private.has_account_standing()` (afrouxado deliberadamente para não quebrar o cadastro, ver F1.2); `update_user_profile` usa `has_app_access()` completo | Resolvida (era Alta) | `docs/releases/F1_CLOSE_HAS_APP_ACCESS_GATES.md`, `docs/releases/F1_2_CORRECAO_ONBOARDING.md` |
| P18-b | `request_cash_purchase` (função já removida) / residual em `reserve_infinitepay_cash_purchase` | Resolvido/obsoleto (função não existe mais); residual de defesa em profundidade **pendência aceita**, gravidade já Baixa, fora do escopo desta migration (objeto não é acessível a `authenticated`/`anon`) | Baixa (residual) | Seção "P18-b — RECLASSIFICADO" |
| P18-c | Vitrine profissional só checava `deleting` | **Corrigido na F1** — `has_app_access()` completo (único call site sempre pós-`LegalGate`, confirmado por rastreamento exaustivo na F1.2) | Resolvida (era Alta) | `docs/releases/F1_CLOSE_HAS_APP_ACCESS_GATES.md` |
| P18-d | `cast_vote` não checava `disabled` | **Corrigido na F1** — `has_app_access()` completo | Resolvida (era Média) | `docs/releases/F1_CLOSE_HAS_APP_ACCESS_GATES.md` |
| P18-e | Avatar (`allocate_profile_avatar` + policy) só checava `deleting` | **Corrigido na F1** — `has_app_access()` completo em ambos, incluindo a janela residual de alocação prévia | Resolvida (era Média) | `docs/releases/F1_CLOSE_HAS_APP_ACCESS_GATES.md` |
| P18-f | Policies de dono de comunidade sem revalidar status do dono | **Corrigido na F1** — `has_app_access()` acrescentado ao braço do dono (braço do superadmin inalterado, por decisão) | Resolvida (era Média) | `docs/releases/F1_CLOSE_HAS_APP_ACCESS_GATES.md` |
| P18-g | Moderação por dono de comunidade sem revalidar status | **Corrigido na F1** — `has_app_access()` acrescentado a `statuses_delete` e `private.can_moderate_status` | Resolvida (era Média) | `docs/releases/F1_CLOSE_HAS_APP_ACCESS_GATES.md` |
| P18-h | `sponsored_ads_select` sem checagem de app-access | **Corrigido na F1** — `has_app_access()` em ambos os braços de leitura | Resolvida (era Baixa) | `docs/releases/F1_CLOSE_HAS_APP_ACCESS_GATES.md` |
| P19 | Ausência de qualquer pipeline de CI | Pendência aceita (F6, não implementada) | Média/Alta | Achado original, seção "P19" |
| P20 | `cast_vote`/`create_promotion` com `search_path=public` isolado | **Corrigido na F1** — `search_path=''` em ambas, invariante do projeto restaurado | Resolvida (era Média, não explorável) | `docs/releases/F1_CLOSE_HAS_APP_ACCESS_GATES.md` |
| P21 | Bloquear a conta não despublica a vitrine profissional (avatar/conteúdo continuam públicos) | Pendência aceita (descoberto na F1.2; fora do escopo desta migration) | Média | Seção "P21" acima, `docs/releases/F1_2_CORRECAO_ONBOARDING.md` seção 6 |

**Pendências aceitas registradas nesta revisão** (nenhuma ação de código requerida agora; listadas para rastreabilidade): **P21**; UI de conta bloqueada (fase **F4** do plano pós-auditoria — tratar `'deleting'` no `ProtectedRoute` e a mensagem `account-deleted` pós-exclusão física, P01/P02); erros silenciosos em policies RLS puras (várias policies da F1 negam por **0 linhas afetadas**, não por exceção catchável — ex.: `communities_update`, `statuses_delete` — comportamento pré-existente no projeto, mantido); **P03**/`banned_until` (decisão de bloquear login no Supabase Auth, não só pós-login); **P05** (ordem de locks `cancel_account_deletion` vs. webhooks); **P06** (ban evasion vs. minimização de dados); **P09** (`queue_deletion` chamável direto); ausência de **CI** (P19); e as decisões jurídicas **J2** (bloqueio de recriação de conta) e **J4–J7** (prazos de retenção de `admin_audit_log`/`moderation_decisions`/`account_restrictions`, validação jurídica do prazo de 1 ano do caso financeiro, e o que fazer após esse prazo).

**Nota explícita de processo:** a migration F1 (`20261105000001_close_has_app_access_gates.sql`, na versão corrigida pela F1.2) **não foi validada em nenhum ambiente remoto** (nem dev, nem produção) antes desta consolidação — toda a validação (138 migrations, suíte pgTAP completa, `npm test`, `test:functions`) foi feita exclusivamente em um container PostgreSQL local descartável, com uma instância real do serviço de Storage, nunca contra um projeto Supabase hospedado. O runbook de aplicação em produção (`docs/releases/F1_APLICACAO_PRODUCAO.md`) tem essa validação remota como seu primeiro passo formal, antes de qualquer aplicação.

## Limitações desta auditoria

- Não foi feita uma varredura linha-a-linha de todas as ocorrências de `auth.uid()` em todas as RPCs/policies do repositório — os achados de autorização cobrem os casos mais relevantes encontrados por amostragem dirigida às tabelas ligadas a conta/conteúdo, não uma certificação de que não existe nenhum outro caso de policy que esqueça `has_app_access()`. **Atualização (2026-10-16): esta limitação foi superada** — uma varredura exaustiva de todas as ~93 policies e ~119 RPCs `SECURITY DEFINER` acessíveis a `authenticated` nas 137 migrations foi feita e está em [`ANEXO_VARREDURA_HAS_APP_ACCESS.md`](ANEXO_VARREDURA_HAS_APP_ACCESS.md) (resultado consolidado no novo achado P18, seção "Revisão de 2026-10-16").
- O tempo real de expiração do JWT (configuração do painel GoTrue) não está no repositório e não foi possível confirmá-lo — ele determina a duração prática da janela descrita em P02.
- O comportamento do navegador/OS quanto a manter o WebSocket Realtime vivo com a aba em segundo plano/dispositivo bloqueado não é determinável por código e afeta a severidade real de P01 em uso móvel.
- Não foi possível confirmar, só pelo código, se existe algum processo manual/jurídico fora do repositório que já responda às dúvidas de negócio da seção J.
