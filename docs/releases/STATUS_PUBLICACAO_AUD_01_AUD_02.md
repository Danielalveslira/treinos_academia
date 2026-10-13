# Publicação AUD-01 / AUD-02 e catálogo offline

**PUBLICADO — confirmado em 12/10/2026, 19:47 UTC.** Banco e frontend publicados, com verificações de produção aprovadas. A autorização já existente foi utilizada; nenhuma proteção foi desativada para publicar.

## Commit, destinos e deployment

- Commit: **68dbeb2196e19a1a8ceaf92d2315bdd0f900ed33** (`fix: protege autoria e exclusão e converge catálogo offline`). Push confirmado em `Danielalveslira/treinos_academia`, branch main.
- Supabase: **ywrjojrjgozdfpddkkuy**, projeto treinos_academia, organização confirmada, plano Free.
- Vercel: **prj_WYVlCGYu021KZCrqfp62qRH2cbIE**, equipe danielalvesliras-projects, vínculo GitHub/main confirmado.
- Deployment: **dpl_74CPRcqrKiuMWbgAnZTBMDkjNGxp**, target production, **READY**, SHA igual ao commit acima.
- URL pública: **https://treinosacademia-ten.vercel.app**.
- URL específica: **https://treinosacademia-mt6p5yywk-danielalvesliras-projects.vercel.app**.

## Migrations efetivamente aplicadas em produção

1. **20261026000005_aud_security_atomic.sql** — quatro fontes AUD executadas em uma única transação da CLI, com limites lock 5 s/statement 60 s. Bloqueia rollback destrutivo, endurece INSERT/UPDATE e autoria, preserva dicas legadas e protege promoção de comunidades.
2. **20261026000006_exercise_catalog_offline_converge.sql** — catálogo offline convergido de forma idempotente, mantendo as funções/trigger existentes e seus contratos de revisão/keyset.

Journal final: **125 versões**, inicial 123 até 20261024000001. Nenhuma versão 01–04 ou 25 foi artificialmente registrada. Fontes arquivadas com hashes no manifesto. O schema de produção já continha os três objetos offline equivalentes à fonte 25 sem journal; a versão original não idempotente falhou no ensaio local, então foi substituída pela convergência 06. Nenhum repair ou edição manual do journal de produção. CLI 2.119.0, `--skip-vault`, sem seeds/roles/include-all ou migrations adicionais. O frontend foi enviado somente depois da aplicação e conferência do banco.

Conferência pós-migration: versões corretas, RLS ativo em todos os objetos afetados, guards verificados, EXECUTE legado revogado, dicas de autoria aceitas somente no INSERT, metadados do servidor sem INSERT, UPDATE direto negado. Corpos de create_promotion/cancel_promotion/queue_deletion/run_deletion_job iguais aos anteriores. Não houve saneamento ou remoção de dados históricos.

## Backup e recuperação comprovados

Plano Free confirmado administrativamente; PITR desativado e nenhum backup listado pela API. Preparado manualmente um snapshot consistente do banco inteiro em formato custom pg_dump, incluindo schema, dados, ACLs, Auth, metadados Storage, journal, Vault e informações financeiras. Roles/memberships, configuração Auth/projeto, chaves de recuperação e arquivos Storage preservados separadamente, privadamente.

Backup criptografado fora do Git: `/home/codespace/.local/share/evolutus-backups/release-aud-20261012/backup-payload.enc`. A chave está em arquivo separado e restrito no diretório pai; não imprimir, enviar no chat ou versionar. Payload e chave nunca integraram o commit. Decriptação comparada byte a byte e hashes do manifesto privado conferidos.

Provas de recuperação:

- PostgreSQL real restaurado em container **sem rede e sem portas expostas**, cron desativado. Schema/roles/owners/data/constraints/ACL/RLS restaurados com sucesso.
- **130 tabelas** restauradas com conteúdo idêntico ao snapshot; Auth e financeiro incluídos. Preservados hashes de senhas, identidades e demais registros Auth sem expor valores.
- Vault decriptado com chave recuperada, digest idêntico à origem, sem divulgar secrets.
- **60 arquivos Storage** referenciados pelo snapshot copiados e restaurados no backend real sem rede; bytes, MIME e cache-control iguais. Ownership/metadados SQL permaneceram preservados. Três arquivos surgidos entre a cópia inicial e o snapshot foram recuperados por GET; objetos comuns não mudaram. Uploads posteriores não foram confundidos com aquele ponto de recuperação.
- Pacote final ensaiado na cópia real pela CLI: journal 123 → 125, somente 05/06; **129 tabelas de dados fora do journal sem alterações**.
- Container local com dados de produção **parado ao final**; não ficaram serviços locais expondo o backup ou jobs externos ativos.

O backup é um ponto no tempo, não RPO zero. Deve ser conservado com sua chave em local durável antes de excluir o Codespaces. Não foi ativado PITR nem criado plano pago/rotina automática ou envio a outro provedor. O detalhe criptográfico/hashes individuais permanece fora do Git; apenas evidências agregadas foram registradas.

## Verificações realizadas

| Área | Resultado efetivo |
|---|---|
| Validações AUD anteriores | Reaproveitadas, sem reexecutar toda a suíte: 1.888 JS, 534 SQL, 105 HTTP, 21 PWA, 20 INSERTs concorrentes |
| Offline auditado nesta etapa | **57 JS + 18 SQL**; corrigida apenas rotina auxiliar do teste SQL (alias UUID/ordenação/tipos bigint), assertions mantidas |
| Offline após convergência na cópia real | **18 SQL** aprovados |
| Lint/diff | Zero erros, 14 avisos conhecidos; diff-check aprovado |
| Recuperação | Banco/Auth/financeiro/Vault/Storage e decriptação comprovados conforme acima |
| Produção Auth/PostgREST | **6 GETs** de saúde/settings/contratos/catálogo aprovados, sem capturar dados de terceiros |
| Auth/perfil reais | Conta sintética **comum**, login por senha emitindo JWT real, ensure_user_profile/set_username/set_birth_info/aceite legal/set_usage_profile por RPCs autorizadas; nenhuma conta de terceiros usada |
| Navegador publicado | **11 checks** aprovados: desktop autenticado, catálogo preparado pela UI, reload offline com snapshot completo, menu mobile rolável, cinco publicações, autoria/metadados, Storage real, EvoCash inalterado, cache privado excluído, zero exceções não tratadas, SW shell instalado |
| Publicações reais próprias | Texto, enquete, treino, foto e progresso pelo serviço extraído do commit publicado; upload/download autenticados reais para fotos/progresso; autoria/nome/selo/contadores/promoção confirmados |
| EvoCash e promoções | Saldo próprio inalterado, zero promotion_purchase; grants/guard e corpos das RPCs financeiras conferidos. **Nenhuma promoção/pagamento real ou débito de teste**. Não se declara execução financeira de ponta a ponta em produção |
| Vercel | READY, produção, SHA/alias corretos, sem deploy alternativo local com arquivos fora do commit |

O primeiro teste de catálogo procurou o botão antes de abrir o catálogo; corrigida somente a sequência do verificador. A publicação de progresso falhou porque o verificador enviou `day` em vez do contrato `daily`; corrigido o teste, sem modificar a aplicação. O diagnóstico inicial de post_access não era a causa dessa falha. As demais publicações já tinham passado; o teste final completo passou. O verificador de perfil também foi corrigido para account_status e leitura de wallet opcional antes da inicialização normal, reaproveitando a mesma identidade. Esses erros de harness não foram ocultados nem apresentados como falhas resolvidas do produto.

Não foram repetidos testes de cadastro interrompido com falhas artificiais em produção. A recuperação/interrupção havia sido aprovada localmente; em produção foram comprovados login real e preenchimento/aceite pelas RPCs do próprio fixture. Página Exercícios e menu mobile já estavam no HEAD anteriormente publicado e não foram anunciados como melhorias novas deste commit; seu funcionamento atual foi verificado.

## Dados sintéticos e pendências

- Uma conta de teste comum permanece para eventual revisão/exclusão **pelo fluxo oficial**; sem privilégios administrativos. As sessões refresh foram encerradas globalmente.
- Comunidade de teste com apenas essa conta como membro foi **desativada pelo próprio dono**; seus registros ficaram ocultos nas leituras ordinárias pelo RLS. Foram preservadas **14 publicações sintéticas**, incluindo repetições do harness, e seus arquivos, sem apagamento destrutivo ou bypass do financeiro. Revisão/limpeza definitiva continua pendente pelo fluxo normal.
- Conservar cópia durável do backup criptografado e da chave, separadamente; planejar rotina de backup/recuperação apropriada ao plano Free. PITR não está habilitado.
- Testes reais de promoção/pagamento não foram executados nem autorizados; sua execução funcional já tinha sido provada localmente, e os controles/corpos em produção foram conferidos. AUD-03 a AUD-10 e saneamento de dados históricos permanecem fora deste release.
- Relatório final e JSONs pós-publicação estão atualizados no workspace; não se criou um segundo deploy apenas para versionar evidências posteriores ao commit publicado. Alterações preexistentes da auditoria/prompts permanecem fora do commit. Nenhum código de produto incompleto ficou pendente neste release.

## Recuperação em incidente

Frontend: voltar ao deployment anterior READY compatível `dpl_DYLierFP1RvS7fyf5U3uzWSnBT6L` / commit f036475, preservando banco endurecido. Banco após COMMIT: não há ROLLBACK daquela transação; preparar migration corretiva testada, sem restaurar grants amplos ou RPC destrutiva. Restore de incidente exige ponto de decisão e reconciliação de transações/uploads posteriores ao snapshot, preservando financeiro/webhooks. A restauração de ensaio usa banco isolado e jobs/rede desativados; não ligar seus serviços externos automaticamente.

Evidências atuais: `DEPLOYMENT_PUBLICADO_AUD.json`, `VERIFICACAO_BANCO_PUBLICADO_AUD.json`, `SAUDE_APIS_PRODUCAO_AUD.json`, `SMOKE_BROWSER_PRODUCAO_AUD.json`, `LIMPEZA_FIXTURE_PRODUCAO_AUD.json`, `RECUPERACAO_E_RELEASE_AUD_EVIDENCIAS.json` e manifesto deste diretório. Logs locais: `/tmp/release-production-migrations.log`, `/tmp/release-production-dry-run.log`, `/tmp/release-final-local-cli.log`, `/tmp/release-offline-targeted.log`, `/tmp/release-offline-converge-sql.log`, `/tmp/release-production-auth-smoke.log`, `/tmp/release-production-browser-smoke.log`. Dumps, envs, chaves, tokens, identidades e hashes detalhados privados não constam desses relatórios públicos.

## Histórico das etapas anteriores
# Publicação AUD-01 / AUD-02

12/10/2026. O usuário autorizou publicar em produção: “Pode lançar tudo a produção”. Essa autorização substitui a restrição anterior de não fazer commit/push/deploy. Não é necessário pedir novamente a mesma autorização quando os bloqueios abaixo estiverem resolvidos.

**Estado atual: PREPARADO — recuperação comprovada e inventário final ensaiado; publicação ainda não executada. Veja a atualização final abaixo.**

Destinos confirmados nesta etapa por leitura GitHub:

- Repositório: Danielalveslira/treinos_academia, branch main.
- Status Vercel success no commit f036475138fa9730edcc51f55e49526107bb4a82.
- Projeto indicado pelo check: danielalvesliras-projects/treinos_academia.
- Deployment GitHub 6989338734, ambiente Production, success.
- URL desse deployment: https://treinosacademia-khvctgbql-danielalvesliras-projects.vercel.app.

O vínculo administrativo com o projeto Vercel e seus domínios ainda exige conexão autenticada. O Supabase configurado no frontend é ywrjojrjgozdfpddkkuy; propriedade, journal, drift, configurações e backup não foram confirmados administrativamente. Existe somente credencial GitHub nesta sessão; não há token/CLI vinculado Supabase/Vercel. A busca de plugins encontrou ambos disponíveis e não instalados/conectados. Como já haviam sido sugeridos recentemente, não foi repetida a sugestão automática; foi solicitado ao usuário conectá-los, sem fornecer secrets no chat.

Artefato local revisável: `20261026000005_aud_security_atomic.sql`, ao lado deste documento. Gerado em modo CLI, com hashes e ordem das quatro fontes; não contém escrita manual no journal nem COMMIT explícito. Não foi colocado na pasta executável de migrations, porque sua adoção depende de comprovar que nenhuma das quatro versões originais foi publicada. O mecanismo de consolidação já foi ensaiado com sucesso conforme o parecer pré-deploy. Este artefato ainda requer os limites operacionais e ensaio final previstos nesse parecer.

Próximos passos após as conexões: confirmar projetos/conta, inspecionar journal/drift/ACL/RLS/RPCs/Auth, obter evidência de backup/restauração, fechar inventário canônico e ensaio final, aplicar banco atômico pela CLI e só depois publicar frontend. Não efetuar push agora: a integração Vercel pode publicar o frontend antes do banco. Nenhuma mudança preexistente alheia ao release deve ser incluída automaticamente no commit.

Referência: ../PRE_DEPLOY_AUD_01_AUD_02_SEM_HOMOLOGACAO.md. O parecer histórico NO-GO continua justificando os bloqueios técnicos; a autorização de publicação em si já foi recebida.

## Continuação conforme PROMPT_CODEX_CONTINUAR_RELEASE_EVOLUTUS

**Resultado da tentativa anterior: BLOQUEADO na etapa 1 — posteriormente resolvido pelo login do responsável; veja atualização abaixo.**

O prompt foi lido integralmente. Foram consultados os relatórios e o estado real do workspace. Foi iniciada uma nova tentativa de `npx supabase login`, sem reutilizar a sessão cancelada. Nenhum link/código/token foi transcrito para o chat ou salvo em arquivo. A verificação posterior `npx supabase projects list` encerrou com código 1 e `AccessTokenRequiredError`: não há acesso administrativo autenticado disponível.

Foi solicitado ao responsável concluir `npx supabase login` no terminal interativo do Codespaces e informar apenas a conclusão, sem fornecer dados de autenticação. O prompt determina parar se não for possível autenticar; por isso não foram iniciadas inspeções/migrations/deploy em produção.

O workspace permanece na branch main, com alterações locais AUD e arquivos preexistentes preservados. O artefato consolidado conserva os hashes das quatro fontes, mas não foi promovido à pasta executável de migrations. Exercícios e menu mobile precisam ser distinguidos entre mudanças já publicadas e eventuais pendências ao fechar o inventário; nenhuma melhoria adicional foi automaticamente incluída.

A informação de que o login Vercel CLI foi concluído veio do novo prompt. Ainda requer verificação de `npx vercel whoami` e vínculo existente após resolver a autenticação inicial; não foi tratada como confirmação de conta/projeto nem como deploy novo. Backup/PITR, histórico e drift continuam sem confirmação nesta continuação.

Commits novos: nenhum. Push: nenhum. Migrations efetivamente aplicadas em produção nesta continuação: nenhuma. Deploy novo: nenhum. Saúde pós-publicação: não avaliada, pois não houve publicação. As contagens de testes dos relatórios anteriores são históricas e não foram anunciadas como novas execuções nesta etapa.

Próximo passo obrigatório: login Supabase concluído e `projects list` bem-sucedido; então seguir as etapas 2–9 do prompt, incluindo identidade/destinos, inventário, inspeção read-only, backup verificável, atomicidade e publicação estritamente do commit validado. A autorização de release já existe e não precisa ser repetida; a autenticação e os gates técnicos não podem ser substituídos por ela.

## Atualização após confirmação de login pelo responsável

**Resultado atual: BLOQUEADO / NO-GO para iniciar publicação.**

A autenticação Supabase foi comprovada com `projects list` (exit 0). A conta Supabase confirmou username Danielalveslira. Projeto encontrado: **treinos_academia**, ref **ywrjojrjgozdfpddkkuy**, região us-east-2, ACTIVE_HEALTHY. Não foi presumido que o outro projeto da organização fosse destino do release.

GitHub confirmou Danielalveslira, origin Danielalveslira/treinos_academia, branch main, HEAD f036475138fa9730edcc51f55e49526107bb4a82. Vercel whoami confirmou danielalveslira; listagem e inspeção confirmaram equipe danielalvesliras-projects, projeto treinos_academia, ID prj_WYVlCGYu021KZCrqfp62qRH2cbIE, framework Vite, Node 24.x e URL de produção https://treinosacademia-ten.vercel.app. Não houve troca para outra conta/projeto ou criação de ambiente remoto.

**Backup:** `npx supabase backups list --project-ref ywrjojrjgozdfpddkkuy --output-format json` retornou exit 0, walg_enabled=true, **pitr_enabled=false**, **backups=[]**, physical_backup_data={}. Isso não comprova backup recuperável, atualização, abrangência ou restauração. WAL-G habilitado sozinho não prova ponto de recuperação. Não é afirmação de que backups externos inexistem; nenhuma evidência externa foi fornecida. Pelo gate obrigatório do prompt, não é permitido publicar nesse estado. Nenhum PITR foi ativado, backup criado ou restore iniciado automaticamente.

**Histórico remoto:** consulta SQL com BEGIN READ ONLY/COMMIT retornou **123 versões**, até **20261024000001_greeting_personalization**. As quatro versões AUD 20261026000001–04 e a candidata consolidada 05 não aparecem no journal. O workspace possui 128 arquivos: há **cinco pendentes** por comparação de versão, e nenhuma versão exclusivamente remota:

- 20261025000001_exercise_catalog_offline_sync.sql
- 20261026000001_close_account_rollback.sql
- 20261026000002_status_write_allowlist.sql
- 20261026000003_status_legacy_author_compat.sql
- 20261026000004_community_promotion_server_only.sql

A primeira consulta precisou da flag --linked junto ao ref explícito conforme exigência da CLI; não foi aplicado `supabase link`, `db push` ou migration repair. A CLI escreveu metadados locais de linked-project durante a consulta ao ref explícito confirmado. Comparação de nomes/versões não certifica ausência de drift: ACL/RLS/functions/triggers/owners/financeiro e Auth ainda requerem inspeção e comparação antes do release.

A migration 25 é aditiva e cria o trigger exercise_catalog_touch_updated_at e as RPCs get_exercise_catalog_revision/list_exercise_catalog_for_sync. Fazia parte da baseline local de 124 migrations do ensaio, mas não está registrada em produção. Não foi incluída por ordenação automática nem marcada aplicada manualmente. O inventário proposto de baseline + uma migration consolidada não coincide hoje com o remoto; precisa tratar essa pendência explicitamente e repetir o ensaio final sobre a baseline real. A ausência no journal também não prova, sem consulta de schema, que os objetos nunca foram criados fora do histórico.

A página Exercícios e o menu mobile não apresentam diff de implementação pendente no workspace. O histórico Git contém aef4b77 para a página Exercícios e b2f4978/f036475 para menu mobile; o deployment GitHub de produção já observado é f036475. Não foram anunciados como novas alterações deste release nem incluídos automaticamente.

**Publicação efetiva nesta continuação:** nenhum commit novo, nenhum push, nenhuma migration de produção, nenhum deploy novo. Não há versões novas aplicadas ou smoke tests pós-publicação a reportar. Nenhuma promoção/pagamento real, exclusão, worker ou dado de terceiros foi executado para teste. As provas locais anteriores permanecem históricas; não foram repetidas como nova execução nesta etapa.

**Pendências para retomar:** evidência de backup externo recuperável ou preparar backup/restauração em ação separada adequada ao plano; decisão explícita sobre a migration 25; conferir drift/ACL/RLS/RPCs/Auth e volume/locks; fechar inventário, limites e ensaio final do pacote atômico; aplicar banco antes de publicar frontend do commit validado. Se fonte AUD já estiver aplicada fora do journal, parar e desenhar corretiva, sem repair improvisado. Não restaurar grants amplos ou RPC destrutiva durante recuperação.

Evidências redigidas sem tokens, códigos ou dados de usuários: `EVIDENCIA_PRODUCAO_READONLY_AUD_01_AUD_02.json` neste diretório. A autorização geral de release continua válida; ela não cobre ausência de backup nem inclusão automática de migrations extras.

## Preparação final autorizada — requisitos fechados

Backup manual criptografado e privado fora do Git, com decriptação comprovada. Banco inteiro restaurado sem rede/cron: 130 tabelas com conteúdo idêntico; Auth e finanças incluídos. Vault restaurado/decriptado com digest igual à origem. Sessenta arquivos Storage restaurados e lidos com hashes, MIME e cache-control preservados, sem modificar ownership/metadados SQL. Plano Free/PITR false confirmado; não houve mudança de plano.

Drift do catálogo identificado: três funções da fonte 25 já existem sem journal. Fonte 25 arquivada; nova convergência idempotente 20261026000006, sem repair. Quatro fontes AUD arquivadas e consolidadas em 20261026000005 atômica, com limites de lock/statement. Ensaiadas pela CLI 2.119.0 sobre a cópia real: somente 05/06, journal 123 → 125, 129 tabelas de dados fora do journal intactas. Offline 57 JS e 18 SQL aprovados; SQL 18 também na cópia convergida. Lint zero erros/14 avisos. Validações AUD anteriores aprovadas reaproveitadas.

Dry-run remoto confirmou somente 05/06, zero seeds/roles e skip-vault. GitHub/main, Supabase ref e Vercel projeto/equipe/branch confirmados. Env Vercel real aponta ao mesmo Supabase, com chave cliente anon e offline cold start/write true; nenhuma configuração remota alterada.

Manifesto e evidências: MANIFESTO_RELEASE_AUD_01_AUD_02.md/.json e RECUPERACAO_E_RELEASE_AUD_EVIDENCIAS.json. Nesta atualização preparatória, ainda não há novo commit remoto, migrations de produção ou deployment novo. O resultado efetivo será registrado após a execução autorizada. Arquivos preexistentes alheios ao release permanecerão fora do commit.
