# Publicação AUD-04 — PUBLICADA no Supabase

**GO executado e confirmado em 13/10/2026, 12:46 UTC.** Migration e worker publicados no projeto de produção correto. Push para `origin/main` e redeploy automático da Vercel autorizados pelo responsável; esta etapa não reaplica migrations nem Edge Functions.

## Destinos, commit e autorização

- GitHub: **Danielalveslira/treinos_academia**, branch **main**, conta Danielalveslira confirmada. HEAD remoto antes deste release: `68dbeb2196e19a1a8ceaf92d2315bdd0f900ed33`.
- Commit local do código publicado: **`f6e866ee8b999d63ac77532d8aa070febd7e4d58`**, `fix: torna limpeza de fotos AUD-04 durável e verificável`. Inclui somente os 11 arquivos revisados da correção, testes, scripts e relatórios AUD-04. Alterações preexistentes não relacionadas permaneceram fora do commit.
- Supabase: **treinos_academia / ywrjojrjgozdfpddkkuy**, us-east-2, ACTIVE_HEALTHY, acesso administrativo autenticado. CLI **2.119.0**, sem atualização automática.
- O responsável suspendeu o backup e em seguida solicitou publicar em produção. Esta publicação seguiu essa orientação mais recente. **Não foi criada/comprovada cópia externa do backup nem guarda externa da chave nesta execução.** O backup local e a chave foram preservados. A declaração de que não há usuários reais veio do responsável, sem inspeção de dados pessoais para confirmá-la.
- Nenhum deploy Vercel manual, configuração de frontend, cron duplicado, transferência de backup ou limpeza histórica foi executado.

## Pré-deploy efetivamente confirmado

Histórico remoto tinha **125 versões**, correspondentes às migrations anteriores disponíveis. A única versão local adicional era `20261027000001`. O dry-run no pacote isolado confirmou **somente `20261027000001_storage_cleanup_outbox.sql`**, sem seeds/roles e com `--skip-vault`.

O schema não tinha outbox. Colunas necessárias, constraints pertinentes e triggers existentes foram inspecionados. As oito RPCs envolvidas tinham corpos equivalentes às definições atuais das migrations; após o release, suas definições inteiras continuaram idênticas às capturadas antes. Não se declara inspeção de todo o schema fora do escopo AUD-04.

A função estava ACTIVE na **versão 6**, JWT habilitado; os dois arquivos da fonte remota correspondiam exatamente ao worker anterior esperado. A fonte foi preservada privadamente em `/tmp/aud04/worker-before`. O cron `process-deletion-jobs` era único, ativo, a cada minuto e com URL correta. Buckets `status-photos` e `profile-avatars` privados; nenhum job pending/auth_cleanup.

Os secrets padrão necessários estavam presentes. Após publicação, nomes e digests de todos os secrets continuaram iguais, sem exposição de valores. Apenas timestamps de metadados de secrets reservados foram atualizados pelo serviço durante o deploy; nenhuma chamada de configuração/rotação de secrets foi feita.

## Publicação efetiva e ordem

1. **Banco primeiro:** `supabase db push --linked --project-ref ywrjojrjgozdfpddkkuy --workdir /tmp/aud04/release-package --skip-vault --yes`. A CLI aplicou somente a migration AUD-04 pelo procedimento versionado/transacional. Não foi usado repair, escrita manual de journal, include-all, seed ou roles.
2. A consulta seguinte confirmou journal **125 → 126**, versão **20261027000001 / storage_cleanup_outbox**, tabela, dois triggers e três funções, RLS e grants corretos. Só então houve deploy da função.
3. **Worker depois:** `supabase functions deploy process-deletion-jobs --project-ref ywrjojrjgozdfpddkkuy --workdir /tmp/aud04/release-package --use-api`. Foram enviados somente `index.ts`, `processor.js` e `storage-cleanup.js`. JWT, secrets e cron preservados.
4. Listagem administrativa confirmou **ACTIVE, versão 7, verify_jwt=true**. Somente essa função mudou de versão. O download posterior dos três arquivos comprovou correspondência byte a byte com o código publicado do commit local.
5. Dry-run pós-publicação: **Remote database is up to date**, nenhuma migration pendente no pacote.

## Segurança e comportamento preservados

RLS da outbox habilitada, sem policies de cliente; owner postgres. `anon`/`authenticated` não têm SELECT/INSERT/UPDATE/DELETE/TRUNCATE nem EXECUTE em claim/finish/capture. `service_role` tem SELECT e EXECUTE em claim/finish, sem escrita direta na tabela nem EXECUTE no helper de trigger. As três funções novas são SECURITY DEFINER, owner postgres e `search_path = ''`. Os dois triggers estão habilitados.

As oito RPCs existentes, incluindo exclusão/Auth e bloqueio/revisão financeira, permaneceram idênticas. Nenhuma migration anterior foi editada. Não houve alteração de fluxo financeiro, retenção, frontend ou permissões de clientes fora da outbox.

## Verificação pós-publicação não destrutiva

| Verificação | Resultado real |
|---|---|
| Versão Edge | **7, ACTIVE, JWT habilitado** |
| Fonte publicada | Três arquivos idênticos ao pacote revisado |
| Cron | Um job, ID 3, ativo, `* * * * *`, URL correta |
| Execução da versão nova pelo cron | **Quatro respostas HTTP 200**, 12:43, 12:44, 12:45 e 12:46 UTC; sem timeout |
| Resposta sem jobs de exclusão | `queued=0`, `processed=0`, `errored=0`, `blocked=0`, `cleanupQueued=0`, `cleanupCompleted=0`, `cleanupErrored=0` |
| Outbox total | **0 tarefas** |
| pending / leased / complete / failed | **0 / 0 / 0 / 0** |
| Maior número de tentativas | **0** |
| Idade da tarefa pendente mais antiga | **Não aplicável**, nenhuma tarefa |
| Leases vencidas | **0** |
| INVALID_REFERENCE / STORAGE_RETRY / ATTEMPTS_EXHAUSTED persistidos | **0 ocorrências** |
| Crescimento no intervalo observado | **0 → 0**, de 12:43 a 12:46 UTC |
| Jobs de exclusão pending/auth_cleanup | **0** |
| Migrations pendentes após release | **Nenhuma** |

Foram consultados logs de execução de `cron.job_run_details`, respostas já registradas em `net._http_response` e métricas da outbox. As respostas confirmam que o worker novo executa o caminho de claim mesmo com deletion jobs vazios. Não houve invocação manual do worker nem criação/exclusão de usuários ou objetos reais como smoke. Logs de console do runtime hospedado não foram exportados via Logs API; não se afirma leitura desses logs. Esta observação curta comprova disponibilidade/execução da fila vazia, não uma remoção física nova em produção.

## Testes nesta etapa e limites

**Executados nesta publicação:** 11 unitários do processor e nove de Storage, todos aprovados; ESLint dos módulos, syntax checks dos scripts e diff-check aprovados. A função carregou imports no Edge Runtime v1.77.1 local e respondeu ao endpoint sintético indisponível com o erro esperado, sem portas expostas nem conexão a produção. O container descartável foi encerrado.

**Provas locais anteriores reaproveitadas, sem repetir toda a suíte sem alteração de código:** 1.888 JS; 145 funções e um skip conhecido; 568 assertions SQL; 28 verificações de SQL/worker/Auth/Storage reais locais; concorrência/recuperação 20 + 5; lint/build aprovados. Não foram tratadas como novos testes de produção.

A limpeza física, erro do SDK, retry, restart, ausência de objetos, concorrência e token antigo já tinham sido validados localmente. Como não há tarefas reais novas na outbox, não há evidência de retry/remoção física exercitados novamente em produção. Não foram enfileirados órfãos antigos nem apagados objetos retroativamente.

## Git/Vercel e próximos passos

O código publicado está registrado nos commits locais `f6e866e` e `bb47f0c`. O responsável autorizou explicitamente o push para `origin/main`, incluindo as demais alterações concluídas/revisadas, e o redeploy automático da Vercel. Antes do envio foram confirmados conta/repositório/main, ausência de divergência remota e revisão dos arquivos, sem credenciais, backups ou temporários. Nenhuma configuração Vercel será alterada e nenhuma migration ou Edge Function será reaplicada. As evidências JSON desta publicação continuam sendo snapshots das verificações remotas realizadas em 13/10/2026, 12:46 UTC; o resultado do novo push/deployment será confirmado separadamente ao concluir esta etapa.

Acompanhar as primeiras tarefas naturais, backlog/idade, erros e leases; casos failed devem permanecer disponíveis para revisão. Em incidente, preservar outbox/evidências e preparar correção progressiva; não apagar tarefas, reabrir grants ou executar rollback destrutivo. A fonte da versão 6 permanece recuperável, mas retornar ao worker antigo não escoa a fila durável.

**AUD-05 continua aberta**, inclusive a exclusão administrativa de publicação com foto existente. Não foi alterada nem declarada resolvida.

## Evidências

[VERIFICACAO_PUBLICACAO_AUD_04.json](VERIFICACAO_PUBLICACAO_AUD_04.json) contém somente metadados/contagens sanitizados desta publicação. Logs operacionais e fontes de recuperação em `/tmp/aud04/`: `production-migration.log`, `production-function-deploy.log`, `predeploy-remote.json`, `post-migration.json`, `post-worker.json`, `post-final.json`, `cron-health-final.json`, `dry-run-after.log`, `worker-before/`, `worker-after/`. Tokens, valores de secrets, backups, chaves e dados pessoais não pertencem a este relatório ou ao commit.
