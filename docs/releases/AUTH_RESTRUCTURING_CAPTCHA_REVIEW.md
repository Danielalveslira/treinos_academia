# Auditoria de CAPTCHA — correção obrigatória adicional (18/11/2026)

Disparado por um achado do usuário: na tela de confirmação de e-mail, é possível clicar em "Confirmar" sem concluir o hCaptcha. Esta auditoria cobre toda a infraestrutura de CAPTCHA nos seis fluxos pedidos.

## Causa raiz

Lida diretamente no SDK instalado (`node_modules/@supabase/auth-js/dist/module/lib/types.d.ts`), não por suposição:

| Operação | Método do SDK | `captchaToken` |
| --- | --- | --- |
| Cadastro | `signUp` | suportado |
| Cadastro e-mail primeiro | `signInWithOtp` | suportado |
| Login | `signInWithPassword` | suportado |
| Reenvio de código | `resend` | suportado |
| Recuperação de senha (solicitação) | `resetPasswordForEmail` | suportado |
| **Confirmação de e-mail (consumir o código)** | `verifyOtp` | **existe no tipo, mas marcado `@deprecated`** |
| Redefinição de senha (trocar a senha) | `updateUser` | **nunca existiu** (ação de sessão já autenticada, não endpoint público) |

Ou seja: o código já estava correto -- `registerUser`, `loginUser`, `resetPassword`, `sendVerificationEmail`, `requestEmailFirstSignup` (`src/services/authService.js`) já chamam `takeCaptchaToken()` (fail-closed: lança `CAPTCHA_REQUIRED` se o token estiver ausente/expirado/já consumido) antes de qualquer chamada ao Supabase, e os botões de `Register.jsx`, `Login.jsx`, `ForgotPassword.jsx` já tinham `!captchaVerified` no `disabled`. `confirmSignupOtp`/`confirmEmailFirstOtp` e `updatePassword` corretamente nunca chamam `takeCaptchaToken`.

**O "bug" relatado é real como experiência, mas não é uma falha de autorização**: o widget de CAPTCHA em `ConfirmEmail.jsx` e no passo de confirmação de `Register.jsx` ficava visualmente entre o botão "Confirmar" (que o SDK não protege, por desenho) e "Reenviar código" (que ele protege de verdade), sem nada indicando a qual botão ele pertence -- dando a impressão de que também protegia a confirmação.

A defesa real de `verifyOtp` é o rate limit nativo do GoTrue, já configurado e confirmado (via `supabase config diff`, nesta sessão) como **idêntico entre local e produção**: `auth.rate_limit.token_verifications = 30` -- 30 tentativas de verificação por IP a cada 5 minutos.

## Correção aplicada

- `src/pages/ConfirmEmail.jsx` e `src/pages/Register.jsx` (passo de confirmação): adicionado texto "Verificação de segurança necessária para reenviar o código:" imediatamente antes do widget, e um comentário no código explicando por que `verifyOtp` nunca é gateado por CAPTCHA. Nenhuma lógica de habilitação/desabilitação foi alterada (já estava correta).
- `src/services/authCaptchaFlow.test.js`: novo teste `'verifyOtp e updateUser nunca enviam nem exigem CAPTCHA, mesmo com CAPTCHA exigido globalmente'` -- prova a exclusão como decisão de desenho, não como lacuna de configuração.
- `src/pages/ConfirmEmail.test.js` (**novo arquivo** -- a página não tinha nenhum teste antes): 5 casos cobrindo exatamente o achado -- Confirmar nunca bloqueado pelo CAPTCHA; Reenviar bloqueado até a verificação; Reenviar sem e-mail continua bloqueado mesmo verificado; confirmação avança para a etapa de senha; reenvio chama o serviço com o token certo e reseta o widget depois.

## Cobertura já existente, confirmada nesta auditoria (não precisou de mudança)

- `authCaptchaFlow.test.js` já provava: token enviado nas 5 operações reais; token ausente bloqueia todas as 5 antes de chamar o Supabase; rejeição do servidor propaga; produção sem site key falha fechada; política de exigência correta em dev-hospedado/preview/produção.
- `AuthCaptcha.test.js` já provava: token consumido uma única vez (`takeToken()` zera a referência); expiração e erro do widget permitem nova tentativa.
- `Login.jsx`, `ForgotPassword.jsx`, `Register.jsx` (cadastro) já tinham os botões corretamente gateados por `captchaVerified`.

## Prova real (GoTrue de verdade, não mockado): API direta não contorna a proteção

`scripts/homolog/verify-captcha-server-enforcement.mjs` (novo, versionado). Diferente de `local-stack.sh`/`auth-hook-stack.sh`, esta stack **não** é isolada de rede -- ela precisa alcançar `https://hcaptcha.com/siteverify` de verdade. Por isso roda num par Postgres+GoTrue totalmente separado (`cdb`/`cauth`, rede padrão do Docker), usando só as chaves de teste **públicas e oficiais** da hCaptcha (sitekey/secret "all zeros", documentadas para automação -- nunca uma conta real), e nunca aponta para o projeto hospedado. Sobe, testa e derruba tudo sozinho, mesmo em caso de falha (`try/finally`).

Rodei de forma independente (não só a sessão que construiu); **14/14 PASS**, reprodutível:

0. Sanidade do secret de teste: uma resposta arbitrária é rejeitada (`success:false`) mesmo com o secret de teste -- confirma que ele não é um passe-livre incondicional, só reconhece os tokens "dummy" documentados.
1. **Reject-path (7 chamadas HTTP diretas ao GoTrue, sem frontend nenhum)**: `/signup` sem CAPTCHA, com CAPTCHA vazio, com CAPTCHA inválido; `/token?grant_type=password`, `/otp`, `/resend`, `/recover` sem CAPTCHA -- todas as 7 recusadas pelo próprio GoTrue com `400 captcha_failed`, antes de qualquer lógica de negócio. Isso é a prova direta de que nenhuma chamada de API contorna a proteção pulando o frontend.
2. **Accept-path**: os mesmos endpoints, com o token de teste válido, superam o gate de CAPTCHA (a falha seguinte é só `unexpected_failure`/SMTP não configurado neste ambiente descartável -- prova que o CAPTCHA foi aceito, não que o fluxo inteiro "funciona" sem e-mail).
3. **`/verify` nunca exige CAPTCHA**: confirmado empiricamente (não só pelo tipo do SDK) -- um código OTP real obtido via `generate_link`, verificado **sem nenhum campo de CAPTCHA**, numa instância com CAPTCHA globalmente ligado, emite sessão normalmente (`200`).
4. **Limite documentado, não maquiado como sucesso**: o token "dummy" de teste da hCaptcha é intencionalmente reutilizável (para permitir automação repetida), então repeti-lo contra o GoTrue não prova rejeição de replay de um token real -- um token de desafio genuíno é invalidado pela própria hCaptcha após a primeira verificação (comportamento documentado do provedor), mas reproduzir isso exigiria um navegador completando um desafio de verdade, o que não foi tentado. Reportado como nota informativa, não como `PASS`.

Variáveis de ambiente reais do GoTrue confirmadas por teste direto (podem ser úteis para configurar isso de verdade depois, com aprovação): `GOTRUE_SECURITY_CAPTCHA_ENABLED`, `GOTRUE_SECURITY_CAPTCHA_PROVIDER`, `GOTRUE_SECURITY_CAPTCHA_SECRET`.

Nenhum container ou rede ficou para trás (`docker ps -a`/`docker network ls` confirmados limpos, inclusive depois da minha própria reexecução independente).

## Conclusão

A infraestrutura de CAPTCHA já estava correta em todos os seis fluxos pedidos (cadastro, login, confirmação de e-mail, reenvio, recuperação, redefinição) -- cadastro/login/reenvio/recuperação já eram gateados fail-closed, com prova agora real de que o GoTrue aplica isso no servidor, não só no cliente; confirmação e redefinição de senha nunca precisaram de CAPTCHA, por desenho do próprio Supabase Auth, agora com evidência direta em vez de inferência. A única correção necessária foi de clareza visual (o widget parecia proteger "Confirmar", mas nunca protegeu -- protege só "Reenviar código" ao lado dele), já aplicada e testada.
