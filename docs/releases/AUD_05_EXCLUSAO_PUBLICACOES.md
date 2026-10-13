# AUD-05 — Exclusão administrativa de publicações

## Diagnóstico e alteração

O `run_deletion_job(uuid)` implantado atribuía `statuses.photo_path` (texto escalar) a `v_photo_paths` (`text[]`) no ramo de publicação individual. Uma foto com caminho canônico produzia `22P02: malformed array literal`. A subtransação revertia a exclusão e seus triggers, mantendo a publicação e o job pendente, com `last_error`; não criava a tarefa AUD-04. Reproduzido localmente antes da alteração. A definição local original foi comparada integralmente com a de produção.

A migration `20261030000001_aud05_status_deletion.sql` substitui apenas essa atribuição por `coalesce(array_agg(photo_path), '{}'::text[])`, filtrando caminhos nulos. Retorna um array de um elemento para foto e vazio para texto/alvo ausente. Preserva o restante do corpo da função, proprietário, `SECURITY DEFINER`, `search_path`, grants, retenção financeira, tratamento de erros e transações. Não altera frontend, Edge Functions, tabelas, índices, RLS, workers ou crons.

## Mapa de impacto auditado

| Caminho/dependência | Comportamento preservado e validação |
| --- | --- |
| Autor, proprietário de comunidade e superadmin | `statusesService.deleteStatus`, estado/cache do feed e exclusão direta; RLS exige identidade/permissão e acesso à comunidade. Testes de autor, proprietário e usuário não autorizado. |
| Exclusão administrativa em fila | `queue_deletion` exige superadmin autenticado; `run_deletion_job` é executável apenas por `postgres`/`service_role`. Worker `process-deletion-jobs` existente, sem republicação. |
| Texto, foto, enquete, treino, conquista e permanente | Conteúdo e tipos existentes preservados; exclusão individual com/sem foto coberta por pgTAP. Ramos de conta/comunidade já agregavam arrays corretamente. |
| Comentários, respostas, likes, votos, participantes e contadores | FKs, cascades e triggers existentes; cobertura SQL de comentários, apoio, feed, enquete e treino. Exclusão atômica com a captura de limpeza. |
| Denúncias, suporte e moderação | FK de publicação/comentário em suporte usa `SET NULL`; snapshot, decisões e histórico permanecem. Evidência é copiada para `moderation-evidence`, fora do ciclo de vida da foto original. Essa cópia já é best-effort: uma falha anterior de captura não é corrigida pela AUD-05. |
| Promoções, compras, carteiras, ledger e retenção | Expiração respeita promoções efetivamente vigentes e suporte aberto. Remoção manual autorizada segue a regra existente de marcar promoção ativa como `target_removed`, sem apagar compra/ledger ou gerar reembolso. Promoções encerradas/canceladas preservadas. Gates de exclusão de conta e vínculos a casos financeiros permanecem intactos. |
| Expiração e Recentes/Destaques | Processador de expiração, `status_publications`, prazos verificados e filtros do feed permanecem inalterados. Regressão SQL e integração de expiração/promoção passaram. |
| Notificações, push e links | FKs de notificações e respectivas filas/entregas fazem cascade; assinatura permanece. Link de publicação removida segue o tratamento existente de alvo ausente. Push já entregue externamente não pode ser desfeito. Nenhuma alteração nesse fluxo. |
| Storage / AUD-04 | Trigger `statuses_storage_cleanup` captura `OLD.photo_path` na mesma transação. Validação de chave canônica, tombstone contra reutilização, deduplicação, advisory locks, referências compartilhadas, leases, fencing, backoff e retentativas continuam existentes. A remoção física permanece assíncrona. |
| Erros e concorrência | Lock do job serializa execuções; repetição de job concluído é ignorada. Corrida autor/administrador mantém uma tarefa. Falha de banco reverte publicação/cascades/outbox e persiste diagnóstico; falha de Storage mantém tarefa pendente e arquivo até retentativa. |

## Testes e performance

- Falha original reproduzida antes da correção: `22P02`, publicação presente e nenhuma tarefa de limpeza.
- Teste permanente `supabase/tests/aud05_status_deletion_test.sql`: 32 verificações, incluindo tipos, permissões, RLS, promoções, finanças, suporte, rollback e repetição.
- Runner SQL local: 15 suítes, 601 verificações pgTAP aprovadas. Isolamento de fixtures/filas dentro de rollback permite executar regressões antigas sobre o banco local já populado sem alterar seus dados anteriores.
- Integração AUD-05: 19 verificações com Auth/PostgREST/Storage reais locais, falha simulada de Storage, dois workers concorrentes e corrida autor/administrador. Integração AUD-04: 29 verificações. Integração de expiração: 20 verificações.
- JavaScript: 1.912 aprovados. Edge Functions: 151 aprovados e um skip preexistente. Lint: zero erros, 14 avisos preexistentes. Build aprovado, com aviso preexistente de chunk.
- Uma repetição da integração encontrou `ECONNRESET` no gateway local; a execução seguinte concluiu todas as 19 verificações. Não foi mascarado erro de aplicação.
- Consulta continua única por chave primária, agregando no máximo um caminho. Nenhuma consulta/frontend extra, dependência, novo lock, worker ou cron. Conta/comunidade, limites de lote e limpeza assíncrona inalterados.

## Publicação e recuperação

Conta `Danielalveslira`, repositório `Danielalveslira/treinos_academia`, `main`, `origin`; Supabase `ywrjojrjgozdfpddkkuy`; Vercel `treinos_academia` / `prj_WYVlCGYu021KZCrqfp62qRH2cbIE` conferidos. Pacote isolado com 130 migrations históricas e somente a nova migration; dry-run confirmou exclusivamente `20261030000001` e a aplicação foi concluída. Sem seeds, roles, Vault ou Edge Functions publicados.

Definição, proprietário, grants, dependências, estado das filas e hashes de dados foram registrados antes da aplicação. Recuperação preparada: restaurar apenas a definição anterior da função em transação com `lock_timeout=5s`. Isso não restaura conteúdo já excluído nem deve remover tombstones, reprocessar tarefas concluídas ou alterar histórico financeiro. Arquivos operacionais e credenciais não fazem parte do commit.

As evidências sanitizadas de produção, commit e deploy são registradas em `AUD_05_PRODUCAO_EVIDENCIAS.json`. O smoke usa exclusivamente uma nova publicação com imagem sintética própria; insert com service-role impede enfileirar recompensa EvoCoins. A fila é executada somente para seu job, e a remoção física é feita pelo cron AUD-04 já existente, sem execução global manual.

Validação em produção concluída em 2026-10-13: publicação `0491dbd1-55ef-47c3-917e-cd1867e1282c`, job `6fbf39e0-4fe1-44e2-9dfb-2c0678306d0b` e tarefa AUD-04 `69076896-ad64-47f8-84c6-c7d4914a463e`. Job e tarefa concluídos sem erro; limpeza em uma tentativa às 20:19:00 UTC. Registro e objeto em `storage.objects` ausentes; download via SDK e GET autenticado sem cache retornaram `Object not found`, com o bucket existente. O primeiro GET público retornou `Bucket not found` por se tratar de bucket privado e foi substituído pela verificação autenticada antes de considerar a remoção comprovada.

Cron com execuções `succeeded` e resposta HTTP 200 do worker: `cleanupCompleted=1`, `cleanupErrored=0`, `errored=0`. Hashes de todos os posts preexistentes, promoções, ledger, carteiras, compras e arquivos de evidência iguais antes/depois; nenhuma recompensa financeira enfileirada para a fixture. Sessão temporária revogada apenas no escopo local. Commit/push e status do deploy automático correspondente serão informados na entrega final; não há alteração de frontend a implantar.
