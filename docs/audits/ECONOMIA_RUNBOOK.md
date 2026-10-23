# Economia Evolutus — validação local e publicação

Estado atual: consulte `finance-integration/RELATORIO_FINAL.md` e a seção `stabilization` de `ECONOMIA_EVIDENCIAS.json`. Publicação não autorizada. Este runbook substitui o procedimento antigo com schemas sintéticos; não existe homologação remota. O merge do PR #65 não comprova que suas migrations foram aplicadas no Supabase de produção.

## Ambiente local reproduzível

Node 24, Docker e dependências do lockfile. Todos os comandos abaixo usam nomes fixos de containers descartáveis, senha/chaves sintéticas e portas somente em loopback. Nunca substituir por URL/credencial de produção.

```bash
node scripts/homolog/finance/stack.mjs start
node scripts/homolog/finance/migrate.mjs all
node scripts/homolog/finance/sql-tests.mjs
node scripts/homolog/finance/http-integration.mjs
PG_TEST_CONTAINER=evolutus_integrated_db PG_TEST_USER=supabase_admin npm run test:functions
node --test --test-concurrency=1 src/services/logoutScope.test.js src/hooks/useLogout.test.js
npm test
npm run lint
npm run build
```

`start` recusa sobrescrever containers existentes. Para retomar containers parados, usar `node scripts/homolog/finance/stack.mjs resume`; o preparador recompõe os arquivos locais em `.finance-local/runtime` (ignorada pelo Git), aguarda PostgreSQL TCP, Auth, Storage e gateway. `restart-edge.mjs` atualiza somente a cópia temporária das funções. O shim do provedor nunca entra em `supabase/functions` nem no bundle publicado; sua saída HTTP externa é bloqueada. JSR usado pelo runtime para resolver imports continua sendo download de dependências, não chamada de pagamento.

Instalação limpa e atualização com carteira/ledger/compra já existentes:

```bash
node scripts/homolog/finance/install-check.mjs
node scripts/homolog/finance/sql-tests.mjs evolutus_integrated_clean_db
python3 scripts/finance-audit-local.py concurrency --container evolutus_integrated_clean_db
python3 scripts/finance-audit-local.py performance --container evolutus_integrated_clean_db
```

O ensaio recusa um `evolutus_integrated_clean_db` preexistente e valida imagem, endereço, senha sintética e segredo de teste dos serviços antes de copiá-los. Usa Auth/Storage reais para preparar os schemas, encerra esses dois serviços auxiliares e troca exclusivamente sua própria instância descartável entre as fases. Não recria o database padrão em uma instância viva: foi reproduzido crash do worker pg_net 0.20.4 nessa operação de infraestrutura; isso não é uma falha de migration. Não aplicar esse procedimento de reset em banco real.

Executar suítes sequencialmente. PostgreSQL integrado limitado a 0,7 CPU/900 MiB, banco do ensaio a 0,5 CPU/900 MiB; Edge a 0,25 CPU/450 MiB. Concorrência financeira limitada a quatro conexões. Não executar carga enquanto executa build/testes gerais. Ao terminar, parar os containers fixos da auditoria, preservando Vite 5173 e processos alheios. Nenhum prune global.

## Destino e pré-check remoto — somente leitura

Destino esperado: projeto `ywrjojrjgozdfpddkkuy`, evolutus.com.br. Confirmar a organização/projeto na saída de `projects list`, o vínculo em `supabase/.temp/project-ref` e o histórico completo antes da consulta. Credenciais somente no terminal/cofre; não publicar tokens ou arquivos de ambiente. Identidade Git esperada: Danielalveslira / `124009137+Danielalveslira@users.noreply.github.com`. Um `GITHUB_TOKEN` antigo da sessão pode sobrepor a credencial pessoal do `gh`; isso não autentica a CLI Supabase.

```bash
node_modules/.bin/supabase projects list --output json
cat supabase/.temp/project-ref
node_modules/.bin/supabase migration list --linked
node_modules/.bin/supabase db query --linked --file scripts/release/finance-production-readonly.sql --output json > /tmp/finance-production-preflight.json
```

O SQL usa `BEGIN READ ONLY`, statement timeout de 10 s e lock timeout de 2 s. Retorna somente metadados/contagens: unidades inválidas, saldos negativos, divergência carteira/ledger/lifetime, compra creditada sem ledger/identidade, duplicidade e definições/grants/RLS/índices. Não grava cursor/findings. Não executar `finance_reconcile_shadow` sob a autorização de somente leitura: essa função grava evidências, embora não modifique saldos.

Comparar funções, RLS, grants, colunas, índices e constraints com uma baseline local até a última versão **realmente registrada remotamente**; normalizar apenas owner/grantor e qualificação equivalente do deparser. A evidência anterior `remote-baseline-drift.json` é histórica, não substitui consulta atual. Zero linhas inválidas não prova equivalência de schema; journal sozinho também não. Se houver divergência, parar publicação e revisar roll-forward. Não arredondar valores, fabricar ledger inicial ou reparar saldo automaticamente.

## Ordem das migrations

Aplicação em ordem lexicográfica, sem editar as 148 históricas até `20261111000001`:

| Versões | Conteúdo / dependência |
| --- | --- |
| `20261112000001` | permissões internas e search_path |
| `20261112000002` | inteiros, constraints NOT VALID, ledger imutável, promoção serializada |
| `20261112000003` | finalização/estados do pagamento e lease persistente de 30 s |
| `20261112000004` | eventos compensatórios e obrigação; flag desativada |
| `20261112000005` | evidência de recursos/eventos e fingerprint de recompensas |
| `20261112000006` | conciliação paginada, lease/backoff com fencing token; sem novo cron |
| `20261113000001` → `20261113000003` | sessão real em auth.sessions, RPC is_session_active, proteção administrativa |
| `20261114000001` → `20261114000003` | integração financeira/Auth, RLS, operações de comunidade e exclusão |
| `20261115000001` | catálogo de fusos qualificado em set_training_preferences |

São 13 pendentes se o remoto ainda estiver em `20261111000001`; confirmar, nunca presumir. O ensaio local aplica 161 no total. `NOT VALID` protege novas escritas sem alterar dados históricos. Validar constraints antigas separadamente após pré-check e janela aprovados. Estimar tempo dos índices com tamanho real: o DDL transacional pode bloquear escritas. Não prometer zero downtime.

## Backup e recuperação — requisitos antes de publicar

Registrar responsável e aprovação, snapshot/PITR e horário do ponto recuperável, retenção, RPO/RTO aceitos e evidência de restauração em destino isolado. Incluir dados, schema, histórico de migrations, configuração/secrets de funções por cofre e objetos do Storage (dump SQL não inclui arquivos). Conferir transações/pagamentos recebidos após o ponto recuperável antes de qualquer recuperação. Não depender de um `down` destrutivo para desfazer publicação.

Na janela autorizada: suspender criação de novos checkouts/debitos pela configuração operacional existente, manter recebimento/verificação de pagamentos e aguardar operações em curso. Conferir bloqueios e erros. DDL tem lock_timeout quando previsto; falha aborta sua migration, não autoriza ignorar erro ou mexer no journal. Se a operação financeira antiga já está em produção, planejar proteção equivalente antes de ampliar tráfego; não desligar webhooks de pagamentos já iniciados.

## Publicação — comandos preparados, NÃO executados

Somente após autorização explícita, pré-check atual limpo e recuperação aprovada. Fixar commit e hashes revisados. Bloquear auto-publicação do frontend pela integração Git durante a janela; push/merge em main pode publicar frontend antes do banco. Não configurar integração CI nova nesta entrega.

```bash
# Revisão final do destino e do plano. Não confirmar diferenças inesperadas.
node_modules/.bin/supabase migration list --linked
node_modules/.bin/supabase db push --linked --dry-run

# 1. BANCO — ação remota: somente após autorização.
node_modules/.bin/supabase db push --linked

# 2. EDGE — inclui consumidores do helper administrativo alterado no PR #65.
node_modules/.bin/supabase functions deploy infinitepay-create-checkout --project-ref ywrjojrjgozdfpddkkuy
node_modules/.bin/supabase functions deploy infinitepay-check-payment --project-ref ywrjojrjgozdfpddkkuy
node_modules/.bin/supabase functions deploy infinitepay-webhook --project-ref ywrjojrjgozdfpddkkuy
node_modules/.bin/supabase functions deploy infinitepay-admin-reconcile --project-ref ywrjojrjgozdfpddkkuy
node_modules/.bin/supabase functions deploy exercise-visual-confirm --project-ref ywrjojrjgozdfpddkkuy
node_modules/.bin/supabase functions deploy publish-exercise-visual --project-ref ywrjojrjgozdfpddkkuy
node_modules/.bin/supabase functions deploy cleanup-exercise-visuals --project-ref ywrjojrjgozdfpddkkuy
node_modules/.bin/supabase functions deploy delete-exercise-visual --project-ref ywrjojrjgozdfpddkkuy
```

Preservar `verify_jwt=false` somente no webhook público; o webhook sempre confirma pelo provedor antes de crédito. As demais funções mantêm autenticação. Secrets de servidor nunca em VITE_ nem no cliente. Manter compatibilidade: o banco novo aceita as assinaturas anteriores; a Edge nova depende de `is_session_active()` e do RPC de término de conciliação, portanto banco antes de Edge/frontend.

Frontend na Vercel: a identidade/equipe/projeto precisam ser confirmados no momento, não inferidos de login. Os comandos abaixo exigem CLI Vercel instalada em versão revisada e autorização da publicação. A última evidência do PR aponta para equipe `danielalvesliras-projects`, projeto `treinos_academia`; interromper em divergência/link_required. Não fazer link automático para contornar divergência.

```bash
vercel project inspect --non-interactive
vercel whoami --format json
vercel pull --environment=production --scope danielalvesliras-projects
vercel build --prod
# 3. FRONTEND — prepara build de produção sem atribuir domínio.
vercel deploy --prebuilt --prod --skip-domain --scope danielalvesliras-projects
# Inspecionar a URL retornada; DEPLOYMENT_URL é exatamente essa URL, após revisão.
vercel inspect "$DEPLOYMENT_URL" --scope danielalvesliras-projects
# 4. Somente após smoke e autorização: atribuir domínio ao MESMO build validado.
vercel promote "$DEPLOYMENT_URL" --scope danielalvesliras-projects
```

Nenhum comando Vercel acima foi executado. Não incluir `.vercel`/env puxado como evidência pública. Não utilizar os scripts locais de fixtures/HTTP/carga contra a URL publicada.

## Smoke e ativação

1. Conferir journal e repetir SQL read-only; grants/RLS/search_path/constraints esperados, sem divergência nova de saldos.
2. Com conta controlada autorizada: login, leitura de carteira e histórico, isolamento entre contas, logout global e rejeição do JWT revogado. Nenhum débito/crédito artificial. Consultas de autorização negativa não devem alterar valores.
3. Verificar rotas `/app` e EvoCash, histórico e estados pending/needs_review/cancelled; observar erros de Auth, Edge, RLS e latências. Confirmar que snapshot offline é informativo e não autoriza gasto.
4. Pagamento real ou reembolso exige autorização separada e transação controlada no provedor; nunca substituir essa confirmação por service_role/SQL. As opções com API Key dependem de validação do lojista; não presumir autenticidade de webhook de estorno.
5. Manter `financialControls.reversalsEnabled=false`, estorno automático e novos cron financeiros desativados. Lote de conciliação externo: padrão 2, máximo 3, sequencial, até 10 tentativas e lease de 2 min com fencing token; somente iniciar sob aprovação operacional. Shadow: padrão 50, máximo 200, cursor persistente, sem correção de saldo e sem lock de carteira. Findings de segundo pagamento verificado não entram no purge operacional.

## Contenção e compensação

Erro do provedor: conservar pending/uncertain, leases e backoff; não criar checkout novo após resultado incerto. Pagamento tardio comprovado segue o settlement original. Segundo pagamento no link legado: finding auditável, nenhum crédito extra; investigação no painel.

Divergência: conter a fonte pela configuração/versão revisada, preservar ledger e provas. Não executar UPDATE/DELETE de transações ou soma/regravação de carteira. Compensação requer política e registro auditável aprovados. Reembolso parcial acumula centavos e aloca unidades inteiras pela diferença de pisos cumulativos; dívida separada, sem saldo disponível negativo. A flag continua desativada até aprovação comercial/jurídica e prova do provedor.

Regressão após COMMIT: restaurar frontend/Edge compatíveis e fazer roll-forward testado; manter grants, constraints, histórico e obrigações. Para Vercel, `vercel rollback` usa deployment revisado e não reverte banco; a autoatribuição precisa ser revista depois. Não restaurar snapshot antigo por rotina, pois pagamentos posteriores precisam de conciliação. Não reabrir permissões para contornar falha.

## Retomada do desenvolvimento e evidências

O runtime/logs de validação ficam em `.finance-local/`, preservados entre retomadas do workspace e ignorados pelo Git. Os resultados selecionados estão versionados em `docs/audits/finance-integration/`. Os serviços de testes são parados após a validação; o banco/containers atuais ficam preparados para `stack.mjs resume`, sem consumir CPU de testes. Caches do runtime anterior e o Chromium/bibliotecas temporárias usados no canário foram removidos.

Para restaurar a mesma rota de desenvolvimento, sem publicar:

```bash
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

O frontend usa a configuração Supabase existente do Codespace. Não apontar o canário/fixtures/carga para ela; os testes financeiros usam exclusivamente o stack sintético em loopback.
