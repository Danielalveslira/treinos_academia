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

Gerar o par de chaves (uma vez; a privada só vai para os secrets da função):

```bash
npx web-push generate-vapid-keys --json
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...
```

`VITE_VAPID_PUBLIC_KEY` precisa ser igual a `VAPID_PUBLIC_KEY`. Se a chave for trocada, o app
recria a subscription do navegador na próxima ativação (a antiga seria recusada pelo provedor).
Sem os quatro valores a função responde 503 e **não consome a fila**: os jobs ficam pendentes.

## Segurança do worker

- Só endpoints dos serviços de push dos navegadores são aceitos (FCM, Mozilla, Apple, WNS), na
  migration (`private.is_push_endpoint_allowed`) e no worker. Isso evita SSRF: o worker faz POST
  no endpoint que o usuário registrou. Se surgir um provedor novo, ampliar os dois lugares.
- `targetUrl` aceita apenas caminho interno; `//` e `\` são rejeitados (o navegador trata
  `/\host` como `//host`) no banco, no worker, no Service Worker e na Central.
- Como o agendamento do `process-deletion-jobs`, o cron autentica com a anon key (pública).
  Qualquer pessoa com ela pode disparar o worker, mas só consegue antecipar o processamento da
  fila; o claim usa `FOR UPDATE SKIP LOCKED` e nenhum dado é retornado além de contadores.
- Cada conta mantém no máximo 20 dispositivos ativos (os menos recentes são revogados).
- Trocar de conta no mesmo navegador reassocia o endpoint à conta atual e cancela as entregas
  pendentes da conta anterior.

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
