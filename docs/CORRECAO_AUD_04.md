# Correção local da AUD-04 — limpeza durável de fotos

## Resultado e limites de autorização

Implementada e validada **somente localmente** a AUD-04. A limpeza agora tem estado próprio, persistido no PostgreSQL, independente da conclusão da exclusão no banco/Auth. Foram usados mocks e serviços locais reais com identidades `@example.invalid` e objetos sintéticos. Nenhum commit, push, deploy, alteração de Edge Function remota, migration remota ou exclusão de arquivo de produção foi executado.

**AUD-05 permanece aberta**: a atribuição de `photo_path` texto a `text[]` em `run_deletion_job` não foi modificada. Nenhuma outra auditoria foi corrigida. Alterações de documentação/releases e outros arquivos que já existiam no working tree foram preservadas.

## Diagnóstico do fluxo efetivo

A referência SQL foi conferida na última definição de `run_deletion_job`, em `20261005000003_case_items_traceability.sql`, e nas migrations posteriores disponíveis no repositório. A nova migration é posterior à última existente, `20261026000006_exercise_catalog_offline_converge.sql`. Não houve consulta à produção para confirmar objetos individuais ou histórico remoto.

1. `src/services/statusesService.js:createPhotoStatus` cria primeiro a linha com `statusPhotos/<community_uuid>/<status_uuid>.webp`. O upload usa XMLHttpRequest no endpoint do bucket `status-photos`, com **`<community_uuid>/<status_uuid>.webp`**. O download e o serviço de suporte também retiram o prefixo. A constraint de `statuses` e as policies de Storage confirmam esse contrato. Fotos de progresso usam o mesmo fluxo.
2. `profileAvatarService` reserva mídia via `allocate_profile_avatar`; `profile_avatar_media.storage_path` e a chave de `profile-avatars` usam `<owner_uuid>/<media_uuid>.webp`. As alocações têm registros próprios, inclusive estados `allocated`, `active`, `superseded` e `deleted`.
3. O fluxo administrativo continua passando por `queue_deletion`, bloqueio/revisão financeira quando exigido e `run_deletion_job`. A RPC trava o job com `FOR UPDATE`; conta captura fotos por autor e exclui o usuário; comunidade captura por comunidade e exclui suas publicações e linha da comunidade.
4. Conta passa para `auth_cleanup`, retornando `deleteAuthUser`; só `confirm_auth_deletion` a leva a `complete`. Reentrega em `auth_cleanup` retorna `photoPaths: []`. Comunidade/publicação passa diretamente para `complete`. `list_pending_deletion_jobs` entrega até dez jobs `pending`/`auth_cleanup`; jobs completos saem da seleção.
5. O gatilho existente `queue_deletion_on_delete` cria jobs de publicação/comunidade usando `OLD`. Seu campo `deletion_jobs.photo_path` não era usado pela remoção física. Se a linha da publicação já foi apagada, a RPC não consegue recuperar seu caminho original. O SQL de publicação ainda apresenta a AUD-05 quando tenta atribuir o texto da foto existente ao array.
6. O cron existente invoca `process-deletion-jobs` a cada minuto. Antes, o worker repassava `photoPaths` diretamente ao bucket e tratava apenas rejeições da promessa. Um resultado `{ error }` do SDK era ignorado. O worker também listava avatares por prefixo, sem verificar todos os resultados e sem persistir o inventário.

## Reprodução antes da correção

Antes de editar o worker, foi executado um mock contra uma cópia integral do original. Resultado:

```text
REPRODUCED: prefix sent unchanged; SDK error counted as success
```

As assertions verificaram `remove(['statusPhotos/c/s.webp'])`, resposta `{ error: { status: 503 } }`, `processed = 1` e `errored = 0`. A reprodução é repetível com `node scripts/verify-aud04-before.mjs`, que lê exclusivamente o blob Git original `4a7f2b3ed3fa0f3b7a297e3c59b983e792e1a072` e usa mocks. Não executa Storage real.

## Implementação

### Captura transacional e validação de escopo

A migration `20261027000001_storage_cleanup_outbox.sql` cria `storage_cleanup_tasks` e gatilhos `AFTER DELETE` em `statuses` e `profile_avatar_media`. Eles capturam `OLD` **na mesma transação** da exclusão, inclusive em cascades de conta/comunidade e na exclusão direta autorizada de publicação. Se a transação ou subtransação de `run_deletion_job` falhar, a captura também é desfeita.

O gatilho confere a referência contra os IDs da própria linha: comunidade/publicação ou dono/mídia. Uma referência sintaticamente válida apontando para outro objeto não é autorizada. Referências inválidas são registradas como `failed / INVALID_REFERENCE`, com chave nula; nunca chegam ao Storage. A outbox não possui FK com os registros removidos nem com jobs sujeitos a expiração, preservando caminhos após exclusão/restart.

A função pura `normalizePhotoPath` admite UUIDs minúsculos e extensão `.webp`, com dois segmentos. Para status admite o prefixo único `statusPhotos/` observado no contrato legado do repositório e a chave relativa; para avatar admite somente a chave relativa. Recusa prefixos duplicados, outros buckets, URLs, query strings, traversal, espaços, segmentos extras, escapes e entradas que não sejam strings. Não há suporte especulativo a outros formatos históricos. Não foi feito inventário remoto de referências legadas.

### Execução, concorrência e retentativa

O mesmo worker e cron escoam a outbox, mesmo quando não restam jobs de exclusão. Não foi criado outro agendamento, dependência ou varredura de Storage.

- Até 20 tarefas por execução, obtidas via `FOR UPDATE SKIP LOCKED` e lease de cinco minutos, com token novo a cada claim.
- Uma remoção por objeto, no bucket indicado e validado. Isso permite atribuir erro/ausência a cada tarefa e evita interpretar erro de lote como ausência de todas as fotos.
- SDK `{ error }`, promessa rejeitada ou resposta inválida impedem a conclusão. A confirmação SQL exige token atual e lease não expirado. Falha de confirmação deixa a lease recuperável.
- Resposta sem erro é sucesso. Somente códigos explícitos `NoSuchKey`/`ObjectNotFound` são aceitos como objeto já inexistente; HTTP 404 genérico e bucket ausente continuam sendo falhas. O Storage local confirmou remoção idempotente de objetos ausentes com resposta de sucesso.
- Backoff de 30, 60, 120, 240, 480, 960 e 1.920 segundos, limitado a uma hora, e máximo de oito tentativas. Tentativa, vencimento e erro ficam no banco. Oito falhas ou crash na oitava lease levam a `failed`, sem exclusão da tarefa e sem contá-la como sucesso. Erros de configuração/permissão também passam pelo limite; exigem revisão se persistirem.
- `last_error` recebe códigos fixos `STORAGE_RETRY`, `INVALID_REFERENCE` ou `ATTEMPTS_EXHAUSTED`; mensagens externas não são armazenadas na outbox ou impressas pelo worker. Logs contêm eventos/contagens e IDs técnicos de jobs, sem caminhos, nomes pessoais, tokens ou conteúdo de erros.

O contrato financeiro e os estados originais de `deletion_jobs` foram preservados. `processed` continua medindo a execução do job de banco/Auth; **não comprova limpeza física**. Os campos adicionais `cleanupQueued`, `cleanupCompleted` e `cleanupErrored`, junto com os estados da outbox, medem a limpeza. Um job pode estar `complete` enquanto sua limpeza permanece pendente ou falhou; essa separação é explícita e durável.

Avatares conhecidos são capturados pelas linhas de mídia, incluindo alocações anteriores do titular. Não se usa mais listagem paginada por prefixo para apagar objetos arbitrários. Objetos históricos sem registro de mídia exigem inventário separado.

### Segurança

RLS habilitada, sem policies de cliente; `anon`/`authenticated` não têm leitura ou escrita na outbox nem EXECUTE nas RPCs de claim/finish. `service_role` tem SELECT para inspeção e EXECUTE somente nas duas RPCs administrativas; não recebeu escrita direta na tabela. A função de trigger tem EXECUTE revogado dos papéis de cliente e serviço; dispara somente por exclusões que já passaram pelas permissões existentes. Funções novas usam `search_path = ''` e objetos qualificados.

## Arquivos da entrega

| Arquivo | Alteração |
|---|---|
| `supabase/migrations/20261027000001_storage_cleanup_outbox.sql` | Outbox, captura por triggers, grants/RLS, leases e confirmação com backoff |
| `supabase/functions/process-deletion-jobs/storage-cleanup.js` | Normalizador puro, remoção validada e tratamento de resultados/erros |
| `supabase/functions/process-deletion-jobs/storage-cleanup.test.js` | Unitários de caminhos, buckets, lotes, ausência, erros e confirmação |
| `supabase/functions/process-deletion-jobs/processor.js` | Consumo da outbox independente do retorno efêmero da RPC; logs sanitizados |
| `supabase/functions/process-deletion-jobs/processor.test.js` | Regressão Auth/jobs adaptada ao contrato durável; retomada após falha de listagem |
| `supabase/tests/storage_cleanup_outbox_test.sql` | pgTAP transacional, segurança, rollback, cascades, retries e fencing |
| `scripts/verify-aud04-before.mjs` | Reprodução dos dois defeitos originais com mocks |
| `scripts/verify-aud04-local.mjs` | SQL/worker/Auth/Storage reais exclusivamente locais |
| `scripts/verify-aud04-concurrency-local.mjs` | Transações PostgreSQL simultâneas e recuperação de leases |
| `docs/CORRECAO_AUD_04.md` | Diagnóstico, evidências, limitações e proposta de rollout |

Nenhuma migration aplicada anteriormente foi editada. Nenhum arquivo do frontend foi alterado.

## Testes e evidências reais

| Verificação | Resultado |
|---|---|
| Reprodução dos defeitos antes da correção | Ambos confirmados |
| Unitários diretos do worker | 11 passaram |
| Unitários diretos de Storage/normalização | 9 passaram |
| pgTAP AUD-04 | 34 assertions passaram |
| Regressão SQL existente | 13 suítes, 534 assertions passaram |
| Integração SQL/worker/Storage/Auth reais | 28 verificações passaram |
| Concorrência de transações PostgreSQL | 25 tarefas divididas em 20 + 5 enquanto a primeira transação mantinha locks; recuperação posterior de 20 + 5, sem perda |
| `npm test` fora do sandbox | 1.888 passaram; nenhuma falha |
| `npm run test:functions` fora do sandbox | 145 passaram; um skip existente de concorrência do push outbox (sem `PG_TEST_CONTAINER`); nenhuma falha |
| `npm run lint` | Zero erros; 14 warnings existentes |
| `npm run build` | Passou; aviso existente de chunks grandes |

A regressão SQL cobriu AUD-01/AUD-02, promoções de comunidade, revisão financeira e histórico de casos, hardening de exclusão/Auth, retenção e cancelamento de casos, compras InfinitePay, comentários, apoio/moderação, limites de texto, progresso e feed. A suíte JS cobre contratos de Auth, uploads, fotos/progresso, carteiras/EvoCash, frontend e exclusões sem foto.

A integração real validou cadastro/login Auth, upload autenticado com RLS nos dois buckets, captura após exclusão direta de publicação, exclusão de conta com foto/avatar, falha `{ error: 503 }` persistida mesmo após conclusão no Auth, bytes ainda presentes após falha, retentativa com cliente novo e workers concorrentes, remoção física, preservação de foto alheia, exclusão de comunidade, replay e objeto ausente. SQL validou rollback da outbox junto da exclusão, token inválido/antigo, backoff, recuperação de lease, falha permanente e referências suspeitas. Clientes autenticados não conseguiram enfileirar, alterar status ou executar RPCs administrativas; `anon` também foi recusado.

O caso de exclusão administrativa de **publicação com foto ainda existente** foi executado e retornou erro da AUD-05. A linha não é excluída nesse fluxo; a AUD-04 foi validada pelas exclusões de conta, comunidade e publicação diretamente autorizada. Não se declara esse cenário administrativo resolvido.

### Ambiente e reprodução

Foram iniciados os containers locais já disponíveis `evolutus_aud_postgres`, `evolutus_homolog_db`, `evolutus_homolog_storage`, `evolutus_homolog_auth` e `evolutus_homolog_rest`. O Auth precisou ser reiniciado após o banco ficar pronto. As portas são loopback; o gateway de teste não encaminha tráfego remoto. Foi confirmado nos dois bancos `cron.launch_active_jobs = off` e zero execuções em `cron.job_run_details` nas duas horas da sessão; os cadastros de cron herdados das migrations não foram executados. Os scripts agora também exigem o launcher local desligado antes de criar fixtures. Os scripts não leem `.env` nem aceitam URL remota.

A nova migration foi aplicada com `psql -1`, exclusivamente nos dois bancos locais. O ambiente de homologação já continha fixtures de testes anteriores, que não foram varridas ou removidas; o worker integrado filtrou os jobs de exclusão às novas identidades. Os dois scripts de integração/concorrência exigem outbox vazia no início e mantêm fixtures para inspeção: para repetir, usar banco local descartável limpo, com as migrations atuais aplicadas. Não execute contra produção. Há também fixtures locais de tentativas preliminares preservadas, sem limpeza automática.

Com os serviços locais preparados:

```sh
node scripts/verify-aud04-before.mjs
node supabase/functions/process-deletion-jobs/processor.test.js
node supabase/functions/process-deletion-jobs/storage-cleanup.test.js
# Aplicar a migration nova apenas no banco local, em uma transação.
docker exec -i evolutus_aud_postgres psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/storage_cleanup_outbox_test.sql
bash scripts/verify-aud-security-local.sh
node scripts/verify-aud04-local.mjs
node scripts/verify-aud04-concurrency-local.mjs
npm test
npm run test:functions
npm run lint
npm run build
```

Logs desta execução: `/tmp/aud04/` (`migration.log`, `homolog-migration.log`, `sql.log`, `regression-sql.log`, `integration.log`, `concurrency.log`, `npm-test-unsandboxed.log`, `functions-full.log`, `lint-final.log`, `build.log`). Os logs SQL detalhados de regressão estão em `/tmp/evolutus-aud-tests.Nm3SzT/`. A primeira execução JS no sandbox falhou com `EPERM` ao criar subprocessos de `businessDate`; a repetição autorizada fora do sandbox passou integralmente. O runner no sandbox apresentava contagens por arquivo; as contagens acima usam os testes diretos e a suíte completa fora dessa restrição.

## Compatibilidade, riscos residuais e rollout futuro

A migration é aditiva e não redefine `run_deletion_job`, `list_pending_deletion_jobs`, revisão financeira, ledger, retenção ou Auth. Não faz backfill histórico nem altera dados atuais de usuários. Falha ao gravar a outbox aborta a exclusão correspondente; isso evita apagar referências sem registrar uma tarefa. Novas RPCs ficam inacessíveis a clientes comuns.

Não houve deploy do runtime Deno/Edge Function; a orquestração JS foi executada via Node com Supabase SDK e serviços locais reais. Ainda é necessário validar o pacote Edge em ambiente de homologação dedicado e, após autorização, confirmar o cron e as versões remotas efetivamente publicadas. Não se afirma equivalência absoluta entre todo o estado da produção e as fixtures locais.

Riscos remanescentes: arquivos órfãos de execuções antigas não são recuperados automaticamente; referências históricas fora do formato comprovado ficam para inventário/revisão; alocações de upload sem exclusão da linha não são coletadas; tasks completas/falhas são mantidas sem política nova de purga. O limite de 20 por invocação exige acompanhar backlog. Uma operação que dure além da lease pode ser repetida; remoção por chave UUID é idempotente e a confirmação antiga é recusada. A revisão de `failed` e eventual reenfileiramento devem ser administrativos, após corrigir a causa, nunca por cliente. Não foi alterado o contrato de corridas entre uploads em andamento e exclusão da publicação.

**Proposta de rollout, ainda não autorizada/executada:**

1. Conferir por leitura o histórico remoto e a definição vigente das funções; revisar a migration e a lista exata de arquivos. Validar o pacote Edge em homologação.
2. Aplicar primeiro a nova migration em transação. Ela começa a capturar exclusões sem depender da atualização do worker; o worker anterior pode remover os mesmos objetos, e o novo consumidor depois convergirá por idempotência.
3. Publicar `process-deletion-jobs` com seus dois módulos JS. Não há mudança de frontend/Vercel nem novo cron. **Não publicar o worker antes da migration**: ele depende da outbox.
4. Acompanhar estados, idade da tarefa mais antiga, attempts e contagens `cleanup*`; alertar se houver `failed` ou backlog crescente. Confirmar que o cron segue invocando o worker mesmo sem jobs de banco pendentes.
5. Se for necessário interromper o consumidor, preservar tabela/gatilhos e o inventário; não apagar outbox ou restaurar o worker antigo como solução definitiva. Corrigir/retomar preservando as tarefas. Qualquer ação em produção requer autorização específica.

## Inventário de órfãos antigos — exclusivamente por leitura

Uma consulta de **metadados PostgreSQL** pode listar candidatos em páginas, sem percorrer bytes do Storage. Executar somente com acesso administrativo aprovado, exportar para local restrito e revisar. Ausência de referência não prova autorização para excluir: pode haver upload em andamento, importação histórica, mídia copiada/referenciada por outro recurso ou referência já apagada em execução antiga. Estes candidatos nunca são enfileirados pela migration.

Exemplo de inventário de `status-photos`, com cursor e limite; substituir os parâmetros de data/cursor após revisão:

```sql
begin transaction read only;
select o.id, o.name, o.created_at,
       j.id as historical_job_id, j.state as historical_job_state,
       t.state as cleanup_state, t.attempts, t.last_error
from storage.objects o
left join public.statuses s
  on s.photo_path = 'statusPhotos/' || o.name or s.photo_path = o.name
left join public.deletion_jobs j
  on j.kind = 'status' and j.photo_path = 'statusPhotos/' || o.name
left join public.storage_cleanup_tasks t
  on t.bucket = o.bucket_id and t.object_key = o.name
where o.bucket_id = 'status-photos'
  and o.name > :name_cursor
  and o.created_at < :review_cutoff
  and s.id is null
order by o.name
limit 200;
rollback;
```

Para `profile-avatars`, comparar os metadados paginados com `profile_avatar_media.storage_path`, `users.avatar_path` e `public_profiles.avatar_path`. Arquivos não referenciados e tasks `failed` exigem revisão humana; preservar histórico e evidências. Para casos sem `deletion_jobs.photo_path` (por exemplo, conta/comunidade antigas), o inventário de metadados e backups autorizados pode ser a única evidência restante. Este relatório não inclui comandos de remoção ou saneamento histórico.
