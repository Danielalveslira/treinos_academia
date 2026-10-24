> **Finalização posterior:** [estado atual de segurança e publicação](../finance-release-verification/LIBERACAO_SEGURANCA.md). Backup de banco restaurado; custódia externa, hold Vercel e CI/proteções continuam pendentes.

> **Verificação remota posterior:** autenticação e diagnóstico concluídos. O estado atual está em [finance-release-verification/RELATORIO_FINAL.md](../finance-release-verification/RELATORIO_FINAL.md). Publicação continua bloqueada por recuperação e controle de implantação. O conteúdo abaixo preserva a evidência da estabilização anterior.

# Estabilização financeira Evolutus — 2026-10-23

**BLOQUEADO PARA PUBLICAÇÃO. Validação local concluída, sem falhas ou skips nas suítes finais.** O impedimento atual é a ausência da autenticação CLI Supabase para confirmar destino, journal, schema e dados de produção. Backup/PITR e recuperação também precisam ser confirmados na janela de publicação. Não confundir aprovação local com aprovação do banco remoto.

Base: `0cdde0e` (PR #65 integrado). Nenhum push, deploy, pagamento real ou alteração de dados remotos nesta execução. As alterações financeiras e de Auth/offline anteriores foram preservadas; nenhuma migration histórica nem as seis financeiras do PR foram reescritas.

## Correções realizadas

| Problema | Causa comprovada | Correção e evidência |
| --- | --- | --- |
| `admin_accounts_defensive_test.sql` | A assertiva 75 esperava `active`, mas outra assertiva anterior já havia desativado o alvo. Reprodução: `have: disabled / want: active`. | O PR #65 já capturava o estado anterior real. Confirmado com 76 assertivas, inclusive rejeição da sessão revogada e ausência de mutação. Nenhuma proteção administrativa reduzida. Reprodução histórica em `logs/admin-original.log`. |
| `LOCAL_WORKER_FAILURE` | Imports absolutos do wrapper para fora da árvore compilada do worker não eram resolvidos: `Module not found ...provider-mock.ts`, depois `...functions/.../index.ts`. | Cópia temporária da árvore completa de funções, shim relativo e caminhos consistentes; código de produção preservado. Diagnóstico explícito no gateway local e espera por serviços saudáveis. O HTTP final passou nos oito cenários. |
| Reinícios do Codespace | `/tmp` foi perdido; containers antigos passaram a falhar com `RWLayer ... unexpectedly nil`. | Runtime/logs locais passaram para `.finance-local/`, ignorada pelo Git. Containers descartáveis reconstruídos, sem apagar código/evidências. Instalação atual repetida: 161 migrations. |
| `set_training_preferences` | Mesmo com `search_path=''`, uma tabela temporária `pg_timezone_names` substituía o catálogo: aceitava `Finance/Fake` e rejeitava `UTC`. | Nova migration `20261115000001` qualifica `pg_catalog.pg_timezone_names`, preservando assinatura, corpo restante, owner/grants e regras. Teste novo: nove assertivas para shadowing, sessão malformada/expirada e permissões. Reprodução em `logs/timezone-before.log`. |
| Regressões dos mocks de Edge | O helper de autenticação do PR passou a consultar `is_session_active`; o cliente fake não implementava RPC. Isso causava 44 falhas antes das operações reais dos handlers. | Mock implementa somente o contrato de sessão, com registro separado e falhas injetáveis. Teste adicional exige 401 para sessão revogada/consulta indisponível, sem Storage nem RPC privilegiada. |
| Testes de Push antes pulados | Fixtures não tinham sessões reais; uma expectativa de navegação ainda usava `/`, embora o próprio teste validasse `targetUrl='/app'`. | Helper de sessão real nos dois testes de integração; destino corrigido para o app autenticado. Os três cenários de PostgreSQL passaram, sem skips. |
| Teste de notificações após compras HTTP | Uma subconsulta escalar buscava créditos de todas as contas e retornava várias linhas. | Consulta limitada ao destinatário da fixture; valor esperado continua 25. Teste isolado e suíte completa passaram. |
| Disco cheio | Dois armazenamentos distintos de containerd coexistiam após a retomada: o atual em `/var/lib/docker/containerd/daemon`, o antigo inativo em `/var/lib/containerd`. | Removidos caches e snapshots obsoletos dos antigos containers descartáveis, após verificar separação de runtimes e autorização de limpeza. Projeto, credenciais, dependências e Docker atual preservados. De 100% para 59%, com 13 GB livres. |

## Migrations e instalação

Ordem: seis financeiras `20261112000001` → `20261112000006`; três de Auth `20261113000001` → `20261113000003`; três de integração `20261114000001` → `20261114000003`; correção de catálogo `20261115000001`.

| Financeira | Revisão final |
| --- | --- |
| 01 — permissões | Clientes sem acesso aos helpers internos; grants explícitos e paths controlados. |
| 02 — integridade | Inteiros finitos, constraints NOT VALID, ledger imutável, promoção serializada. Dados antigos não arredondados nem regravados. |
| 03 — finalização | Snapshot do pacote/preço, identidade/valor/moeda, estado final de reembolso, cancelamento local e confirmação tardia, cooldown persistente. |
| 04 — estornos | Registro compensatório, idempotência, obrigação separada e recuperação sem saldo negativo. Flag desativada. |
| 05 — recompensas | Evidência de recurso/evento, repetição de conteúdo, teto diário e lifetime preservados. Jobs legítimos não exigem sessão online do autor. |
| 06 — conciliação | Cursor e lotes limitados, sem reparo automático; lease/backoff/fencing token; índices de fila/findings. Nenhum cron novo ativado. |

Instalação limpa: **161/161**. Atualização com dados existentes: **148 históricas + 13 pendentes**, preservando os campos originais da carteira, ledger e compra. As novas colunas são comparadas no contrato de schema, sem tratá-las como alteração dos dados anteriores.

Contratos financeiros e de Auth iguais entre instalação limpa/incremental, SHA-256 `88c9babcaf13e0ec65abd0ca1d5242f6a3ab2045c0b7de8b985735deb15a7b3a`. Hashes dos dados antes/depois iguais, em `install-results.json`. O ensaio usa schemas preparados por Auth/Storage reais. `install-check.mjs` recusa alvo preexistente e configurações não sintéticas.

O teste de restauração inicialmente reproduziu crash do worker pg_net 0.20.4 ao remover/recriar o database padrão. A versão final troca exclusivamente sua instância descartável entre fases e restaura os schemas Auth/Storage. A operação problemática não faz parte das migrations nem do rollout.

## Testes finais

| Verificação | Resultado |
| --- | --- |
| SQL completo, com plano pgTAP verificado | **68/68 suítes, 3.028 assertivas, zero falhas/skips** |
| Financeiros específicos após carga (subconjunto do anterior) | **6/6 suítes, 73 assertivas, zero falhas/skips** |
| Auth, Storage, RLS, permissões e integração offline SQL | Incluídos na suíte completa, com schemas dos serviços reais |
| HTTP com Auth, PostgreSQL, PostgREST, Storage e Edge reais | **8/8 cenários**; provedor simulado, saída para pagamentos reais bloqueada |
| Edge Functions, PostgreSQL real habilitado | **207/207**, zero falhas/skips/cancelamentos |
| Logout/serialização entre escopos | **26/26**, zero falhas/skips |
| `npm test` | **2.092/2.092**, zero falhas/skips; 115,38 s |
| `npm run lint` | Zero erros; 16 avisos preexistentes |
| `npm run build` | Aprovado; Vite 17,10 s; aviso preexistente de tamanho de chunks |
| Chromium offline | Aprovado: 49 assets do SW, cold start, snapshot informativo, IndexedDB/outbox, escrita, reconexão e atualização do SW |
| Rota de desenvolvimento | `/app` retorna 200 e renderiza login para visitante anônimo, sem erro JS; hostname do Codespace aceito na porta 5173 |
| Bundle | 123 arquivos JS, sem JWT service_role ou referências às variáveis secretas backend verificadas |
| Pré-check de produção | **Não executado atualmente**: CLI sem token. Sintaxe e execução read-only validadas localmente |

A diferença para os antigos 69 arquivos é de descoberta: há scripts de diagnóstico sem plano pgTAP, que não são suítes. O runner atual executa `*_test.sql`, exige plano completo, ordem/quantidade de assertivas e ausência de `not ok`/erros. A nova suíte de segurança foi acrescentada; nenhuma suíte real foi retirada.

O navegador inicialmente não abriu por bibliotecas gráficas ausentes. O runtime e os pacotes Ubuntu necessários foram baixados/extraídos somente em `/tmp`; nenhuma dependência do projeto ou pacote global foi adicionado. O canário usa dados sintéticos e endpoint inválido isolado; a checagem de Vite bloqueou todas as requisições externas.

Logs persistentes ignorados pelo Git: `.finance-local/validation/` e `.finance-local/logs/`. Evidências portáveis: JSONs e logs selecionados neste diretório; hashes dos logs em `ECONOMIA_EVIDENCIAS.json` → `stabilization`.

## Concorrência e performance

Quinhentas tentativas financeiras, cinco cenários de 100, no máximo quatro conexões simultâneas; **zero erros inesperados e zero novos deadlocks**. Rejeições por saldo insuficiente são esperadas e contabilizadas. Estorno foi habilitado somente no banco sintético durante seu cenário e a configuração original foi restaurada em `finally`.

| Cenário | p50 ms | p95 ms | p99 ms | req/s |
| --- | ---: | ---: | ---: | ---: |
| Confirmação repetida | 421,10 | 566,80 | 628,62 | 9,29 |
| Replay da promoção | 424,48 | 606,39 | 663,63 | 9,21 |
| Gasto sem saldo | 420,82 | 589,66 | 616,06 | 9,29 |
| Estorno concorrente com gasto | 445,52 | 567,49 | 605,69 | 9,02 |
| Teto de EvoCoins | 379,23 | 534,35 | 551,62 | 10,16 |

Esses tempos incluem Docker/psql por tentativa. PostgreSQL limitado a 0,7 CPU/900 MiB; máximos **amostrados** de CPU 71,75% de um núcleo e memória 14,45% do limite. Não são picos contínuos nem latência/capacidade de produção. `concurrency.json` conserva as amostras por cenário.

No HTTP, 100 webhooks com concorrência progressiva 1/2/4 produziram um crédito/uma linha de ledger. No último grupo (68 requisições, quatro em paralelo), p50 79,84 ms, p95 103,55 ms, p99 111,60 ms e 56,08 req/s. Provedor local simulado, sem latência real da InfinitePay.

Microbenchmark: cinco amostras de 2.000 chamadas, mesmas transações revertidas. Helpers históricos: mediana 593,175 ms; motor atual: 940,178 ms; diferença +347,003 ms (+58,50%, aproximadamente **0,174 ms/chamada**). Essa comparação mede a validação/recuperação de obrigação do conjunto financeiro contra helpers históricos, não o custo da correção pontual do catálogo. Nenhuma otimização removeu proteção de integridade. Leitura comum da carteira continua pela PK; histórico não é somado a cada acesso do frontend.

## Segurança e InfinitePay

Nas condições testadas: EvoCoins respeitam teto diário 10, fonte legítima, chave de evento e lifetime consistente. EvoCash só é creditado após verificação servidor-servidor, com valor inteiro/identidade/moeda/pacote corretos; frontend não altera saldo; débitos são atômicos; replays/concorrência não duplicam benefício. Histórico confirmado não é apagado ou regravado; exclusão mantém vínculo com caso financeiro. Snapshot offline é informativo, não autorização de gasto; sessão revogada não lê carteira nem sincroniza.

HTTP verificou checkout/reuso, autenticação, isolamento entre contas, bloqueio de helper/alteração direta, resposta não paga, replay, erro de valor/moeda, indisponibilidade/timeout sem crédito, cancelamento local pago tarde e sessão revogada. As quatro funções foram executadas/compiladas no runtime real; a negativa administrativa confirma autorização do quarto handler. O simulador não altera endpoints de produção.

Contratos consultados novamente: [documentação de checkout](https://www.infinitepay.io/checkout-documentacao) e [ajuda oficial](https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay). Links e `payment_check` são os contratos usados. Opções avançadas dependem da chave/validação do lojista; não ativá-las sem confirmação. Não foi presumido endpoint de estorno ou busca de pedido sem identidade.

Estornos automáticos e novos agendamentos permanecem desativados. A política administrativa compensatória exige aprovação e comprovação no provedor; webhook público sozinho não prova reembolso/chargeback. Conciliação é paginada/idempotente e somente aponta divergências; não corrige saldo automaticamente. Recursos autodeclarados ainda não provam ação humana: limite, existência do recurso e fingerprint reduzem abuso, sem prometer proteção absoluta contra contas coordenadas.

## Pendências comprovadas e publicação

1. Restabelecer a sessão Supabase CLI no terminal, sem compartilhar token no chat. O vínculo local é `ywrjojrjgozdfpddkkuy`, mas a confirmação online do destino, journal e drift atual ficou impedida por `Access token not provided`. Ver `logs/supabase-auth-blocker.log`. A comparação anterior em `remote-baseline-drift.json` é histórica.
2. Executar `scripts/release/finance-production-readonly.sql` somente após confirmar o destino. Ele detecta unidades/configurações incompatíveis, saldo/lifetime divergente, crédito sem ledger e duplicidade, além de retornar metadados. Investigar qualquer ocorrência, preservando dados; nenhuma correção automática autorizada.
3. Confirmar backup/PITR, restauração em destino isolado, responsáveis e RPO/RTO. Avaliar janela de índices/validação de constraints com o tamanho real. Não executar reversão destrutiva de migrations.
4. Validar credenciais/opções avançadas e qualquer futuro estorno com o provedor, sob autorização. Essas capacidades não são liberadas por mocks locais.

Ordem exata e comandos estão em **[ECONOMIA_RUNBOOK.md](../ECONOMIA_RUNBOOK.md)**: confirmar projeto e executar pré-check → plano `db push --dry-run` → banco → oito Edge Functions (quatro financeiras e quatro consumidoras do helper administrativo) → build de produção Vercel sem atribuir domínio → smoke autorizado → promover o mesmo build. Manter flags/agendamentos fechados. Push/merge em main pode disparar frontend pela integração Git; não realizar antes da janela de banco.

Contenção: preservar webhooks dos pagamentos já iniciados, conter novas origens afetadas, manter ledger/grants, retornar frontend/Edge compatíveis e aplicar roll-forward revisado. Compensação somente aprovada e auditável; nunca DELETE/UPDATE de valores confirmados. Nenhum pagamento real de teste é permitido pela autorização atual.

**Resultado: BLOQUEADO PARA PUBLICAÇÃO por verificações remotas/recuperação pendentes; correções e validações locais concluídas.** Nenhuma falha local de segurança/integridade financeira permanece aberta nas suítes executadas. A autorização de publicação deve ocorrer somente após resolver os impedimentos acima.

## Consolidação local

- `7b6738e`: correção de segurança SQL e teste de regressão.
- `c3cb962`: harness local, fixtures de Auth/Storage/Edge e script de pré-check read-only.
- Documentação/evidências em commit separado, sem misturar alterações de autenticação já integradas no PR.

Autor e committer: Danielalveslira (`124009137+Danielalveslira@users.noreply.github.com`). O assinador automático `gh-gpgsign` do Codespace recusou a assinatura com `403 | Author is invalid`; os commits locais foram criados sem assinatura, por opção apenas nesses comandos, preservando a configuração de assinatura do repositório. Nenhum commit foi enviado.

Após os testes, os cinco serviços locais foram parados para liberar recursos; o banco/containers atuais permanecem preparados para reprodução, e Vite 5173 continua ativo. Chromium e bibliotecas temporárias foram removidos após a validação.
