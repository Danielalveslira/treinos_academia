# F1.1 — Verificação pré-aplicação da migration 20261105000001

**Recomendação objetiva: NÃO aplicar em dev nem em produção.** A migration `20261105000001_close_has_app_access_gates.sql`, como está, **quebra o cadastro de qualquer usuário novo** (item A). Isso é um defeito na migration em si — por instrução explícita desta tarefa, não a alterei; parei e relato aqui, com evidência completa.

Escopo desta verificação: leitura + `supabase/tests/` + `supabase/rollbacks/` + `docs/`. Nenhum arquivo em `src/`/`supabase/functions/` foi alterado. A migration `20261105000001` não foi alterada. Nenhuma conexão remota. Nenhum commit.

---

## A. Fluxo de cadastro/onboarding — DEFEITO CRÍTICO, BLOQUEANTE

**Achado:** `src/pages/Register.jsx:104-145` chama, em ordem, dentro do mesmo bloco `try`:

```
123  await ensureUserProfile(uid)
124  await setUsername(uid, username)        <- RPC set_username
125  await setBirthInfo(uid, { sexo, dataNascimento: birthDate })
126  await setDisplayName({ uid }, username)
...
141  if (legalBundle.manifest.published) await acceptLegalDocuments(confirmed, legalBundle)   <- RPC accept_legal_documents
```

`set_username` (linha 124) é chamado **antes** de `accept_legal_documents` (linha 141). A migration `20261105000001` adicionou a `set_username` (`:35-37`):
```sql
if not coalesce(public.has_app_access(), false) then raise exception 'PERMISSION_DENIED'; end if;
```

`has_app_access()` vigente (`supabase/migrations/20260926000023_users_new_fields.sql:33-50`) exige, entre outras coisas, que `u.legal_acceptance_version`/`digest` coincidam com a `legal_policy` publicada — **sem exceção para o fluxo de cadastro**. Para um usuário recém-criado (`handle_new_user()`, `20260926000002_identity.sql:41-47`), essas colunas nascem `NULL`. Como `legal/manifest.json:4` tem `"published": true` (confirmado: a política real vigente, v1.5.0, está publicada), a cláusula de termos de `has_app_access()` avalia `NULL` (não `false` — comentário do próprio projeto em `20261009000003_evocoins_activity_unified.sql:89` já documenta esse comportamento de `has_app_access()`), e `coalesce(NULL, false) = false` → **`set_username` sempre lança `PERMISSION_DENIED` para um usuário novo**.

**Efeito em produção, se aplicada hoje:** todo cadastro cai no `catch` de `Register.jsx:127-134` ("Sua conta foi criada, mas o perfil não foi concluído..."). Como `createdAccount` (o `uid`) já foi persistido no estado do componente, um novo clique em "Concluir cadastro" repete exatamente `ensureUserProfile → setUsername` e falha de novo, **sem nunca alcançar `acceptLegalDocuments` (linha 141)**. É um laço sem saída pela própria UI: a conta de Auth existe, mas o perfil nunca é concluído, e o cadastro nunca termina normalmente.

**Não afetados pela mesma causa, confirmado:**
- `accept_legal_documents` (`20260926000019_legal_support_admin_rpcs.sql:15-58`) não exige `has_app_access()` — é desenhada para funcionar exatamente quando o acesso ainda não foi liberado (é o que destrava).
- Verificação de e-mail não é um bloqueio hoje: `supabase/config.toml:220` tem `enable_confirmations = false` (autoconfirm ligado) — confirmado por comentários do próprio código (`src/services/authService.js:11-20`, `src/utils/emailVerification.js:9-10`). `email_verified_ok()` já vem satisfeito no instante do `signUp`.
- `update_user_profile` **não é chamado durante o cadastro** — só em `Profile.jsx:89`, atrás de `ProtectedRoute`+`LegalGate`, que já exige `gateState==='allowed'` antes de deixar o usuário chegar lá. Não é atingido por este bug.
- Usuário antigo com `legal_acceptance_version` desatualizado: já é interceptado pelo `LegalGate` (`src/utils/legal.js:108-170`) antes de qualquer tela que dependa de `has_app_access()` no servidor — comportamento preexistente, não afetado por esta migration.

**Recomendação (não implementada, decisão do responsável):** a causa raiz é a ordem de chamadas em `Register.jsx` (fora do escopo desta verificação, está em `src/`), não a lógica de `has_app_access()` em si. Dois caminhos possíveis, mutuamente exclusivos, cabe decidir:
1. Reordenar `Register.jsx` para aceitar os termos **antes** de `ensureUserProfile`/`setUsername`; ou
2. Não usar `has_app_access()` completo em `set_username` — restringir o gate a `account_status`/`account_restrictions` (sem a cláusula de termos/e-mail), já que essa RPC é parte do próprio fluxo que leva à aceitação dos termos.

Qualquer um dos dois exige alterar `src/` ou a migration — **nenhum dos dois está no escopo desta tarefa**.

---

## B. Compra de EvoCash — seguro hoje, residuais conhecidos de defesa em profundidade

**Pergunta central respondida com evidência:** conta `disabled`, com restrição ativa, ou `deleting` **não consegue iniciar um checkout de EvoCash hoje**. O bloqueio ocorre em `supabase/functions/infinitepay-create-checkout/core.js:23-24`:
```js
const { data: access } = await userClient.rpc('has_app_access')
if (access !== true) throw new Error('APP_ACCESS_DENIED')
```
Isso roda **antes** de chamar `reserve_infinitepay_cash_purchase` (`core.js:37`, via client `service_role`). Essa RPC (`supabase/migrations/20261015000002_infinitepay_checkout_failure.sql:38-117`, vigente) só checa `account_status <> 'deleting'` internamente (`:53-54`) — não checa `disabled`/`account_restrictions` dentro do banco.

**Residual de defesa em profundidade (gravidade Baixa, não bloqueante):** se algum caminho futuro chamar `reserve_infinitepay_cash_purchase` sem passar pelo gate de `core.js`, não há segunda camada dentro do Postgres para `disabled`/restrição. Hoje isso não é explorável (`revoke all ... from public, anon, authenticated`, só a Edge Function chama). Já documentado e corrigido no anexo (ver seção C).

**Demais caminhos (sem checagem de conta, por desenho, não achado novo):**
- `cancel_my_cash_purchase`/`request_infinitepay_cash_purchase_cancellation` (`20261015000004_immediate_cash_purchase_cancel.sql:11-38`): só `auth.uid()`+ownership. Já classificado como risco Baixo aceito no anexo/F1 (ação autodestrutiva).
- `confirm_infinitepay_cash_purchase` + webhook (`infinitepay-webhook`) + check-payment (`infinitepay-check-payment`): sem checagem de conta — por desenho, é confirmação de dinheiro já pago pelo provedor; a mitigação para conta restrita é o caso financeiro (`_compute_financial_block_reason`), não bloqueio de acesso.
- `create_promotion` (gasto de EvoCash): vigente em `20261105000001:555-670`, usa `has_app_access()` (cobre `deleting`/`disabled`/`account_restrictions`); `community_restrictions` continua separado por design.

---

## C. Recheque do anexo (`ANEXO_VARREDURA_HAS_APP_ACCESS.md`)

Confirmado no container local (138 migrations, `to_regprocedure`/`pg_policies`/`pg_get_function_identity_arguments`) para **todos** os objetos citados: 69 policies + 67 nomes de RPC (exceto os já marcados "Removida" no próprio anexo).

**3 discrepâncias encontradas e corrigidas:**
1. `request_cash_purchase(text,text)` — **não existe** (`to_regprocedure` retorna `NULL`). Removida por `20261015000005_remove_mercadopago_runtime.sql:17`. O anexo ainda a listava como "Alta (P18-b)". **Corrigido**: anexo e `AUDITORIA_EXCLUSAO_CONTAS.md` (P18-b) atualizados — ver seção B acima para o estado real do fluxo que a substituiu.
2. `list_post_economy_voters(...)` — **não existe**. Removida por `20261006000001_post_support_reactions.sql:17` (motivo de privacidade), substituída por `list_post_supporters` (já listada corretamente no anexo). **Corrigido** no anexo.
3. `profile_avatars_published_read` (policy em `storage.objects`, `20261001000003_professional_listing_avatar_publish.sql:18`) — existe no banco mas **não estava em nenhuma tabela do anexo**. Leitura pública de avatar de vitrine já publicada, sem `auth.uid()` nem `has_app_access()` — por desenho (conteúdo de marketing público). **Adicionada** ao anexo, classificação Baixa/inferência, mesmo padrão dos outros `*_read` públicos.

**Todos os demais ~130 objetos confirmados existentes com assinatura/tabela compatível com o anexo** — nenhuma outra discrepância encontrada.

---

## D. Testes complementares

**D1 — `supabase/tests/aud_community_covers_gates_test.sql` (novo, 15 asserções).** Dedicado a `community_covers_insert`/`update`, contra o Storage real local (mesmo procedimento da F0b/F1). Cobre ativa/disabled/deleting/suspensão/banimento/superadmin para ambos. **15/15 verde.**

**D2 — Teste de rollback (executado diretamente, não como arquivo pgTAP — comparação de catálogo, não asserções de comportamento de app).** Container novo: 137 migrations → snapshot (hash de `pg_get_functiondef`/definição de policy/grants dos 15 objetos reais que compõem os "14" da F1, já que `community_covers_insert`+`update` são 2 policies) → aplica F1 → aplica rollback → novo snapshot → compara → reaplica F1.

- **Policies (6) e grants: idênticos**, sem nenhuma diferença.
- **5 de 9 funções: idênticas** (`set_username`, `update_user_profile`, `allocate_profile_avatar`, `create_promotion`, `can_moderate_status`).
- **4 de 9 funções diferem** (`cast_vote`, `create_professional_listing`, `save_professional_listing_draft`, `prepare_professional_listing_publish`) — mas a diferença, confirmada por diff textual completo linha a linha, é **só a ausência de comentários SQL explicativos** que existiam no código original (ex.: `-- Corrida: duas chamadas concorrentes tentando criar a primeira vitrine...`, `-- Serializa retries/cliques concorrentes do MESMO usuário...`) e que não foram preservados ao transcrever essas 4 funções para a migration/rollback. **Nenhuma diferença de lógica, validação, mensagem de erro, `search_path` ou comportamento** — confirmado comparando o texto completo, não só o hash.
- **Reaplicação da F1 depois do rollback: sucesso, sem erros.**

Isso significa: o rollback é **funcionalmente correto** (restaura exatamente o comportamento anterior), mas tem uma fidelidade imperfeita quanto a comentários de documentação em 4 das 9 funções — uma imprecisão cosmética da minha transcrição ao escrever a migration original e o rollback, não um defeito de comportamento.

**D3 — Caso de superadmin para `create_promotion`.** Viável sem inflar a fixture: reusei a comunidade/post já existentes na suíte principal, só credenciei EvoCoins/EvoCash para o usuário `'6'` (já fazia parte da fixture) e adicionei 1 post próprio dele. Acrescentado a `supabase/tests/aud_has_app_access_gates_test.sql` (agora 80 asserções, era 79). **80/80 verde.**

---

## E. Mensagens específicas de `create_promotion` no frontend — busca exaustiva

**Confirmado: existe, sim**, tratamento específico — `src/components/PromoteDialog.jsx:85-103`, mapa `KNOWN_ERRORS`:
```js
ACCOUNT_DISABLED: 'Sua conta não está em condições de promover conteúdo.',
ACCOUNT_RESTRICTED: 'Sua conta está com uma restrição ativa.',
```
`ACCOUNT_DELETING` **não** está nesse mapa (cairia no fallback genérico mesmo antes desta migration). `PromoteDialog.jsx` é o **único** call site de `createPromotion` em todo `src/` (busca exaustiva confirmada; `CommunityDetail.jsx`/`StatusCard.jsx` só importam o componente via `lazy()`, sem lógica de erro própria).

**Impacto real da F1:** como `create_promotion` agora lança só `PERMISSION_DENIED` para `disabled`/restrição/banimento (em vez das 3 mensagens antigas), e `PERMISSION_DENIED` **não está** no mapa `KNOWN_ERRORS`, o usuário bloqueado passa a ver o fallback genérico ("Não foi possível criar a promoção. Tente novamente.") em vez das duas mensagens amigáveis específicas que existiam. **Isto é uma regressão de UX real e confirmada** (não uma suposição) — não é uma falha de segurança (a ação continua corretamente bloqueada), mas é uma perda de qualidade de mensagem que a migration introduz sem que o `src/` correspondente tenha sido atualizado (fora do escopo desta migration/tarefa).

---

## O que não pôde ser comprovado

- Não testei o comportamento de `Register.jsx` executando de fato no navegador (só tracei o código estaticamente) — a conclusão do item A é por leitura de código, não por reprodução em UI real; a leitura é direta e inequívoca (ordem literal de `await` no mesmo bloco `try`), mas não há screenshot/execução ao vivo.
- Não verifiquei se existe algum OUTRO fluxo de criação de conta (ex.: login social, se existir) que poderia evitar `Register.jsx` e não ser afetado pelo mesmo bug — a busca foi dirigida a `Register.jsx` como pedido, não uma varredura de todo possível caminho de criação de usuário.
- Não confirmei, em todo `src/`, se existe uma tela que trata `ACCOUNT_DISABLED`/`ACCOUNT_RESTRICTED` para **outro** objeto além de `create_promotion` (a busca do item E foi especificamente sobre `create_promotion`, por ser o único objeto do grupo P18/P20 que tinha mensagens antigas distintas).
- A comparação do item D2 usou hash de `pg_get_functiondef`/definição de policy — não comparei explicitamente os grants a nível de coluna (`information_schema.column_privileges`) para os 15 objetos, só grants de tabela/rotina; não há indicação de que isso divirja (nenhum dos 15 objetos teve coluna específica alterada por esta migration), mas não foi verificado linha a linha.

## Resultado da suíte completa nesta verificação

Container novo, Storage real, 138 migrations, 57 arquivos de teste (55 originais + `aud_has_app_access_gates_test.sql` com 80 asserções + `aud_community_covers_gates_test.sql` com 15 asserções): **57/57 limpos, 0 `not ok`, 0 arquivo interrompido por erro de SQL.** `npm test`: 1951/1951. `npm run test:functions`: 156/156.

## Conclusão

**Seguro aplicar em dev/produção: NÃO, não como está.** O item A é um defeito confirmado, reproduzível e bloqueante (quebra 100% dos cadastros novos) introduzido pela migration `20261105000001` em combinação com a ordem de chamadas já existente em `Register.jsx`. Até que a ordem do fluxo de cadastro seja corrigida (em `src/`, fora do escopo desta verificação) ou o gate de `set_username` seja ajustado na migration para não exigir a cláusula de termos durante o próprio onboarding, **esta migration não deve ser aplicada em nenhum ambiente real**. Os demais itens (B, C, D, E) não bloqueiam — são, respectivamente, confirmação de segurança, correções de documentação, cobertura de teste adicional, e uma regressão de UX menor e já identificada com precisão para correção futura em `src/`.
