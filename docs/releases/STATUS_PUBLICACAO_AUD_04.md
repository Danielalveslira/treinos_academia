# Publicação AUD-04 — GO autorizado; aplicação em preparação

**GO para o release AUD-04 após confirmação remota. Backup externo suspenso por decisão do responsável; ainda não há publicação nova nesta atualização preparatória.**

As seções iniciais abaixo registram o NO-GO anterior; a atualização mais recente está ao final.

O prompt `docs/prompts/PROMPT_CODEX_RELEASE_AUD_04_EVOLUTUS.md` e o relatório `docs/CORRECAO_AUD_04.md` foram lidos integralmente. Existe autorização para publicar somente a AUD-04, condicionada à comprovação dos pré-requisitos. **A etapa de publicação foi interrompida antes de qualquer alteração de produção porque não há evidência disponível de backup recuperável externo ao Codespaces.**

## Bloqueio obrigatório

O item 1.3 do prompt exige: “Confirme backup **externo ao Codespaces**, criptografado, com chave preservada separadamente e **evidência de restauração testada**. Se não for recuperável, **NO-GO**.”

As evidências anteriores são `RECUPERACAO_E_RELEASE_AUD_EVIDENCIAS.json`, `MANIFESTO_RELEASE_AUD_01_AUD_02.md` e `STATUS_PUBLICACAO_AUD_01_AUD_02.md`. Elas documentam:

- Backup criptografado em diretório privado **dentro do Codespaces**, fora do Git, com chave separada.
- Ensaio de recuperação de 130 tabelas, Auth/financeiro/Vault e 60 objetos Storage, com comparações aprovadas.
- Necessidade de conservar cópia durável fora do ciclo de vida do Codespaces; nenhum envio a outro provedor havia sido executado naquela etapa.

Essas provas de restauração são históricas e relevantes, mas não comprovam que o arquivo e a chave estejam preservados fora deste ambiente. **Fora do Git não equivale a fora do Codespaces.** Não se afirma que um backup externo inexista; sua localização, integridade, disponibilidade da chave e vínculo com o restore testado não estão comprovados pelas evidências acessíveis nesta tentativa.

Não foram abertos dumps, chaves ou arquivos com dados pessoais. Não foi enviado backup a um provedor novo, criado plano pago ou iniciado restore de produção. Não há justificativa para tratar o backup local como cumprimento do gate externo exigido pelo usuário.

## Identidade, destinos e estado confirmado

| Verificação | Evidência desta tentativa |
|---|---|
| Branch local | `main` |
| HEAD local | `68dbeb2196e19a1a8ceaf92d2315bdd0f900ed33` |
| Origin fetch/push | `https://github.com/Danielalveslira/treinos_academia` |
| Conta GitHub | `gh auth status` confirmou **Danielalveslira** pela rede |
| Repositório remoto | `gh repo view` confirmou **Danielalveslira/treinos_academia**, branch padrão `main` |
| HEAD remoto `main` | API GitHub confirmou `68dbeb2196e19a1a8ceaf92d2315bdd0f900ed33`, igual ao HEAD local |
| Projeto Supabase esperado | `treinos_academia`, ref **ywrjojrjgozdfpddkkuy** |
| Configuração Supabase local | `supabase/.temp/linked-project.json` contém o nome/ref esperados; isso **não é confirmação administrativa remota atual** |
| CLI Supabase | Versão instalada **2.119.0**; não foi atualizada |
| Conta/projeto Supabase remotos atuais | Não consultados nesta tentativa; gate de backup impede prosseguir |
| Versão remota atual de `process-deletion-jobs` | Não consultada; nenhum número de versão presumido |
| Novo commit/versão de release | Nenhum; o HEAD citado ainda não inclui a correção AUD-04 do working tree |

As primeiras verificações de `gh auth status` e versão da CLI encontraram restrições locais de sandbox. A repetição permitida fora do sandbox confirmou autenticação GitHub e versão da CLI; não se registra erro de autenticação persistente. Nenhum token foi impresso sem mascaramento ou salvo neste relatório.

O working tree contém arquivos preexistentes não relacionados: exclusão de outro prompt, mudanças no status AUD-01/AUD-02, auditoria e evidências daquele release. Eles foram preservados e não foram incluídos em commit. A nova migration e módulos de Storage ainda estão no working tree; não houve stage, commit, push ou deploy.

## Revisão local do candidato

Escopo de publicação candidato:

- `supabase/migrations/20261027000001_storage_cleanup_outbox.sql`.
- Edge Function `process-deletion-jobs`: `index.ts` existente e módulos `processor.js` / `storage-cleanup.js`.
- Testes, scripts e relatórios da AUD-04 somente como evidências/versionamento local a revisar antes de eventual commit.

A migration é aditiva; não redefine revisão financeira, `run_deletion_job`, Auth, ledger, retenção nem outras auditorias. RLS sem policies de cliente, revogação de leitura/escrita de `anon`/`authenticated`, RPCs administrativas somente para `service_role`, captura transacional via triggers e `search_path` restrito foram conferidos no arquivo atual. Não há backfill de órfãos.

Os imports relativos `index.ts -> processor.js -> storage-cleanup.js` estão presentes. A entrada usa `Deno.env`, `Deno.serve` e o import JSR já existente do SDK. O client privilegiado usa `SUPABASE_SERVICE_ROLE_KEY`; a configuração local preserva `verify_jwt = true`. Isso constitui inspeção de código; **não comprova bundling no Edge remoto, disponibilidade/valores de secrets ou configuração JWT remota**. O cron original permanece sem alterações locais. Não foi invocada a função remota, pois ela pode executar exclusões reais pendentes.

Hashes SHA-256 dos artefatos revisados:

| Arquivo | SHA-256 |
|---|---|
| Migration `20261027000001_storage_cleanup_outbox.sql` | `0505a299066df8f014fbd3383b8bf38394edc2471ac3ae12b6fc3a919dfa7550` |
| `process-deletion-jobs/index.ts` | `514a1b948cf091d6b23843e9e0b2d6eaaf5945fd2d9731a2ed2e468ac0a98bc2` |
| `process-deletion-jobs/processor.js` | `2f368b5437e4623feb538553ff0281a2123a8014782e3a3b6f75bcb2fd67ad8e` |
| `process-deletion-jobs/storage-cleanup.js` | `151ac6b41672961c1ec4fa99ba2e8c2faa6c74e3854b202840d2b9ea2d4ad5dc` |

## Testes e verificações

**Executados novamente nesta tentativa:** 11 unitários do processor e nove de Storage/normalização, todos aprovados; `git diff --check` aprovado. Logs locais: `/tmp/aud04/release-processor.log` e `/tmp/aud04/release-storage.log`.

**Resultados da etapa local anterior, não anunciados como novos testes de release:** 1.888 JS; 145 funções aprovadas e um skip conhecido do push outbox; 34 assertions SQL da AUD-04 e 534 de regressão; 28 verificações reais locais SQL/worker/Storage/Auth; concorrência de transações 20 + 5 e recuperação sem perda; lint/build aprovados com avisos existentes. O relatório de correção e os logs `/tmp/aud04/` foram conferidos. Nenhum desses resultados confirma o estado remoto atual.

## Publicação e métricas remotas efetivas

| Item | Resultado desta tentativa |
|---|---|
| Migrations aplicadas em produção | **Nenhuma** |
| `db push` / reparo de journal | Não executados |
| Deploy da Edge Function | Não executado |
| Commit / push | Não executados |
| Deploy Vercel / frontend | Não executado |
| Histórico/schema/grants remotos | Não consultados após identificar o gate impeditivo; ausência de drift **não comprovada** |
| Registro remoto de `20261027000001` | Não consultado; não se presume aplicado ou ausente |
| Cron / secrets / JWT remotos | Não conferidos nesta tentativa |
| Versão anterior recuperável da Edge Function | Exportação/versionamento remoto ainda pendentes; Git contém fonte histórica, mas não prova equivalência ao deployment remoto atual |
| Outbox `pending`, `leased`, `complete`, `failed` | Não consultada em produção; valores **não medidos**, não iguais a zero por presunção |
| Tentativas, idade da tarefa mais antiga e crescimento | Não medidos em produção |
| Logs remotos de erros/leases | Não coletados |
| Smoke com limpeza real | Não executado; nenhuma autorização/isolamento adicional presumido |

## Condições para retomar e plano de recuperação

1. Comprovar backup criptografado em local durável **externo ao Codespaces**, com disponibilidade da chave em local separado. Informar somente metadados/evidências, nunca chaves ou tokens no chat. Demonstrar integridade da cópia externa e sua correspondência com o ponto de recuperação testado, ou realizar um ensaio isolado apropriado. Não é necessário repetir a autorização geral deste release; falta satisfazer o gate técnico.
2. Retomar as consultas administrativas somente leitura: identidade/projeto Supabase, journal/schema/grants/owners/triggers, fontes vigentes da função e cron. Fechar comparação com o repositório e exigir que a única migration pendente/aplicável seja `20261027000001_storage_cleanup_outbox.sql`. Se houver drift ou versões extras, parar e reportar.
3. Recuperar e preservar o pacote/configuração da versão anterior da Edge Function, conferir secrets por nomes/presença sem valores, validar runtime/imports e preparar a interrupção do consumidor preservando a outbox. Validar os efeitos de CI/CD antes de qualquer push: o release anterior documenta integração GitHub/main com Vercel, e não se autoriza um deploy de frontend como consequência desta tarefa.
4. Somente com todos os gates aprovados: aplicar a migration primeiro, de forma transacional e auditável pela CLI, conferir journal/objetos/ACL/RLS e depois publicar exclusivamente `process-deletion-jobs`, preservando JWT/secrets/cron. Não editar manualmente o journal.
5. Fazer verificação remota somente leitura de versão, agendamento, logs e métricas da fila. Não executar exclusão de usuários/objetos reais como teste nem limpar órfãos históricos.
6. Em incidente, interromper novas ações, preservar tarefas e evidências e preparar correção progressiva. Não apagar outbox, desfazer schema destrutivamente ou restaurar grants inseguros. Nenhum comando de rollback de produção foi executado/preparado como ação automática nesta tentativa.

**AUD-05 continua pendente**, inclusive a exclusão administrativa de publicação com foto existente. Não foi corrigida nem considerada resolvida pelo release AUD-04.


## Continuação — backup externo antes do release AUD-04

**NO-GO mantido: aguardando escolha/configuração do destino externo e, depois, comprovação da guarda separada da chave.** O novo prompt `PROMPT_CODEX_BACKUP_EXTERNO_E_RELEASE_AUD_04_EVOLUTUS.md` foi lido integralmente; a autorização de publicação continua condicionada aos gates e não precisa ser repetida.

O arquivo criptografado existente foi localizado e seu hash foi calculado novamente por leitura, sem acessar ou imprimir conteúdo pessoal:

| Item | Evidência nova |
|---|---|
| Identificador não sensível do artefato | `encrypted-release-aud-20261012` |
| Última modificação do arquivo | **12/10/2026, 18:29:10 UTC**; mtime não comprova sozinho o instante do snapshot SQL |
| Tamanho | **3.837.664 bytes** (aproximadamente 3,84 MB) |
| SHA-256 | `79d7389dfd10159e3ec31e61acb3f93ad99d6c8b8ad1c6450d06a3c6f12810d9` |
| Comparação com restore anterior | Hash **idêntico** ao registrado em `RECUPERACAO_E_RELEASE_AUD_EVIDENCIAS.json` |
| Criptografia/formato | OpenSSL com cabeçalho `Salted__`, confirmado por leitura dos primeiros oito bytes; AES-256/PBKDF2 conforme manifesto anterior. Cabeçalho isoladamente não comprova algoritmo/parâmetros; não foi feito novo ensaio criptográfico |
| Permissões do arquivo | `0600` |
| Recuperação vinculada ao mesmo hash | Evidência anterior de 130 tabelas, Auth/financeiro/Vault, 60 arquivos Storage reais e comparação da decriptação; não anunciada como novo restore nesta continuação |
| Material de recuperação local | Arquivo separado no diretório pai, com permissões `0600`; conteúdo não aberto nem exposto nesta verificação |
| Destino externo privado/autorizado | **Não identificado** nos documentos/configuração disponível |
| Configuração externa | Ausentes arquivos AWS config/credentials e variáveis específicas de destino de backup verificadas; isso não prova ausência de outros serviços, apenas não estabelece destino/autorização utilizáveis |
| Cópia externa e comparação do hash | Não executadas |
| Chave guardada fora do Codespaces | Ainda não comprovada pelo responsável |

O pacote anterior documenta dump custom do banco completo, roles/memberships, configuração e material de recuperação privados, além dos bytes de Storage; não é somente backup de metadados. O inventário local foi conferido por contagem/tipo de arquivo, sem publicar nomes dos objetos, conteúdo dos dumps, chave ou credenciais. Nenhum desses arquivos foi adicionado ao Git ou incluído nos logs.

**Recência permanece a validar.** O artefato é anterior à publicação AUD-01/AUD-02/catálogo e às operações posteriores documentadas naquele release. Não se pode afirmar que reflita todo o estado atual de produção. Após definir o destino, conferir por leitura o ponto de recuperação, as alterações posteriores e a cobertura necessária antes da AUD-04; caso insuficiente, preparar novo snapshot consistente com bytes de Storage e ensaio isolado conforme o novo prompt. Um backup antigo de hash válido não representa automaticamente o estado pré-migration atual.

Foi solicitada ao responsável a escolha entre seu computador (download seguro feito por ele) e armazenamento privado da organização com destino/acesso identificados. O item 2.2 do novo prompt determina parar antes de transferir quando não existir destino externo autorizado. A confirmação de posse da chave em local externo separado só poderá fechar o gate após ação do responsável ou mecanismo seguro autorizado; **não solicitar/colar chave no chat**.

Nenhuma transferência, criação de conta/serviço, novo snapshot de produção, migration remota, publicação de Edge Function, commit, push, alteração Vercel ou limpeza histórica foi executada nesta continuação. Backup e material de recuperação locais foram preservados. Sem alteração de código, as suítes completas não foram repetidas. O status/diff foram conferidos; os resultados locais anteriores continuam históricos.

O prompt de release anterior não está mais presente no diretório `docs/prompts` nesta continuação. Seu conteúdo já havia sido lido integralmente na etapa anterior desta mesma sessão; as restrições foram mantidas e o arquivo ausente não foi recriado nem tratado como nova autorização. O novo prompt também repete os gates essenciais.

**Ação exata pendente:** escolher/configurar destino externo privado e autorizado, sem credenciais no chat. Depois conferir recência/cobertura, transferir apenas o arquivo criptografado, comparar hashes e confirmar a guarda externa separada da chave. Somente com recuperação comprovada retomar os gates remotos e o release exclusivo da AUD-04. **AUD-05 permanece aberta.**


## Suspensão da etapa de backup pelo responsável

Registro em 13/10/2026, 12:26 UTC. O responsável pediu para não seguir com o backup no momento, informando que o Evolutus não tem usuários reais. A etapa de backup externo foi suspensa; não haverá transferência ou nova coleta enquanto essa orientação vigorar. A informação sobre ausência de usuários reais é declaração do responsável, sem nova verificação de dados de produção.

A correção AUD-04 permanece preparada localmente. Nenhuma migration remota, atualização de Edge Function, commit, push ou deploy foi executado. A suspensão do backup não foi interpretada como instrução para publicar sem os gates anteriormente exigidos; o release permanece não publicado. AUD-05 continua aberta.


## Retomada após solicitação de publicação em produção

Atualização em 13/10/2026, 12:30 UTC. Após pedir para suspender o backup, o responsável solicitou: “Vamos subir tudo a produção”. O release foi retomado exclusivamente para a AUD-04, preservando o escopo da conversa e as alterações não relacionadas. A etapa de backup externo continua suspensa conforme a orientação mais recente; não há cópia externa comprovada nem transferência de chave realizada. A afirmação de ausência de usuários reais permanece informação do responsável, sem leitura de dados pessoais para confirmá-la.

**Impedimento atual: autenticação Supabase indisponível.** `projects list` e `functions list --project-ref ywrjojrjgozdfpddkkuy` retornaram `AccessTokenRequiredError`, também fora do sandbox. Não existe `SUPABASE_ACCESS_TOKEN` no ambiente nem arquivo de token da CLI no local padrão verificado. Não foi tentado substituir a credencial administrativa por uma chave de cliente ou service role. Foi solicitado ao responsável concluir `npx supabase login` no terminal e informar somente a conclusão, sem token/código/link no chat.

Verificações novas: GitHub autenticado como Danielalveslira; `main` remoto e local no commit `68dbeb2196e19a1a8ceaf92d2315bdd0f900ed33`; origin correto; último status Vercel success confirmado; Vercel CLI autenticada como danielalveslira. Os 11 testes do processor e nove de Storage passaram novamente; ESLint dos módulos do worker, syntax checks dos scripts e diff-check aprovados. Não foi repetida a suíte completa sem mudança de código.

Pacote isolado preparado em `/tmp/aud04/release-package`, com 126 migrations para comparação do journal (125 anteriores + candidata AUD-04), configuração existente e somente os três arquivos de runtime da Edge Function. O pacote não foi aplicado ou publicado; arquivo adicional no diretório não torna migration anterior pendente/aplicável. Só se aceitará dry-run com `20261027000001` após inspeção remota. Hashes dos módulos continuam iguais à tabela deste relatório.

**CI/CD:** o status remoto confirma integração Vercel/main. Um push pode disparar frontend; ainda não houve confirmação de regra existente que o dispense. Não se presume que um marcador de commit cancele Vercel. O push fica pendente dessa decisão/verificação, conforme o limite original do release. Documentação oficial: [Ignored Build Step](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel). Nenhuma configuração Vercel foi alterada.

Migration aplicada: nenhuma. Edge Function publicada: nenhuma. Commit/push: nenhum. Métricas remotas, drift, cron e versão do worker: ainda não verificados por falta de sessão administrativa. O próximo passo é o login, seguido dos checks somente leitura e aplicação primeiro da migration, depois do worker. AUD-05 permanece aberta.


## Pré-deploy confirmado após login

O login administrativo foi confirmado com `projects list`; projeto `treinos_academia`, ref `ywrjojrjgozdfpddkkuy`, região us-east-2, ACTIVE_HEALTHY. GitHub Danielalveslira/main continua no HEAD `68dbeb2196e19a1a8ceaf92d2315bdd0f900ed33`. O responsável já havia suspendido o backup e solicitado prosseguir com a publicação; a etapa externa permanece suspensa, sem alegação de backup externo recuperável.

Consulta de produção em `BEGIN READ ONLY` confirmou 125 versões no journal, correspondentes às migrations anteriores locais, e ausência da outbox. A única versão local adicional é `20261027000001`. O dry-run da CLI 2.119.0 no pacote isolado apontou **somente `20261027000001_storage_cleanup_outbox.sql`**, sem seeds/roles e com `--skip-vault`.

As oito RPCs envolvidas foram comparadas com suas últimas definições nas migrations: corpos equivalentes após normalização de comentários/whitespace. Colunas exigidas e triggers existentes foram conferidos; buckets status-photos/profile-avatars privados; zero jobs pending/auth_cleanup. O cron `process-deletion-jobs` é único, ativo, a cada minuto, com URL correta. A função remota está **ACTIVE, versão 6, verify_jwt=true**. Seu pacote de fonte foi baixado privadamente em `/tmp/aud04/worker-before`; os arquivos index.ts/processor.js são idênticos à versão anterior esperada. Os três secrets padrão necessários estão presentes, sem leitura/divulgação de valores.

A nova função foi carregada no Edge Runtime v1.77.1 local, sem portas expostas e com chave/endpoint sintéticos. Respondeu HTTP 500 INTERNAL_ERROR ao backend sintético indisponível, com logs esperados de falha de listagem/claim: isto comprova carregamento dos imports no runtime sem executar ações em produção. Os 20 unitários afetados, ESLint dos módulos e diff-check passaram.

Antes da escrita remota, ficam registrados: journal 125; outbox inexistente; função versão 6/JWT habilitado; cron único; jobs executáveis zero. Interrupção/recuperação: preservar tabela e fila se surgir erro, não fazer rollback destrutivo; manter fonte anterior recuperável, sem presumir que voltar ao worker antigo escoe a outbox. Preferir correção progressiva do consumidor.

O push continua condicionado à decisão sobre o redeploy automático da Vercel. Foi solicitada preferência ao responsável; nenhuma configuração de frontend/Vercel foi alterada para evitar o build.
