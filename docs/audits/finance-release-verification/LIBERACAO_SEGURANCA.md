> **Estado mais recente:** [PR_READINESS.md](PR_READINESS.md). GitHub/SSH Daniel confirmados, 69 SQL/3.035 assertivas e demais suítes locais aprovadas; Supabase/Vercel precisam de nova autenticação neste Codespace. O conteúdo abaixo preserva a etapa anterior.

# Finalização de segurança — situação real

**BLOQUEADO PARA PUBLICAÇÃO.** O backup de banco agora foi efetivamente restaurado e conferido. A proteção de publicação e o CI real ainda dependem de autorização/configurações externas. Nenhum push, merge, deploy, pagamento real ou migration remota foi executado. As mudanças anteriores foram preservadas.

Evidência estruturada: [security-finalization-evidence.json](security-finalization-evidence.json). Este documento sucede as limitações de backup do relatório anterior, sem transformar os testes históricos em novas execuções.

## 1. Backup e recuperação comprovados

Produção confirmada novamente: `ywrjojrjgozdfpddkkuy`, evolutus.com.br, us-east-2. Organização: Stockflow (`bvgictlmomeysblyrqjf`). A CLI não expõe o nome do plano nos metadados de organização disponíveis; **não foi presumido Free/Pro**, nem contratado qualquer recurso. A consulta atual de backups mantém `backups:null`, PITR=false e WALG=true, sem ponto recuperável gerenciado demonstrado.

Foi possível utilizar a conexão da CLI para um **pg_dump completo em formato custom**, com sessão `default_transaction_read_only=on`, statement timeout de 120 s, lock timeout de 2 s e lock-wait-timeout de 2 s. A geração levou 30,51 s e produziu 5.169.098 bytes. Data interna do archive: **2026-10-23 20:54:13 UTC**. O dump utiliza o snapshot transacional do pg_dump; nenhuma instrução de alteração foi enviada à origem.

Restauração realizada em `evolutus_finance_restore_verify`, database separado `finance_restore`, PostgreSQL 17.6.1.166, **network=none, nenhuma porta publicada, nenhum mount, cron.launch_active_jobs=off, 0,5 CPU/900 MiB**. Não foram iniciados Auth, Storage, Edge, fixtures, pagamentos nem jobs contra os dados recuperados.

Tentativas registradas, sem mascaramento: primeiro faltava preload de pg_cron; depois a configuração da lista de bibliotecas estava incorreta; por fim faltavam duas roles globais na imagem-base (`supabase_functions_admin`, `supabase_realtime_admin`). A configuração foi corrigida apenas localmente e essas duas roles foram criadas NOLOGIN/NOSUPERUSER. Todas as tentativas de pg_restore usaram single-transaction/exit-on-error. A última restauração terminou com **exit code 0**. O ciclo final de restauração, incluindo resolução das roles, levou 19 s; **isso não é RTO completo de produção**.

Conferências efetivas:

- **19/19 tabelas** com contagens e fingerprints iguais à origem: carteiras, ledger, compras, configuração/regras/agregado de economia, promoções, casos/eventos/itens financeiros, perfis, Auth users/sessions/refresh_tokens, Storage buckets/objects (metadados), journal e cron.job.
- 148 migrations recuperadas; 11 registros de sessão Auth, zero referências órfãs de sessões.
- 297 funções, 92 relações, 66 triggers, cinco views, dois enums e 14 jobs comparados, com grants/RLS/índices/validação de constraints preservados. Owners DBA são mapeados para o owner local, conforme o comparador documentado.
- Uma diferença de deparse revisada: `push_subscription_key_lengths` reagrupa os mesmos operandos AND após dump/reparse. As operações são as mesmas comparações imutáveis; AND é associativo também com NULL. A constraint permanece validada. **O comparador não foi enfraquecido para escondê-la**; a diferença está registrada na evidência.
- Zero divergência financeira no diagnóstico da cópia e da origem: seis carteiras, 166 lançamentos, 25 compras.

O dump foi criptografado com **GnuPG/AES256 e proteção de integridade**. A descriptografia foi testada e seu SHA-256 coincide com o dump original. O temporário sem criptografia foi removido. O arquivo criptografado tem aproximadamente 4 MB, em `.finance-local/remote/recovery/production.dump.gpg`; a chave está em arquivo privado separado, não versionado e não publicado em logs/relatórios. O container com os dados recuperados será removido após a coleta de evidências.

**Limitação que permanece:** arquivo e chave ainda estão no Codespace. Não há destino externo aprovado, retenção e acesso independente comprovados. Copiar ambos para o mesmo destino não resolve a independência da chave. A pergunta sobre destino seguro já foi apresentada. Guardar o ciphertext em armazenamento externo existente e a chave em cofre separado, comprovar download/descriptografia e registrar responsáveis/data/retenção. Não é necessário presumir contratação de PITR para executar esse procedimento, mas o ponto recuperável gerenciado segue indisponível.

O dump não inclui bytes dos objetos Storage, configurações do projeto gerenciado, secrets de Edge/JWT/SMTP ou senhas de roles globais. Nenhum desses recursos será alterado pelo rollout atual; ainda assim seu inventário, custódia e recuperação precisam ser documentados antes da publicação. **A recuperação integral de um projeto Supabase gerenciado não foi homologada**. Não confundir recuperação comprovada do banco com recuperação automática de toda a plataforma.

RPO: uma recuperação pelo snapshot perde alterações posteriores a 20:54:13 UTC, salvo recomposição aprovada com evidências e dados do provedor. As 19 tabelas conferidas continuavam iguais na comparação, mas isso não garante RPO zero no futuro. Fazer cópia atual na janela, conter novas operações e manter verificação de pagamentos em curso; pagamentos posteriores devem ser conciliados antes da recuperação. RTO completo depende de provisionamento, objetos/configuração/credenciais e validação de serviços; não há SLA medido/aceito. Responsáveis por custódia, recuperação e decisão de incidente precisam ser nomeados pelo proprietário.

Fontes: [backups Supabase](https://supabase.com/docs/guides/platform/backups) e [migração por backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Foram utilizadas as capacidades existentes, sem restaurar sobre produção.

## 2. Vercel: proteção preparada, alteração remota pendente

Inspeção autenticada confirmou equipe `danielalvesliras-projects`, projeto `treinos_academia` (`prj_WYVlCGYu021KZCrqfp62qRH2cbIE`), repositório Danielalveslira/treinos_academia e productionBranch=main. O deployment atual continua `dpl_2akHRitD4MDdf7WdCKNmup9mAoXv`, commit `0cdde0e`. **autoAssignCustomDomains ainda é true**.

Mudança remota proposta em [vercel-hold.proposed.json](vercel-hold.proposed.json): apenas `autoAssignCustomDomains:false`. Preserva o deployment/domínios atuais e integração Git; builds futuros deixam de receber domínio automaticamente e precisam de promoção explícita. Não desliga webhook, frontend atual ou Supabase. O script `scripts/release/vercel-production-gate.mjs` é GET-only por padrão, confirma equipe/projeto/repositório/branch, aplica somente esse PATCH se invocado com `--apply-hold`, lê de volta e recusa alvo divergente ou mudança concorrente de deployment. Quatro testes cobrem inspeção, alteração exata, idempotência e recusas. A inspeção real passou; **o PATCH não foi executado**. Autorização solicitada especificamente para essa configuração, sem incluir deploy.

Proteção local adicional: `vercel.json` passa a definir `git.deploymentEnabled.main=false` e `finance-ci-*=false`. Após publicação autorizada dessa configuração, a main não gera deploy Git automático e a branch de CI não cria preview. As demais branches conservam previews; PRs não passam a produção por essa configuração. CLI/builds controlados continuam possíveis. **O arquivo local ainda não protege a configuração atualmente publicada**; por isso o hold remoto precisa vir primeiro.

[Git deploymentEnabled oficial](https://vercel.com/docs/project-configuration/git-configuration) e [API de atualização do projeto](https://vercel.com/docs/rest-api/projects/update-an-existing-project). `vercel promote` pode reativar autoatribuição; verificar o hold após promoção e manter deploymentEnabled.main=false enquanto o fluxo manual estiver vigente. Não remover proteções para forçar publicação.

## 3. CI/CD e main

Workflow `.github/workflows/supabase-tests.yml` preparado:

- `npm ci`, Node 24, actions checkout/setup-node fixadas em SHA, contents:read e checkout sem persistir credenciais.
- A tag `supabase/setup-cli@v1` retornou 404 e não apareceu em ls-remote. Removida a dependência dessa referência: a CLI **2.119.0 do package-lock**, já instalada por npm ci, executa start/test/stop.
- JS: lint, testes de gates, aplicação, build e scanner do bundle. SQL: Supabase local descartável, todas as migrations e suítes pgTAP, Functions com PostgreSQL real habilitado. Auth/offline/RLS/integridade pertencem às suítes existentes, sem exclusão de assertivas.
- Scanner de credenciais reconhece chaves privadas, tokens GitHub/Supabase/AWS, URLs com senha literal e JWT service_role. No browser também recusa referências a secrets backend. Não imprime os valores. Não é detector universal nem substitui revisão/histórico/rotação; não foram encontrados segredos nos arquivos atuais ou bundle existente.
- Check final **finance-quality** usa `always()` e depende de JS, SQL e secrets. Retorna exit 1 para falha, cancelamento ou skip de qualquer dependência. Sem continue-on-error ou `|| true`. Quatro combinações do script real do YAML foram executadas e conferidas.
- Push isolado `finance-ci-*` dispara CI sem exigir deploy. PR também dispara. Nada foi enviado.

**Situação remota real:** main continua protected=false. API de proteção retorna HTTP 403 com exigência de plano compatível para repositório privado. [Proteções GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) dependem de plano elegível. O proprietário deve confirmar/habilitar esse recurso mantendo o repositório privado; não foi contratado plano nem alterada visibilidade.

Payload proposto em [github-main-protection.proposed.json](github-main-protection.proposed.json): finance-quality emitido pelo GitHub Actions (app 15368 confirmado nos checks existentes), branch atualizada, revisão independente do último push, revisão obsoleta descartada, conversas resolvidas, proteção aplicada a administradores e proibição de force-push/delete. É preciso indicar revisor com acesso; autor não aprova o próprio PR. Após resolver assinatura, adicionar também a exigência nativa de commits assinados e conferir que os três commits locais antigos são compatíveis antes de enviá-los. Nenhuma proteção existente foi desativada.

Assinatura foi testada **em repositório descartável**, sem modificar refs/index do Evolutus: falhou com `No secret key` para `GitHub <noreply@github.com>`. O erro anterior `403 Author is invalid` é histórico; não foi apresentado como resultado atual. As configurações de assinatura continuam habilitadas e não houve novo commit sem assinatura. Ação necessária: disponibilizar/configurar um assinador válido de Daniel (SSH/GPG/serviço do Codespace), registrar somente a chave pública no GitHub mediante autorização e validar Verified; nunca enviar chave privada pelo chat. Só então preparar commits assinados preservando as referências locais antigas.

**CI atual no GitHub: NÃO EXECUTADO.** Sem push autorizado não é possível obter checks do conteúdo ainda local. Checks antigos de 0cdde0e não aprovam estas mudanças. Antes do primeiro push: hold Vercel verificado, branch isolada `finance-ci-final-security`, assinatura resolvida, diff/secrets revisados e autorização explícita para enviar somente essa branch. Não usar push/main para descobrir o comportamento de produção.

## 4. Migrations e compatibilidade

Nova conferência remota e dry-run: 148 versões até `20261111000001`, **14 pendentes**, seeds/roles vazios, `--skip-vault`. Nenhuma mudança remota aplicada. As três diferenças de grants já revisadas permanecem; corpos SQL/RLS/triggers/índices/constraints de baseline mantêm os contratos esperados. Os hashes das 13 candidatas originais foram preservados.

Ordem exata:

1. `20261112000001_finance_permissions.sql`
2. `20261112000002_finance_integrity.sql`
3. `20261112000003_finance_payment_finality.sql`
4. `20261112000004_finance_reversals.sql`
5. `20261112000005_finance_reward_evidence.sql`
6. `20261112000006_finance_reconciliation_shadow.sql`
7. `20261113000001_session_revocation_guard.sql`
8. `20261113000002_session_active_rpc.sql`
9. `20261113000003_admin_session_revocation_guard.sql`
10. `20261114000001_financial_auth_integration.sql`
11. `20261114000002_remaining_sensitive_rpcs_guard.sql`
12. `20261114000003_community_economy_session_guard.sql`
13. `20261115000001_training_preferences_catalog.sql`
14. `20261115000002_cash_reminder_session_guard.sql`

A última exige sessão ativa na leitura administrativa de lembretes financeiros, sem DML ou novo índice. Nenhuma migration histórica modificada. Constraints NOT VALID preservam legados; não arredondar valores nem validar fora da janela. Índices/transações DDL podem bloquear escritas apesar da massa pequena. Reexaminar transações/locks antes da execução; timeout não autoriza alterar journal ou relaxar constraints. Versões antigas das Edge usam RPCs preservados e continuam confirmando pagamentos em curso; novas Edge só depois do banco. Usuários com sessão revogada serão recusados pela nova regra; cache não autoriza gasto.

## 5. Testes e performance

- **15/15** testes Node dos gates/comparador/scanner, zero falhas/skips.
- Quatro casos reais do job agregador: sucesso=exit 0; falha/cancelado/skip=exit 1.
- Canário temporário sintético: scanner retorna exit 1 e não imprime a credencial; arquivo removido. Scanner normal e do bundle existente: zero achados.
- Gate financeiro pré-deploy aprovado sobre a leitura remota atual; pós-deploy aprovado sobre evidência **local**, não sobre produção ainda sem migrations.
- YAML de CI e template de release válidos; lint zero erros/16 avisos anteriores. `git diff --check` e hashes das candidatas conferidos.
- Recuperação de banco comprovada conforme seção 1. Nenhuma suíte pesada foi repetida: 162 migrations/142 assertivas afetadas e demais totais de estabilização conservam suas datas e escopos anteriores.

Não houve mudança no motor financeiro ou componentes do frontend nesta etapa; gates são scripts de release/CI. Não houve nova dependência npm nem novo bundle gerado. Scanner do bundle existente não substitui o scanner do build futuro. Não há nova medição de p95/p99, nem promessa de alteração de latência. O restore rodou com 0,5 CPU/900 MiB e será removido; Vite 5173 é preservado. Não executar carga em produção.

## 6. Implantação e contingência

[ECONOMIA_RUNBOOK.md](../ECONOMIA_RUNBOOK.md) contém os comandos de banco/Edge/frontend e os novos gates. A sequência exige aprovações, não apenas flags locais:

1. Aprovar destino externo, guardar ciphertext/chave separados, verificar recuperação/custódia e configuração/Storage; fixar responsáveis e RPO/RTO. Fazer cópia atual na janela.
2. Autorizar e aplicar somente hold Vercel, conferir que deployment atual não mudou. Resolver proteção da main e assinatura.
3. Autorizar push apenas da branch isolada e acompanhar CI real até finance-quality verde. Exigir essas verificações no PR; integrar somente após autorização e obter CI do SHA final main. Git main deve estar com deploy desativado.
4. Repetir leitura de integridade/catalog/journal e dry-run, aprovar o plano exato. Publicar as 14 migrations **somente sob autorização separada**.
5. Publicar oito Edge dependentes, preservando verify_jwt=false apenas no webhook. Conferir inicialização/logs/configurações, versões e contratos. Manter o recebimento/verificação de pagamentos anteriores.
6. Executar leitura pós-deploy e seu validador; comparar deltas com baseline. Login/sessões/carteira/leitura RLS com conta controlada somente conforme autorização operacional. Não fabricar transações.
7. Preparar build production com domínio não atribuído, scanner do novo bundle e inspeção do deployment/SHA. Validar `/app`, EvoCash, histórico, offline informativo e erros de sessão. Sem compras/reembolsos reais.
8. Após revisão, promover **o mesmo build**. Observar em 0/5/15/60 min e durante a janela seguinte: Auth/Edge/InfinitePay, compras sem crédito, duplicidades, carteira/ledger, EvoCoins/teto, needs_review/pendentes, obrigações e deadlocks. Não ativar cron novo.

Template nativo preparado em [finance-production.yml.disabled](finance-production.yml.disabled), fora de `.github/workflows`: dispatch manual, SHA main exato com CI aprovado → environment de revisão do backend/recuperação → SQL pós-deploy validado → environment de staging → build production sem domínio → environment distinto de revisão do smoke/promoção. Dependências `needs` impedem sequência após falha. **Não está ativado nem homologado no GitHub**. Só habilitar após plano/proteções/revisores/secrets/versão exata da CLI Vercel serem verificados. A aprovação de backend deve anexar as oito versões de Edge e evidência de recuperação do mesmo release. O template não publica migrations automaticamente.

Estornos automáticos, `financialControls.reversalsEnabled`, opções avançadas sem chave/contrato InfinitePay e novos agendamentos continuam desativados. A compra pendente sem identidade não prova pagamento; revisar no provedor se necessário. Não criar crédito para fechar relatório.

Contenção: impedir novas origens afetadas por configuração aprovada, preservar confirmação de pagamentos já iniciados, leases, ledger e evidências. Retornar frontend/Edge somente a versões compatíveis, usando deployment anterior conhecido. Manter schema novo e aplicar roll-forward revisado; não apagar lançamentos, reabrir grants ou restaurar snapshot antigo como rollback rotineiro. Recuperação de desastre exige decisão do responsável, destino isolado validado e análise das transações posteriores ao snapshot.

## Decisão e ações externas necessárias

**BLOQUEADO**, por impedimentos identificados com evidências:

1. Backup recuperado, porém custódia externa/chave independente e recuperação de configuração/Storage ainda não comprovadas. Informar destino seguro existente e responsáveis; não enviar credenciais.
2. Hold remoto da Vercel aguarda autorização explícita; local `vercel.json` ainda não foi publicado.
3. GitHub não permite impor proteção com o plano/acesso atual; assinador sem chave válida; CI do código atual depende de commits assinados e push isolado autorizado.

Nenhum desses impedimentos será resolvido por apagar dados, ignorar testes, desativar RLS ou declarar resultados antigos como CI atual. As correções locais, scripts, payloads e template estão disponíveis para revisão. Publicação de produção continua exigindo autorização separada após a resolução dos bloqueios.
