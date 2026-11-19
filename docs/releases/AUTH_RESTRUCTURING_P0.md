# Autenticação Evolutus — entrega local P0 (18/11/2026)

## Causa e correção

`registerUser` classificava `signUp` sem erro e sem sessão como `ambiguous`; `Register.handleCreate` mostrava um desfecho de falha antes da confirmação. Com confirmação obrigatória de e-mail, ausência de sessão é esperada. A resposta também pode ser ofuscada para uma conta existente: sucesso da API não comprova criação ou entrega do e-mail.

Agora o pedido sem sessão abre diretamente **Confirme seu e-mail**, com linguagem neutra e código como ação principal. Duplicidade explícita recebe a mesma experiência pública. Erro de transporte é `request_uncertain`: permite informar um código recebido sem repetir `signUp` automaticamente. Erro definitivo continua no formulário. Sessão inesperada no `signUp` é encerrada localmente e não cria perfil; falha ao encerrar bloqueia a continuação. O UID de resposta sem sessão nunca é usado para gravar perfil. A sincronização de senha após OTP foi preservada.

O contêiner de rodapé vazio deixou de ser renderizado.

## Evidência local

| Verificação | Resultado |
| --- | --- |
| Antes: `Register.test.js` | 19/19, incluindo expectativa antiga da tela de falha |
| Depois: `Register.test.js` + `authRecoveryFlow.test.js` | 48/48 |
| Suítes de rota, CAPTCHA, recovery, sessão, cold start e perfil | 92/92 |
| `npm run lint` | 0 erros; 16 avisos preexistentes em outros arquivos |
| `npm run build` | passou |
| `npm run budget` | passou; boot JS gzip 342447 bytes, CSS 71052 bytes, 7 arquivos |
| `git diff --check` | passou |

O build inclui alterações locais não relacionadas de publicidade; os números de bundle não isolam o impacto deste hotfix. Uma resposta sem sessão passou de uma tela intermediária de falha para a tela OTP, eliminando uma etapa de interface; não há medição de latência ou custo de rede. Nenhum teste com entrega SMTP ou navegador real foi executado nesta entrega.

## Gate de segurança para P1–P7

A última definição localizada de `public.has_app_access()` é `20261114000001_financial_auth_integration.sql`: valida sessão ativa, conta, e-mail, termos e restrições, mas não finalidade comprovada de sessão. Assim, um JWT de recuperação/cadastro não está demonstrado como isolado no backend. Este é um risco potencial alto, ainda sem teste adversarial direto; não está classificado como exploração confirmada.

`node_modules/.bin/supabase status` falhou porque o contêiner local `supabase_db_treinos_academia` não existe. O script alternativo `scripts/homolog/local-stack.sh up` usa `GOTRUE_MAILER_AUTOCONFIRM=true` e aplica todas as migrations atuais, inclusive migrations não concluídas de publicidade na árvore de trabalho. Ele não reproduziria o fluxo OTP de confirmação obrigatória nesta configuração. Não houve alteração em banco, Auth hospedado, SMTP, Vercel, secrets, PR ou produção.

Antes de P1: subir stack descartável com confirmação de e-mail e caixa de teste, mapear claims e emissão/refresh/revogação dos tokens reais; executar chamadas diretas a PostgREST, RPC, Storage, Realtime e Edge com sessão transitória; definir gate de sessão confiável no servidor, compatibilidade com sessões legadas e ADR. Só depois avaliar `signInWithOtp` para e-mail primeiro, RPC transacional de onboarding e MFA administrativa. Sem essa prova, manter `signUp` convencional corrigido.

## Homologação e implantação pendentes

1. Em ambiente de teste separado, confirmar que `Confirm email` continua ligado, templates usam OTP `signup`, hCaptcha é exigido no servidor e URLs de redirect são permitidas estritamente.
2. Testar e-mail novo, pendente, existente confirmado e resposta perdida com caixa de teste. Conferir Auth Logs e logs SMTP sem expor e-mail ou token; distinguir pedido aceito de entrega comprovada.
3. Confirmar OTP válido, expirado e reenvio; verificar que confirmação não abre o app antes da sincronização de senha e conclusão de perfil. Reproduzir pré-cadastro por terceiro no GoTrue real.
4. Executar testes diretos de RLS/RPC e smoke mobile antes de qualquer publicação. Rollback do hotfix é reverter somente o frontend/serviço de P0; nenhuma migration foi criada.

O trabalho está na branch existente `feat/advertiser-portal-ux`, com mudanças anteriores de publicidade preservadas. Uma branch/PR isolada requer separar essa árvore de trabalho antes da publicação.
