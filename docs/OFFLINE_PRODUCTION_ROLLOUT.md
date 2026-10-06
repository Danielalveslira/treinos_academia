# Publicação do PWA Offline-First

Destino oficial deste release: GitHub `Danielalveslira/treinos_academia`, Supabase produção `ywrjojrjgozdfpddkkuy` e Vercel produção `https://treinosacademia-ten.vercel.app`. Não há Supabase de homologação separado. Publicar o código com as duas flags operacionais em 0%; testar em produção antes de elevar o rollout.

## Artefatos e dependências

| Migration candidata | Objetivo | Dependência | Risco |
| --- | --- | --- | --- |
| `20261016000001_offline_workout_sync.sql` | `workouts.updated_at`, recibos de idempotência, RPC `sync_workout_mutations` | Todas as migrations anteriores, em especial workouts, Auth e `has_app_access()` | Médio: schema/RPC novos; validar RLS e grants antes do frontend |
| `20261016000002_security_hardening_followup.sql` | Revoke de `mark_infinitepay_checkout_uncertain`; `search_path` de `review_blocked_account_deletion` | `20261016000001` na ordem do ledger; funções criadas em migrations anteriores | Baixo: grants e configuração de função; confirmar papel service_role |
| `20261016000003_offline_runtime_control_telemetry.sql` | Flags remotas, telemetria técnica e limpeza após 30 dias | `20261016000002`, Auth e pg_cron | Médio: novas RPCs; validar grants e job |

O ledger remoto confirmou os 108 arquivos anteriores. `npx supabase db push --dry-run` listou somente estas três migrations, que foram aplicadas em `ywrjojrjgozdfpddkkuy` em 2026-10-06. Um segundo dry run retornou banco atualizado, sem migrations pendentes. `scripts/offline-local-supabase-baseline.sql` é fixture local de teste e nunca deve ser aplicada remotamente.

Nenhuma Edge Function mudou para o release; `supabase/functions/process-push-outbox/concurrency.test.js` é somente teste. O frontend é o build Vite `dist` na Vercel. O remote Git aponta para o destino oficial. As exclusões dos 12 documentos no working tree foram confirmadas pelo responsável e podem fazer parte do release.

## Antes da publicação

1. Confirmar conta GitHub, repositório/branch, projeto Supabase de **produção** e projeto Vercel. Registrar responsáveis e janela de rollback. Confirmar backup restaurável ou snapshot do banco e estado do ledger.
2. Rodar `PG_TEST_CONTAINER=<container-local-migrado> PG_TEST_USER=<papel> npm run release:offline-check`. Exige PostgreSQL local com migrations, extensão pgTAP e todos os 32 testes. A fixture local pode ser usada apenas no container sem rede. Instalar o Chromium de teste com `npx playwright-core install chromium --only-shell` e validar `npm run test:offline-browser`.
3. Ledger conferido: 108 arquivos anteriores registrados e somente as três migrations acima pendentes antes do `db push`; dry run posterior sem pendências.
4. Configurar o build com `VITE_OFFLINE_READ_ENABLED=true`, `VITE_OFFLINE_WRITE_ENABLED=true`, `VITE_OFFLINE_COLD_START_ENABLED=true`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` corretos. Percentuais `VITE_*` são obsoletos. As duas linhas de `public.offline_feature_flags` iniciam com `enabled=false`, `rollout_percentage=0`. `npm run release:offline-config` valida o build; o SQL preflight valida grants/RLS.

## Ordem de publicação

1. Banco: aplicar migrations versionadas somente depois de confirmar projeto, backup e ledger. Não editar/apagar migrations já aplicadas. Conferir versão aplicada, grants, RLS e RPC com `scripts/offline-security-preflight.sql` em leitura administrativa.
2. Backend: nenhuma Edge Function nova ou alterada. Não publicar functions por rotina.
3. Frontend: publicar `dist` na Vercel pelo processo corporativo já aprovado, com flags remotas 0%. Confirmar `sw.js` com `Cache-Control: no-cache` e shell atualizado.
4. Smoke online com conta de teste após publicar o frontend, mantendo flags remotas em 0%. Confirmar conta, legal, acesso e ausência de erros novos. Antes de elevar percentuais, executar o fluxo offline real descrito em [PWA_PHASE5_HOMOLOGATION.md](PWA_PHASE5_HOMOLOGATION.md).
5. Em produção, habilitar escrita e depois cold start por atualizações separadas de `public.offline_feature_flags`. Avançar 5%, 10%, 25%, 50%, 100%, observando cada patamar e coletando contadores locais, `public.offline_telemetry`, outbox e recibos agregados do servidor. O percentual determinístico não seleciona apenas contas internas. Suspender avanço diante de duplicação, perda, cruzamento de contas, sync sem autorização ou falha legal/storage.

## Kill switch e rollback

O controle operacional é **server-side** em `public.offline_feature_flags`. `enabled=false` ou `rollout_percentage=0` desliga a coorte sem novo build. Clientes online consultam a RPC a cada 15 segundos, ao voltar à aba/rede e antes de nova escrita (espera de até 1,5 s). Aparelhos offline usam apenas a última resposta válida da própria conta; nenhuma mudança remota alcança um aparelho sem rede. Percentual ausente = 0. A outbox existente continua elegível ao sync autorizado mesmo após desligar novas escritas. Não limpar IndexedDB nem outbox em rollback.

```sql
-- SQL Editor do projeto confirmado, após aprovação operacional. Não executado nesta tarefa.
update public.offline_feature_flags
set enabled = false, rollout_percentage = 0
where feature in ('offline_write', 'offline_cold_start');
```

Pode-se voltar o frontend a um build anterior **compatível com o schema**. A telemetria admite até 100 eventos técnicos na fila local e 120 por usuário por hora no servidor; um job diário elimina linhas após 30 dias. Não reverter `workouts.updated_at`, recibos ou RPC após clientes os usarem; manter migrations aditivas e corrigir adiante. A revogação de grants de segurança não deve ser desfeita. Se houver incidente, zerar percentuais, preservar dados locais e bloquear avanço até entender os recibos e pendências.

## Comandos operacionais

```bash
# local, contra PostgreSQL de teste já migrado
PG_TEST_CONTAINER=<container-local-migrado> PG_TEST_USER=<papel> npm run release:offline-check
npx playwright-core install chromium --only-shell
npm run test:offline-browser

# leitura remota SOMENTE após autenticar CLI e confirmar project_ref de produção
node_modules/.bin/supabase migration list --linked

# escrita remota SOMENTE após aprovação, backup e ledger conferido
node_modules/.bin/supabase db push

# validação administrativa somente leitura no banco migrado
psql '<CONNECTION_STRING_DO_PROJETO_CONFIRMADO>' -X -v ON_ERROR_STOP=1 -f scripts/offline-security-preflight.sql

# build local na configuração de produção conferida
npm run release:offline-config
npm run build
npm run budget
```

**AÇÃO MANUAL NECESSÁRIA:** executar a matriz física Android/iPhone antes de elevar o rollout acima de 0%. Nenhuma Edge Function precisa de publicação.
