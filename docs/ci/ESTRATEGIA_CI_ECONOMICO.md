# Estratégia de CI econômico do Evolutus

## Regra de segurança

O check obrigatório `finance-quality` continua sendo o único gate agregado. Ele aceita `skipped` apenas quando o plano de escopo, calculado a partir do diff inteiro do PR por código da **base confiável**, dispensa aquele job. Falha, cancelamento, ausência de job, plano inválido, SHA divergente ou PR em rascunho bloqueiam o gate. No `push` de `main`, os jobs JavaScript, SQL, financeiro e secrets são sempre exigidos. A automação de release continua consumindo o resultado do workflow completo de `main`.

O job `scope` faz checkout do SHA da base, busca a ref do PR e verifica que o SHA buscado coincide com o evento. Executa `scripts/ci/plan.mjs` da base, não do PR. Se a base ainda não contém o classificador (a implantação inicial neste PR), usa **CI completo**. Alterações no classificador, no gate ou no workflow são classificadas como críticas pelo classificador já existente na base. Alterações desconhecidas também usam CI completo. O plano é vinculado ao SHA do commit do PR, verificado novamente pelo gate. Não são usadas labels para dispensar testes.

Como o classificador e o gate são lidos sempre do **mesmo** commit da base (nunca o classificador da base com o gate do PR, ou vice-versa), a transição entre versões do desenho é atômica: nunca existe um descompasso em que um plano de um formato é avaliado por um gate de outro. Um PR que altera `scripts/ci/plan.mjs` ou `quality-gate.mjs` só passa a valer a partir do commit em que for mesclado em `main` -- e, enquanto isso não ocorre, esse próprio PR continua sendo validado pela versão antiga (ou pelo bootstrap de CI completo, se a base ainda não tiver nenhuma versão), nunca pela versão nova que ele mesmo está propondo. Isso impede por construção que um PR reduza suas próprias exigências de validação.

## Suítes de navegador como união, não hierarquia

Cada arquivo alterado contribui um conjunto independente de suítes de navegador exigidas (`browser_base`, `browser_catalog`, `browser_full`), combinadas por OR lógico entre todos os arquivos do diff. Antes, um único modo hierárquico (`none < catalog < sheets < full`) escolhia apenas o perfil de maior prioridade entre os arquivos alterados -- um PR que tocasse catálogo e fichas ao mesmo tempo escolhia `sheets` e descartava silenciosamente `phase3-exercises-browser-smoke.mjs`, que só roda em `catalog` ou `full`. Os três indicadores atuais eliminam essa ordenação: cada um responde independentemente "este grupo de smokes é necessário?", então a combinação catálogo+fichas liga `browser_base` (fichas, Home, offline) **e** `browser_catalog` (catálogo) ao mesmo tempo, sem precisar de um modo composto. Cobertura: `plan.test.mjs`, "a PR touching both catalog and sheets runs the true union of both matrices".

## Matriz de execução

| Escopo acumulado do PR | JavaScript | SQL | Financeiro E2E | Navegador |
|---|---:|---:|---:|---|
| Apenas documentação reconhecida | dispensado | dispensado | dispensado | nenhum |
| CSS isolado de fichas | obrigatório | dispensado | dispensado | completo, por impacto visual |
| Catálogo apenas em arquivos JS específicos | obrigatório | dispensado | dispensado | catálogo + fichas, Home e offline |
| Fichas de treino | obrigatório | obrigatório | dispensado | fichas, Home e offline |
| Catálogo + fichas no mesmo PR | obrigatório | obrigatório | dispensado | união: catálogo + fichas, Home e offline |
| Publicidade, finanças, segurança, migrations, dependências, CI, componentes compartilhados, escopo desconhecido ou misto com qualquer um destes | obrigatório | obrigatório | obrigatório | completo |
| `main` e execução manual | obrigatório | obrigatório | obrigatório | completo |

Os testes unitários, lint, build, budget, gate de migrations e scanner do build continuam dentro de `js` quando ele é exigido. Secrets roda em **todos** os perfis. `sql` continua aplicando todas as migrations em uma base limpa e executando pgTAP, funções e concorrência quando exigido. A concorrência publicitária ocorre no job SQL; a segunda execução do mesmo script, que também usava somente acesso direto ao PostgreSQL dentro de `finance-e2e`, foi removida. O E2E financeiro real (Auth, PostgREST, ledger, carteira, navegador) permanece.

Rascunhos executam `scope` e `secrets`. O gate fica bloqueado até `ready_for_review`, que dispara a verificação correspondente ao escopo (`converted_to_draft` também é observado, então voltar um PR pronto para rascunho bloqueia o gate de novo no mesmo run). `synchronize` revalida a cada novo commit e cancela o run anterior do PR. `edited` revalida mudanças de base do PR; edições de título e descrição também podem gerar um run, custo pequeno aceito para não reutilizar uma aprovação calculada para outra base. `push` só em `main`, com grupo de concorrência por SHA, nunca cancela a validação pós-merge.

## Edição de título/descrição (`edited`) — risco analisado, comportamento preservado

`edited` dispara uma nova execução tanto quando só o título/descrição do PR muda quanto quando a branch base muda -- o evento do GitHub Actions não permite diferenciar os dois casos *no gatilho* (`on.pull_request.types`), apenas depois, lendo `github.event.changes` dentro de um job. Avaliei três formas de evitar o custo de uma edição de metadados e rejeitei todas por motivo de segurança, não por dificuldade de implementação:

1. **Remover `edited` do gatilho.** Rejeitado pela própria tarefa: uma mudança de branch base também chega como `edited`, e sem revalidação uma aprovação calculada para uma base antiga poderia ser usada para mesclar contra uma base diferente.
2. **Pular o job `finance-quality` inteiro quando `github.event.changes` não tiver a chave `base`.** Rejeitado: um job pulado (`if:` falso) produz um check-run com conclusão `skipped` para aquele nome, no mesmo SHA onde já pode existir um check-run anterior ainda `pending` ou `failure` (ex.: o autor edita o título enquanto o run de `synchronize` ainda está rodando, ou depois que ele falhou). Um `skipped` mais recente arriscaria ser lido como aprovação do SHA sem que o CI real tenha sido concluído -- exatamente "jobs ignorados interpretados como aprovação indevida".
3. **Pular só os jobs pesados (`js`/`sql`/`finance-e2e`) nesse caso, mantendo `finance-quality` real.** Não funciona: como o SHA não muda numa edição de metadados, o gate precisaria dos resultados *desta mesma execução* (`needs.<job>.result`) para decidir algo -- o Actions não deixa um job ler o resultado de um job de uma execução anterior (diferente `run_id`). Reavaliar a mesma `plan.mjs` para este SHA já reaproveita a classificação (ex.: um PR só-documentação continua dispensando os jobs pesados nesta nova execução, sem mudança); o custo extra só existe quando o escopo já exige CI completo, e nesse caso não há atalho seguro sem consultar a API de check-runs de fora da própria execução (API extra, nova permissão, risco de leitura inconsistente) -- fora do que "simples" cobre.

Conclusão, conforme instruído: como não existe solução nativa simples que elimine esse custo sem comprometer essas garantias, o comportamento atual (gate sempre reavalia os resultados reais desta execução) foi preservado. O custo real é pequeno na prática: só o título/descrição mudar não altera o SHA nem o diff, então a nova execução sempre reclassifica para o mesmo resultado da anterior -- o desperdício é limitado aos minutos de reexecutar jobs que já passaram para aquele SHA, nunca um risco de aprovação indevida.

## Primeira execução (bootstrap) — verificada por simulação direta

`scripts/ci/plan.mjs` e `scripts/ci/quality-gate.mjs` ainda não existem em `main` nesta entrega: a própria PR #152 é a primeira execução real deste desenho. Os dois pontos de verificação (`git cat-file -e "$CI_BASE_SHA:scripts/ci/plan.mjs"` no job `scope` e o equivalente para `quality-gate.mjs` no job `quality`) foram simulados localmente contra o SHA real de `origin/main` e o HEAD real desta PR, fora do runner: ambos os arquivos resolvem corretamente como ausentes na base, o plano cai no fallback `{"run_js":true,"run_sql":true,"run_finance":true,"browser_base":true,"browser_catalog":true,"browser_full":true,...}` e o gate cai no fallback que exige sucesso de `scope`+`js`+`sql`+`finance-e2e`+`secrets` e `draft=false` -- ou seja, a primeira execução real exige CI completo e não tem caminho de bypass. Simulação adicional do fallback do gate confirmou: todos os jobs com sucesso e sem rascunho aprova; rascunho reprova; um job obrigatório com falha reprova. Depois que esta PR for mesclada, a PR seguinte passa a usar o classificador real (já cobre essa transição: `plan.test.mjs`, "new commit invalidates previous plan and main always requires full CI").

## Verificações manuais necessárias (fora do alcance de qualquer script deste PR)

- **Revisão obrigatória antes do merge em `main`.** É o controle real contra um PR alterar o próprio `.github/workflows/supabase-tests.yml` (ou `scripts/ci/*`) para esvaziar um job e ainda reportar sucesso: a classificação sempre marca esses caminhos como CI completo, mas isso decide **se** o job roda, não **o que** o job faz no SHA daquela PR -- quem decide isso de verdade é a revisão humana antes do merge, não um script. Confirmar que a revisão está exigida nas proteções de `main`.
- **"Require branches to be up to date before merging"** nas proteções de `main` -- não pôde ser lido pela API nesta sessão (403 à integração atual); confirmar manualmente em Settings → Branches.
- **Nome do check obrigatório.** O job `quality` continua se chamando `finance-quality` (`name:` inalterado) especificamente para não exigir reconfigurar as proteções de branch; confirmar que é esse o nome exigido.
- **CODEOWNERS (opcional, recomendado).** Considerar exigir um revisor de confiança especificamente para `.github/workflows/` e `scripts/ci/`, já que são os únicos caminhos cuja alteração decide o que "CI completo" significa.

## Fluxo de desenvolvimento

1. Atualizar `main` e criar uma branch para a tarefa.
2. Desenvolver localmente. Rodar testes direcionados e, antes do push final, `npm run validate:local` (gate de migrations, `npm run lint`, `npm run test:backfill`, `npm run test:ci`, `npm test`, `npm run build`, `npm run budget`, nessa ordem, falhando rápido no primeiro erro).
3. Para SQL, usar uma stack local descartável com Auth e Postgres reais e executar pgTAP/concorrência relevantes. Nunca usar produção.
4. Revisar `git diff main...HEAD`, incluindo migrations, segurança e arquivos fora do escopo.
5. Solicitar autorização para um push. Usar PR em rascunho durante o desenvolvimento quando conveniente; promover a pronto para revisão para rodar o CI exigido.
6. Confirmar `finance-quality` e os checks obrigatórios no SHA final. Solicitar autorização separada para merge; validar e publicar em produção conforme o processo de release.
7. Limpar branches concluídas somente após confirmação de que não há trabalho local pendente.

## Medição de custo

Amostra medida pela API de jobs do GitHub Actions em 17/11/2026 (runs `44094530453`, `44081882250`, `44079028164`): 22,7 a 23,8 minutos **somados de tempo real dos jobs** por run completo, média aproximada 23,3. O workflow de parede levou 10,8 a 12,6 minutos por paralelismo. O GitHub arredonda cada job para cima na cobrança; estes runs equivalem a cerca de 26 a 27 minutos de runner faturáveis cada, antes de franquia e multiplicadores aplicáveis. A cobrança real da conta não foi acessada.

Estimativa para o perfil atual, usando a amostra e mais cerca de um minuto arredondado para `scope`:

| Perfil | Antes (minutos de runner arredondados) | Depois estimado | Redução estimada |
|---|---:|---:|---:|
| Documentação isolada | 26–27 | ~3 | ~88% |
| CSS ou catálogo JS | 26–27 | ~12–16, conforme smokes | ~38–56% |
| Fichas JS | 26–27 | ~18–21 | ~19–33% |
| Crítico ou `main` | 26–27 | ~26–28 | sem economia relevante por seleção |

O ganho mensal depende da mistura real de PRs e da quantidade de pushes. A meta de 50–70% **não é garantida**; deve ser reavaliada após um mês de runs, somando minutos de todos os jobs e cache/armazenamento. Em repositório privado, o custo acima da franquia depende do plano e do faturamento da conta. Referências: [cobrança e arredondamento](https://docs.github.com/en/billing/reference/actions-runner-pricing), [armazenamento de cache](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Caches, Vercel e runner próprio

O workflow já usa cache npm, cache do binário Playwright pelo lockfile e cache OCI financeiro com verificação de digest. Não foram adicionados novos caches de imagens grandes; o custo de armazenamento e a taxa de acerto precisam ser medidos antes de expandi-los. No modo seletivo, o navegador não é instalado quando nenhum smoke visual é exigido. A Vercel é uma integração externa: a política de builds de preview deve ser ajustada no projeto Vercel, não por um script com permissão elevada neste PR. Nenhum deploy de produção é disparado por esta estratégia.

Um runner próprio pode trocar minutos hospedados por custo de hardware, energia, rede, manutenção, backups, atualizações de Docker e disponibilidade. Requer isolamento efêmero e proteção forte contra código de PR: a [orientação de segurança do GitHub](https://docs.github.com/en/actions/reference/security/secure-use) alerta que runners próprios podem ser comprometidos persistentemente por código não confiável. Não será instalado nesta etapa. Primeiro medir o efeito da seleção e dos caches existentes.
