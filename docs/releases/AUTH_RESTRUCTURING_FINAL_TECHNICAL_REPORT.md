# Evolutus — relatório técnico final da autenticação

## Segunda atualização de 19/11/2026

Reexecutei a homologação visual de navegador real (`verify-register-email-first-browser.mjs`,
modo e-mail primeiro) do zero, de forma independente da rodada anterior. Na primeira tentativa,
a etapa 7 (recuperação) falhou: o driver reenviava o pedido de recuperação sem a interceptação de
rede e esperava a mensagem neutra de sucesso, mas esta stack isolada não tem SMTP configurado --
a chamada real sempre falha com "Error sending recovery email", disparando corretamente o
fallback documentado de `ForgotPassword.jsx` (erro técnico, não a mensagem neutra, só numa falha
real de rede/servidor -- comportamento certo, não regressão). Corrigi a expectativa do driver
(`scripts/homolog/_e2e-driver.mjs`), removendo a reexecução sem interceptação -- validar a
mensagem neutra sobre um envio real exige SMTP de verdade, em staging. Reexecutada do zero após a
correção: **12 verificações, todas PASS**, console sem erros, screenshots reais em `/tmp/e2e-shots`
(`01-email-step.png` a `06-login-handoff.png`). O log de chamadas por endpoint confirma exatamente
uma `complete_user_onboarding` e uma `signup-password-sync` por cadastro -- a RPC transacional do
P3 na prática, não só em SQL isolado. Também corrigi um bug real e pequeno encontrado por essa
mesma rodada de trabalho em `AuthCaptcha.jsx`: `reset()` invalidava o estado mesmo quando a
verificação não é exigida, podendo derrubar `captchaVerified` de um componente pai de volta para
`false` para um captcha que nunca foi renderizado. Ambas as correções (commit `5d09f8a`) têm
testes verdes (`AuthCaptcha.test.js` 3/3) e não tocam nenhuma asserção de segurança. Repeti também
a suíte JavaScript completa do zero nesta branch: **2.785/2.785**, 0 falhas.

Conferi por amostragem, lendo o conteúdo de verdade (não só nomes de arquivo), que os commits já
presentes em `feat/auth-restructuring` antes desta sessão incorporam as correções da suíte pgTAP
descritas na seção "Regressão pgTAP" abaixo -- inclusive uma variante mais limpa da minha própria
correção em `evocash_pricing_test.sql` (omite a chave `timestamp` do `amr` em vez de usar um
valor antigo) e a melhoria do isolamento de cron para `cron.launch_active_jobs = off` antes das
migrations, em vez de `cron.unschedule` depois -- o que preserva as definições de job para as
asserções que contam jobs, fechando os 6 arquivos antes classificados como falso-alarme.

## Atualização de 19/11/2026 — esta seção substitui as contagens históricas abaixo

O trabalho segue **local**. Nenhum push, merge, deploy, migration remota ou mudança de configuração hospedada foi executado. O mantenedor informou login no terminal Supabase; ele não foi usado para alterar o projeto. A branch local `feat/auth-restructuring` foi criada a partir do HEAD de `feat/advertiser-portal-ux`. Os commits de autenticação foram separados em fundação SQL (`d496a70`), correção independente do cron (`b896299`), Edge Functions (`2e89473`), frontend (`8ecceb8`), MFA (`95ee847`) e harnesses/documentação (HEAD desta branch). A branch de publicidade preserva o restante em `294b436` e a correção de sobrecarga em `fffb3f0`. Ambas estão limpas; um stash duplicado de publicidade foi mantido como recuperação local.

**Dependência de revisão:** os números completos abaixo foram medidos na árvore combinada antes da separação final. A branch de autenticação isolada herda os commits de publicidade até `5998f0a`, mas não contém os commits novos `294b436`/`fffb3f0`; o teste SQL de campanhas depende da migration 17. Integrar publicidade primeiro e repetir o CI consolidado na combinação exata proposta para publicação. Não declarar a branch de autenticação isolada como CI verde por inferência da árvore combinada. Na branch isolada, repetiram-se a suíte JavaScript completa (`node --test --test-concurrency=1 --test-reporter=dot "src/**/*.test.js"`, saída 0, sem contagem TAP no reporter), os testes de Edge **25/25**, lint (0 erros, 16 avisos), build, budget e integridade **280/280**. O build emitiu os avisos preexistentes sobre importação mista do módulo offline e chunk grande; o gate de orçamento passou.

| Fase | Resultado atual | Gate restante |
| --- | --- | --- |
| P0 | Cadastro convencional corrigido; E2E real em Chromium com GoTrue/Postgres/PostgREST **9/9** antes da ativação do hook. | Entrega SMTP em staging. |
| P1 | Hook, grants, RLS, Storage e Edge preparados; isolamento de sessão real **63/63**, inclusive JWT restrito, refresh, revogação e pre-account hijacking. | Realtime e HTTP completo das Edge Functions em staging. |
| P2 | E-mail primeiro atrás de flag desligada; E2E real **10/10** com OTP incorreto/reutilizado, segunda aba/reload restritos, senha, login e logout. | SMTP, expiração e reenvio em staging. |
| P3 | Onboarding em uma RPC transacional; `auth.uid()`, lock de perfil, OTP, prova server-side de senha/revogação, validação de campos e termos, marcador privado. | Medição de latência com volume representativo. |
| P4 | Login, recuperação, logout, revogação e offline cobertos por testes; 63/63 com GoTrue real. | Recovery com e-mail real e UX manual em staging. |
| P5 | Política local 15 caracteres/72 bytes e TOTP com enforcement desligado; CAPTCHA **14/14** e MFA **14/14** reexecutados com GoTrue real. | Matrícula dos 2 superadmins reais antes de ligar AAL2; política remota ainda é 8 caracteres + composição na última leitura. |
| P6 | Fluxos desktop em Chromium, pt-BR, temas e testes de componente. | WCAG mobile, teclado e leitor de tela em staging. |
| P7 | JavaScript **2.791/2.791**, Edge **25/25**, isolamento **63/63**, pgTAP **122/122**, lint 0 erros/16 avisos prévios, build/budget aprovados, integridade **284 migrations**, `git diff --check` limpo. | Cenários E2E restantes e CI consolidado após autorização. |

**Correção da contagem SQL:** `supabase/tests/` tem 128 arquivos `.sql`, mas só **122** são pgTAP (`*_test.sql`). Os seis restantes são inventário, preflight, fixture de migração e diagnósticos de desempenho. O novo [runner SQL](../../scripts/homolog/verify-sql-suite.mjs) executou os 122 com `ON_ERROR_STOP=1`, falhando também em `not ok`. Todos passaram em uma stack Docker `--internal` com `cron.launch_active_jobs=off` configurado **antes** das migrations; os jobs continuaram cadastrados para as assertions. Nenhuma chamada do cron foi executada. A primeira rodada estrita encontrou seis falhas adicionais que os testes anteriores mascaravam ou não alcançavam; após correção, 122/122 passaram.

O lockfile instalado resolve `@supabase/supabase-js` e `@supabase/auth-js` em **2.117.2**. A integridade foi checada em **284 migrations na árvore combinada** e novamente em **280 na branch de autenticação isolada**. Uma consulta à base descartável confirmou que `auth_signup` podia executar somente duas funções públicas `SECURITY DEFINER` (`complete_user_onboarding` e a leitura da flag); `auth_setup`/`auth_recovery`, somente a leitura da flag. Isso não substitui a auditoria de RLS/Realtime em staging.

**Correções desta continuação:** [local-stack.sh](../../scripts/homolog/local-stack.sh), o E2E e o harness MFA desligam o launcher do cron antes dos outros serviços, em vez de apagar `cron.job` depois. A migration independente `20261222000017_remove_ambiguous_advertising_campaigns_overload.sql` remove a sobrecarga de dois argumentos; a de três argumentos com parâmetros opcionais preserva as chamadas antigas, e três testes de campanhas voltaram a passar. Foram corrigidas fixtures em `advertising_operations_for_advertiser_test.sql` (`bigint` para `jsonb`), `offline_workout_sync_test.sql` (preservar AMR/marcador ao simular outro `session_id`) e `evocash_pricing_test.sql` (método password sem timestamp para testar reautenticação recente). Nenhuma assertion de autorização foi removida ou enfraquecida.

**Chamadas medidas no Chromium:** o caminho convencional fez seis escritas de conclusão de perfil/termos (`ensure_user_profile`, nascimento, município, perfil de uso, username e aceite legal); o novo fez **uma** chamada `complete_user_onboarding` e uma Edge `signup-password-sync`, além das operações Auth. O log capturou também um `ensure_user_profile` no bootstrap após login no caminho novo, fora da transação de onboarding. Essas são contagens locais por requisição, não estimativas de latência ou custo em produção. O fluxo convencional completo só é compatível **antes** do hook/gate 03; publicar o gate 03 enquanto a flag nova permanece desligada bloquearia novos cadastros convencionais. A janela de ativação precisa ser coordenada.

| # | Critério de aceite original | Estado |
| --- | --- | --- |
| 1 | Cadastro direto ao OTP | Aprovado localmente nos dois modos. |
| 2 | Sem enumeração | Serviço/GoTrue aprovados; SMTP em staging pendente. |
| 3 | Pre-account hijacking | Ataque real coberto no 63/63. |
| 4 | Sessão restrita no backend | REST/RPC/Storage aprovados; Realtime/Edge HTTP pendentes. |
| 5 | Redirect e corrida | Testes de componente e E2E com segunda aba/reload aprovados. |
| 6 | Login, recuperação, offline | Automatizados; recovery com e-mail real pendente. |
| 7 | Onboarding transacional | Implementado e provado em SQL/GoTrue. |
| 8 | Senha, OTP, CAPTCHA | Política local/OTP testados; política remota, HIBP e SMTP pendentes. |
| 9 | MFA administrativo | Localmente implementado; matrícula/contingência remotas pendentes. |
| 10 | UX/acessibilidade | Desktop real; WCAG mobile/leitor de tela pendente. |
| 11 | Segurança/regressões | 122/122 pgTAP e 2.791/2.791 JS; superfícies de staging pendentes. |
| 12 | Testes e rollback | Plano abaixo; expiração/reenvio/recovery/falha de rede no browser pendentes. |
| 13 | Produção preservada | Sim, nenhuma alteração remota. |

### Publicação exata, somente após autorização

1. Concluir revisão dos commits e CI consolidado. A base de publicidade desta branch e a migration 17 devem ser integradas antes das migrations de autenticação. Revisar separadamente a migration 06 de URLs do cron e o estado real de cada job; não reativar job pausado.
2. Em staging isolado, aplicar migrations 01–02; publicar `signup-password-sync`, as Edge Functions alteradas, templates `recovery.html`/`magic_link.html` e cliente compatível ainda com flag `false`. Configurar Site URL e redirects, hCaptcha, SMTP de teste, confirmação obrigatória, política de 15 caracteres sem composição e grants `supabase_auth_admin`. Na Vercel, manter somente URL e anon key públicas em `VITE_*`, CSP/HTTPS e redirect de recuperação corretos; nunca segredo no build.
3. Numa janela sem cadastros convencionais em andamento, aplicar 03–07, habilitar o Custom Access Token Hook e então ligar `auth_email_first_ready`. Testar usuário novo, existente, pendente, legado incompleto, bloqueado e admin, além de OTP/recovery, RLS/Storage/Realtime/Edge, offline, finanças, publicidade, treino e notificações. Não servir o cliente P0 antigo com gate 03 ativo e flag desligada.
4. Produção recebe a mesma sequência **somente após autorização** e gates verdes em staging. Matricular e verificar TOTP dos dois superadmins, testar contingência e AAL1 negado/AAL2 permitido antes de ligar `mfa_enforcement_ready`; nunca ligar a flag antecipadamente.
5. Monitorar Auth/SMTP, 4xx/5xx, `auth_access_denied`, `session_revocation_pending`, OTP/CAPTCHA e onboarding incompleto sem e-mail, senha, código, token ou URL sensível nos logs.

**Rollback:** desligar primeiro `auth_email_first_ready` e pausar novas inscrições na janela. Restaurar cliente, hook e gate como **unidade compatível testada**; não remover isoladamente RLS/grants/marker/provas server-side, pois isso reabriria acesso a sessões restritas. Se a falha for apenas de MFA, desligar `mfa_enforcement_ready` sem remover fatores. Preservar migrations e dados; corrigir de forma aditiva. Repetir chamadas diretas com JWT restrito/revogado antes de reabrir inscrições.

**Riscos residuais:** entrega SMTP, HIBP, quotas/rate limits e política efetiva do projeto hospedado exigem verificação no painel. Realtime e Edge HTTP completos não foram exercitados na rede Docker interna porque o runtime Deno tenta resolver `jsr:` externamente. Sessões offline genuinamente desconectadas não recebem revogação imediata; a janela permanece em 24 h. A UI valida 72 **bytes** de senha sem truncar Unicode; senhas antigas não são invalidadas. Nenhuma falha de segurança reproduzida foi deliberadamente deixada aberta no código local, mas esses gates operacionais impedem declarar a publicação liberada.

**Checklist desta continuação:** [x] 122/122 pgTAP, [x] 63/63 isolamento, [x] 2.791/2.791 JavaScript, [x] 25/25 Edge, [x] E2E convencional 9/9, [x] E2E e-mail primeiro 10/10 com abas/reload, [x] CAPTCHA/MFA 14/14 cada, [x] build/budget/integridade/diff, [x] seis commits locais de autenticação por responsabilidade, [x] contêineres/redes/volume e imagem Playwright temporários removidos, [ ] staging e CI consolidados após integração das branches, [ ] autorização de publicação. As seções anteriores abaixo foram escritas antes dessas correções e servem apenas como histórico; seus números de pgTAP, E2E e status de branch não representam mais o estado atual.

---

## Histórico anterior (superado pela atualização acima)

Estado local em 19/11/2026. Este documento consolida as etapas P0–P7 do [prompt](../promps/PROMPT_REESTRUTURACAO_AUTENTICACAO_EVOLUTUS.md). Nenhuma configuração hospedada, migration remota, deploy, push ou PR foi alterado nesta continuação. O trabalho permanece no worktree misto `feat/advertiser-portal-ux`; as alterações de publicidade foram preservadas.

## Status por fase

| Fase | Estado técnico | Condição para publicar |
| --- | --- | --- |
| P0 | Implementada e testada: `signUp` sem sessão segue ao OTP; retorno incerto não é confundido com rejeição; duplicidade usa mensagem neutra. | Validar SMTP e logs no staging. |
| P1 | Implementada localmente: hook assina roles `auth_signup`, `auth_setup`, `auth_recovery` e `authenticated`; RLS, RPCs, Storage e Edge Functions negam sessões restritas. Harness real de GoTrue/Postgres/PostgREST: 63/63 verificações. | Habilitar hook só no staging e seguir a ordem de rollout abaixo. |
| P2 | Fluxo de e-mail primeiro está atrás da flag de servidor desligada. Conta legada incompleta exige novo OTP, nova senha e revogação comprovada antes da RPC. Pré-cadastro por terceiro não conserva sua senha ou sessão depois da prova da vítima. | Confirmar caixa de e-mail real e navegador em staging; ligar flag somente após hook e cliente compatíveis. |
| P3 | `complete_user_onboarding(jsonb,jsonb)` transaciona perfil e aceite legal; bloqueia replay, concorrência, dados inválidos, sessão sem OTP, senha não sincronizada e revogação pendente. Marcador privado do servidor substitui username como prova de conclusão. Fluxo novo reduz as escritas de perfil de seis chamadas para uma RPC; Auth e PostgreSQL continuam etapas distintas com retomada idempotente. | Migration e Edge Function precisam entrar antes da flag; revalidar documentos publicados durante o cadastro. |
| P4 | Login, recuperação, saída, revogação, cold start offline e isolamento por UID cobertos por testes. Sessões restritas não carregam perfil, termos, carteira ou bootstrap offline. Teste de treino que travava corrigido por desmontagem dos componentes e restauração do relógio. | Validar URLs, templates e delivery no staging. |
| P5 | Política local preparada: 15 caracteres, sem classe obrigatória; OTP local alinhado ao remoto em 900 s e reenvio 60 s. CAPTCHA e refresh rotation mantidos. UI de matrícula/desafio TOTP adicionada; `is_superadmin()` e helper das Edge Functions usam gate de sessão completa e AAL2 quando a flag de enforcement for ligada. | **Bloqueio operacional:** 2 superadmins reais sem fator. Matricular ambos, configurar fator de reserva/contingência e homologar antes de ligar enforcement. Política hospedada ainda é 8 + letras/números; atualizar junto do cliente no rollout. |
| P6 | Fluxos de cadastro e retomada exibem estado e erros específicos; tela MFA é carregada sob demanda; não há CAPTCHA em cada render. Build e orçamento de bundle passaram. | Teste manual móvel e acessibilidade com serviços reais ainda necessário. |
| P7 | Suíte React/serviços completa, testes de Edge, backfill, CI, lint, build, budget, integridade de migrations e harness de isolamento executados; resultados abaixo. Suíte pgTAP completa (128 arquivos) auditada: 117/128 limpos após 2 correções de fixture; 6 falhas são artefato do isolamento de cron desta stack, não bugs; 5 permanecem sem causa raiz confirmada. | Smoke de staging depois da publicação coordenada; investigar os 5 arquivos pgTAP restantes antes do fechamento. |

## Bloqueios e riscos que impedem declarar rollout concluído

1. **Ordem de ativação:** `20261223000003_auth_full_session_gate.sql` exige marcador de onboarding. Enquanto o hook e e-mail primeiro estiverem desligados, o cadastro convencional P0 ainda conclui dados por RPCs separadas, sem marcador. Publicar a migration 03 isoladamente interromperia esse cadastro. A migration 01 e 02 são preparatórias; a partir da 03, a ativação de hook/flag precisa ocorrer numa janela coordenada sem novos cadastros em andamento. Não ativar a flag antes das verificações de OTP, login e recuperação. Não usar a flag como bypass temporário do gate de autorização.
2. **MFA:** 2 contas superadmin hospedadas, nenhuma com TOTP verificado na última consulta autorizada. `mfa_enforcement_ready` permanece `false`. Ativar agora bloquearia ambos. O Supabase não fornece códigos de recuperação nativos nesta integração; usar segundo fator/dispositivo e processo de recuperação administrativa controlado.
3. **Política de senhas:** UI e `config.toml` agora aceitam frases longas sem composição, mas a política remota ainda exige letras e números e mínimo 8. Até a configuração remota ser alinhada, uma frase só com letras pode receber `weak_password` do GoTrue. O GoTrue limita a 72 **bytes**; a UI valida explicitamente, aceita 64 caracteres ASCII e não trunca senhas Unicode. Usuários antigos não terão a senha redefinida em massa.
4. **SMTP/CAPTCHA/limites:** hCaptcha está ativo no servidor hospedado; quota, reputação do Resend, proteção HIBP e limites efetivos do plano dependem de painel/telemetria, não foram inferidos de `config.toml`. O CAPTCHA é verificado no GoTrue; cooldown de UI não substitui rate limit do servidor.
5. **Contas históricas:** backfill considera o contrato antigo (username preenchido após perfil e aceite, e-mail confirmado). Contas sem marcador passam por nova prova de e-mail; dados históricos são preservados. O cadastro novo exige todos os campos atuais na RPC. Não atribuir marcador em massa por mera sessão de senha.
6. **Suíte pgTAP:** 5 de 128 arquivos de teste SQL ficaram com falha não explicada depois do gate novo de sessão (ver seção "Regressão pgTAP"). Não bloqueiam P0-P2, mas precisam de investigação antes de considerar a reestruturação completa encerrada -- não declarados seguros nem regressão confirmada.

## Arquivos de autenticação alterados ou criados

- UI/estado: `src/App.jsx`, `src/components/AuthCaptcha.jsx`, `src/components/NewPasswordFields.jsx`, `src/components/ProtectedRoute.jsx`, `src/components/RestrictedSessionGate.jsx`, `src/components/PublicLayout.jsx`, `src/components/AdminNav.jsx`, `src/components/AccountMenu.test.js`, `src/constants/adminNav.js`, `src/contexts/AuthContext.jsx`, `src/hooks/useRecoveryTokenExchange.js`, `src/pages/{AdminMfa,ConfirmEmail,ForgotPassword,Login,Register,ResetPassword}.jsx`, `src/styles/app.css`, `index.html`, `public/recovery-token-boot.js`.
- Serviços/regras: `src/services/{authService,profileCompletion}.js`, `src/utils/{authSession,authAnalytics,authErrors,validators}.js`, `supabase/config.toml`, `supabase/templates/{recovery,magic_link}.html`.
- Testes: `src/components/{AuthCaptcha,ProtectedRoute,workoutSession.interactions}.test.js`, `src/contexts/authColdStart.test.js`, `src/pages/{ConfirmEmail,Register}.test.js`, `src/services/{authCaptchaFlow,authRecoveryFlow,profileCompletion}.test.js`, `src/utils/{authSession,validators,municipalities}.test.js`, `src/hooks/recoveryTokenBoot.test.js`, `supabase/functions/_shared/edgeTestKit.js`, `supabase/functions/publish-exercise-visual/publish.test.js`, `supabase/tests/{_helpers/auth_session,session_revocation_guard_test}.sql`.
- Harness e documentação: `scripts/homolog/{local-stack.sh,auth-hook-stack.sh,verify-auth-session-isolation.mjs,verify-captcha-server-enforcement.mjs,verify-mfa-totp.mjs}`, `docs/releases/AUTH_RESTRUCTURING_*.md`.

Alterações anteriores de publicidade, imagens, contratos, compras e migrations `20261222000014`–`16` continuam no mesmo worktree e **não pertencem ao pacote de autenticação**. As quatro Edge Functions de pagamento/listagem e `exercise-catalog-proxy` já modificadas no worktree devem ser revisadas separadamente antes de qualquer commit. Não usar `git add .`.

## Migrations e Edge Functions

| Arquivo | Papel |
| --- | --- |
| `20261223000001_auth_scope_foundation.sql` | Roles temporárias, marcador de conclusão e hook de claims. |
| `20261223000002_auth_signup_password_proof.sql` | Prova de senha/revogação e RPC transacional de onboarding. |
| `20261223000003_auth_full_session_gate.sql` | Gate de sessão completa em `has_app_access()` e `is_superadmin()`. |
| `20261223000004_auth_email_first_switch.sql` | Flag de servidor, desligada por padrão. |
| `20261223000005_storage_restricted_session_read_gate.sql` | Privilégios de leitura mínimos no Storage. |
| `20261223000006_realign_stale_cron_urls.sql` | Realinhamento de URLs antigas de cron; revisar no deploy isolado. |
| `20261223000007_mfa_superadmin_readiness.sql` | Gate AAL2 com enforcement desligado por padrão. |

`supabase/functions/signup-password-sync/index.ts` usa o JWT temporário, atualiza senha no Auth, revoga outras sessões e registra as provas no PostgreSQL. `supabase/functions/_shared/superadminAuth.ts` agora consulta `is_superadmin()` com o JWT do solicitante antes de criar o cliente `service_role`; as funções administrativas que o importam herdam o gate de sessão/AAL2.

## Verificações locais

| Verificação | Resultado |
| --- | --- |
| `npm test` (execução completa após tela MFA) | 2.791/2.791 passou; 0 falhas. |
| `src/components/workoutSession.interactions.test.js` isolado | 20/20; processo termina normalmente. |
| `node --test` direcionado de AuthContext, rotas, regras e perfil | 109/109. |
| Rotas/menu administrativo depois da tela MFA | 20/20. |
| `npm run test:functions` | 25/25, incluindo negação de sessão restrita/AAL insuficiente antes de Storage. |
| `npm run test:backfill` / `npm run test:ci` | 9/9 e 1/1. |
| `npm run lint` | 0 erros; 16 avisos existentes. |
| `npm run build` / `npm run budget` / integridade de migrations | Passou. |
| GoTrue + Postgres + PostgREST com hook em Docker `--internal` | 63/63 verificações de sessão/conta legada/RPC. |
| GoTrue TOTP real em Docker `--internal` | 14/14: matrícula, erro de código, verify correto, AAL2, negação de AAL1 após enforcement local. |
| pgtap `session_revocation_guard_test.sql` | 23/23 após corrigir a fixture de termos vigentes. |
| pgtap, suíte completa (128 arquivos) | 117/128 arquivos limpos após as correções abaixo; ver seção "Regressão pgTAP" para os 11 restantes. |

O sandbox impediu `spawnSync` em testes que abrem subprocessos (`EPERM`) e a conexão ao socket Docker. A suíte completa foi repetida com a permissão de execução necessária, sem ampliar timeouts ou ignorar testes. Avisos `SET LOCAL can only be used in transaction blocks` vêm do aplicador SQL simplificado do harness; não alteraram os resultados de autorização.

## Regressão pgTAP — auditoria dos 128 arquivos de `supabase/tests/`

Rodei os 128 arquivos individualmente (`docker cp` + `psql -f` por arquivo, contra uma stack isolada reconstruída do zero; `\ir` relativo não resolve via stdin) para confrontar a suíte SQL inteira com o gate novo de sessão (`is_full_login_session()`), não só os arquivos já citados acima. Resultado reproduzido duas vezes seguidas, estável: **117/128 limpos**; 11 arquivos com `not ok`.

**Causa raiz, corrigida em `supabase/tests/_helpers/auth_session.sql`:** `pg_temp.set_test_user()` nunca definia `amr` nem `private.auth_onboarding_completed` -- toda fixture virava uma sessão restrita aos olhos do gate novo, mesmo quando o teste sempre assumiu "sessão válida = acesso total" (verdade antes desta tarefa). Corrigido para gravar `amr` com `password` e a marcação de onboarding por padrão -- a mesma suposição que todo teste pré-existente já fazia.

**Não** estendi esse default para aceite de termos legais: ao contrário de amr/onboarding (conceito novo, nenhum teste antigo podia prever), o estado de aceite já era uma dimensão deliberadamente variada por vários testes (alguns querem "aceitou", outros "não aceitou ainda" de propósito -- `aud_has_app_access_gates_test.sql` 16c, `supporters_failclosed_test.sql`). Tentei um default aqui também; quebrou exatamente esses testes. Revertido -- cada um já grava o aceite que precisa, explicitamente.

**3 arquivos** (`evocash_pricing_test.sql`, `refund_requests_test.sql`, `supplier_info_atomic_gate_test.sql`) testam uma exigência de reautenticação *recente* pré-existente e não relacionada (`private.require_evocash_admin(true)`, migration `20261128000001`), que também lê `amr`, mas por *recência* (janela de 5 minutos), não só presença. O novo default (amr sempre "agora") fazia essas chamadas parecerem sempre recém-autenticadas, derrubando o teste. Corrigido por arquivo: um login antigo explícito (amr presente, `timestamp` de 1h atrás) depois do `set_test_user`, só nesses três -- preserva o gate novo (sessão plena) e ainda exercita a janela de recência antiga.

**6 arquivos são falso-alarme do isolamento de produção desta sessão, não bugs:** `local-stack.sh` roda `select cron.unschedule(jobid) from cron.job` depois das migrations (proteção deliberada contra as URLs de cron de produção -- seção anterior). Qualquer teste que verifique "existe N jobs de cron" falha nesta stack isolada por desenho, mesmo a migration real registrando o job corretamente: `public_catalog_snapshot_test.sql`, `sponsored_ad_metrics_test.sql`, `web_push_hardening_test.sql`, `web_push_notifications_test.sql`, `workout_reminders_test.sql`, `offline_runtime_control_test.sql`.

**5 arquivos permanecem com falha não explicada, sem correção aplicada** -- investigados, causa raiz não isolada com confiança suficiente para corrigir sem risco: `admin_accounts_defensive_test.sql` (reprodução isolada do mecanismo de revogação+nova sessão funciona corretamente fora do arquivo; a falha só ocorre dentro do fluxo completo do arquivo, possivelmente interação com o mecanismo de injeção por DO block que o próprio arquivo documenta como "em evolução ativa"), `advertising_operations_for_advertiser_test.sql`, `notification_security_test.sql`, `security_followup_test.sql`, `workout_exercise_completion_test.sql` (este último parece não ter relação com sessão/amr -- RLS de `workouts`, possivelmente pré-existente e independente desta tarefa). **Não declaro esses cinco como seguros nem como regressão confirmada** -- precisam de investigação dedicada antes do rollout, idealmente por quem tem contexto completo do mecanismo financeiro "em evolução ativa" citado nos comentários do primeiro arquivo.

Arquivos alterados nesta auditoria: `supabase/tests/_helpers/auth_session.sql`, `supabase/tests/evocash_pricing_test.sql`, `supabase/tests/refund_requests_test.sql`, `supabase/tests/supplier_info_atomic_gate_test.sql`. Nenhuma migration foi tocada.

## Homologação do fluxo de cadastro -- limite confirmado deste ambiente

Tentei uma homologação completa via navegador real (Vite dev server apontado para a stack isolada com o hook ligado e a flag `email_first_ready=true` só no banco descartável) para observar visualmente as telas novas (código, "defina sua senha", confirmação). **Não foi possível**: a publicação de porta do Docker para o host não funciona de forma confiável neste sandbox -- `docker inspect` mostra `PortBindings` com IP inválido e nenhuma porta (`54321`, `8000`, `9991`) realmente aceita conexão do host, mesmo com o container saudável e respondendo corretamente por dentro da própria rede (`docker exec hdb curl ...` funciona; `curl` do host não). Isso já era conhecido e documentado em `scripts/homolog/verify-auth-session-isolation.mjs` (por isso aquele script nunca usa a porta publicada, só `docker exec`) -- esta sessão só confirma que o navegador real, que precisa da porta do host, não tem como contornar essa limitação aqui.

A homologação do fluxo e-mail-primeiro continua apoiada em duas camadas reais, não numa terceira: (1) prova real de API/SQL ponta a ponta (harness de 63 verificações, hook real, Postgres real, sem mocks) cobrindo exatamente a sequência que o navegador executaria -- solicitar código, verificar, definir senha, concluir onboarding, logar explicitamente; (2) prova de componente (`Register.test.js`, casos "e-mail primeiro") confirmando que a UI decide a tela certa a cada resposta do servidor. Falta, e não foi possível produzir neste ambiente: uma captura visual real das telas novas com o fluxo realmente ligado (teclado, leitor de tela, mobile, tema escuro especificamente nessas telas) -- a verificação visual já feita nesta tarefa foi contra produção, com a flag desligada, então nunca renderizou as telas exclusivas do e-mail primeiro. Recomendo esse passo específico em staging real (onde a porta não é um problema) antes de ligar a flag em produção.

## Publicação coordenada e rollback

1. Criar uma branch/commit **somente de autenticação** a partir dos caminhos acima; manter publicidade em patch/commit separado sem limpar o worktree. Revisar diffs das funções que misturam autorização com módulos comerciais.
2. Em staging isolado, preparar migrations 01–02, Edge `signup-password-sync`, templates, URL/redirects/CAPTCHA/SMTP e política de senhas. Publicar o cliente compatível ainda com e-mail primeiro desligado; ele interpreta ausência da RPC de flag como `false`.
3. Numa janela coordenada de staging, sem cadastros P0 em andamento, aplicar migrations 03–07, conferir grants `supabase_auth_admin`, habilitar o custom access token hook e então ligar a flag e-mail primeiro. Repetir os 63 casos, criação/duplicidade/pre-account hijacking, conta legada, recuperação, login antigo, offline, legal, treino, comunidade, publicidade, EvoCash/EvoCoins/compras/notificações/admin. Em produção, usar a mesma sequência somente após aprovação do rollout e repetir com usuários de teste, sem copiar dados pessoais para staging.
4. Matricular e confirmar TOTP dos dois superadmins e fator de reserva; testar um segundo administrador e a contingência. Só depois, com autorização de rollout, ligar `mfa_enforcement_ready` no servidor. Verificar Edge Functions administrativas diretamente com AAL1 e AAL2.
5. Rollback de fluxo: desligar primeiro `auth_email_first_ready`, restaurar cliente anterior compatível e configuração do hook de forma coordenada. Não apagar o marcador privado, perfis, aceites, sessões ou migrations já aplicadas. Se o gate 03 já estiver ativo, não voltar ao cadastro P0 sem uma migration de compatibilidade cuidadosamente testada; restaurar o cliente e o hook como uma unidade. Desligar `mfa_enforcement_ready` se houver bloqueio administrativo; não remover fatores de usuários. Documentar e revalidar a migração de senhas/SMTP antes de reverter política remota.

## Separação por responsabilidade -- plano, não executado

Classifiquei cada um dos arquivos hoje modificados/novos no worktree. Nenhum `git add`/`commit` foi feito -- a política deste assistente é nunca commitar sem pedido explícito. Abaixo está o plano pronto para execução quando autorizado.

**Fora do pacote de autenticação (publicidade/comercial -- não tocar):** `scripts/ads-ux-browser-smoke.mjs`; `src/components/{AdvertisingCentral,CommercialContractPreview,CommercialLeasePurchase,CommercialOrderHistory,ProfileAvatarEditor}.jsx`; `src/components/advertising/*` (incl. `AdChangesTimeline.jsx`, `AdImageEditor.jsx` novos); `src/hooks/useDecodedImageSource.js` (extraído para o editor de imagem do anúncio reaproveitar, só incidentalmente toca `ProfileAvatarEditor.jsx`); `src/services/{advertisingService,storefrontService}.js`; `src/utils/{avatarCrop,adImageCrop,imageCropEncode}.js` (+ `adImageCrop.test.js`); `supabase/migrations/20261222000014-16*.sql`; `supabase/tests/advertising_destination_validation_test.sql`.

**Pacote de autenticação, em 5 commits propostos (nomes de arquivo exatos, para execução com `git add <paths>`, nunca `git add .`):**

1. *Fundação de autorização por sessão (migrations + correção da suíte pgTAP)* -- `supabase/migrations/20261223000001-07_*.sql` (7 arquivos), `supabase/config.toml`, `supabase/tests/_helpers/auth_session.sql`, `supabase/tests/{evocash_pricing,refund_requests,session_revocation_guard,supplier_info_atomic_gate}_test.sql`.
2. *Edge Functions administrativas e financeiras sob o gate novo* -- `supabase/functions/_shared/{superadminAuth.ts,edgeTestKit.js}`, `supabase/functions/{exercise-catalog-proxy,finalize-professional-listing-publish,infinitepay-check-payment,infinitepay-create-checkout}/index.ts`, `supabase/functions/publish-exercise-visual/publish.test.js`, `supabase/functions/signup-password-sync/` (diretório novo inteiro).
3. *Cadastro, confirmação, recuperação e login reconstruídos sobre sessão comprovada* -- `src/services/{authService,profileCompletion}.js` (+ `.test.js`), `src/utils/{authErrors,authSession,authAnalytics,validators,municipalities}.js` (+ `.test.js` onde houver), `src/hooks/useRecoveryTokenExchange.js` (+ `recoveryTokenBoot.test.js`), `public/recovery-token-boot.js`, `index.html`, `src/pages/{Register,ConfirmEmail,ForgotPassword,ResetPassword,Login}.jsx` (+ `.test.js`), `src/components/{NewPasswordFields,AuthCaptcha,PublicLayout,RestrictedSessionGate,ProtectedRoute}.jsx` (+ `.test.js`), `src/contexts/AuthContext.jsx` (+ `authColdStart.test.js`), `src/services/{authCaptchaFlow,authRecoveryFlow}.test.js`, `src/styles/app.css`, `src/components/workoutSession.interactions.test.js` (destravado por esta mudança, não por uma mudança de treino), `supabase/templates/{recovery,magic_link}.html`.
4. *Matrícula e desafio TOTP para superadmins* -- `src/pages/AdminMfa.jsx`, `src/App.jsx`, `src/components/AdminNav.jsx` (+ `AccountMenu.test.js`), `src/constants/adminNav.js`.
5. *Harness de homologação local e documentação* -- `scripts/homolog/{local-stack.sh,auth-hook-stack.sh,verify-auth-session-isolation.mjs,verify-captcha-server-enforcement.mjs,verify-mfa-totp.mjs}`, `docs/promps/PROMPT_REESTRUTURACAO_AUTENTICACAO_EVOLUTUS.md`, `docs/releases/AUTH_RESTRUCTURING_*.md` (6 arquivos).

Branch sugerida pelo prompt original: `fix/auth-signup-hardening`, criada a partir do HEAD atual de `feat/advertiser-portal-ux`. Como commits não duplicam a árvore de trabalho, os arquivos de publicidade acima continuam como modificações não staged em qualquer branch até serem commitados separadamente pelo responsável por aquele trabalho.

## Checklist final (Definition of Done, seção 13 do prompt)

- [x] Cadastro novo encaminha diretamente à confirmação; sem falsa falha quando a API aceita sem sessão.
- [x] Interface neutra, sem enumeração; duplicidade não cria perfil/identidade paralela (testado com GoTrue real).
- [x] Pre-account hijacking coberto por GoTrue real (harness, cenário do atacante com senha própria), sem regressão.
- [x] Sessões de recuperação/cadastro com privilégios mínimos verificados server-side, inclusive chamada direta (RPC/Storage/Edge testados; Realtime não exercitado nesta sessão).
- [x] Nenhum acesso prematuro ao app por evento de Auth/reload/múltiplas abas (`RestrictedSessionGate`, `is_full_login_session()`).
- [x] Login, logout, recuperação, revogação, bloqueio, exclusão e offline com contratos seguros -- testes automatizados cobrindo cada um.
- [x] Onboarding transacional, idempotente, validado no servidor, compatível com usuários existentes (`complete_user_onboarding`, cenário "legado incompleto" testado).
- [ ] Política de senha/OTP/CAPTCHA/limites validada em ambiente real -- **parcial**: CAPTCHA validado contra hCaptcha real; política de senha e OTP alinhados localmente, mudança remota ainda não aplicada (lista abaixo).
- [ ] MFA administrativa implementada e homologada -- **parcial**: implementada e homologada localmente (14/14, GoTrue real); matrícula real dos 2 superadmins e enforcement remoto são ação humana fora do alcance deste repositório.
- [x] UX responsiva, acessível, localizada; sem rodapé vazio (verificado visualmente em 360/390px, claro/escuro -- telas exclusivas do e-mail primeiro não renderizadas por limite de ambiente, ver seção acima).
- [ ] Sem segredos, permissões excessivas, gaps em RLS, regressão financeira -- **parcial**: 123/128 arquivos pgTAP limpos (117 limpos de origem + 6 cron-artefato explicados); 5 arquivos com causa raiz não confirmada (ver "Regressão pgTAP").
- [x] Testes executados localmente com resultados reais reportados (não estimados); falhas/bloqueios documentados.
- [x] Nenhuma mudança remota ou publicação sem autorização -- todas as consultas ao projeto hospedado foram somente leitura e autorizadas explicitamente.

**Não concluído integralmente**: 3 itens ficam parciais pelos motivos acima (política de senha remota, MFA remoto, 5 arquivos pgTAP). Isso é compatível com a própria regra do prompt -- "P0 pode ser homologado separadamente; a reestruturação completa só será considerada concluída após todos os gates aplicáveis" -- P0-P4 e a fundação do P1 estão prontos para homologação; P5 (senha/MFA remotos) e o fechamento de regressão pgTAP são os gates que faltam.

**Conclusão:** implementação e homologação local avançadas; rollout e fechamento da reestruturação ainda dependem dos gates operacionais acima. Não declarar produção pronta enquanto essas pendências existirem.
