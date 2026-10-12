# Pré-deploy AUD-01 / AUD-02 — sem homologação remota

12/10/2026. **Decisão: NO-GO para publicar agora.** As correções e os ensaios locais passaram. Permanecem sem confirmação o projeto Supabase de produção, o projeto Vercel associado, migrations aplicadas/pendentes e drift remoto, configuração de Auth e backup/restauração. Além disso, o inventário de release precisa adotar a consolidação descrita abaixo antes de qualquer push de banco: a pasta atual conserva quatro migrations de desenvolvimento e sua aplicação sequencial ainda exporia a incompatibilidade entre 02 e 03.

Existe somente stack local e produção. Não é necessário criar ou exigir homologação remota. Este parecer substitui as referências a homologação remota e ao journal sintético no relatório anterior. Nenhum commit, push, deploy, migration remota ou alteração de configuração/dado de produção foi realizado. A autorização atual cobre correções/ensaios locais e leituras remotas já configuradas, não publicação.

## Destinos e acesso

Antes do acesso remoto foram apresentados os destinos encontrados localmente:

| Destino | Evidência | Situação |
|---|---|---|
| Git origin fetch/push | `https://github.com/Danielalveslira/treinos_academia` | Confirmado; não alterado |
| Conta GitHub | Ambiente indicava Danielalveslira; `gh api user` retornou Danielalveslira | Confirmada por leitura |
| Repositório | `gh api repos/Danielalveslira/treinos_academia`: mesmo full_name, default_branch main, archived false | Confirmado por leitura |
| Supabase | `.env` aponta para `ywrjojrjgozdfpddkkuy.supabase.co` | Referência do frontend, sem confirmação administrativa de propriedade/produção; nenhum project-ref vinculado ou acesso administrativo disponível |
| Vercel | Existe `vercel.json`; não existe `.vercel/project.json`, CLI/token configurado | Projeto/domínio/deployment não confirmados |

Somente as duas consultas GitHub foram executadas remotamente. Não se usou a chave do frontend como autorização administrativa para produção. Não houve consulta ao Supabase/Vercel remoto. Nenhum secret, JWT real ou dado pessoal consta nas evidências.

## Alterações desta etapa e causas

- `src/features/adminAccounts/utils/accounts.test.js`: a última fixture de filtro usava o relógio real apesar de construir contas relativas ao NOW fixo. Passa o mesmo NOW explicitamente; assertions preservadas.
- `src/components/CatalogOfflineStatus.test.js`: esperas de 20/40 ms não aguardavam IndexedDB/single-flight e os componentes permaneciam montados entre testes. Agora aguarda a Promise devolvida pelo clique, espera condições observáveis com limite de três segundos e desmonta componentes. A sincronização fica deliberadamente pendente para verificar “Baixando” e botão desabilitado antes da conclusão. Nenhuma mudança no componente/hook de produto foi necessária.
- `src/components/CommunityFeedSection.test.js`: a primeira reexecução completa encontrou uma terceira falha. O NOW do bundle era capturado uma vez, enquanto fixtures posteriores usavam Date.now; após mais de um minuto sob carga, “um minuto atrás” ainda era futuro para o componente. Fixtures e bundle usam o mesmo instante fixo. Sem alterar regras de treino ou enfraquecer assertions.
- `scripts/build-aud-migration-batch.mjs`: removida escrita manual no journal. Modo padrão emite BEGIN/COMMIT para ensaio SQL; modo `--cli` emite somente o corpo consolidado, pois a CLI deve controlar a transação e o registro de histórico juntos. COMMIT explícito no arquivo CLI poderia separar DDL do journal.
- `scripts/verify-aud-rollout-atomic.mjs`: removidos criação/registro/assertions do journal sintético. Continua comprovando as vinte requisições concorrentes, sem alegar que comprova histórico remoto.
- `scripts/verify-aud-cli-history-local.mjs`: ensaio de histórico real da CLI com falha tardia, sucesso e chamada repetida; destino exclusivamente local fixo, container `evolutus_aud_cli_db`, porta 55435.
- `scripts/aud-production-readonly.sql`: consultas de inspeção preparadas para o responsável autorizado; não executadas remotamente.
- Este relatório, `docs/evidencias/PRE_DEPLOY_AUD_01_AUD_02.json` e nota no relatório anterior: decisão atual, inventário com hashes e evidências resumidas persistentes.

As mudanças anteriores continuam no workspace: Register/Auth/users/statuses services, statusWriteContract.test.js, três testes SQL, quatro migrations, scripts de stack/API/navegador/promoção/SQL e os dois relatórios anteriores. Preservadas a auditoria e a exclusão preexistente de `PROMPT_CLAUDE_CORRECAO_SCROLL_MENU_MOBILE_EVOLUTUS.md`. AUD-03 a AUD-10 não foram corrigidas ou incluídas neste escopo; este parecer não certifica todo o sistema.

## Resultados reais desta sessão

| Execução | Resultado final | Log local |
|---|---|---|
| `npm test` | **1.888/1.888**, zero falhas, zero skips | `/tmp/predeploy-js-final.log` |
| Três arquivos de teste corrigidos | 57/57 | `/tmp/predeploy-targeted-final.log` |
| `npm run lint` | Zero erros, 14 avisos existentes | `/tmp/predeploy-lint-final.log` |
| `npm run build` | Aprovado; aviso de chunks >500 kB | `/tmp/predeploy-build.log` |
| Builds antigo/novo para localhost | Ambos aprovados; mesmo aviso de tamanho | `/tmp/predeploy-build-old.log`, `/tmp/predeploy-build-new.log` |
| 13 arquivos pgTAP | **534/534** | `/tmp/predeploy-sql.log`, detalhes `/tmp/evolutus-aud-tests.3svOoO/` |
| HTTP Auth/PostgREST | **87/87** | `/tmp/predeploy-http.log` |
| HTTP financeiro/comunidades | **18/18**, total HTTP **105** | `/tmp/predeploy-finance.log` |
| Chromium/PWA | **21/21** | `/tmp/predeploy-browser-final.log` |
| Rollout SQL concorrente | **20/20 INSERTs** de contrato antigo | `/tmp/predeploy-atomic.log` |
| Histórico/atomicidade CLI 2.119.0 | **15/15** | `/tmp/predeploy-cli-history.log` |
| pgTAP no banco migrado pela CLI consolidada | **80+15/95**; execução adicional, não somada às 534 | `/tmp/predeploy-cli-security.log`, `/tmp/predeploy-cli-finance.log` |
| `git diff --check` | Aprovado | Executado localmente |

Os 57 casos direcionados já integram os 1.888; não representam testes adicionais. A primeira execução completa JS falhou apenas na fixture de treino; a execução final passou após controlar esse relógio. A primeira execução HTTP ocorreu antes de Auth ficar pronto; foi repetida com o serviço disponível. Um primeiro ensaio Chromium chegou à recarga explícita, mas excedeu 20 s esperando a navegação sob carga concorrente da suíte JS; o ensaio completo seguinte passou sem alterar assertions/timeouts. A causa de temporização não foi isolada conclusivamente; registrar a intermitência e conferir recarga em celulares/produção, sem alegar ausência universal de falhas. O primeiro rollout concorrente conflitou com a porta do navegador; a execução isolada passou.

A stack anterior estava parada e os logs /tmp anteriores não existiam mais. As contagens acima vêm de novas execuções. Os resumos e SHA256 dos logs/inventário estão no JSON de evidências; /tmp é temporário. O frontend antigo corresponde ao HEAD `f036475138fa9730edcc51f55e49526107bb4a82` deste repositório, não a um deployment de produção confirmado.

O ambiente local usa GoTrue, PostgREST, Storage e Chromium reais; HTTP recebe JWT emitido por Auth. Só portas locais, identidades, carteiras e pagamentos sintéticos; cron desativado. A fixture Storage do ensaio CLI é mínima; uploads reais foram comprovados separadamente pela stack com serviço Storage. Auth local autoconfirma e-mail: não foi comprovada entrega de e-mail, redefinição de senha ou configuração SMTP/redirects em produção.

## O que foi comprovado e o que falta

| Área | Local | Produção |
|---|---|---|
| Autoria/grants/RLS | PostgREST com usuários autenticados; autoria/selo falsos sobrescritos, autor divergente recusado, INSERT/UPDATE/UPSERT financeiro negados | Owners, ACLs inclusive coluna/herança, RLS, triggers/ordem e corpos de RPCs não inspecionados |
| Cadastro interrompido | Identidade/reserva preservadas, retry sem segundo signUp; abandono/login/gate legal/Meu Perfil concluem perfil | Fluxo real de confirmação/recuperação por e-mail não verificado |
| Publicações | Texto, enquete, treino, foto e progresso; uploads/downloads autenticados reais, formulário após reload | Contrato/PostgREST/schema cache remoto não confirmado |
| Exclusão oficial | Rollback legado recusado; casos com saldo, ledger e pendências preservados, queue/admin/worker financeiro exercitados em SQL | Configuração/implantação do worker e jobs remotos não confirmadas; não se disparou worker remoto |
| EvoCash | RPC de post cobra 25, retry não cobra novamente, nova promoção cobra; comunidade cobra 100, ledger único; dono/admin não fabricam flags ou saldo | Schema, RPCs de pagamento, integrações e histórico financeiro reais não verificados |
| PWA | Shell atualiza; aba antiga continua publicando; chunk antigo ausente exige reload explícito; novo formulário publica; cache exclui API/Storage privado | Headers, domínio, assets e SW efetivamente publicados não verificados |
| Histórico | 124 migrations de base aplicadas pela CLI; release consolidada acrescenta uma versão, sem manipulação manual | Journal aplicado/pendente/drift desconhecido |
| Backup/restauração | Plano preparado abaixo; nenhuma restauração de produção ensaiada | Backup/PITR, retenção e restauração comprovável desconhecidos — bloqueio |

## Inventário e procedimento atômico

Fontes de desenvolvimento, nesta ordem:

1. `20261026000001_close_account_rollback.sql`: bloqueia RPC destrutiva e DELETE/TRUNCATE direto de identidade/perfil, preservando fluxo oficial.
2. `20261026000002_status_write_allowlist.sql`: limpa grants de tabela/coluna, limita INSERT e inicializa autoria/metadados no servidor.
3. `20261026000003_status_legacy_author_compat.sql`: aceita dicas legadas de nome/selo somente no INSERT, sempre sobrescritas pelo servidor.
4. `20261026000004_community_promotion_server_only.sql`: bloqueia manipulação direta dos três campos financeiros de promoção de comunidade.

Nenhuma fonte executa saneamento de linhas, DELETE/TRUNCATE de dados existentes ou DROP de tabela. Removem/recriam policies/triggers e alteram funções/privilégios. Corpos de funções são definições, não execução do fluxo financeiro durante a migration. Expiração/contadores/promoções históricas não são zerados. Inventário completo dos **128 arquivos** e respectivos hashes está no JSON: **124 anteriores + quatro fontes AUD**. Última baseline: `20261025000001_exercise_catalog_offline_sync.sql`. Há timestamps posteriores a 12/10/2026; a ordem por versão não prova que essas migrations estejam aplicadas remotamente.

**Não executar `db push` sobre a pasta atual nem aplicar 02 isoladamente.** O ensaio HTTP reproduz 42501 em clientes antigos entre commits 02/03. Um pacote SQL aplicado por psql sem gerenciamento de histórico também não está aprovado para produção.

Procedimento proposto e ensaiado, condicionado a confirmar que NENHUMA das quatro fontes foi publicada em qualquer destino compartilhado:

1. Confirmar journal remoto e drift por leitura; a baseline aprovada deve corresponder integralmente às migrations históricas. Qualquer pendência anterior/divergência exige resolução separada, não inclusão automática no release AUD.
2. Consolidar as quatro fontes em **uma migration canônica `20261026000005_aud_security_atomic.sql`**, gerada pelo modo `--cli`, contendo hashes e ordem das quatro fontes. Retirar as quatro versões de desenvolvimento da pasta executável e preservá-las como fontes arquivadas auditáveis; atualizar repositório/CI/inventário para usar somente baseline + consolidada. Essa mudança canônica ainda não foi feita no workspace, pois depende do histórico remoto. Não usar migration repair para fingir que quatro versões foram aplicadas.
3. Se alguma fonte já existir no histórico remoto, **abortar este procedimento**: não renomear/squash histórico publicado; desenhar migration corretiva sobre o estado efetivo e repetir ensaio.
4. Fixar CLI 2.119.0 e hashes; construir diretório de release com toda a baseline aprovada e só a consolidada como pendência. Conferir `migration list` e `db push --dry-run` no destino confirmado; lista esperada exatamente uma migration. Nunca `--include-all`, `--include-seed`, repair, reset ou edição manual do journal para contornar diferenças.
5. Depois da autorização específica de publicação, a CLI aplica o único arquivo e registra sua versão. A transação única contém 01 → 02 → 03 → 04 e NOTIFY PostgREST, sem BEGIN/COMMIT internos. Não há instante confirmado intermediário de allowlist estrita.

A [documentação Supabase de migrations](https://supabase.com/docs/guides/deployment/database-migrations) orienta manter mudanças em migration files e histórico sincronizado. O comportamento de atomicidade deste procedimento não foi presumido dessa orientação: foi comprovado com a CLI instalada e PostgreSQL local.

Evidência CLI: container novo `evolutus_aud_cli_db`, banco postgres, porta 55435. As 124 migrations foram aplicadas pela CLI e criaram seu journal real. O pacote `--cli` foi colocado como única pendência no diretório `/tmp/aud-cli-history-jwuDww/supabase/migrations/`. `select 1/0` injetado após as quatro fontes fez a CLI falhar: guards ausentes, permissão antiga de exclusão ainda presente, versão 05 ausente. Removida a falha, CLI aplicou o arquivo; guards presentes, exclusão antiga revogada, histórico **125** versões com nome/statements oficiais. Nova chamada não aplicou nada. Nenhum registro de histórico foi criado/reparado manualmente. Isto demonstra o mecanismo local; não certifica o inventário remoto.

## Compatibilidade e PWA

| Frontend / banco | Resultado local |
|---|---|
| Antigo / antigo | Contrato legítimo funciona; vulnerabilidades continuam antes da correção |
| Novo / antigo | Dicas de autoria conservadas permitem nome/selo; proteção de banco ainda ausente |
| Antigo / novo completo | Cinco tipos funcionam; nome/selo derivados; rollback de cadastro antigo recebe 403 e preserva conta |
| Novo / novo completo | Cinco tipos funcionam, retry e recuperação de perfil funcionam |
| Antigo / somente 02 | Incompatível: 42501; estado proibido no rollout |

Aplicar banco completo antes de publicar frontend novo. Aba/PWA antiga pode continuar executando o bundle antigo; novas restrições precisam aceitar esse contrato indefinidamente enquanto necessário. Quando um chunk antigo não está mais disponível, há recuperação explícita por “Recarregar página”; sem reload automático durante digitação. Confirmar em celulares a navegação/recarga; conservar assets antigos quando o hosting permitir. No arquivo Vercel local, assets têm cache immutable e sw.js no-cache; isso ainda precisa ser confirmado no deployment real.

Rollback do frontend deve restaurar um deployment aprovado compatível com banco novo. Não reabrir grants, rollback de cadastro nem manipulação financeira para acomodar uma versão antiga. O ensaio não prova que o deployment atualmente publicado seja igual ao HEAD usado como frontend antigo.

## Inspeções pendentes por leitura

O responsável com acesso ao projeto confirmado deve executar `scripts/aud-production-readonly.sql` em conexão read-only. O arquivo consulta journal sem statements potencialmente sensíveis, ACLs brutas/efetivas de tabela e coluna, memberships herdadas, RLS/policies, owners, triggers habilitados/ordem, assinaturas/EXECUTE/corpos e search_path de funções relevantes. Revisar resultados em local protegido e compartilhar apenas diferenças redigidas; nunca copiar secrets ou dados reais. As consultas não leem linhas de Auth/perfil nem executam RPCs mutantes. Comparar a saída com o schema local final e o inventário de hashes; divergência de owner, definer/search_path ou permissões bloqueia a publicação.

Também obter, por leitura:

- Identificação administrativa Supabase/organização/ref e vínculo Vercel repo/projeto/domínio/deployment; confirmar que são produção, sem trocar automaticamente o destino.
- Journal vs arquivos, todas as pendências e drift de objetos afetados; eventual migration list deve ser usado após conferir suas credenciais/destino.
- Contrato OpenAPI do PostgREST via GET com acesso já autorizado: campos/assinaturas/status/versão de API; não executar POST/PATCH/DELETE para provar negação em produção. SQL/HTTP mutante permanece ensaio local.
- Auth: signup, confirmação de e-mail, SMTP, redirect allowlist/site URL, duração de sessão e recuperação. Nunca exportar secret SMTP/JWT.
- Vercel/SW: GET de index, manifest, sw.js e assets do deployment confirmado; Cache-Control, reescritas, escopo/cache version e comportamento de chunks antigos.
- Backup/PITR: plano habilitado, último ponto recuperável, retenção, status de backup, responsável e evidência de restauração recente em destino isolado autorizado; Storage/objetos e configuração de Auth/integrações contemplados separadamente. “Há backup” não comprova restauração.

A falta dessas leituras bloqueia esta etapa de produção, não os ensaios locais já concluídos. Não se solicita criação de homologação remota.

## Plano de publicação e recuperação — preparado, não executado

**Antes da janela:** concluir todas as leituras, confirmar ausência de drift/pending desconhecido, fechar inventário canônico, arquivar hashes/artifacts, aprovar backup verificável e restauração ensaiada com RPO/RTO aceitos pelo responsável. Registrar deployment frontend anterior, commit/hashes do novo e versão única de banco. Coordenar um único executor; suspender automação de migrations/deploy durante a janela mediante autorização futura. Não executar esta suspensão agora.

**Janela proposta:** reservar 30 minutos de baixa atividade para aplicação/observação e manter responsável por recuperação disponível. Planejar lock_timeout de 5 s e statement_timeout de 60 s no artefato final aprovado e repetir ensaio com esses parâmetros antes da liberação; não foram adicionados ao pacote testado nesta tarefa. Locks longos devem causar aborto antes do commit, não insistência automática. Os limites precisam ser validados contra volume/bloqueios reais por leitura.

**Ordem após autorização explícita:** confirmar destino e backup → conferir lista/dry-run exatamente uma pendência → aplicar consolidada pela CLI → conferir journal/guards/ACLs e recarga PostgREST por leitura → validar rotas/Auth do frontend anterior com banco novo → publicar o frontend aprovado → observar PWA/login/cadastro/feed/erros por pelo menos 15 minutos. Proibir aplicação dos quatro arquivos separados e probes financeiros de produção.

**Pós-deploy sem efeitos colaterais:** GET de página/rotas/assets/manifest/SW, status de serviços, OpenAPI e metadados SQL; observar erros 401/403/42501/5xx sem registrar JWT/PII. Login somente com conta própria de teste previamente autorizada, sem disparar signUp, workers ou exclusões. Publicação de texto/enquete/treino/foto/progresso somente pelo fluxo normal e conta/comunidade de teste, mediante autorização específica dessas gravações. Promoção real/debito e compra não autorizados ficam fora dos smoke tests; usar as provas locais e observação de eventos legítimos redigida. Recuperação de e-mail requer conta própria e envio autorizado.

**Aborto/recuperação:** qualquer destino diferente, migration adicional, drift crítico, ausência de backup/restauração, lock/statement timeout, erro de aplicação ou perda de contrato legado interrompe a janela. Antes de COMMIT, erro da CLI deve reverter DDL e histórico como no ensaio; conferir por leitura e não reexecutar cegamente. Depois de COMMIT não há ROLLBACK da transação: problemas de trigger/grant/compatibilidade exigem migration corretiva testada e autorizada, preservando as proteções. Falha só de frontend permite voltar ao deployment compatível aprovado e conservar banco endurecido. Restaurar banco/PITR exige decisão de incidente, RPO/RTO e reconciliação de transações legítimas posteriores, incluindo pagamentos/webhooks; nunca restauração automática que perca EvoCash/ledger. Nenhum plano de restauração de produção foi declarado comprovado nesta tarefa.

## Condições para reconsiderar NO-GO

- [ ] Confirmar Supabase/organização e Vercel/projeto/domínio/deployment; GitHub já confirmado.
- [ ] Obter journal/drift/ACL/RLS/functions/contrato remoto por leitura e resolver diferenças.
- [ ] Comprovar backup/PITR e restauração incluindo dependências de Storage/Auth; aceitar RPO/RTO.
- [ ] Confirmar que as quatro fontes AUD nunca foram publicadas e adotar inventário consolidado canônico, ou preparar corretiva se já publicadas.
- [ ] Ensaiar artefato final com limites de lock/statement e mesmos hashes/configuração de release; dry-run com exatamente uma migration pendente.
- [ ] Confirmar frontend publicado vs antigo ensaiado, Auth/e-mail e headers/PWA; aceitar recuperação explícita de chunk e investigar se a intermitência de recarga reaparece.
- [ ] Aprovar janela, executor, observação/recuperação e eventuais smoke tests com conta própria, sem transações financeiras não autorizadas.
- [ ] Receber autorização **separada e explícita** para commit/push/deploy/migration remota. Nenhuma foi solicitada ou executada nesta tarefa.

O usuário decide os próximos passos. A aprovação anterior das correções para ensaio local não autoriza publicar em produção.
