# Web Push — operação

## Variáveis

Frontend (valor público):

```text
VITE_VAPID_PUBLIC_KEY
```

Edge Function `process-push-outbox` (secrets; nunca versionar valores):

```text
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

`VAPID_SUBJECT` deve ser `mailto:...` ou uma URL HTTPS controlada pelo Evolutus.

## Ordem de publicação

1. Aplicar migrations.
2. Configurar secrets VAPID.
3. Publicar `process-push-outbox`.
4. Configurar `VITE_VAPID_PUBLIC_KEY` no build e publicar frontend/SW.
5. Confirmar o cron único `process-push-outbox`.

Não publicar parcialmente o frontend antes de RPCs, tabelas e worker estarem disponíveis.

## Rollback operacional

Desativar ou remover o cron `process-push-outbox`. A Central de Notificações continua funcionando;
nenhuma notificação interna depende do Push. Subscriptions e jobs permanecem preservados para
diagnóstico. O histórico terminal é retido por 90 dias; subscriptions revogadas, por 180 dias.

## Smoke obrigatório

- Android Chrome/PWA: ativação, foreground, background, PWA fechado e deep link.
- iPhone/iPad: instalar na Tela de Início, ativar, fechar, receber e abrir deep link.
- Desktop Chrome/Edge: fechar aba, receber notificação do sistema e abrir pelo clique.
- Troca de conta no mesmo navegador: o endpoint deve ficar apenas com a conta atual.
- Logout: o dispositivo não deve continuar recebendo Push da conta anterior.

Não considerar a feature pronta em produção sem esses testes reais.
