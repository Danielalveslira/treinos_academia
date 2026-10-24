> **Estado mais recente do Codespace e PR:** [finance-release-verification/PR_READINESS.md](finance-release-verification/PR_READINESS.md). Branch local chore/finance-release-readiness, assinatura SSH válida; não houve push. Leituras remotas atuais Supabase/Vercel bloqueadas por autenticação.

# Economia Evolutus — validação local e publicação

Estado atual: consulte primeiro `finance-release-verification/LIBERACAO_SEGURANCA.md` e `security-finalization-evidence.json` nesse diretório; backup do banco restaurado, custódia externa e gates remotos ainda pendentes. Consulte também `finance-release-verification/RELATORIO_FINAL.md` e `finance-release-verification/evidencias.json`; a confirmação remota foi concluída, recuperação/publicação continuam bloqueadas. Consulte também `finance-integration/RELATORIO_FINAL.md` e a seção `stabilization` de `ECONOMIA_EVIDENCIAS.json`. Publicação não autorizada. Este runbook substitui o procedimento antigo com schemas sintéticos; não existe homologação remota. O merge do PR #65 não comprova que suas migrations foram aplicadas no Supabase de produção.

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

Comparar funções, RLS, grants, colunas, índices e constraints com uma baseline local até a última versão **realmente registrada remotamente**; normalizar somente os owners DBA documentados e grants duplicados equivalentes; comparar corpos SQL literalmente. A evidência anterior `remote-baseline-drift.json` é histórica, não substitui consulta atual. Zero linhas inválidas não prova equivalência de schema; journal sozinho também não. Se houver divergência, parar publicação e revisar roll-forward. Não arredondar valores, fabricar ledger inicial ou reparar saldo automaticamente.

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
| `20261115000002` | RLS de lembretes financeiros exige sessão ativa, após as integrações |

São 14 pendentes se o remoto ainda estiver em `20261111000001`; confirmar, nunca presumir. O ensaio local aplica 162 no total. `NOT VALID` protege novas escritas sem alterar dados históricos. Validar constraints antigas separadamente após pré-check e janela aprovados. Estimar tempo dos índices com tamanho real: o DDL transacional pode bloquear escritas. Não prometer zero downtime.

## Backup e recuperação — requisitos antes de publicar

Registrar responsável e aprovação, snapshot/PITR e horário do ponto recuperável, retenção, RPO/RTO aceitos e evidência de restauração em destino isolado. Incluir dados, schema, histórico de migrations, configuração/secrets de funções por cofre e objetos do Storage (dump SQL não inclui arquivos). Conferir transações/pagamentos recebidos após o ponto recuperável antes de qualquer recuperação. Não depender de um `down` destrutivo para desfazer publicação.

Na janela autorizada: suspender criação de novos checkouts/debitos pela configuração operacional existente, manter recebimento/verificação de pagamentos e aguardar operações em curso. Conferir bloqueios e erros. DDL tem lock_timeout quando previsto; falha aborta sua migration, não autoriza ignorar erro ou mexer no journal. Se a operação financeira antiga já está em produção, planejar proteção equivalente antes de ampliar tráfego; não desligar webhooks de pagamentos já iniciados.

## Publicação — comandos preparados, NÃO executados

Somente após autorização explícita, pré-check atual limpo e recuperação aprovada. Fixar commit e hashes revisados. Bloquear auto-publicação do frontend pela integração Git durante a janela; push/merge em main pode publicar frontend antes do banco. O template `finance-release-verification/finance-production.yml.disabled` permanece fora dos workflows ativos até aprovação e configuração de proteções.

```bash
# Revisão final do destino e do plano. Não confirmar diferenças inesperadas.
node_modules/.bin/supabase migration list --linked
node_modules/.bin/supabase db push --linked --dry-run --skip-vault

# 1. BANCO — ação remota: somente após autorização.
node_modules/.bin/supabase db push --linked --skip-vault

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

## Evidência remota atual e monitoramento

Ver `finance-release-verification/RELATORIO_FINAL.md`: 148 versões remotas, 14 pendentes, três diferenças de grants revisadas e zero divergências financeiras. Backup utilizável/restauração não comprovados e PITR desativado. Main publica frontend automaticamente na Vercel; estabelecer gate autorizado antes de push/merge. A verificação não autoriza publicação.

Leituras complementares, após conferir destino:

```bash
node_modules/.bin/supabase db query --linked --file scripts/release/finance-catalog-readonly.sql --output json
node_modules/.bin/supabase db query --linked --file scripts/release/finance-dependencies-readonly.sql --output json
# Somente DEPOIS de todas as 14 migrations, leitura sem reparos:
node_modules/.bin/supabase db query --linked --file scripts/release/finance-postdeploy-readonly.sql --output json
```

Guardar saídas de catálogo em diretório privado: definições históricas podem conter configuração sensível. Versionar somente contagens, nomes, hashes e diferenças revisadas. Não registrar valores/digests de secrets. Observar em 0/5/15/60 min e durante a janela seguinte; sem criar cron. Em divergência, conter novas origens afetadas mantendo webhooks e confirmação de pagamentos em curso.

## Gates finais, antes de qualquer publicação

O bloqueio remoto Vercel é uma mudança de configuração, depende de autorização específica e não é deploy. Injetar VERCEL_TOKEN diretamente do cofre/ambiente protegido, nunca por argumento ou arquivo versionado. Inspeção é o padrão:

```bash
node scripts/release/vercel-production-gate.mjs
# SOMENTE após autorização específica do hold:
node scripts/release/vercel-production-gate.mjs --apply-hold
```

Confirmar autoAssignCustomDomains=false e mesmo deployment atual. O `vercel.json` preparado desabilita deploy Git de main e finance-ci-*, mas só protege as revisões que contêm esse arquivo. Aplicar/verificar hold antes do primeiro push. As demais branches mantêm preview. Não atribuir domínio por outra automação durante o rollout.

Resolver plano/acesso que permita proteção da main privada, aplicar o payload proposto somente sob autorização e exigir finance-quality (GitHub Actions app 15368), revisão do último push e proteção de admins. Assinatura segue habilitada; o ensaio atual em repo descartável falhou com chave GitHub ausente. Corrigir o assinador e validar Verified antes de criar/enviar os commits; preservar os três commits locais e suas referências ao reorganizar a branch. Não usar commit.gpgsign=false.

Após o diff estar consolidado e assinado, com autorização específica de push, utilizar somente `chore/finance-release-readiness`; push nela dispara o workflow atualizado. Descobrir a execução pelo SHA exato e acompanhar sem disparar cópias redundantes:

```bash
# Execução futura: a branch e os commits precisam estar previamente preparados/revisados.
git push origin HEAD:refs/heads/chore/finance-release-readiness
# Selecionar o ID da execução que corresponde exatamente ao SHA enviado:
env -u GITHUB_TOKEN -u GH_TOKEN gh run list --workflow supabase-tests.yml --branch chore/finance-release-readiness --commit "$APPROVED_SHA"
env -u GITHUB_TOKEN -u GH_TOKEN gh run watch "$CI_RUN_ID" --exit-status
```

Nenhum push acima foi executado. Não inferir aprovação a partir do CI de 0cdde0e. Não integrar antes de finance-quality aprovado e branch protegida; o SHA final após merge também precisa de CI. Não executar merge automaticamente.

Antes de executar o db push autorizado, além de revisão do schema/backup atual:

```bash
mkdir -p .finance-local/release
chmod 700 .finance-local/release
node_modules/.bin/supabase db query --linked --file scripts/release/finance-production-readonly.sql --output json > .finance-local/release/before.json
node scripts/release/check-finance-diagnostics.mjs before .finance-local/release/before.json
node_modules/.bin/supabase db push --linked --dry-run --skip-vault
# Após as 14 migrations e oito Edge Functions, sob a autorização correspondente:
node_modules/.bin/supabase db query --linked --file scripts/release/finance-postdeploy-readonly.sql --output json > .finance-local/release/after.json
node scripts/release/check-finance-diagnostics.mjs after .finance-local/release/after.json
```

Erro, campo ausente, saldo divergente, flag de reversão ativa ou permissão perigosa bloqueiam o gate. Sucesso da requisição SQL sozinho não aprova integridade. Não chamar reconciliação que grave findings sob escopo de leitura. Tratar needs_review, pendentes com identidade e findings por política operacional, sem fabricar correções de saldo.

O template de frontend requer environments com revisores obrigatórios (backend, stage, promote), acesso apenas a main, secrets mínimos por etapa, versões fixas de CLI e aprovação de backup/backend do mesmo SHA. Não basta copiar o YAML para ativar proteção: GitHub environments não configurados podem não impor aprovação. Só habilitar após conferir as proteções reais. Migrations/Edge permanecem na sequência autorizada acima; o template apenas verifica backend e prepara/promove frontend. A promoção exige smoke revisado do mesmo deployment, sem nova compilação.

Recuperação comprovada do banco, ciphertext/key local, limitações de Storage/configuração, ponto do snapshot e RPO/RTO estão em `finance-release-verification/LIBERACAO_SEGURANCA.md`. Não publicar sem cópia externa/chave independente e responsabilidades confirmadas.

### Identidade dos commits no ambiente automatizado

Neste Codespace, o processo do agente também fornece GIT_COMMITTER_NAME/EMAIL=GitHub, que prevalecem sobre git config. Isso não muda o login HTTPS nem a chave SSH. Para novos commits com Daniel nos dois campos, usar no processo de commit:

```bash
GIT_COMMITTER_NAME=Danielalveslira GIT_COMMITTER_EMAIL=124009137+Danielalveslira@users.noreply.github.com git commit -S
```

Não reescrever os três commits anteriores automaticamente. Os cinco novos de código já assinados têm autor Daniel e committer GitHub; eventual normalização exige consentimento e referência preservada. A documentação seguinte é commitada com o committer explícito.
