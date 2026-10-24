# Evolutus — preparação final do PR

**PR preparado localmente; publicação em produção BLOQUEADA.** Revalidação remota de 2026-10-24: Supabase/Vercel autenticados, 14 pendentes confirmadas e promoção automática Vercel ainda ativa. Evidência: [remote-reverification.json](remote-reverification.json). Branch: `chore/finance-release-readiness`, sem push. Este documento sucede os estados antigos de assinatura e autenticação dos relatórios anteriores. Evidência atual: [pr-readiness-evidence.json](pr-readiness-evidence.json).

## Trabalho preservado

As seis migrations financeiras, integrações Auth/offline e regras de EvoCoins/EvoCash já implementadas foram preservadas. Os três commits locais anteriores continuam intactos: `7b6738e`, `c3cb962`, `341c819`. São não assinados; não foram reescritos, pois a main atual não exige assinatura e não houve autorização para alterar esse histórico. A main local continua nesse ponto; os novos commits estão somente na branch específica.

Instalação limpa e atualização incremental foram repetidas neste Codespace: **162 migrations / 148+14**, contrato financeiro selecionado igual e hashes dos dados anteriores preservados. A evidência antiga de 161 foi mantida em seu arquivo original; a nova está em [install-162-results.json](install-162-results.json). O contrato compara as funções/relações selecionadas em `finance-schema-contract.sql`; a policy de lembretes possui também sua própria suíte de sete assertivas. Nenhuma migration histórica ou das 13 candidatas originais foi alterada.

## Correções e configuração final

- RLS de lembretes financeiros exige sessão ativa além de superadmin. Sessão revogada/malformada não lê metadados; histórico não é apagado.
- Vite agora bloqueia `.finance-local` preservando seus bloqueios padrão. Um canário sintético era servido com HTTP 200 por URL direta e `/@fs`; depois da correção, quatro variantes (direta, @fs, raw, url) retornam **403**, e `/app` continua **200**. Nenhum backup/chave real foi solicitado por HTTP. Nova regressão real de servidor cobre esse comportamento. Scanner também recusa artefatos privados rastreados, mesmo binários.
- Testes PostgreSQL de Push recebem o helper de sessão pelo stdin e funcionam sem mount `/workspace` específico. As sessões e assertivas continuam reais.
- CI usa `npm ci`, CLI Supabase 2.119.0 do lockfile, actions fixadas por SHA, credenciais não persistidas e permissões mínimas. A referência indisponível `supabase/setup-cli@v1` foi removida. Lint/build/aplicação/Functions/SQL/RLS/Auth/financeiro e scanner alimentam o check `finance-quality`, que falha em resultado obrigatório cancelado, pulado ou com erro.
- Push na branch `chore/finance-release-readiness` dispara o workflow atualizado. `vercel.json` desabilita deploy Git de main, finance-ci-* e desta branch; previews de outras branches permanecem. **É configuração local ainda não publicada.** O script de hold não executa PATCH sem `--apply-hold`; o template de promoção permanece desativado fora dos workflows ativos.

## GitHub e assinatura

CLI e credencial HTTPS foram verificadas separadamente contra a API: **Danielalveslira**, com permissões admin/push/pull no repositório privado `Danielalveslira/treinos_academia`. O helper HTTPS remove a sobreposição dos tokens automáticos do Codespace. Nenhum token foi impresso.

SSH: a chave existente foi reutilizada; assinatura e verificação passaram com **Good "git" signature**. A mesma chave pública foi encontrada no cadastro de signing keys de Daniel pela API. `allowedSignersFile` local foi configurado em diretório ignorado; nenhuma chave nova foi gerada.

Cinco commits novos de código foram criados com assinatura válida (`git log` = G):

| Commit | Conteúdo |
| --- | --- |
| `8715f22` | sessão ativa na leitura de lembretes |
| `132ad99` | bloqueio HTTP de arquivos privados e regressão |
| `e05ec55` | fixtures de Push portáveis |
| `e15d5a1` | auditoria de schema/recuperação somente leitura |
| `4f77d8f` | CI e gates de release |

**Atribuição transparente:** esses cinco têm Daniel como autor/chave SSH, mas o ambiente do agente ainda impôs `GIT_COMMITTER_NAME=GitHub` e `GIT_COMMITTER_EMAIL=noreply@github.com`, que prevalecem sobre git config. Não são commits de chatbotlira. Todos os commits foram preservados conforme a instrução atual; não houve normalização ou reescrita de atribuição. Comandos seguintes de commit usam explicitamente Daniel como committer. Os três antigos não serão tocados. A marca Verified no GitHub só poderá ser conferida após push autorizado; a verificação criptográfica local e o cadastro da chave já passaram.

## Testes executados nesta preparação

| Verificação | Resultado |
| --- | --- |
| Instalação limpa / upgrade com dados | **162 / 148+14**, schema selecionado e dados preservados |
| SQL completo | **69 suítes, 3.035 assertivas**, zero falhas/skips |
| Edge Functions com PostgreSQL sintético real | **207/207**, zero falhas/skips |
| `npm test` | **2.092/2.092**, zero falhas/skips; 109,17 s |
| Scripts de release, scanner, gates e HTTP privado Vite | **17/17**, zero falhas/skips |
| `npm run lint` | Zero erros; 16 avisos preexistentes |
| `npm run build` | Aprovado, Vite 14,33 s; aviso preexistente de chunks |
| Scanner de código/bundle | Zero achados nas execuções registradas |

As 69 suítes incluem financeiro, RLS, Auth, Storage, revogação de sessões e offline. O banco sintético utiliza schemas preparados pelos serviços Auth/Storage reais. Os testes não rodaram no banco restaurado com dados reais nem em produção. HTTP de pagamento, Chromium offline e carga continuam com as evidências anteriores; não foram declarados como novas execuções. Não houve mudança no motor financeiro ou no bundle de funcionalidades nesta etapa; a configuração nova de Vite atua somente no servidor de desenvolvimento.

[Resultados SQL completos](pr-sql-results.json), [resumos](pr-test-summaries.log) e [testes dos scripts](pr-release-tests.log). Os logs integrais privados e hashes estão em `.finance-local/remote/` e no JSON de evidências. Os bancos de teste foram parados ao final; não ficaram suítes pesadas em execução.

## Backup, Supabase e Vercel

O backup criptografado e a chave sobreviveram à retomada. SHA-256 e descriptografia foram verificados novamente em memória, sem gerar plaintext em disco. A restauração anterior havia conferido 19 tabelas e o catálogo, com diferença de deparse revisada. O container `evolutus_finance_restore_verify`, parado e contendo a cópia real descriptografada, **foi removido** após conferir arquivo/chave/evidências. Backup e evidências não foram apagados. O script temporário com metadados de conexão deixou de ser necessário e foi removido.

Ainda falta comprovar guarda externa do ciphertext, chave em cofre separado, responsável, retenção e recuperação de configuração/Storage. O banco recuperável local não é proteção contra perda do próprio Codespace. Não foi contratado PITR/plano ou serviço novo.

A revalidação remota de 2026-10-24 confirmou:

- **Supabase:** autenticação válida, projeto `ywrjojrjgozdfpddkkuy` / evolutus.com.br / ACTIVE_HEALTHY. Journal com 148 versões até `20261111000001`; dry-run com exatamente 14 candidatas, sem seeds/roles, com `--skip-vault`. Zero divergência em seis carteiras, 166 lançamentos e 25 compras; teto diário 10; estornos desativados; cliente sem UPDATE de carteira. Comparação atual de 297 funções/92 relações/66 triggers preserva somente as três diferenças de grants já revisadas, sem novo drift. Nenhuma migration aplicada.
- **Vercel:** sessão renovada pela CLI oficial, whoami `danielalveslira`. Equipe/projeto esperados e deployment atual confirmados. `productionBranch=main`, raiz do repositório, um único projeto desse time ligado ao repo; listagem completa. **autoAssignCustomDomains=true: promoção automática ainda não bloqueada.** O PATCH proposto altera somente esse valor para false e aguarda autorização. Nenhum PATCH ou deploy foi executado.
- **GitHub:** identidade Daniel confirmada; main continua em `0cdde0e`, protected=false, API de proteção 403 por plano compatível. Actions habilitado. A branch não existe remotamente e não tem PR. Checks ainda não são requisito imposto de merge.

O envio isolado foi verificado no escopo do projeto esperado: `chore/finance-release-readiness` não é a branch de produção; o `vercel.json` dessa revisão desativa seu deploy Git; o workflow ativo executa somente testes em ambiente descartável, sem comandos de deploy ou credenciais de produção. A autorização para push, PR draft e CI foi solicitada separadamente do hold. Não houve envio.

Backup: ciphertext existente com SHA-256 confirmado, chave presente e ensaio anterior de restauração preservado; container real descriptografado removido. Ainda **não existe evidência de custódia externa e chave independente**. Faltam destino externo privado aprovado, cofre separado para chave, comprovação de recuperação a partir dessas cópias, responsável, retenção e RPO/RTO aceitos. Também documentar custódia de configuração/secrets e objetos Storage, não incluídos como bytes no dump SQL; fazer cópia atual na janela de implantação. API gerenciada continua sem listar backup utilizável e com PITR=false. Nenhum serviço pago criado nem novo restore executado.

As suítes já concluídas não foram repetidas: somente leitura, dry-run, verificação de assinaturas/hash do arquivo e gates leves. As falhas antigas de login preservadas em logs não representam o estado atual.

## PR e próximas ações

Descrição pronta: [PR_DESCRIPTION.md](PR_DESCRIPTION.md). Com logins/equipe/projeto/productionBranch confirmados, autorizar o hold Vercel e seu envio isolado; configurar proteção suportada sem tornar o repositório público ou enfraquecer políticas. O envio e a criação remota deste PR dependem de autorização explícita.

Comandos preparados, **não executados**:

```bash
# Somente após conferir Vercel, identidade e obter autorização para enviar ESTA branch:
git push -u origin chore/finance-release-readiness
# Abrir como draft; nenhum merge/produção é solicitado:
env -u GITHUB_TOKEN -u GH_TOKEN gh pr create --draft --base main --head chore/finance-release-readiness --title "fix: concluir segurança financeira e preparar publicação controlada" --body-file docs/audits/finance-release-verification/PR_DESCRIPTION.md
# Selecionar a execução da branch e do SHA exato enviado, sem reutilizar checks antigos:
env -u GITHUB_TOKEN -u GH_TOKEN gh run list --workflow supabase-tests.yml --branch chore/finance-release-readiness
env -u GITHUB_TOKEN -u GH_TOKEN gh run watch "$CI_RUN_ID" --exit-status
```

Nenhum CI do conteúdo atual foi executado no GitHub; os testes locais estão aprovados. Resolver backup externo e proteção de publicação antes da implantação. As 14 candidatas estão listadas em [LIBERACAO_SEGURANCA.md](LIBERACAO_SEGURANCA.md); o plano remoto foi reconfirmado no dry-run de 2026-10-24; revalidar na janela de publicação. Ordem autorizada futura: backup atual e recuperação → CI/proteções → pré-check/dry-run → banco → oito Edge Functions → diagnóstico/smoke backend → build production sem domínio → smoke revisado → promover o mesmo build → monitorar. Estornos automáticos e novos agendamentos permanecem desativados.

Rollback operacional: preservar ledger/carteiras/casos/obrigações; conter novas origens afetadas e manter confirmação de pagamentos iniciados; retornar frontend/Edge a versão compatível e corrigir banco por roll-forward revisado. Não usar restauração destrutiva de snapshot como rollback rotineiro.

**Resultado:** trabalho local validado e branch/descrição do PR preparados. Produção bloqueada por backup externo/chave independente não comprovados, promoção automática Vercel ainda ativa e proteção/CI remoto ainda não efetivados. Logins Supabase/Vercel resolvidos. Sem push, merge, deploy ou migration remota.

A rota de desenvolvimento foi restaurada: `/app` responde 200 na porta 5173, e o canário privado responde 403 no mesmo servidor. O banco sintético foi parado. Nenhuma limpeza global de imagens/caches de outros trabalhos foi executada.
