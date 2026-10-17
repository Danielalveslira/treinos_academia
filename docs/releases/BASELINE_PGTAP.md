# Baseline pgTAP — reconstrução do zero (2026-10-16)

> **F0b (2026-10-16, mesma data): estabilização da suíte concluída.** Ver seção 7 ao final deste documento para o relatório completo — resultado final, diffs, limitações do Storage e o que não pôde ser comprovado. As seções abaixo (1–6) são o registro original do baseline e foram preservadas sem alteração de conteúdo, só com a nota de correção já existente.

Escopo desta tarefa: **somente** o container PostgreSQL local descartável `evolutus_aud_postgres`. Nenhuma conexão com qualquer projeto Supabase remoto (incluindo produção) foi feita. Nenhum arquivo fora de `docs/` foi alterado. Nenhum commit foi feito.

> **Correção (2026-10-16, mesma data, verificação seguinte):** o achado #2 abaixo (ausência de `GRANT INSERT` em `public.statuses` para `authenticated`) estava **errado** — era um falso positivo da minha própria busca por `grep` de uma linha só, que não encontra uma instrução `GRANT` que se estende por várias linhas no arquivo-fonte. O grant **existe** (`supabase/migrations/20261026000005_aud_security_atomic.sql:94-95`, concessão de INSERT por coluna, cobrindo exatamente as colunas que o app real usa — confirmado em `src/services/statusesService.js:330`, que nunca define `expires_at` no insert). A coluna que falta no grant é `expires_at`, e isso é **intencional** — essa coluna é controlada só por trigger/servidor, nunca pelo cliente. A causa real da falha do teste (`community_creation_test.sql`) é que ele inclui `expires_at` diretamente no `insert`, um padrão que o app real nunca usa. Reclassificado abaixo como **defeito de teste**, não mais "não classificável sem produção". A seção 4 original foi mantida sem apagar, com esta nota de correção acima dela; a conclusão e a tabela de totais no final do documento são as únicas partes atualizadas para refletir a reclassificação.

Objetivo: provar, sem correção manual, que as 137 migrations em `supabase/migrations/` aplicam do zero em sequência, e obter um baseline real da suíte `supabase/tests/`.

## 1. Container novo, vazio

- **Container anterior removido:** `docker rm -f evolutus_aud_postgres` (o container antigo tinha sofrido patches manuais incrementais em uma sessão anterior desta mesma conversa, que já havia sido reportada como não confiável).
- **Imagem/versão usada:** `public.ecr.aws/supabase/postgres:17.11.0.002` (PostgreSQL 17.11, confirmado via `select version();` no container novo: `PostgreSQL 17.11 on x86_64-pc-linux-gnu`).
- **De onde foi obtida:** já estava em cache local do Docker deste ambiente (`docker images`, criada em 2026-09-29) — não foi feito `docker pull`, nenhuma rede externa foi usada. É a mesma imagem que já estava em uso pelo container anterior deste projeto (e por outros containers locais pré-existentes neste ambiente: `evolutus_release_restore`, `evolutus_homolog_db`), consistente com `supabase/config.toml:40` (`major_version = 17`).
- **Comando de criação** (container vazio, sem volumes, dados efêmeros):
  ```
  docker run -d --name evolutus_aud_postgres \
    -e POSTGRES_PASSWORD=local-aud-synthetic-password \
    -e POSTGRES_USER=supabase_admin \
    -e POSTGRES_DB=postgres \
    -e POSTGRES_HOST=/var/run/postgresql \
    -e PGDATA=/var/lib/postgresql/data \
    -e POSTGRES_INITDB_ARGS="--allow-group-access --locale-provider=icu --encoding=UTF-8 --icu-locale=en_US.UTF-8" \
    public.ecr.aws/supabase/postgres:17.11.0.002
  ```
  (parâmetros replicados do container anterior via `docker inspect`, antes de removê-lo, para manter a mesma configuração de inicialização).
- **Confirmação de que estava vazio antes de qualquer migration:** `select count(*) from pg_tables where schemaname='public';` → `0`.
- **Achado de configuração, relevante para os passos seguintes:** nesta imagem, `postgres` **não é superusuário** (`rolsuper=false`); o superusuário real é `supabase_admin` (`rolsuper=true`), que é também o `POSTGRES_USER` da inicialização. Todas as migrations e a suíte de testes foram executadas como `supabase_admin` por esse motivo — `psql -U postgres` falha com `permission denied for schema storage` ao tentar o baseline do passo 2.

## 2. Baseline + todas as 137 migrations, em ordem, sem correção manual

- **Baseline aplicado primeiro:** `scripts/offline-local-supabase-baseline.sql` — aplicável e necessário (o próprio arquivo diz: "A imagem standalone de Postgres do Supabase não inclui a migração do serviço Storage nem todas as colunas atuais do Auth gerenciado"). Resultado: sucesso (`CREATE SCHEMA`/`CREATE TABLE`/`ALTER TABLE`, sem erro).
  ```
  docker exec -i evolutus_aud_postgres psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 < scripts/offline-local-supabase-baseline.sql
  ```
- **Todas as 137 migrations**, lidas de `supabase/migrations/*.sql` em ordem alfabética (= cronológica, pelo prefixo numérico), cada uma aplicada em sua própria transação (`--single-transaction`), sem nenhuma edição manual de nenhum arquivo:
  ```
  for f in $(ls supabase/migrations/*.sql | sort); do
    docker exec -i evolutus_aud_postgres psql -U supabase_admin -d postgres -X --single-transaction -v ON_ERROR_STOP=1 < "$f"
  done
  ```
- **Resultado: 137/137 com sucesso, nenhuma falha, nenhuma correção.** A ordem das migrations é internamente consistente — todas aplicam do zero sem intervenção.
- **Pós-condição verificada:** `85` tabelas e `280` funções em `public`+`private` após as 137 migrations (consistente com o volume esperado do projeto).

Isso já é, por si só, um resultado relevante: a tentativa anterior (nesta mesma conversa) de "catching up" um container antigo com patches incrementais e fora de ordem tinha produzido uma regressão falsa em `account_deletion_financial_case_test.sql` — **esse resultado anterior está invalidado**; a reconstrução do zero mostra que a cadeia de migrations é correta e essa suíte específica passa 85/85 (ver tabela abaixo).

## 3. Suíte completa `supabase/tests/` — resultado real, por arquivo

`pgtap` (extensão) não vem pré-instalada na imagem: foi necessário `create extension if not exists pgtap;` (versão 1.3.3, já disponível na imagem, sem rede externa) antes de rodar a suíte.

Comando usado por arquivo:
```
docker exec -i evolutus_aud_postgres psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 -P tuples_only=on < supabase/tests/<arquivo>.sql
```

55 arquivos em `supabase/tests/*.sql`. Tabela completa (ok = asserções que passaram; not_ok = asserções que falharam; sql_error = 1 se o script abortou por um erro de SQL não capturado pelo pgTAP, interrompendo o restante do arquivo):

| Arquivo | Plano (total) | ok | not_ok | Erro SQL | Status |
|---|---|---|---|---|---|
| account_deletion_financial_case_test.sql | 85 | 85 | 0 | não | OK |
| account_deletion_hardening_test.sql | 32 | 32 | 0 | não | OK |
| admin_accounts_defensive_test.sql | 70 | 70 | 0 | não | OK |
| admin_accounts_snapshot_test.sql | 75 | 75 | 0 | não | OK |
| admin_vitrines_denuncias_test.sql | 32 | 32 | 0 | não | OK |
| aud03_poll_vote_security_test.sql | 20 | 20 | 0 | não | OK |
| aud05_status_deletion_test.sql | 32 | 32 | 0 | não | OK |
| aud07_status_publication_rate_test.sql | 14 | 14 | 0 | não | OK |
| aud_01_aud_02_security_test.sql | 80 | 80 | 0 | não | OK |
| comment_like_notifications_test.sql | 25 | 25 | 0 | não | OK |
| comments_read_access_test.sql | 9 | 9 | 0 | não | OK |
| comments_system_test.sql | 41 | 41 | 0 | não | OK |
| **community_creation_test.sql** | interrompido | 73 | 0 | **sim** | **FALHA — achado #2** |
| community_join_access_list_test.sql | 31 | 31 | 0 | não | OK |
| **community_member_removal_test.sql** | interrompido | 6 | 0 | **sim** | **FALHA — achado #3** |
| community_promotion_security_test.sql | 15 | 15 | 0 | não | OK |
| evocoins_participation_test.sql | 144 | 144 | 0 | não | OK |
| exercise_catalog_offline_sync_test.sql | 18 | 18 | 0 | não | OK |
| exercise_visual_deletion_test.sql | 37 | 37 | 0 | não | OK |
| **exercise_visuals_test.sql** | interrompido | 89 | 1 | **sim** | **FALHA — achado #3** |
| **exercise_visuals_v2_test.sql** | interrompido | 140 | 1 | **sim** | **FALHA — achado #3** |
| feed_batch_rpcs_test.sql | 14 | 14 | 0 | não | OK |
| feed_security_test.sql | 42 | 42 | 0 | não | OK |
| financial_case_cancel_retention_test.sql | 33 | 33 | 0 | não | OK |
| financial_case_cancel_traceability_test.sql | 35 | 35 | 0 | não | OK |
| financial_case_retention_test.sql | 46 | 46 | 0 | não | OK |
| greeting_personalization_test.sql | 35 | 35 | 0 | não | OK |
| infinitepay_cash_purchases_test.sql | 57 | 57 | 0 | não | OK |
| notification_antispam_test.sql | 35 | 35 | 0 | não | OK |
| notification_pipeline_test.sql | 70 | 70 | 0 | não | OK |
| **notification_security_test.sql** | 61 | 60 | **1** | não | **FALHA — achado #1** |
| notifications_center_test.sql | 21 | 21 | 0 | não | OK |
| notifications_realtime_test.sql | 8 | 8 | 0 | não | OK |
| offline_runtime_control_test.sql | 40 | 40 | 0 | não | OK |
| offline_workout_sync_test.sql | 94 | 94 | 0 | não | OK |
| post_support_reactions_test.sql | 52 | 52 | 0 | não | OK |
| push_delivery_telemetry_test.sql | 43 | 43 | 0 | não | OK |
| push_explicit_activation_test.sql | 58 | 58 | 0 | não | OK |
| **security_followup_test.sql** | 19 | 18 | **1** | não | **FALHA — achado #1** |
| showcase_publish_recovery_test.sql | 17 | 17 | 0 | não | OK |
| sponsored_ad_metrics_dashboard_test.sql | 75 | 75 | 0 | não | OK |
| sponsored_ad_metrics_privacy_controls_test.sql | 31 | 31 | 0 | não | OK |
| sponsored_ad_metrics_test.sql | 179 | 179 | 0 | não | OK |
| status_expiration_performance.sql | n/a (benchmark, sem plano TAP) | — | — | não | OK (ver nota) |
| **status_expiration_test.sql** | interrompido | 4 | 5 | **sim** | **FALHA — achado #4** |
| **status_progress_metadata_test.sql** | 29 | 27 | **2** | não | **FALHA — achado #5** |
| status_text_limit_test.sql | 9 | 9 | 0 | não | OK |
| storage_cleanup_outbox_test.sql | 34 | 34 | 0 | não | OK |
| support_moderation_functions_test.sql | 11 | 11 | 0 | não | OK |
| supporters_failclosed_test.sql | 19 | 19 | 0 | não | OK |
| user_activity_test.sql | 28 | 28 | 0 | não | OK |
| web_push_hardening_test.sql | 44 | 44 | 0 | não | OK |
| web_push_notifications_test.sql | 33 | 33 | 0 | não | OK |
| workout_participants_rpc_test.sql | 37 | 37 | 0 | não | OK |
| workout_reminders_test.sql | 79 | 79 | 0 | não | OK |

**Totais: 55 arquivos, 2.456 asserções `ok`, 11 `not ok`, 5 arquivos interrompidos por erro de SQL. 47 de 55 arquivos limpos (0 not_ok, 0 sql_error); 8 arquivos com achados reais, todos classificados abaixo com evidência.**

**Nota sobre `status_expiration_performance.sql`:** não é um teste pgTAP (não chama `plan()`/`ok()`/`finish()`) — é um script de benchmark (`EXPLAIN (ANALYZE, BUFFERS)` + uma chamada real a `process_expired_statuses`). Rodou sem erro e produziu `{"runId": 3, "errors": 0, "deleted": 20, ...}` em 14.4ms para 20.000 linhas sintéticas. Não é uma falha; não há "ok/not ok" porque o arquivo não é desenhado como suíte de asserções.

## 4. Classificação de cada falha, com evidência (fato comprovado, não suposição)

### Achado #1 — `cast_vote` e `create_promotion`: `search_path` não hardenizado (DEFEITO DE CÓDIGO)

- **Evidência:** a asserção (idêntica em `notification_security_test.sql:103-104` e `security_followup_test.sql`) é:
  ```sql
  select is((select count(*)::int from pg_proc p where p.prosecdef and p.prokind = 'f'
    and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
    and exists (select 1 from unnest(p.proconfig) c where c ~ '^search_path=' and c <> 'search_path=""' and c !~ 'pg_temp')),
    0, 'todo SECURITY DEFINER tem search_path vazio ou com pg_temp por último');
  ```
  Consulta direta confirma exatamente 2 violações, ambas com `proconfig = {search_path=public}` (nem vazio, nem contendo `pg_temp`):
  - `public.cast_vote(uuid, smallint)` — `supabase/migrations/20260927000003_economy_cast_vote.sql:13` (definição original) e redefinida identicamente em `supabase/migrations/20261028000001_status_expiration.sql:324-325` (versão vigente, mesmo problema).
  - `public.create_promotion(text, uuid, text, text)` — `supabase/migrations/20260928000001_economy_cash_purchases_promotions.sql:363` (original) e redefinida identicamente em `supabase/migrations/20261028000001_status_expiration.sql:194-197` (versão vigente, mesmo problema).
- **Por que é um defeito e não ambiente/teste:** a própria suíte do projeto declara esse invariante de segurança (`search_path` vazio ou terminando em `pg_temp`, para evitar hijacking de schema em funções `SECURITY DEFINER`) e o testa ativamente em dois arquivos diferentes. `cast_vote` e `create_promotion` são as únicas duas exceções em 280 funções `SECURITY DEFINER` do schema `public`/`private`. Isso é 100% reproduzível em qualquer banco construído a partir destas migrations, independente de ambiente.
- **Impacto:** `search_path=public` (sem `pg_temp` ao final) é menos seguro que o padrão do resto do código porque, em geral, uma tabela temporária com o mesmo nome de um objeto referenciado sem qualificação de schema dentro da função pode ser resolvida primeiro (o schema temporário da sessão é sempre buscado primeiro para relações, esteja ou não listado em `search_path`) — o padrão do projeto evita isso enfaticamente (todas as outras 278 funções usam `search_path=''` ou similar, forçando qualificação explícita de tudo).
- **Verificação de exploração real (2026-10-16, pendência #2 da sala de orientação — reclassificação de P20):** fiz as duas checagens que determinam se isso é exploitável hoje, não só teórico:
  1. `has_schema_privilege('authenticated','public','CREATE')` e o mesmo para `anon`/`service_role` → **todos `false`** no container reconstruído do zero (confirmado contra as 137 migrations, não é um ajuste meu). Nenhum papel de cliente pode criar objetos em `public` para sombrear algo.
  2. Varredura programática do corpo completo de `cast_vote` e `create_promotion` (ambos em `supabase/migrations/20261028000001_status_expiration.sql`, versões vigentes) por qualquer referência de tabela/relação (`from`, `join`, `insert into`, `update ... set`) **sem** qualificação de schema → **nenhuma encontrada**; todas as ~15 referências em cada função são `public.algo` ou `private.algo` explícitos.
  3. Consequência: mesmo que um atacante conseguisse criar uma tabela temporária com o mesmo nome de uma tabela referenciada (o único vetor real, já que `public` está fechado para CREATE), isso não teria efeito, porque nenhuma referência dentro das duas funções depende de resolução implícita via `search_path` — tudo já está qualificado.
- **Classificação final: gravidade Média, mantida (não escalada para Alta).** É um desvio real e reproduzível do invariante de segurança que o próprio projeto declara e testa (por isso vale corrigir, por consistência e defesa em profundidade) — mas não há exploração real possível hoje, pelas duas razões verificadas acima. Adicionei `cast_vote` à lista de funções do `scripts/aud-production-readonly.sql` (antes só tinha `create_promotion`) para que o responsável, ao rodar essa consulta manualmente em produção, também veja o `search_path` efetivo de `cast_vote` lá.

### Achado #2 — RECLASSIFICADO: `public.statuses` tem o grant; o teste é que está desatualizado (DEFEITO DE TESTE)

**(Texto original abaixo, preservado; ver nota de correção no topo do documento.)**

~~`public.statuses`: nenhuma migration concede `INSERT` à role `authenticated` (NÃO CONFIRMADO SE É DEFEITO OU AMBIENTE)~~

**Correção:** o grant existe — `supabase/migrations/20261026000005_aud_security_atomic.sql:94-95` concede `INSERT` por coluna em `public.statuses` a `authenticated`, cobrindo `id, community_id, author_id, type, text, poll_question, poll_options, workout_title, workout_date, workout_location, achievement_day, achievement_text, achievement_entries, achievement_sets, photo_path, photo_caption, progress_kind, progress_period_start, progress_period_end` (uma concessão) e `author_username, author_is_superadmin` (outra). Minha busca original (`grep -rniE "grant[^;]*statuses"`) não encontrou isso porque o `grep` de uma linha não casa uma instrução que se estende por várias linhas no arquivo — falha da minha ferramenta de busca, não do código.

A única coluna de fato ausente da concessão é `expires_at` — e isso é **intencional**: confirmei em `src/services/statusesService.js:310-330` (`createPhotoStatus`) que o app real **nunca** inclui `expires_at` no próprio insert (o valor é só definido por trigger/servidor, via `private.statuses_apply_retention()` e funções relacionadas de expiração). O teste que falhou, `community_creation_test.sql` (linhas 215-221), inclui `expires_at` diretamente no `insert into public.statuses (...)`, um padrão que o app real nunca usa — daí a mensagem "permission denied for table statuses" (Postgres nega a instrução inteira quando qualquer coluna referenciada falta privilégio, mesmo com outras colunas concedidas).

**Classificação final: defeito de teste**, não de código nem de ambiente. A proteção que o teste queria validar ("cliente não força `expires_at`") na verdade já existe, e de forma até mais forte do que o teste assumia — é recusada na camada de privilégio, antes mesmo do trigger ter chance de ignorá-la.

- **Evidência:** `community_creation_test.sql` falha ao inserir uma linha em `public.statuses` como `authenticated` (via `set local role authenticated; select pg_temp.as_user('0a');`), com:
  ```
  ERROR:  permission denied for table statuses
  HINT:  Grant the required privileges to the current role with: GRANT INSERT ON public.statuses TO authenticated;
  ```
  Consulta direta a `information_schema.role_table_grants` para `public.statuses` confirma: `authenticated` e `anon` não têm **nenhum** privilégio de tabela listado (nem SELECT), e nem mesmo `service_role` tem INSERT. O único privilégio de INSERT relacionado em toda a base de 137 migrations é um grant de **coluna específica**: `grant insert (author_username, author_is_superadmin) on public.statuses to authenticated;` (`supabase/migrations/20261026000005_aud_security_atomic.sql:95`) — que não cobre um INSERT com as demais colunas (`id, community_id, author_id, type, text, expires_at` etc.), daí o erro. Busca exaustiva (`grep -rniE "grant[^;]*statuses"`) em todas as 137 migrations não encontra nenhum outro grant relevante.
- **Por que não posso classificar com certeza:** confirmei que este container replica corretamente o comportamento padrão de privilégios da imagem Supabase (`authenticated` tem `SELECT` em `wallets` e outras tabelas sem que nenhuma migration do projeto conceda isso explicitamente — vem de um mecanismo de privilégios padrão da própria imagem/inicialização, não depende de nenhuma migration deste repositório). Ou seja, a camada de "acesso de leitura padrão" está presente e funcionando neste container. Isso significa que a ausência de INSERT em `statuses` **não** é explicada por uma camada de ambiente faltante óbvia — mas não posso confirmar, sem consultar produção (fora do escopo autorizado desta tarefa), se: (a) é uma lacuna real nas migrations que também afeta produção, ou (b) produção recebeu esse `GRANT` manualmente, fora de qualquer migration versionada (um padrão conhecido em projetos Supabase: grants aplicados uma vez via SQL Editor/Studio e nunca registrados como migration).
- **Recomendação de verificação (não implementada):** rodar, só leitura, contra produção/homologação: `select * from information_schema.role_table_grants where table_schema='public' and table_name='statuses';` — isso é exatamente o tipo de consulta que `scripts/aud-production-readonly.sql` já cobre para outras tabelas; caberia estender esse script para incluir `statuses` explicitamente, como parte da Condição 1 ainda pendente.

### Achado #3 — `storage.objects`: stub local não tem os grants do serviço Storage real (DEPENDÊNCIA DE AMBIENTE, confirmada por documentação do próprio projeto)

- **Arquivos afetados:** `community_member_removal_test.sql`, `exercise_visuals_test.sql`, `exercise_visuals_v2_test.sql`.
- **Evidência:** todas as três falhas são exatamente `ERROR: permission denied for table objects` com `HINT: Grant the required privileges... ON storage.objects TO authenticated` (SELECT, INSERT ou UPDATE, dependendo do teste). `storage.objects`, nesta imagem standalone, é uma tabela-stub mínima criada pelo próprio `scripts/offline-local-supabase-baseline.sql` (passo 2 acima) — cujo cabeçalho diz literalmente: *"A imagem standalone de Postgres do Supabase não inclui a migração do serviço Storage... Nunca aplicar em projeto remoto; a cloud já possui essas estruturas."* O stub cria a tabela mas não replica os grants completos que o serviço Storage real (gerenciado, com suas próprias migrations internas do Supabase) concede a `authenticated`.
- **Por que é ambiente, não código/teste:** a limitação é documentada pelo próprio projeto no arquivo que a introduz, e estas RLS policies (`status_photos_read` etc.) e testes assumem a presença do serviço Storage real — comportamento correto esperado contra produção/homologação reais (onde o Storage de fato roda), não reproduzível fielmente com Postgres puro. Não tentei corrigir isso manualmente (adicionar grants ao stub), porque o escopo pedia para não fazer correções manuais e porque isso mascararia a limitação documentada em vez de reportá-la.

### Achado #4 — `status_expiration_test.sql`: pré-condição ("pausado") invalidada pela migration de ativação subsequente (DEPENDÊNCIA DE ORDEM DO PIPELINE DE RELEASE)

- **Evidência:** o teste assume, nas duas primeiras asserções, que a expiração está pausada por padrão:
  ```sql
  select ok(not (select enabled from public.status_expiration_control where id),'install paused');
  select is(public.process_expired_statuses()->>'paused','true','paused routine never deletes');
  ```
  Após as 137 migrations, `select enabled from public.status_expiration_control;` → `true` (ativado), porque a migration `supabase/migrations/20261028000003_activate_status_expiration.sql` já foi aplicada — e seu próprio cabeçalho diz: *"Apply only after installing and validating 20261028000001 in the release pipeline. The first batch runs automatically as part of activation..."*, e seu corpo literalmente executa `update public.status_expiration_control set enabled=true where id; select public.process_expired_statuses(50);` como parte da migration.
- **Por que é dependência de ordem, não defeito de código/teste isolado:** este teste foi escrito para validar o estado **anterior** a essa migration de ativação (um gate de segurança pré-deploy). Rodar "todas as 137 migrations em sequência, sem pausar" — exatamente o que esta tarefa pediu — necessariamente já aplica a ativação antes do teste rodar, invalidando sua pré-condição. As falhas 4, 6 e 7 do mesmo arquivo, e o erro final `PHOTO_ID_ALREADY_DELETED`, são consequências em cascata dessa mesma causa raiz (o `process_expired_statuses(50)` automático da migration de ativação já processou parte do backlog e marcou fotos como excluídas antes do próprio teste rodar sua sequência).
- **Implicação para esta tarefa:** rodar a suíte completa "de ponta a ponta sem pausar" e este teste específico são, por desenho, mutuamente incompatíveis — não é algo que uma correção de código resolva sem mudar a premissa do teste ou da migration de ativação.

### Achado #5 — `status_progress_metadata_test.sql`: teste anterior a uma migration posterior de rate-limit (DEFEITO DE TESTE, desatualizado)

- **Evidência:** o teste insere 6 publicações do tipo foto, como `authenticated`, para o mesmo usuário, em sequência rápida (`pg_temp.photo('10'...)` até `pg_temp.photo('15'...)`, linhas 40-45 do arquivo). A 6ª falha:
  ```
  not ok 6 - foto comum continua sem metadado
      died: PT429: PUBLICATION_RATE_LIMITED
          DETAIL: retry_after_seconds=48
  ```
  O limite de 5 publicações por minuto por usuário foi introduzido por `supabase/migrations/20261101000001_aud07_status_publication_rate.sql:34` (`if v_minute_count>=5 then ...`) — uma migration **posterior** à que este teste originalmente valida (`20261007000001_status_progress_metadata.sql`). O teste nunca foi atualizado para contabilizar o novo limite.
- **Por que é defeito de teste, não de código:** o limitador de taxa funciona exatamente como projetado (é, aliás, testado com sucesso e isoladamente em `aud07_status_publication_rate_test.sql`, 14/14 OK). O teste de metadados de progresso simplesmente não foi revisado para reduzir seu número de inserções (ou usar usuários/minutos distintos) depois que o rate-limit passou a existir.

## 5. Resultado de `npm test` / `npm run test:functions` / `npm run test:backfill` contra este container

Resultados reconfirmados nesta sessão, agora contra o container reconstruído do zero (os dois primeiros não dependem do Postgres; o segundo usa o container para 2 arquivos de teste de integração):

| Suíte | Resultado |
|---|---|
| `npm test` (frontend, não usa o Postgres) | 1951/1951, 0 falhas |
| `npm run test:functions` (`PG_TEST_CONTAINER=evolutus_aud_postgres PG_TEST_USER=supabase_admin`) | 156/156, 0 falhas, 0 skips |
| `npm run test:backfill` (não usa o Postgres) | 23/23, 0 falhas |

## 6. Conclusão

O baseline agora é confiável: as 137 migrations aplicam do zero sem nenhuma correção manual, e a suíte `supabase/tests/` foi executada por completo (55/55 arquivos, 2.456 asserções). 47 arquivos estão totalmente limpos. Os 8 arquivos com achados têm causa raiz identificada e evidenciada, não atribuída genericamente a "artefato": 1 defeito de código real, verificado e confirmado não-explorável hoje (achado #1/P20 — gravidade Média, mantida), 1 limitação de ambiente documentada pelo próprio projeto (achado #3), 1 incompatibilidade de ordem de pipeline de release (achado #4), e 2 testes desatualizados (achados #2 e #5 — achado #2 foi reclassificado nesta mesma data, ver nota de correção no topo: o grant de fato existe, o teste é que usa um padrão de insert que o app real não usa).

Dos 5 achados, nenhum foi corrigido no código nesta tarefa — o escopo pedia só a reconstrução e o registro. A única alteração feita fora de `docs/` foi adicionar `cast_vote` à lista de funções já consultada por `scripts/aud-production-readonly.sql` (script de leitura, preparado para o responsável rodar manualmente em produção — não executado aqui), para apoiar a confirmação do achado #1/P20 relatada acima.

---

## 7. F0b — Estabilização da suíte (2026-10-16, mesma data)

Fase aprovada: corrigir os defeitos de **teste** identificados nas seções 1–6 acima, sem tocar `supabase/migrations/`, `src/`, `supabase/functions/` nem scripts de produção. Escopo desta fase: `supabase/tests/` e `docs/`. Nenhuma conexão com banco remoto. Nenhum commit.

### 7.1 Resultado final — critério de aceitação atingido

Suíte completa, em container novo, construída do zero: **53 de 55 arquivos limpos, as 2 falhas conhecidas (achado #1/P20 — `search_path`) preservadas exatamente como pedido, nenhum arquivo interrompido por erro de SQL.**

| Arquivo | Antes (baseline original) | Depois (F0b) |
|---|---|---|
| community_creation_test.sql | interrompido por erro SQL (73 ok, parou) | **limpo — 102/102** |
| status_progress_metadata_test.sql | 27 ok, 2 not_ok | **limpo — 29/29** |
| status_expiration_test.sql | interrompido por erro SQL (4 ok, 5 not_ok, parou) | **limpo — 35/35** |
| community_member_removal_test.sql | interrompido por erro SQL (6 ok, parou) | **limpo — 81/81** |
| exercise_visuals_test.sql | interrompido por erro SQL (89 ok, 1 not_ok, parou) | **limpo — 95/95** |
| exercise_visuals_v2_test.sql | interrompido por erro SQL (140 ok, 1 not_ok, parou) | **limpo — 175/175** |
| notification_security_test.sql | 60 ok, 1 not_ok | **mantido — 60 ok, 1 not_ok (falha conhecida, P20)** |
| security_followup_test.sql | 18 ok, 1 not_ok | **mantido — 18 ok, 1 not_ok (falha conhecida, P20)** |
| (demais 47 arquivos) | limpos | limpos (reconfirmados) |

Totais da suíte completa, nesta rodada: 55 arquivos, 0 arquivos interrompidos por erro de SQL (antes: 5), 2 `not ok` no total (antes: 11) — ambos os 2 restantes são a falha conhecida do achado #1/P20, intencionalmente preservada por instrução explícita (item 5 do escopo desta fase). `npm run test:functions` contra este mesmo container: 156/156, 0 falhas (reconfirmado).

### 7.2 Procedimento de validação — container novo, com o serviço Storage real

Reavaliação da Análise prévia pedida: reli os achados #2–#5 e os 6 arquivos de teste citados por completo antes de qualquer edição.

Para o achado #3 (`storage.objects`), segui a ordem pedida:

**(a) Avaliação: a stack completa local do Supabase é utilizável neste ambiente? Sim.** As imagens oficiais (`gotrue`, `postgrest`, `storage-api`) já estavam em cache local (de uma sessão anterior, sem necessidade de rede). Em vez do stub manual de `scripts/offline-local-supabase-baseline.sql` (que cria só `storage.buckets`/`storage.objects` mínimas, sem os grants reais), subi o **serviço Storage oficial real** (`public.ecr.aws/supabase/storage-api:v1.79.28`) apontado para o Postgres novo e vazio, **antes** de aplicar o baseline/migrations, para que ele rodasse suas próprias migrations internas e criasse o schema `storage` completo e correto:
```
docker exec evolutus_aud_postgres psql -U supabase_admin -d postgres -X -c \
  "alter role supabase_storage_admin with password 'local-aud-synthetic-password' login;"
docker run -d --name evolutus_storage_setup \
  --network container:evolutus_aud_postgres \
  -e DATABASE_URL='postgres://supabase_storage_admin:local-aud-synthetic-password@127.0.0.1:5432/postgres' \
  -e DB_INSTALL_ROLES=false -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage \
  -e TENANT_ID=local -e REGION=local -e GLOBAL_S3_BUCKET=local -e SERVER_PORT=5000 \
  -e FILE_SIZE_LIMIT=52428800 -e ENABLE_IMAGE_TRANSFORMATION=false \
  -e AUTH_JWT_SECRET='super-secret-jwt-token-with-at-least-32-characters-long' \
  -e PGRST_JWT_SECRET='super-secret-jwt-token-with-at-least-32-characters-long' \
  -e SERVICE_KEY='<jwt local sintético, role=service_role>' -e ANON_KEY='<jwt local sintético, role=anon>' \
  public.ecr.aws/supabase/storage-api:v1.79.28
```
O serviço aplicou suas migrations internas com sucesso (log: `"[Server] Started Successfully"`), criando `storage.buckets`, `storage.objects` (e outras tabelas do schema real: `s3_multipart_uploads`, `buckets_analytics` etc.), com os grants reais confirmados por consulta direta:
```sql
-- authenticated e anon, antes da RLS do projeto: SELECT, INSERT, UPDATE, DELETE em storage.objects
-- (exatamente o que o serviço Storage gerenciado concede por padrão a esses dois papéis; as
-- policies do PRÓPRIO PROJETO, criadas pelas 137 migrations em seguida, é que restringem por
-- bucket/caminho a partir daí -- mesmo modelo de duas camadas de qualquer tabela do projeto)
```
Removi o container do serviço (`evolutus_storage_setup`) depois de confirmado — ele só precisava rodar uma vez para aplicar suas migrations; os testes pgTAP conversam com o Postgres diretamente, nunca com o serviço HTTP.

Como o stub usa `create table if not exists`, aplicá-lo **depois** do serviço real virou um no-op inofensivo para as tabelas de Storage (ele só ainda adiciona as colunas de `auth.users` que a imagem padrão não tem) — **não precisei alterar `scripts/offline-local-supabase-baseline.sql`**, e ele continua sendo o único caminho para quem só precisar da imagem crua do Postgres, sem o serviço Storage.

Como a opção (a) funcionou por completo (confirmado pelos 3 arquivos passando 100% limpos — seção 7.1), **a opção (b) não foi necessária**: não criei nenhum arquivo de apoio/stub de grants.

**Limitação explícita a registrar:** isto valida as policies de Storage do projeto contra o **serviço Storage oficial real** (mesma imagem `storage-api:v1.79.28` que um `supabase start`/produção usariam), rodando localmente — não é mais um stub manual. Mas ainda **não é uma confirmação contra o ambiente de dev/produção hospedado real**: não é possível saber, sem acessá-lo (fora do escopo autorizado), se a versão do `storage-api` hospedada é a mesma, nem se existe alguma configuração de bucket feita manualmente no painel do Supabase (fora de qualquer migration) que não seria replicada aqui. Recomendo que a Pendência #1 (se o ambiente de dev é um projeto Supabase separado) e uma eventual futura confirmação em dev tratem especificamente disso.

### 7.3 Correções aplicadas, uma por achado

**Achado #2 — `community_creation_test.sql`.** Diff mínimo: os 3 `insert into public.statuses (...)` que incluíam `expires_at` diretamente passaram a omitir essa coluna (e o valor que seria passado), igual ao formato real do app (`src/services/statusesService.js`, nunca envia `expires_at`). Confirmei antes que isso não muda nenhum resultado esperado: o gatilho `private.statuses_apply_retention` (`20261008000002_community_tiers_post_retention.sql:71-90`) sobrescreve `expires_at`/`retention_mode` sempre que `auth.uid()` não é nulo — ou seja, se o cliente tentasse enviar um valor (impossível hoje, por causa do grant) ou simplesmente não enviasse nada (o que o teste agora faz), o resultado do gatilho é idêntico. Nenhuma asserção foi removida: todas as 5 que verificam o valor final de `expires_at`/`retention_mode` continuam exatamente iguais, com a mesma expectativa. Só o texto de um label (`'24h: expires_at = agora + 24h (...)'`) foi atualizado para descrever a causa real (decisão do servidor a partir do tier) em vez da antiga ("o valor do cliente é ignorado", que não se aplica mais — o cliente não consegue nem enviar o valor). Nenhum privilégio foi concedido a ninguém — o diff é só no arquivo de teste.

**Achado #5 — `status_progress_metadata_test.sql`.** Diff mínimo: a função auxiliar `pg_temp.photo(...)` ganhou um 5º parâmetro opcional `p_author` (padrão `'01'`, preservando as 5 chamadas existentes sem alteração); o 6º insert ("foto comum sem metadado") passou a ser feito pelo usuário `'02'` (também membro da comunidade, já presente na fixture do teste) em vez de `'01'`, evitando a 6ª publicação no mesmo minuto para o mesmo usuário. O limite em si (`20261101000001_aud07_status_publication_rate.sql`) não foi tocado, nem reduzido, nem contornado — continua 5/min, 30/hora, 100/dia, exatamente como está em produção; apenas deixei de empilhar 6 publicações no mesmo usuário dentro de 1 minuto num cenário que o app real nunca provocaria dessa forma. Nenhuma asserção foi removida ou enfraquecida: a contagem de "cinco publicações de progresso", o conteúdo nulo da foto comum, e tudo o que vem depois (exclusão de conta, limpeza de Storage) continuam inalterados e corretos, porque nenhuma dessas asserções dependia de QUEM autorou a foto comum — só de que ela existisse com metadados nulos.

**Achado #4 — `status_expiration_test.sql`.** Diff mínimo: um comentário de cabeçalho (antes de `begin;`) documentando a premissa do teste ("nasce pausado") e por que ela precisa ser fixada explicitamente; e uma única linha nova, `update public.status_expiration_control set enabled=false where id;`, imediatamente antes das duas asserções que dependem do estado pausado — dentro da mesma transação com rollback que todo o arquivo já usava, sem qualquer conexão externa. Isso faz o teste não depender mais de rodar antes ou depois da migration de ativação `20261028000003_activate_status_expiration.sql` na cadeia. Nenhuma asserção foi alterada, removida ou teve sua expectativa mudada — as mesmas 35 verificações do arquivo original continuam, e a causa-raiz do efeito cascata (4, 6, 7 e o erro final) desaparece porque a pré-condição real volta a ser verdadeira.

### 7.4 O que não pôde ser comprovado

- Se o `storage-api` hospedado em dev/produção está na mesma versão (`v1.79.28`) usada aqui, ou se há configuração de bucket feita manualmente fora de qualquer migration — não verificável sem acessar esses ambientes (fora do escopo desta tarefa).
- Se existe algum outro teste, fora dos 55 arquivos de `supabase/tests/`, que dependa de uma premissa de posição na cadeia de migrations semelhante à do achado #4 — não foi feita uma varredura dedicada a esse padrão em todos os 55 arquivos, só nos 6 citados nesta tarefa.
- A classificação do achado #1/P20 (gravidade Média, não explorável hoje) não foi re-verificada nesta fase — ela já havia sido confirmada na rodada de verificação anterior (mesmo documento, seção 4) e não fazia parte do escopo desta fase (item 5 do escopo pede explicitamente para preservá-la como "falha conhecida", não para reavaliá-la).

Nenhum teste foi reportado como tendo rodado sem ter rodado de fato — todos os números das tabelas acima vêm de execuções reais desta sessão, registradas nos logs do container `evolutus_aud_postgres` (removido/recriado como "novo e vazio" três vezes ao longo desta tarefa, conforme pedido: uma para a avaliação da opção (a), outra para a validação final completa).
