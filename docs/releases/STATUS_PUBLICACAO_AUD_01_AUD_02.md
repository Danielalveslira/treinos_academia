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
