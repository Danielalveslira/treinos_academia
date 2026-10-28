# Migrations, drift e instalação

## Decisão

Preservadas integralmente as 203 migrations da base `5571e5c`, incluindo as 18 `20261205000001`–`20261205000018`. Não houve consolidação física: a comprovação de ineditismo em todos os ambientes persistentes não existe, e o registro local não correspondia aos objetos instalados. Renomear/reordenar esconderia o drift sem trazer benefício de integridade.

Mapeamento antigo → atual: identidade para os 203 arquivos de `MIGRATIONS_BASELINE.json`; apenas `20261206000001_finance_consolidation_guards.sql` foi acrescentada. A instalação contém 204 arquivos, em ordem de versão. O manifesto SHA-256 e `scripts/check-migration-integrity.mjs` bloqueiam alteração/remoção histórica, versões duplicadas, arquivos vazios e adições retroativas. O CI executa o gate e seus testes de adulteração.

## Registros efetivamente consultados

`evolutus_price_phase1_db`: registro consultado nesta execução; último registro `20261204000002`, mas objetos das 18 migrations publicitárias já existiam. A base é descartável, montada nas fases anteriores. O diagnóstico anterior foi preservado em `evidence/readonly-before-registry.json`. Após nova comparação completa de schema/permissões e diagnóstico financeiro, `consolidation-registry.mjs` registrou somente as 19 versões locais ausentes (18 publicitárias + guard), sem reaplicar SQL. O registro final tem as 204 versões; `registry-repair.json` conserva nomes/hashes e comprova diagnósticos financeiros inalterados. Esse reparo é restrito ao container descartável e não é procedimento automático para o destino.

A baseline descartável `evolutus_commercial_phase0_20261027` foi usada no ensaio de upgrade transacional com rollback. Não é produção. O inventário remoto da Fase 0, em `phase0/baseline.json`, registrava `20261127000001`; é evidência histórica, não uma consulta atual do destino. Nenhuma conexão remota atual foi utilizada nesta entrega. Validar o registro real de destino permanece bloqueante antes de qualquer integração.

## Drift encontrado e correção aditiva

A comparação de catálogo identificou duas constraints ausentes em `evocash_price_audit`, default `{}` indevido em `private.advertising_drafts.creation_request` e EXECUTE extra de `service_role` em `admin_list_professional_listings(text,text,uuid,integer)`.

A migration nova restaura e valida `applied_revision>0` e `action<>'publish' OR price_version_id IS NOT NULL`, remove somente o default permissivo e revoga o grant extra. Dados incompatíveis fazem a instalação falhar e reverter; não há correção silenciosa, exclusão ou alteração de saldo. As criações de campanha já fornecem explicitamente o payload de idempotência. O administrador continua usando a RPC autenticada, sem necessidade de service_role.

Diferença de ordem física de colunas foi normalizada somente na comparação por nome. Não se reconstruíram tabelas financeiras/editoriais para reorganizar colunas.

## Provas executadas

- `consolidation-clean.mjs`: PostgreSQL novo com imagem já disponível localmente; importa somente DDL de serviços Auth/Storage, sem policies/triggers da aplicação e sem dados. Todas as 203 migrations da base foram aplicadas e registradas. Vendas, veiculação, capacidade, preços e coleta foram conferidos fechados.
- `consolidation-schema.mjs`: a migration aditiva foi instalada sobre essa base limpa, completando 204. Comparação final de definições/grants/RLS/constraints/índices/triggers/views com a base local atual: **zero diferenças**, 475 funções, 132 tabelas e nove views. Evidências `clean-install.json`, `clean-upgrade.log`, `schema-comparison.json`.
- `phase6-reinstall.mjs`: sequência acumulada desde a baseline comercial anterior, incluindo a correção nova; hashes de carteira, ledger, pedidos, direitos, preços e anúncios legados preservados, rollback ao final. `migrations-reinstall-final.log` e cópia do log SQL completo.
- As regressões SQL foram reexecutadas depois da correção. Nenhum índice duplicado equivalente foi encontrado pelo diagnóstico; nenhuma mudança especulativa de índice foi adicionada.

A prova de aplicação não substitui bootstrap do Supabase hospedado, migrations internas dos serviços ou instalação no destino. Os primeiros ensaios locais falharam por baseline de serviço incompleta/espera da inicialização temporária do Postgres; o harness passou a aguardar TCP e conservar PKs/FKs/índices dos serviços. Nenhuma migration foi enfraquecida para superar essas falhas.

## Sequência futura, sem execução autorizada

1. Inventário read-only atual do destino e comparação do manifesto. Resolver drift por plano revisado, sem marcar versões como aplicadas apenas porque um objeto existe.
2. Backup/restauração comprovados, inclusive mídia; pausar novas vendas e conservar callbacks/conciliação de pedidos aceitos.
3. Aplicar apenas migrations ausentes, em ordem; Fases 1/2/3 → 4/4.1 → 5/5.1 → 18 da Fase 6 → guard da consolidação. Transação por arquivo e timeouts; nunca pular uma substituição intermediária sem análise.
4. Backend/RPCs e gateway antes do frontend que os consome. Configurar bucket privado, permissões e publicação Realtime conforme migrations; sem inserir preços ou ativar gates.
5. Publicar Edge Functions existentes em ambiente autorizado com secrets/URLs corretos; wrappers e mocks de `scripts/homolog` não são artefatos de deploy.
6. Conferir saldo/ledger/pedidos/direitos, capacidade e permissões; validar HTML/mídia, suspensão, expiração, reconexão e sessões no ambiente autorizado.
7. Ativação comercial exige decisões B e autorização específica. Jobs auxiliares não substituem elegibilidade PostgreSQL.

Rollback é compatibilidade de aplicação e pausa auditada de vendas, preservando APIs por UUID, schema, direitos e ledger. Não restaurar unicidade de proprietário após múltiplos cadastros; não apagar dados para adaptar aplicação antiga. A revogação do grant é restauração de privilégio mínimo, não deve ser revertida para contornar um cliente mal configurado. Falha de constraint bloqueia instalação; investigar registros e recuperar com procedimento auditado, nunca editar saldo ou apagar auditoria. Não executar down migration destrutiva.
