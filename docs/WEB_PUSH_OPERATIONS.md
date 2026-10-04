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
PUSH_WORKER_SECRET   (>= 32 caracteres aleatórios; exigido no header X-Push-Worker-Secret)
```

O mesmo valor de `PUSH_WORKER_SECRET` precisa existir no Supabase Vault com o nome
`push_worker_secret` (o cron lê de lá a cada execução; a migration não contém o valor):

```sql
select vault.create_secret('<mesmo valor>', 'push_worker_secret');
-- rotação: select vault.update_secret(id, '<novo valor>') e atualizar o secret da função
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
- O worker só processa a fila com o header `X-Push-Worker-Secret` correto. Sem ele (ou com
  valor errado) responde 401 **antes** de qualquer consulta ou claim; sem `PUSH_WORKER_SECRET`
  utilizável na função responde 503. A anon key do gateway (pública) não autoriza nada.
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

## Runbook de publicação (nesta ordem)

Requer `SUPABASE_ACCESS_TOKEN` (ou `supabase login`) e acesso ao projeto `ywrjojrjgozdfpddkkuy`.

```bash
# 1. migrations (conferir antes: 20261012000000..03)
npx supabase db push --linked --dry-run && npx supabase db push --linked

# 2. secrets (a chave privada não é impressa nem salva em arquivo)
KEYS=$(npx web-push generate-vapid-keys --json)
VAPID_PUBLIC_KEY=$(printf '%s' "$KEYS" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).publicKey')
VAPID_PRIVATE_KEY=$(printf '%s' "$KEYS" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).privateKey')
PUSH_WORKER_SECRET=$(openssl rand -hex 32)
npx supabase secrets set VAPID_PUBLIC_KEY="$VAPID_PUBLIC_KEY" VAPID_PRIVATE_KEY="$VAPID_PRIVATE_KEY" \
  VAPID_SUBJECT="mailto:<contato>" PUSH_WORKER_SECRET="$PUSH_WORKER_SECRET"
echo "VITE_VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY"   # valor público, vai para o Vercel (Production)
# Vault (SQL editor do projeto), com o MESMO valor de PUSH_WORKER_SECRET:
#   select vault.create_secret('<PUSH_WORKER_SECRET>', 'push_worker_secret');

# 3. função
npx supabase functions deploy process-push-outbox

# 4. cron protegido já vem da migration 20261012000000..03; conferir o worker:
curl -si -X POST https://ywrjojrjgozdfpddkkuy.supabase.co/functions/v1/process-push-outbox \
  -H "Authorization: Bearer <anon key>"                       # esperado: 401
curl -si -X POST https://ywrjojrjgozdfpddkkuy.supabase.co/functions/v1/process-push-outbox \
  -H "Authorization: Bearer <anon key>" -H "X-Push-Worker-Secret: $PUSH_WORKER_SECRET"   # 200

# 5. definir VITE_VAPID_PUBLIC_KEY no Vercel (Production) ANTES de publicar; 6. merge/push e
#    aguardar o deploy READY.
```

Depois do smoke com 1 conta de teste, usar `select * from notification_push_outbox order by
created_at desc limit 20` (service role) para acompanhar `status`, `attempt_count` e `last_error`.

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
