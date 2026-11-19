# Evolutus — checklist único de aprovação para publicar a reestruturação de autenticação

Este documento agrupa **tudo** que depende de uma ação sua (configuração remota, matrícula MFA e
autorização de produção) numa única etapa, como pedido. Nenhuma mudança remota foi feita a partir
daqui. Os valores remotos abaixo vêm da última leitura real autorizada (18/11/2026, projeto
`aofjhkkfrtrluuulacjv`, via `supabase config diff` e uma consulta somente leitura) — ver
detalhamento completo em `AUTH_RESTRUCTURING_P5_HARDENING_CHECKLIST.md`. Esta sessão não tinha um
token de acesso Supabase ativo para reconfirmar; antes de aplicar qualquer item abaixo, rode `!
supabase login` (ou exporte `SUPABASE_ACCESS_TOKEN`) para eu reler o estado atual e confirmar que
nada mudou desde então.

## A. Configuração remota do Supabase Auth (Dashboard ou CLI)

| # | Controle | Valor atual (real) | Valor alvo | Onde mudar | Risco se adiado |
| --- | --- | --- | --- | --- | --- |
| A1 | Senha mínima | 8 | **15**, sem exigência de classes (`password_requirements` vazio) | Dashboard > Authentication > Policies > Password, ou `supabase config push` com o `config.toml` já preparado | Nenhum ainda — só ativa com o cliente novo; ativar antes do cliente novo rejeitaria senhas curtas no fluxo antigo sem aviso atualizado na UI |
| A2 | Senhas comprometidas (HIBP) | Não confirmável via CLI nesta versão | Habilitar se o plano permitir | Dashboard > Authentication > Policies > "Leaked password protection" | Verificar manualmente; não bloqueia o restante |
| A3 | Confirmação de e-mail obrigatória | `true` | Manter `true` | já atende | — |
| A4 | OTP (dígitos/expiração/reenvio) | 6 dígitos / 900s / 60s | Manter | já atende, alinhado ao `config.toml` local | — |
| A5 | hCaptcha | `enabled=true`, `provider=hcaptcha` | Manter; confirmar sitekey/secret de produção batem com `src/utils/authCaptcha.js`/Edge Functions | já atende | Trocar a chave sem atualizar os dois lados quebra verificação |
| A6 | Rate limiting | Não alterado nesta tarefa | Conferir que os limites padrão do Supabase continuam ativos (não foram tocados) | Dashboard > Authentication > Rate Limits | — |
| A7 | Custom Access Token Hook | Desligado remotamente | Ligar **somente na janela coordenada** (ver seção B), nunca antes das migrations 01-02 estarem aplicadas | Dashboard > Authentication > Hooks (Postgres), apontar para `private.auth_scope_access_token` | Ligar cedo demais quebra sessões já restritas sem o marcador |
| A8 | `auth_email_first_ready` (flag privada, não é config do Supabase; não tem RPC pública de escrita -- só SQL direto, de propósito) | `false` no banco hospedado | Ligar só depois do hook e do cliente compatível publicados | `update private.auth_flow_control set email_first_ready = true where id;` via SQL direto autorizado (ex. SQL Editor do Dashboard com a `service_role`/owner do schema) | Ligar com cliente antigo em produção interrompe o cadastro convencional |
| A9 | Redirect URLs | Inclui um preview antigo da Vercel (`treinosacademia-qr3k9uub8-...vercel.app`) | Remover a entrada obsoleta; manter `www.evolutus.com.br` e localhost de dev | Dashboard > Authentication > URL Configuration | Não é risco agudo (allowlist, não bypass); é limpeza operacional |
| A10 | SMTP (Resend) | Configurado, remetente "Evolutus" | Conferir reputação/quota no painel do Resend antes do rollout (fora do alcance desta sessão) | Painel do Resend | Falha de entrega em massa durante o rollout |
| A11 | `secure_password_change` | `false` | Avaliar ativar mais adiante (exige fluxo de reautenticação — não bloqueia este rollout) | Dashboard > Authentication > Policies | Não bloqueante |
| A12 | MFA TOTP (capacidade) | `enroll_enabled=true`, `verify_enabled=true` | Já ligado — nenhuma ação aqui; o controle fica em B | já atende | — |

## B. MFA administrativo — procedimento de matrícula (seção 5 do pedido)

Estado real confirmado em 18/11: **2 contas `superadmin`, nenhuma com fator TOTP**. A capacidade de
matrícula já está ligada no projeto; só falta o uso.

1. Cada um dos 2 superadmins acessa `/admin/mfa` (tela `AdminMfa.jsx`, já publicada neste branch)
   logado com sessão completa (AAL1) e matricula um fator TOTP com um app autenticador próprio
   (Google Authenticator, 1Password, Authy, etc.).
2. Confirme que cada um consegue completar o desafio AAL2 (login + código do app) com sucesso —
   a tela já valida isso no próprio fluxo de matrícula.
3. **Contingência:** o Supabase não gera códigos de recuperação nativos para TOTP. Defina agora,
   antes de exigir AAL2 em produção, um procedimento administrativo de recuperação (ex.: um
   segundo superadmin pode usar `service_role` para desmatricular o fator do primeiro em caso de
   perda do dispositivo — isso já é possível via API do GoTrue, só precisa de um runbook curto).
   Sem isso documentado, perder o único dispositivo TOTP de um superadmin pode trancá-lo fora do
   próprio painel admin.
4. Só depois dos passos 1-3 para **ambos** os superadmins, ligue a flag privada
   `mfa_enforcement_ready` (mesma tabela e mecânica da A8 --
   `update private.auth_flow_control set mfa_enforcement_ready = true where id;`, SQL direto
   autorizado) — isso é o que faz
   `is_superadmin()` passar a exigir AAL2. Teste imediatamente: um superadmin sem reautenticar
   (AAL1) deve ser recusado nas rotas/Edge Functions administrativas; o mesmo superadmin, depois
   do desafio TOTP (AAL2), deve ser aceito. O harness local já provou essa mecânica 14/14 vezes
   com GoTrue real; isto é só repetir o mesmo teste manual uma vez em produção.

## C. Ordem de publicação e dependências (seção 6)

Resumo executivo (detalhe completo e rollback já documentados em
`AUTH_RESTRUCTURING_FINAL_TECHNICAL_REPORT.md`, seções "Publicação exata" e "Rollback"):

1. **Integrar `feat/advertiser-portal-ux` em `main` em algum momento, sem bloquear esta** — as 4
   falhas pgTAP pré-existentes que ela resolve já foram incorporadas isoladamente aqui (migrations
   `20261222000014`/`20261222000017`, ver seção D). O que resta pendente nessa branch irmã é só a
   falha de CI `js` (`ads-ux-browser-smoke.mjs`), cuja correção real está misturada com UX de
   publicidade e não foi trazida para cá de propósito (ver seção D). Integrar a branch de
   publicidade resolve isso quando for conveniente; não é um bloqueio da autenticação.
2. Aplicar migrations 01-02 (preparatórias, não mudam comportamento visível), publicar
   `signup-password-sync` e as demais Edge Functions alteradas, templates de e-mail, e o frontend
   compatível com a flag **ainda desligada**.
3. Numa janela sem cadastros convencionais em andamento: aplicar migrations 03-07, ligar o Custom
   Access Token Hook (A7), depois ligar `auth_email_first_ready` (A8).
4. Só depois de B1-B3 completos para os dois superadmins: ligar `mfa_enforcement_ready`.
5. Rollback: desligar primeiro `auth_email_first_ready`; nunca remover isoladamente
   RLS/grants/marker/provas server-side (reabre acesso a sessões restritas); desligar
   `mfa_enforcement_ready` sem remover fatores se o bloqueio for só de MFA.

Uma publicação parcial (ex.: hook ligado sem o cliente novo, ou gate 03 aplicado sem a flag) **não
derruba o login de usuários existentes** — eles continuam autenticando normalmente; o único efeito
de uma ativação fora de ordem é impedir *novos* cadastros pelo fluxo antigo enquanto o novo ainda
não está pronto. Isso já está refletido na migration 03's dependência documentada.

## D. Achados desta verificação final (seção 3 do pedido)

- **2791 vs 2785 testes JavaScript:** o número 2791 foi medido na árvore combinada
  (publicidade + autenticação) antes da separação de branches, que incluía arquivos de teste só de
  publicidade (`CreateAdWizard.test.js`, `AdManagePage.test.js`, `adImageCrop.test.js`, entre
  outros). Essa árvore combinada não existe mais como estado real. Na branch isolada
  `feat/auth-restructuring`, dois `npm test` independentes e consecutivos confirmaram
  **2785/2785, 0 falhas** — esse é o número atual e reproduzível. Nenhum arquivo de teste foi
  removido (`git diff --diff-filter=D` entre a base e HEAD está vazio).
- **6 arquivos de teste relacionados a cron:** reconfirmados nesta sessão como parte dos **117**
  arquivos que passam limpos nesta branch (`public_catalog_snapshot_test.sql`,
  `sponsored_ad_metrics_test.sql`, `web_push_hardening_test.sql`, `web_push_notifications_test.sql`,
  `workout_reminders_test.sql`, `offline_runtime_control_test.sql` — todos com `PASS` na rodada
  fresca de `verify-sql-suite.mjs`). O mecanismo `cron.launch_active_jobs = off` (ligado antes das
  migrations) preserva as definições de job para as asserções, sem jamais disparar o launcher.
- **4 falhas pgTAP originais nesta branch** (`advertising_campaigns_test.sql`,
  `advertising_campaigns_status_filter_test.sql`, `advertising_desired_duration_delivery_test.sql`,
  `advertising_operations_for_advertiser_test.sql`): **pré-existentes, sem relação com a
  autenticação**, isoladas e resolvidas nesta sessão sem trazer nenhum trabalho de UX/publicidade:
  - 3 delas tinham a mesma causa raiz: a migration `20261222000012_advertising_campaigns_status_filter.sql`
    (presente nesta branch, pré-split) introduziu uma ambiguidade de overload de função, só
    corrigida depois pela migration `20261222000017` (`feat/advertiser-portal-ux`, commit
    isolado `fffb3f0`, 5 linhas, sem nenhuma dependência de outro arquivo daquele commit).
    Confirmado por leitura direta: `main` não tem nem a migration 12 nem a 17 (o bug nunca
    existiu lá); a branch de publicidade tem as duas. Verificado empiricamente: aplicar só a
    migration 17 nesta branch resolveu exatamente essas 3. **Incorporada aqui** (commit desta
    sessão) -- mesmo arquivo, sem mudança.
  - A 4ª (`advertising_operations_for_advertiser_test.sql`) tinha DUAS causas distintas: (a) um
    bug real na função `get_advertising_operations_for_advertiser` (agregava com `jsonb_agg` e só
    depois tentava `order by/limit` na query externa -- PostgreSQL rejeita isso corretamente,
    "column must appear in GROUP BY clause"), corrigido pela migration
    `20261222000014_advertiser_operations_pagination.sql` (também um commit isolado,
    `294b436`, mas esse commit mistura 26 arquivos de UX de publicidade -- extraí só esta
    migration, que reescreve a função como uma subconsulta com `limit` ANTES do `jsonb_agg`,
    verificado sem nenhuma dependência de outro arquivo do commit); e (b) dois bugs genuínos só no
    teste (`throws_ok` com 2º argumento de 5 bytes tratado como errcode em vez de descrição; duas
    comparações `order by ... asc limit 1` que deveriam ser `desc`) -- extraí só esses 4 hunks do
    mesmo commit, sem o resto do diff daquele arquivo. **Ambas incorporadas aqui.**
  - Resultado após as duas migrations + a correção do teste: pgTAP **121/121** limpo, reproduzido
    duas vezes (a primeira tentativa de rodar a suíte inteira mostrou 81/121 com falhas em áreas
    sem relação nenhuma -- investigado e descartado como falso-alarme: duas stacks Docker Supabase
    rodando ao mesmo tempo disputando recursos, não uma regressão real; cada arquivo "falho"
    passava limpo quando reexecutado isolado; resolvido encerrando a stack duplicada).
- **CI do PR #153 encontrou dois problemas adicionais**, ambos investigados e tratados nesta sessão:
  - `finance-e2e` falhou: o novo gate `has_app_access()` (desta própria reestruturação) rejeitou
    corretamente um usuário sintético que `scripts/evocoins-activity-e2e-smoke.mjs` cria via
    `admin.createUser()` + login direto, sem nunca completar onboarding -- exatamente o cenário que
    o gate deve bloquear para uma conta de verdade. **Não é um bug no gate.** Corrigido no próprio
    script de teste: grava o marcador `private.auth_onboarding_completed` com `source='legacy'`
    antes do login, simulando uma conta legada de verdade (mesmo padrão do backfill da migration
    01). Reproduzido localmente com a mesma stack `scripts/homolog/finance/stack.mjs` que o CI usa:
    PASS. Outros 6 scripts (`verify-aud0{3,4,5,7}-local.mjs`,
    `verify-exercise-visual-deletion-local.mjs`, `verify-status-expiration-local.mjs`) usam o
    mesmo padrão `admin.createUser()`, mas **não rodam no CI** (só localmente, sob demanda) -- não
    foram tocados; risco residual documentado, não corrigido, por não estarem provadamente
    quebrados agora.
  - `js` falhou: `scripts/ads-ux-browser-smoke.mjs` (fixture de teste) não exporta o mock
    `getAdvertisingCampaignsSummary`, que `AdvertisingCentral.jsx` já importa. Confirmado
    **pré-existente ao split**: `main` não tem esse import no componente; `5998f0a` (a base comum
    de ambas as branches) já tem o import sem o mock correspondente -- idêntico nesta branch e na
    de publicidade. A correção de verdade (commit `294b436`) está inteiramente misturada com ~115
    linhas de mudanças de UX de publicidade genuínas (nova aba "Alterações", botão "Gerenciar",
    novos componentes `AdChangesTimeline`/`AdImageEditor`) -- **não isolável sem trazer esse
    trabalho de UX junto**, então **não foi corrigida aqui**. Fica para quando
    `feat/advertiser-portal-ux` integrar (ela já resolve isso).
- **Integridade de migrations:** `node scripts/check-migration-integrity.mjs` →
  `{"passed":true,"migrations":280,"historical":203}`.
- **Compatibilidade com contas legadas:** `npm run test:backfill` → 46/46.
- **Edge Functions:** `npm run test:functions` → 214/217, 3 skipped (todos pré-existentes,
  condicionados a `PG_TEST_CONTAINER`, sem relação com autenticação -- testes de concorrência do
  `process-push-outbox` que exigem um Postgres real dedicado).
- **Build/orçamento:** `npm run build` e `npm run budget` aprovados nesta branch, sem mudança no
  aviso pré-existente do chunk do Primer (~190 KB gzip), já registrado como risco conhecido e não
  tocado.
- **Nenhuma vulnerabilidade nova encontrada:** todas as funções novas de autenticação têm
  `search_path=''`; as duas migrations sem essa checagem (`...005`, `...006`) não definem funções.
  Nenhum segredo real em texto plano nos commits revisados (só senhas sintéticas de contas de
  teste descartáveis).

## Única aprovação necessária

Para prosseguir com a publicação (seções 8-9 do pedido), preciso de **uma confirmação sua** cobrindo:

1. Autorização para eu aplicar A1-A9 e A11 no projeto hospedado (ou você aplica e eu só confiro).
2. Confirmação de que os dois superadmins completaram B1-B3 (ou autorização para eu orientá-los e
   aguardar).
3. Autorização final para aplicar migrations 03-07, ligar o hook, a flag de e-mail primeiro e o
   `mfa_enforcement_ready`, nessa ordem, em produção.
4. Quando integrar `feat/advertiser-portal-ux` a `main` -- não bloqueia esta entrega; resolve só a
   falha de CI `js` (`ads-ux-browser-smoke.mjs`) que permanece nesta branch, sem relação com
   autenticação.
