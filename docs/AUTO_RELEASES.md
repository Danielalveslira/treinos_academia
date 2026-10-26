# Releases verificadas do Evolutus

## Escopo e estado inicial

A automação observa a produção; não faz merge, deploy, promoção, rollback, alteração de código ou banco. Não atualiza `package.json` a cada publicação. Não usa IA, APIs de IA, dependências adicionais ou capturas de tela.

A consulta realizada em 26/10/2026 encontrou **zero tags e zero GitHub Releases**. `package.json` contém `1.0.0`, mas isso não é prova de uma Release. A primeira versão requer inicialização explícita e não reanuncia mudanças históricas.

A implementação é entregue **desativada**: não cria Secrets, variables, integrações, tags ou Releases reais. O workflow `Supabase & app tests` permanece intacto. Seus testes de `scripts/release/*.test.mjs` incorporam a nova suíte automaticamente.

## Fluxo

1. PR revisado e merge na main pelo fluxo existente.
2. CI completo do **SHA efetivamente publicado** aprovado na main.
3. Deploy autorizado pela Vercel, seguido da promoção real.
4. Evento ou recuperação aciona `Verified production release`.
5. Job `verify`, com `contents: read`, valida APIs e identidade pública, calcula versão e notas sem escrever.
6. Somente com habilitação explícita, o job `publish` recebe `contents: write`, refaz a verificação e cria tag anotada e Release.
7. A produção e a referência da tag são verificadas novamente. Divergências não são ocultadas nem corrigidas reescrevendo histórico.

O merge e o estado READY **não** são prova de publicação. Um build Preview nunca autoriza uma Release.

## Projeto autorizado e prova de produção

Valores públicos confirmados na configuração existente, centralizados em `scripts/release/auto-release/config.json`:

| Campo | Valor |
| --- | --- |
| Repositório | `Danielalveslira/treinos_academia` |
| ID GitHub | `1361638594` |
| Branch | `main` |
| Projeto Vercel | `prj_WYVlCGYu021KZCrqfp62qRH2cbIE` (`treinos_academia`) |
| Equipe Vercel | `team_tQQ2dDGOWbWO9LmffGeLJlUb` (`danielalvesliras-projects`) |
| Domínio | `www.evolutus.com.br` |

A verificação consulta somente endpoints de leitura da Vercel:

- `/v9/projects/{id}`: projeto/equipe/repositório/branch, target de produção e operações de alias/rollback.
- `/v4/aliases/{dominio}`: o domínio precisa apontar para o mesmo deployment e projeto.
- `/v13/deployments/{id}`: `production`, `READY`, alias atribuído, owner/projeto esperados e `gitSource` oficial GitHub com repositório e SHA comprováveis.
- `/v9/projects/{id}/domains/{dominio}`: domínio verificado, sem redirecionamento para outro endereço.

O build emite `/.well-known/evolutus-build.json`, contendo somente schema, repositório, commit, deployment ID e project ID. Esses valores vêm das variáveis oficiais `VERCEL_GIT_COMMIT_SHA`, `VERCEL_DEPLOYMENT_ID` e `VERCEL_PROJECT_ID`. Builds locais sem essa identidade emitem campos nulos, que **não** autorizam Release.

A automação lê esse arquivo pelo domínio HTTPS oficial, sem Authorization, sem seguir redirects e com revalidação de cache e query única. Seu conteúdo precisa corresponder exatamente ao deployment ativo consultado nas APIs. O manifesto não contém credenciais nem inventa um número SemVer antes da criação da Release. A versão oficial é obtida da tag/Release associada ao commit; um redeploy com árvore Git idêntica mantém a versão anterior.

O arquivo é pequeno, não gera chamadas na interface e não entra no precache do app. O plugin roda depois do gerador do service worker, evitando atualizar a versão do SW apenas por mudanças de identidade do deployment.

## CI obrigatório

`verifyCI` identifica o workflow **pelo arquivo** `supabase-tests.yml`, consulta as execuções do SHA/branch/repositório corretos e aceita somente `push` ou `workflow_dispatch` na main. O run mais recente tem prioridade; um sucesso antigo não encobre uma reexecução pendente ou reprovada.

O run deve estar concluído com sucesso, assim como os jobs `js`, `sql`, `secrets` e `finance-quality`. Todos os demais jobs precisam estar concluídos e sem falha. Resultados de PR/fork ou de outro commit não são substitutos. As quatro exigências mínimas não podem ser removidas do config.

As proteções observadas da main exigem `finance-quality`, branch atualizada e uma aprovação independente do último push. A automação não altera essas proteções. Restrições de criação de tags também são respeitadas: um 403/422 bloqueia, sem uso de admin, force, PATCH ou DELETE.

## Eventos e compatibilidade Hobby

Eventos principais oficiais: `repository_dispatch` com `vercel.deployment.success` e `vercel.deployment.promoted`. URLs e afirmações do payload não são usadas como prova. O código valida o ID e a origem por API e recusa Preview, deployment inativo e metadados conflitantes.

`workflow_run` da suíte principal concluída na main cobre a situação em que o evento Vercel chegou antes do CI. Um evento antigo não pode publicar outro commit em seu lugar.

`workflow_dispatch` permite recuperar uma Release pendente consultando a produção atual, sem novo commit ou deploy quando a origem já pode ser comprovada. Não exige webhooks Pro/Enterprise.

A leitura atual mostrou apenas `gitProviderOptions.createDeployments=enabled`; isso não comprova a entrega de repository dispatch. A documentação oficial confirma os eventos, mas o schema público consultado não expôs uma operação de ativação específica. Não usar PATCH com campos internos não documentados.

Após o merge, o responsável deve abrir **Vercel → projeto treinos_academia → Settings → Git**, conferir o repositório conectado e a opção de eventos `repository_dispatch`, se disponibilizada pela integração. No GitHub, **Settings → Applications → Installed GitHub Apps → Vercel → Configure**, conferir acesso ao repositório. Não remover a integração nem trocar o repositório. A confirmação é uma execução em **Actions → Verified production release** com o evento esperado depois de uma publicação autorizada. Não presumir que READY ou um comentário no PR confirma essa entrega.

Se o controle não estiver disponível ou a entrega for incerta, existe reconciliação **opt-in**, duas vezes ao dia (`17 */12 * * *` UTC). Ela só executa com as duas variables de habilitação descritas abaixo. Não faz polling no app, não reconstrói o frontend e somente publica a produção atual. Versões intermediárias já substituídas não são lançadas retroativamente. Por padrão a reconciliação permanece desativada.

## Versão e inicialização

Sem Release oficial gerenciada, o fluxo automático bloqueia com `EXPLICIT_BASELINE_REQUIRED`.

A inicialização recebe `baseline_sha` (40 caracteres, exatamente o commit atual em produção) e `baseline_version` (`vMAJOR.MINOR.PATCH`, escolhido explicitamente). Não deriva a versão de `package.json`. Sua nota diz “Marco inicial”, sem listar PRs antigos como novidades. Pode adotar uma tag já existente **no mesmo SHA**, somente nessa operação explícita. Uma tag com outro SHA ou superior ao baseline escolhido bloqueia; não é movida.

Depois do baseline, a última Release estável oficial é identificada por SemVer e prova de publicação. Drafts/prereleases não são usados como última versão. Releases existentes sem prova gerenciada requerem auditoria/importação explícita; não são adotadas silenciosamente. Uma tag publicada movida ou removida bloqueia a automação.

Incremento pela maior categoria acumulada no intervalo:

- `semver:major`, título Conventional Commit com `!:` ou declaração `BREAKING CHANGE:` não vazia → MAJOR.
- `semver:minor`, label `feature` ou Conventional Commit `feat:` → MINOR.
- Demais casos, inclusive `semver:patch`, alterações técnicas e PR sem classificação → PATCH.

Sinais incompatíveis sempre vencem uma label PATCH. Labels são normalizadas para minúsculas. Nenhuma tag é reutilizada para outro commit. Alterações de árvore inexistentes, reexecução do mesmo commit e redeploy sem código inédito não criam versões.

## Changelog em português e rastreabilidade

`.github/release.yml` configura a geração oficial do GitHub nas categorias Novidades, Melhorias, Correções, Segurança e estabilidade e Alterações técnicas. O job `publish` consulta `releases/generate-notes` (POST somente de consulta, sem criar Release), confirma que seus PRs pertencem ao intervalo e registra o hash da fonte. Embora não salve conteúdo, esse endpoint [exige `contents: write`](https://docs.github.com/en/rest/releases/releases#generate-release-notes-content-for-a-release). Por isso `verify` e dry-run geram as mesmas notas determinísticas sem chamar esse endpoint e registram `deferred-until-publication`; o job de publicação exige a validação oficial antes de qualquer criação de tag. Uma falha nessa consulta bloqueia a publicação. Não se amplia a permissão do dry-run.

A apresentação final é determinística a partir dos PRs/commits comprovados, sem publicar o Markdown remoto bruto. A coleta usa GraphQL em lotes, não uma consulta REST por commit. Só entram PRs efetivamente integrados na main cujo merge commit faz parte do intervalo. PRs repetidos são deduplicados; commits diretos recebem links próprios. Intervalos/paginações acima dos limites seguros bloqueiam em vez de omitir mudanças.

Categorias usam labels `feature`, `enhancement`, `ui`, `mobile`, `performance`, `accessibility`, `bug`, `fix`, `security`, `stability` e seus sinais SemVer. Alterações não classificadas ficam em **Alterações técnicas**, não viram grandes funcionalidades inventadas. `release:skip` exclui mudanças sem relevância pública, mas não esconde segurança/alterações incompatíveis. Escopos convencionais `security`, `auth` e `rls` também indicam segurança.

Para melhorar a linguagem sem IA, incluir no PR uma linha factual em português:

```text
Nota de versão: Melhoramos o registro das séries de treino.
```

Essa linha é citada como fonte, não executada. Sem ela, conserva-se o título original; não há tradução automática nem inferência de funcionalidades. Todos os itens têm links. Incompatibilidades ganham aviso próprio. Descrições completas não são publicadas. Markdown/HTML e menções são escapados, padrões de credenciais/URLs privadas são redigidos e marcadores reservados são retirados do texto não confiável. Rótulos, títulos e notas devem ser revisados pelos mantenedores, pois a automação comprova inclusão do código, não interpreta seu comportamento.

No GitHub, labels podem ser criadas em **Issues → Labels → New label**, com os nomes acima. Não é necessário conceder permissão administrativa ao workflow para criar labels.

IA não está integrada e não é dependência ou requisito de custo. Toda a geração funciona sem chave ou serviço pago de IA.

## Idempotência e recuperação

Um único concurrency group serializa todas as modalidades, com `cancel-in-progress: false`. Nenhum evento é utilizado como lock de confiança; cada execução consulta o estado atual.

Antes de qualquer gravação visível, produção, CI, histórico e plano são recalculados. As tags anotadas incluem prova/hash estável do plano, sem dados de deployment que mudem em um simples redeploy. A Release inclui a prova correspondente e IDs verificáveis de deployment e CI. Conflitos são relidos, nunca sobrescritos.

Perdas de resposta após criação de referência ou Release são recuperadas por GET. Reexecuções reconhecem o registro existente. Uma falha depois da criação do objeto anotado mas antes da referência pode deixar somente um objeto Git sem referência; a nova tentativa não duplica tags publicadas.

Se houver uma tag reservada após falha parcial, a mesma produção/plano pode ser retomada por **workflow_dispatch → auto**. Uma tag com outro SHA/prova, uma Release manual conflitante ou metadados alterados no meio do processo exigem auditoria. Não apagar/mover tags nem publicar retroativamente para contornar o conflito.

Não existe transação atômica entre GitHub e Vercel. O código revalida imediatamente antes de cada escrita e depois da publicação. Uma troca/rollback que ocorra após a escrita é sinalizada como `POST_PUBLICATION_DRIFT_AUDIT_REQUIRED`; a Release não é apagada para esconder o evento. Inspecionar o run e a versão que foi observada naquele momento.

## Rollback

Operações de alias pendentes/reprovadas, rollback ativo ou sinal de rollback sem dados suficientes bloqueiam. `lastAliasRequest` é correlacionado com o deployment atual; histórico de rollback anterior não é confundido com um novo Git deploy criado depois dele. Uma promoção oficial concluída permite recuperar o fluxo.

O commit atual precisa pertencer à main e não pode retroceder/divergir da última versão lançada. Voltar a uma versão já publicada é um noop rastreável. Uma Release publicada não é editada/apagada; notas e provas originais permanecem auditáveis. Não há rollback de banco nem promoção automática.

## Configuração externa e ativação (somente após autorização)

1. Aprovar o PR, concluir o CI completo e mesclar respeitando as proteções. Publicar esse commit pela estratégia Vercel já autorizada. **Este sistema não autoriza o deploy nem substitui seus gates.**
2. Na Vercel, em **Settings → Environment Variables**, verificar **Automatically expose System Environment Variables**. O build precisa receber os três IDs/SHAs oficiais usados no manifesto. Não criar valores falsos nem sobrescrever essas variáveis para simular origem.
3. Criar em **Vercel Account Settings → Tokens** um token com escopo limitado à equipe do projeto e expiração adequada. Preferir acesso somente de leitura quando essa granularidade estiver disponível no plano. Em Hobby, não presumir que o token oferece permissões finas: o cliente desta automação impõe somente GET à API Vercel. Nunca colar o token em código ou logs.
4. No repositório GitHub, **Settings → Secrets and variables → Actions → Secrets → New repository secret**, criar `VERCEL_RELEASE_READ_TOKEN` com esse token. Não precisa criar PAT GitHub: o `GITHUB_TOKEN` é fornecido pelo Actions, com leitura em `verify` e `contents: write` somente em `publish`.
5. Em **Variables**, manter `EVOLUTUS_AUTO_RELEASE_ENABLED` ausente ou `false`. Manter `EVOLUTUS_RELEASE_RECONCILE_ENABLED` ausente ou `false`. Nenhuma dessas configurações é alterada por esta implementação.
6. Confirmar o manifesto no domínio e executar **Actions → Verified production release → Run workflow**, branch `main`. Sem histórico, escolher **initialize** e preencher SHA ativo e versão desejada. Como a variável de publicação ainda está desativada, somente o job de leitura executa: é o dry-run seguro de inicialização. Com histórico, escolher **dry-run**.
7. Conferir summary: domínio, deployment, SHA, CI, versão, conteúdo e plano da tag. Em build antigo sem manifesto, o bloqueio é esperado; a implantação deste PR precisa estar ativa antes dessa validação real.
8. **Obter autorização explícita de ativação.** Só depois mudar `EVOLUTUS_AUTO_RELEASE_ENABLED` para o texto `true`. Executar **initialize** uma única vez com os mesmos dados ainda atuais para criar o marco inicial. Inicialização não faz lançamento retroativo.
9. Confirmar entrega dos eventos oficiais. Se necessário/desejado, mudar `EVOLUTUS_RELEASE_RECONCILE_ENABLED` para `true` para a recuperação periódica leve. Não é requisito contratar Vercel Pro ou configurar webhooks pagos.
10. Se regras de tags impedirem criar `v*`, auditar o ruleset em **Settings → Rules → Rulesets** e conceder somente a criação permitida ao fluxo de Releases, mantendo bloqueadas atualizações/exclusões. Não usar bypass administrativo para contornar gates. A disponibilidade dessa UI depende do plano GitHub; o código não exige upgrade nem modifica regras.

Nas atualizações normais, após essa ativação, o processo é automático. Não há novos commits de número de versão.

## Deploy manual, recuperação e diagnóstico

Uma promoção via CLI de um build Git nativo continua elegível, pois conserva `gitSource` comprovável. Após a publicação autorizada, **Run workflow → auto** recupera uma Release não criada, consultando o deployment atual. Não exige novo commit ou deploy nesse caso.

Um upload CLI sem `gitSource` oficial não é aprovado por um SHA digitado, metadados `meta.*` ou pelo manifesto isoladamente. Para obter associação oficial comprovável, usar um build Git nativo do SHA aprovado e promovê-lo pelo fluxo autorizado. A recuperação de metadados insuficientes não é a mesma coisa que recuperar uma Release pendente: não se fabrica prova para evitar uma nova implantação quando a origem não pode ser demonstrada.

Logs ficam em **Actions → Verified production release**. Códigos importantes:

| Código | Ação |
| --- | --- |
| `CI_PENDING`, `MAIN_CI_MISSING`, `MANDATORY_JOB_NOT_APPROVED` | Aguardar/consertar o CI do SHA; jamais aceitar o de outro commit. |
| `DEPLOYMENT_NOT_ACTIVE`, `PUBLIC_IDENTITY_MISMATCH` | Conferir alias/domínio e se o manifesto pertence ao deployment atual. |
| `UNPROVEN_GIT_SOURCE` | Auditar a origem; não preencher SHA por suposição. |
| `EXPLICIT_BASELINE_REQUIRED` | Fazer o procedimento de inicialização. |
| `ROLLBACK_ACTIVE`, `ROLLBACK_STATE_UNCERTAIN` | Resolver/confirmar o estado pela Vercel; não lançar durante rollback. |
| `TAG_CONFLICT`, `TAG_PLAN_CONFLICT`, `EXISTING_RELEASE_CONFLICT` | Auditar a referência/plano; não usar force, PATCH ou DELETE. |
| `API_HTTP_401`, `API_HTTP_403` | Conferir credenciais, escopos e regras sem imprimir respostas privadas. |
| `API_HTTP_429`, `API_NETWORK_ERROR` | Aguardar o serviço e reexecutar o workflow; não recriar referências às cegas. |

Para pausar somente a publicação, definir `EVOLUTUS_AUTO_RELEASE_ENABLED=false`. Isso não altera o CI obrigatório, o frontend ou o banco. Para um dry-run, usar o modo **dry-run**. Para desligar apenas a reconciliação, definir sua variável como `false`.

## Testes e evidência sem escrita real

```sh
node --test scripts/release/*.test.mjs
node scripts/release/auto-release/dry-run-demo.mjs
```

Todos os testes são isolados, sem acesso à produção. A demo usa repositório/domínio/SHAs sintéticos, propõe tag e notas, repete o dry-run e comprova zero chamadas de rede/escritas. Sua saída de referência fica em `docs/AUTO_RELEASES_DRY_RUN.json`. Os testes também simulam aplicação em memória, repetição/concor­rência, perda de resposta, falha parcial, rollback, Preview e indisponibilidade das APIs. Isso não cria tags ou Releases reais.

A autorização e o dry-run contra o deployment real serão realizados **depois** do merge, implantação do manifesto e configuração das credenciais. Não declarar a automação ativa com base apenas nas simulações.

Fontes oficiais: [eventos Vercel/GitHub](https://vercel.com/docs/git/vercel-for-github#repository-dispatch-events), [schema/exemplos de dispatch](https://github.com/vercel/repository-dispatch), [variáveis de sistema Vercel](https://vercel.com/docs/environment-variables/system-environment-variables), [notas oficiais GitHub](https://docs.github.com/en/rest/releases/releases#generate-release-notes-content-for-a-release), [SemVer](https://semver.org/lang/pt-BR/).

## Continuidade e verificação de 26/10/2026

O trabalho foi recuperado sem reconstrução do worktree `/tmp/evolutus-auto-releases`, branch `feat/verified-production-releases`, baseado em `4a50238b8d3c91f0627731cc69065dcd772406f0`. Workflow, módulos, manifesto, documentação e 72 testes específicos já existiam sem commit. Os logs anteriores de lint e build estavam aprovados. As exclusões documentais de imagens e as alterações da tarefa financeira no diretório principal foram preservadas fora desta entrega.

A revisão corrigiu a chamada de `generate-notes` pelo job sem permissão de escrita, adicionou regressão para HTTP 403 e passou a persistir o hash das notas oficiais na prova da Release. O dry-run continua sem gravar no GitHub ou na Vercel.

A consulta autenticada somente de leitura confirmou o projeto/equipe/repositório configurados, o domínio `www.evolutus.com.br` verificado e o deployment ativo `dpl_3vKYnNXBLGQCLRpKNFeqirHXH6sp`, com `gitSource` GitHub do SHA acima. O [CI da main nesse SHA](https://github.com/Danielalveslira/treinos_academia/actions/runs/40313669147) concluiu com sucesso. Isso não substitui o CI do PR.

A verificação real bloqueou em `PUBLIC_IDENTITY_UNAVAILABLE`, pois o deployment atual ainda não serve o manifesto novo. Portanto o dry-run completo disponível nesta entrega é **simulado**, com resultado em `AUTO_RELEASES_DRY_RUN.json`; não constitui comprovação de execução completa contra produção. Implantar o PR por autorização própria e depois seguir o procedimento operacional acima para a primeira validação real. Nenhum deploy, tag, Release, secret ou variável de ativação foi criado por esta validação.
