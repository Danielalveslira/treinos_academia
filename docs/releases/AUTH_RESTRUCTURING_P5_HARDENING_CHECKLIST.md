# Autenticação Evolutus — checklist P5 (hardening e configurações do Supabase Auth)

Checklist da seção 9 do prompt, com valores **reais confirmados** no projeto hospedado (`aofjhkkfrtrluuulacjv`, São Paulo), via `supabase config diff` e uma consulta somente leitura (`select ... from auth.mfa_factors`), ambas autorizadas explicitamente pelo usuário nesta sessão (18/11/2026). Nenhuma mudança foi feita no projeto hospedado. Em 19/11, a política declarada no `supabase/config.toml` e na UI foi preparada localmente para o rollout; os valores remotos abaixo continuam sendo os medidos antes dessa mudança.

| Controle | Declarado localmente (`config.toml`) | Real no projeto hospedado | Proposta do prompt | Status |
| --- | --- | --- | --- | --- |
| Confirmação de e-mail | `enabled = true` | igual (sem diff) | Manter obrigatória | **OK, já atende** |
| Senha mínima | `minimum_password_length = 15` (preparado localmente) | `8` | 15, considerando login de fator único | **Aguardando ajuste remoto no rollout** |
| Composição de senha | `password_requirements = ""` (preparado localmente) | `letters_digits` | Remover obrigatoriedade de classes | **Aguardando ajuste remoto no rollout** |
| OTP (dígitos) | `otp_length = 6` | igual (sem diff) | Manter | **OK** |
| Expiração do OTP | `otp_expiry = 900` (15 min, alinhado localmente) | **`900` (15 min)** | Avaliar 600s | **Alinhado**; redução adicional exige teste de e-mails e links emitidos |
| Reenvio (cooldown) | `max_frequency = "1m"` (alinhado localmente) | **`1m0s` (60s)** | Avaliar 60s efetivos no servidor | **Alinhado** |
| Alteração segura de senha | `secure_password_change = false` | igual (sem diff) | Avaliar habilitação e reautenticação | **Pendente**, requer desenho de reautenticação (seção 8) antes de ativar |
| CAPTCHA | não declarado localmente | **`enabled=true`, `provider=hcaptcha`** | Manter hCaptcha real verificado no servidor | **OK, já atende** |
| Refresh rotation | `enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10` | igual (sem diff) | Manter | **OK** |
| JWT (expiração) | `jwt_expiry = 3600` | igual (sem diff) | Preservar inicialmente | **OK** |
| MFA TOTP | `mfa.totp.enroll_enabled = false`, `verify_enabled = false` | **`enroll_enabled=true`, `verify_enabled=true`** | Ativar progressivamente para superadmins | **Capacidade já ligada; rollout operacional não começou** -- ver 4.1 |
| Senhas comprometidas (HIBP) | não declarado; não suportado pelo schema desta versão do CLI (`supabase config diff` não compara esse campo) | não verificável por esta via | Habilitar proteção nativa se disponível | **Não confirmado** -- checar manualmente em Dashboard > Authentication > Policies |
| SMTP | não declarado localmente | `smtp.enabled=true`, host `smtp.resend.com:465`, remetente "Evolutus", admin `suporte@evolutus.com.br` | Auditar entrega, reputação, quota | **Configurado**; reputação/quota real não verificadas por esta via (exigiria painel do Resend) |
| Redirects permitidos | `additional_redirect_urls = ["https://127.0.0.1:3000"]` (placeholder local) | `http://localhost:5173/**`, `http://127.0.0.1:5173/**`, `https://www.evolutus.com.br/**`, e **um preview específico do Vercel** (`https://treinosacademia-qr3k9uub8-danielalvesliras-projects.vercel.app/**`) | Validar allowlist estrita | **Atenção**: a entrada de preview do Vercel é de um deploy específico já antigo; não é um risco agudo (é uma allowlist, não um bypass), mas é lixo operacional que vale limpar quando não for mais necessária |

## 4.1 MFA/superadmin -- estado real, nenhuma ação tomada

A validação local de senha exige 15 caracteres sem classe obrigatória e rejeita explicitamente acima de 72 bytes UTF-8, limite do GoTrue/bcrypt. Não há truncamento nem normalização. Uma frase de 64 caracteres ASCII passa; Unicode pode alcançar o limite de bytes antes de 64 caracteres. Esse limite do provedor deve ser comunicado no rollout e revisto se o Supabase alterar o algoritmo.

Consulta somente leitura confirmou: **2 contas `superadmin` existem, nenhuma com fator TOTP cadastrado** (`with_totp_factor = 0`, `verified_totp = 0`), mesmo com a capacidade de matrícula já ligada no projeto. Isso corresponde exatamente ao passo 1 do rollout do prompt ("inventário e matrícula dos admins legítimos"), que **ainda não começou operacionalmente**.

`is_superadmin()` já exige `is_full_login_session()` (sessão restrita nunca é superadmin). A migration local `20261223000007_mfa_superadmin_readiness.sql` acrescentou a exigência de `aal2` quando a flag privada `mfa_enforcement_ready` for ligada. A flag nasce desligada; o helper das Edge Functions administrativas agora consulta a mesma RPC. A tela `AdminMfa.jsx` oferece matrícula e desafio, mas a autorização continua no servidor. A prova local com GoTrue real passou 14/14 verificações, incluindo negação de AAL1 e permissão de AAL2 depois de ligar a flag só na base descartável.

**O enforcement remoto não foi ligado.** Fazer isso agora, com os dois únicos superadmins sem fator cadastrado, bloquearia o acesso administrativo imediatamente. Antes da ativação:

1. Os dois superadmins precisam cadastrar TOTP (fluxo já disponível nativamente, já habilitado no projeto).
2. Confirmar um método de contingência operacional (o prompt é explícito: Supabase não garante códigos de recuperação nativos).
3. Testar o enforcement com um segundo admin já matriculado antes de ativar para todos.
4. Só então ligar `mfa_enforcement_ready` no servidor, com aprovação explícita e teste de AAL1/AAL2 nas Edge Functions.

## Controles não verificáveis pela CLI/consulta

- **Senhas comprometidas (HIBP):** não suportado pelo schema de config desta versão da CLI; confirmar manualmente no Dashboard.
- **Capacidade/custo do plano** para MFA, proteção de senha comprometida e limites de taxa: não verificável por este caminho; exige checar o plano contratado no Dashboard de billing.
- **Reputação/quota real de SMTP:** exigiria acesso ao painel do Resend, fora do escopo desta sessão.
