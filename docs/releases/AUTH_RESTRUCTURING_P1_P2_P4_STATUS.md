# Autenticação Evolutus — status P1/P2/P4 (continuação, 18/11/2026)

Este documento continua `AUTH_RESTRUCTURING_P0.md`. O trabalho abaixo já existia, não documentado, quando esta sessão retomou a tarefa; eu revisei, corrigi uma quebra de build nos testes e validei o estado atual. Nada foi enviado para ambiente remoto, `main` ou PR.

## 1. O que já existe (não commitado, branch `feat/advertiser-portal-ux`)

### P1 — Autorização por sessão no servidor

| Migration | Função |
| --- | --- |
| `20261223000001_auth_scope_foundation.sql` | Cria roles `auth_signup`/`auth_recovery`/`auth_setup`; marcador server-only `private.auth_onboarding_completed`; hook `private.auth_scope_access_token(event)` que lê o `amr` assinado pelo GoTrue (não o `purpose` do cliente) e grava um `role` derivado no JWT; cria `complete_user_onboarding(profile, legal)`; reconcede explicitamente a `anon`/`authenticated` RPCs `SECURITY DEFINER` que um `revoke from public` cego teria cortado. **O hook não está habilitado em lugar nenhum** (nem local, nem hospedado) — comentário no arquivo exige testes em ambiente separado antes disso. |
| `20261223000002_auth_signup_password_proof.sql` | `private.auth_signup_password_progress` (prova por `session_id`, gravável só por `service_role`) e reescreve `complete_user_onboarding` para exigir prova de senha + revogação de outras sessões **da mesma sessão**, e falhar se existir qualquer outra sessão viva do usuário — o gate anti-pre-account-hijacking. |
| `20261223000003_auth_full_session_gate.sql` | `is_full_login_session()` (role `authenticated` + sessão ativa + onboarding concluído + `amr` contém `password`) e reescreve `has_app_access()`/`is_superadmin()` para negar por padrão quando não for sessão plena. **Esta é a migration que já funciona mesmo sem o hook habilitado**, porque `amr` e o marcador de onboarding já existem nativamente; o hook só adiciona separação de role no PostgREST por cima disso. |
| `20261223000004_auth_email_first_switch.sql` | Flag server-side `auth_email_first_ready()`, default `false`. Não é controle de autorização, só liga a UI de e-mail primeiro quando autorizado manualmente. |

`supabase/functions/signup-password-sync/index.ts` (nova Edge Function) usa a chave de serviço para trocar a senha via API admin do GoTrue, encerrar outras sessões e gravar a prova via as RPCs acima — o cliente nunca atesta isso sozinho.

As quatro Edge Functions financeiras/de catálogo (`exercise-catalog-proxy`, `finalize-professional-listing-publish`, `infinitepay-check-payment`, `infinitepay-create-checkout`) já foram migradas de `is_session_active()`/checagem simples para `is_full_login_session()` — o alcance do gate já chegou às superfícies financeiras, não só ao fluxo de Auth.

### P2 — Cadastro e-mail primeiro (atrás da flag, sem afetar produção)

`Register.jsx`, `authService.js` e `profileCompletion.js` implementam o fluxo completo da seção 6 do prompt — `signInWithOtp` (e-mail) → `verifyOtp` → senha via `signup-password-sync` → `complete_user_onboarding` → logout → login explícito — mas **só quando `auth_email_first_ready()` retorna `true`**. Com a flag em `false` (estado atual, inclusive em produção), o caminho é exatamente o `signUp` convencional corrigido do P0. Um código roteado para `auth_recovery` (conta existente) nunca chega a trocar senha nem perfil; a sessão é encerrada e a pessoa é mandada para login/recuperação.

### P4 — Recuperação

- Token de recuperação passou de query string (`?token_hash=...`) para fragmento de URL (`#token_hash=...`) no template `recovery.html` — nunca trafega em requisição HTTP, logs de servidor/CDN ou `Referer`.
- `public/recovery-token-boot.js`, carregado antes de qualquer outro script em `index.html`, captura o token em memória (`window.__EVOLUTUS_RECOVERY_TOKEN`) e limpa a URL imediatamente, antes de analytics/React.
- `<meta name="referrer" content="no-referrer">` adicionada.
- `ResetPassword.jsx` ficou idempotente por etapa (`passwordUpdated`/`othersRevoked`) e **falha fechado**: se a troca de senha funcionou mas a revogação de outras sessões falhar, a pessoa vê exatamente isso e pode retomar sem repetir a troca de senha nem perder a sessão de recuperação à força.

## 2. O que eu corrigi nesta sessão

O build dos testes estava quebrado: `Register.jsx` passou a importar `useLocation` do `react-router-dom` (para pré-preencher e-mail ao voltar de `/confirmar-email` ou do fluxo "conta existente"), mas o stub de router do teste (`Register.test.js`) só exportava `Link`/`Navigate`/`useNavigate`. Adicionei `useLocation` ao stub e `location: { state: null }` ao `globalThis.__reg`, sem mudar nenhum teste existente.

## 3. Verificação local executada agora

| Verificação | Resultado |
| --- | --- |
| `node --test --test-concurrency=1 "src/**/*.test.js"` (suíte completa) | **2784/2784**, 0 falhas |
| `src/pages/Register.test.js` isolado | 21/21, incluindo os 2 testes novos de e-mail primeiro |
| `src/services/authRecoveryFlow.test.js` + `authCaptchaFlow.test.js` | 40/40 |
| `src/hooks/recoveryTokenBoot.test.js` | 2/2 |
| `npm run lint` | 0 erros, 16 avisos preexistentes (não relacionados) |
| `npm run build` | passou (aviso preexistente de chunk `primer` grande, não relacionado) |
| `npm run budget` | passou |
| `git diff --check` | sem erros de espaço em branco |

Estes são testes de componente/unidade com Auth, SDK e banco **mockados**. Não comprovam isolamento de RLS/RPC com JWT real — ver seção 5.

## 4. Achado de segurança operacional — contido, não corrigir sozinho

Esta sessão encontrou um ambiente de teste descartável (containers Docker manuais: `hdb`, `hauth`, `hauth_confirm`, `hauth_full`, `hauth_hook`, `hauth_role`, `hauth_foundation`, `hauth_magic`, `hrest`, `hstorage`, `hkong`, `hfn` — não o script versionado `scripts/homolog/local-stack.sh`) montado por uma sessão anterior para mapear claims reais do GoTrue e testar o hook. Todos os containers já haviam saído (`Exited 255`) quando a investigação começou.

Ao reiniciar `hdb` só para inspecionar o estado (migrations aplicadas, evidência de claims), os logs mostraram **`pg_cron` disparando, a cada ciclo, chamadas HTTP reais para Edge Functions do projeto Supabase hospedado em produção** (`process-deletion-jobs`, `send-cash-purchase-reminder-emails`, `settle_vote_rewards`, `refresh_public_catalog_snapshot`) usando a chave anônima pública do projeto. Ou seja, o container de teste parece ser um snapshot do esquema/configuração de produção, incluindo os jobs agendados — e ao ficar de pé, ele continua "batendo" na produção real, não é isolado.

Parei o container (`docker stop hdb`) imediatamente após notar isso, dentro de poucos segundos. Não tenho evidência de que isso tenha causado dano (os jobs chamam endpoints que já rodam destes mesmos horários em produção de qualquer forma, e a chave usada é a anônima pública, nunca `service_role`), mas é um risco real de qualquer harness futuro assim ficar de pé sem supervisão. **Recomendação antes de reconstruir esse ambiente:** neutralizar `pg_cron`/`net.http_post` (desabilitar a extensão ou redirecionar a URL base para um sink local) antes de deixar o container rodando por qualquer tempo, e preferir reconstruir o harness como script versionado em `scripts/homolog/`, não como comandos `docker run` manuais e não registrados.

A evidência de claims que essa sessão anterior havia capturado (`private.auth_hook_probe`, `/tmp/auth-local-mails.jsonl` com `amr` reais de `signUp`/`signInWithOtp`) não foi escrita em nenhum lugar de `docs/`, e o container que a continha está parado; não tentei reaproveitá-la para não religar os containers sem neutralizar o cron primeiro.

### 4.1 Achado maior: o risco é estrutural, não só deste container

Investigando os logs completos do `hdb` (`docker logs hdb`), confirmei **148 chamadas HTTP reais** para a produção hospedada (`ywrjojrjgozdfpddkkuy.supabase.co`) entre 16:36 e 17:25 UTC de 18/11/2026, a cada minuto, para três Edge Functions: `process-deletion-jobs` (50x), `process-push-outbox` (49x), `send-cash-purchase-reminder-emails` (49x). Isso aconteceu todo durante a sessão anterior (antes desta auditoria); meu próprio restart do container (só para inspecionar) durou segundos e não cruzou um novo ciclo de minuto — confirmado pela ausência de qualquer linha de log após 17:26 nos logs do container.

Rastreei a causa: **a URL de produção está hardcoded em quatro migrations já commitadas do próprio repositório** (`20260930000002_deletion_worker.sql`, `20261012000001_web_push_notifications.sql`, `20261012000003_push_worker_cron_secret.sql`, `20261105000004_cash_purchase_reminder_emails.sql`), via `cron.schedule(...)` chamando `net.http_post(url := 'https://ywrjojrjgozdfpddkkuy.supabase.co/functions/v1/...')`. O script padrão do projeto `scripts/homolog/local-stack.sh` já habilita `pg_cron` (linha 43) e aplica todas as migrations -- ou seja, **qualquer execução local/homolog desse script, não só o harness improvisado desta tarefa, agenda esses mesmos jobs contra produção** sempre que o container `hdb` tiver rota de saída para a internet (não há isolamento de rede no script).

Avaliação de impacto por função:
- `process-push-outbox` e `send-cash-purchase-reminder-emails` exigem um header de segredo (`X-Push-Worker-Secret`/`X-Cash-Reminder-Worker-Secret`) lido de `vault.decrypted_secrets`; uma instância local não tem a chave de decriptação do vault do projeto hospedado, então esse valor sai vazio/incorreto e a função real deve rejeitar a chamada (401/403) sem agir. Risco residual: nenhuma ação confirmada, mas as 98 tentativas ficam registradas nos logs de produção dessas funções.
- `process-deletion-jobs` **não tem segredo por requisição** -- qualquer chamada que passe o gate de JWT válido do gateway (a anon key pública já basta) executa com a `SUPABASE_SERVICE_ROLE_KEY` real do lado do servidor. As 50 chamadas desse período **provavelmente foram processadas de verdade em produção**, de forma redundante ao agendamento normal da própria produção. Isso não é, por si, uma ação destrutiva nova (é a mesma fila de exclusões pendentes sendo processada com frequência extra, presumindo que `processDeletionJobs` trata concorrência corretamente), mas é contato não autorizado com produção e deve ser confirmado pelo mantenedor nos logs reais do projeto hospedado para esse intervalo (16:36–17:25 UTC, 18/11/2026).

Esse achado é anterior a esta tarefa (a prática já existe nessas migrations desde que foram escritas) e não foi introduzido por esta sessão, mas a correção faz parte do trabalho pedido ("ambiente de homologação completamente isolado de produção", "bloquear conexões de saída"); ver seção 7 para a correção aplicada em `scripts/homolog/local-stack.sh`.

## 5. Gate do P1 — satisfeito, com evidência real e reproduzível

> "Testes de integração demonstram isolamento backend mesmo em chamadas diretas, com JWT válido de sessão restrita. Testes apenas mockados não aprovam esta fase."

Reconstruí o ambiente do zero, desta vez isolado de produção e versionado (nada em `/tmp`):

- `scripts/homolog/local-stack.sh` passou a montar uma rede Docker `--internal` (sem rota para a internet) e, depois de aplicar as migrations, roda `select cron.unschedule(jobid) from cron.job;` -- duas camadas independentes contra o risco da seção 4.1. Também corrigi uma race preexistente (sleep fixo trocado por polling de `auth.users`/`storage.buckets`) que causava falha intermitente de `up`.
- `scripts/homolog/auth-hook-stack.sh` (novo): sobe um GoTrue extra (`hauth_hook`) na mesma rede isolada, com o Custom Access Token Hook (`private.auth_scope_access_token`) ligado -- nunca fora desse isolamento.
- `scripts/homolog/verify-auth-session-isolation.mjs` (novo): suíte de integração real (GoTrue + PostgREST + Postgres reais, sem mocks), rodada **duas vezes do zero** com resultado idêntico: **39/39 PASS**. Cobre:
  1. Sanidade do isolamento (cron vazio; egress externo falha).
  2. Sessão `auth_signup` real: nega `is_full_login_session()`, leitura de `wallets` e `complete_user_onboarding` antes da prova de senha; após reproduzir exatamente a sequência do `signup-password-sync`, o onboarding conclui e o login explícito seguinte já chega como `authenticated`.
  3. Sessão `auth_recovery` real (usuário existente): nega as mesmas três superfícies.
  4. Refresh de uma sessão restrita preserva o role (nunca promove).
  5. `signOut(scope=others)` revoga de verdade: a outra sessão perde `is_full_login_session()`, `is_session_active()` e o próprio GoTrue nega o refresh dela.
  6. Usuário legado (username + e-mail confirmado antes desta mudança): login normal continua chegando como `authenticated` com `is_full_login_session()=true` -- sem regressão.
  7. Storage: ver achado abaixo.
  8. Pré-cadastro por terceiro (gate do P2, seção 6): atacante cria a conta com a senha dele primeiro (sem sessão, sem autoconfirm); a vítima, dona real do e-mail, verifica o código dela e recebe uma sessão `auth_signup` igualmente restrita; ao definir a senha definitiva, a senha do atacante é sobrescrita; depois do onboarding, a senha do atacante **não autentica mais** e só a da vítima funciona.

Reproduzido por mim de forma independente (não só pela sessão que construiu o harness), incluindo dois teardowns completos e dois `up` limpos do zero -- o segundo depois de adicionar o teste de pré-cadastro por terceiro -- antes da contagem final de **46/46**.

### 5.1 Bug real encontrado e corrigido: leitura de Storage não respeitava sessão restrita

A suíte expôs que `profile_avatars_read` e `community_covers_read` (`storage.objects`) usavam só `auth.uid() is not null` -- verdadeiro também para uma sessão `auth_signup`/`auth_recovery`, que logo têm um `sub` no JWT. Uma sessão de cadastro ou recuperação, nunca provada por senha nem com onboarding concluído, conseguia ler qualquer avatar ou capa de comunidade. As políticas de insert/update dos mesmos buckets já haviam sido fechadas por `has_app_access()` em `20261105000001_close_has_app_access_gates.sql`; só a leitura ficou para trás.

Corrigido em **`supabase/migrations/20261223000005_storage_restricted_session_read_gate.sql`** (migration nova e aditiva, nenhuma migration antiga foi editada): as duas policies passam a exigir `public.has_app_access()`, mesmo padrão já usado em todo o resto do repositório. A suíte comprova as duas direções: a sessão restrita deixa de ver um objeto real inserido no bucket; um usuário com onboarding e aceite legal completos, autenticado por senha, continua vendo normalmente.

Buckets que já gate em `is_superadmin()` (`exercise-visual-drafts`, `exercise-visual-references`, `moderation-evidence`) e o que gate em `is_community_member()` (`status-photos`, que já exige `has_app_access()` internamente) já estavam corretos antes desta sessão -- não precisaram de mudança.

### 5.2 O que não pôde ser exercitado, e por quê

Edge Functions reais (`exercise-catalog-proxy`, `infinitepay-create-checkout` etc.) não puderam ser chamadas de ponta a ponta: o runtime Deno local (`hfn`) resolve `jsr:@supabase/supabase-js` por uma busca de rede real a `jsr.io` a cada boot de worker, que o isolamento `--internal` bloqueia corretamente (uma falha de boot do worker, não uma negação de autorização -- confirmado via `docker logs hfn` antes de descartar essa asserção). A cobertura equivalente é a RPC `is_full_login_session()`, testada diretamente acima: é exatamente o gate de uma linha que cada uma dessas funções chama antes de qualquer lógica própria, já corrigido nessas quatro funções conforme a seção 1 deste documento. Rodar essas funções de ponta a ponta localmente exigiria vendorizar a dependência ou usar um import map local -- não fiz essa mudança sem necessidade clara, por não ser a forma como elas são servidas em produção (lá a resolução de `jsr:` acontece no ambiente hospedado, não sob este isolamento de rede).

### 5.3 Containers órfãos de uma sessão anterior

`docker ps -a` ainda lista seis containers já parados de uma sessão anterior a esta tarefa, com nomes diferentes dos usados pelos scripts agora versionados (`hauth_magic`, `hauth_foundation`, `hauth_role`, `hauth_full`, `hauth_confirm_templated`, `hauth_confirm`). Não os toquei -- ficam para o mantenedor decidir (`docker rm`), já que não são mais necessários (o harness novo e versionado os substitui). Um sétimo nome antigo, `hauth_hook`, foi reaproveitado (removido e recriado) pelo novo `auth-hook-stack.sh` neste processo normal de `up`, da mesma forma que `local-stack.sh` sempre faz com seus próprios nomes -- o container antigo com esse nome já estava parado e ligado a um banco (`hdb`) que já havia sido destruído e recriado várias vezes desde então, sem valor recuperável.

## 5.4 Achado fora do escopo da autenticação, resolvido à parte

Investigando o domínio hardcoded da seção 4.1, descobri que o projeto antigo (`ywrjojrjgozdfpddkkuy`) não é mais produção: a Política de Privacidade 2.0.0 (`docs/juridico/DOSSIE_DECISAO_LEGAL_2_0.md`) documenta a migração EUA → Brasil de 06/11/2026 (PR #127) para o projeto atual, `aofjhkkfrtrluuulacjv`. O domínio antigo não resolve mais (confirmado por DNS). Isso muda a leitura do achado da seção 4.1: as 148 chamadas não atingiram produção viva, nenhum dano real nelas.

Com autorização explícita do usuário, consultei (somente leitura, `supabase db query --linked`) o `cron.job` real do projeto atual. Os 3 jobs já usam a URL correta -- alguém já corrigiu isso direto no banco, fora de qualquer migration commitada, criando uma divergência entre o histórico de migrations e o estado real. Corrigido em **`supabase/migrations/20261223000006_realign_stale_cron_urls.sql`**, só para `process-deletion-jobs` e `process-push-outbox` (ambos `active=true` em produção; a correção apenas reflete o que já está ao vivo). Deliberadamente **não** toquei em `send-cash-purchase-reminder-emails`: está `active=false` em produção, e `cron.schedule()` reativaria o job ao recriá-lo -- não sei se essa pausa é intencional, então não assumi. Nenhuma mudança foi feita em produção; o estado real já estava correto para os dois jobs tratados.

## 5.5 P6 — verificação visual (mobile, dark mode) das páginas tocadas

Rodei `npm run dev` e inspecionei `/cadastro`, `/confirmar-email`, `/login`, `/redefinir-senha` via Chrome DevTools (MCP), em 360px e 390px, claro e escuro, sem precisar de login (páginas públicas). Não submeti nenhum formulário real (o dev aponta para o projeto hospedado de verdade; evitei criar contas de teste reais fora do harness isolado).

- Sem scroll horizontal nem elemento cortado em nenhuma das quatro páginas, nos dois larguras.
- `auth-switch` (rodapé do `AuthLayout`) nunca renderiza vazio -- confirma visualmente a correção do P0/`PublicLayout.jsx:140`.
- Tema escuro: contraste e legibilidade OK em todas as quatro páginas; nenhum texto invisível.
- `/confirmar-email`: título "Confirme seu e-mail", código único de 6 dígitos (`inputMode="numeric"`, `autoComplete="one-time-code"`, sem `type="number"`), aviso de spam, CAPTCHA com o aviso esperado de "localhost detected" (comportamento normal de dev, não é bug).
- `/login`: um CTA primário, "Esqueci minha senha" como link secundário discreto -- mínimo de passos.
- `/redefinir-senha` sem token: mensagem neutra em pt-BR ("Link inválido ou expirado"), sem código SQL/HTTP exposto -- confirma visualmente que `useRecoveryTokenExchange`/`recovery-token-boot.js` tratam a ausência de token sem erro técnico vazando para a UI.
- Único erro de console em todas as páginas: 404 dos endpoints de telemetria da Vercel (`/_vercel/insights/view`, `/_vercel/speed-insights/vitals`), esperado em dev (não existem localmente) e não relacionado a esta tarefa.

Não avancei pelos passos 2/3 do cadastro nem completei um envio real (exigiria `signUp`/hCaptcha reais contra produção); essa parte já está coberta estruturalmente pela suíte de componente (`Register.test.js`, 21/21).

## 5.6 P7 — observabilidade (eventos estruturados e sanitizados)

`src/utils/authAnalytics.js` (novo): `trackAuthEvent(name, properties)` com a lista fixa de nomes da seção 11 do prompt (`signup_requested`, `verification_required`, `otp_verified`, `onboarding_completed`, `recovery_requested`, `password_changed`, `session_revocation_pending`, `auth_access_denied`, `captcha_failed`, `auth_rate_limited`) -- lança se alguém passar um nome fora da lista, para a lista continuar sendo a fonte única de verdade. `reportAuthOutcome(err)` observa só `err.code` (nunca mensagem, nunca e-mail/senha/token) e decide entre `auth_rate_limited` (`over_request_rate_limit`, `over_email_send_rate_limit`) e `auth_access_denied` (códigos estruturais do P1: `SESSION_REVOKED`, `PASSWORD_PROOF_REQUIRED`, `SESSION_REVOCATION_REQUIRED`, `ONBOARDING_SESSION_REQUIRED`, `AUTH_SCOPE_UNAVAILABLE`, `SIGNUP_UNEXPECTED_SESSION`, `PASSWORD_SYNC_FAILED`, e `42501` do Postgres por trás de qualquer RPC).

Usa a infraestrutura já existente (`@vercel/analytics`, mesmo mecanismo do único evento anterior, `track('Signup complete')` em `Register.jsx` -- preservado, não removido). Instrumentado em `Register.jsx`, `ConfirmEmail.jsx`, `Login.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx` e `AuthCaptcha.jsx` (este último também ganhou a observação do timeout de carregamento de 15s, que antes mudava de estado sem passar por `invalidate()` e por isso nunca teria dado o evento). Nenhuma mudança de comportamento do usuário -- só observação.

Testes: `authCaptchaFlow.test.js` ganhou o caso de exclusão de `verifyOtp`/`updateUser` (seção 5.0 acima). `AuthCaptcha.test.js` ganhou asserções explícitas de que `captcha_failed` dispara exatamente nos dois caminhos de erro (`onError` e timeout de carregamento) e não nos de expiração/reset. `ConfirmEmail.test.js` estuba o módulo inteiro (sem rede real de analytics em teste).

## 6. Nada remoto, nada commitado

Nenhuma migration foi aplicada em banco hospedado nesta sessão -- só na stack local isolada e descartável, destruída ao final. `supabase/config.toml` continua sem diff. Nenhum commit, push ou PR foi criado. O código acima está todo em árvore de trabalho, misturado com mudanças anteriores de publicidade na mesma branch (conforme já registrado no relatório do P0). `npm run lint`, `npm run build` e `node scripts/check-migration-integrity.mjs` (281 migrations, sem conflito) seguem limpos após a nova migration.
