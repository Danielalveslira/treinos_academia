# Expiração automática de publicações — produção

Publicado no Supabase `ywrjojrjgozdfpddkkuy` em **13/10/2026**. Ativação às **14:16:39 UTC**, Storage confirmado às **14:19:06 UTC**. GitHub/Vercel serão confirmados na revisão final deste relatório.

## Resultado real

- **30 publicações removidas definitivamente**: 15 textos, 11 fotos, duas publicações de treino, uma enquete e uma conquista. IDs removidos correspondem exatamente aos candidatos registrados antes da ativação.
- **15 preservadas**: 14 ainda não expiradas e uma expirada com promoção válida e paga. `c73d8851-f50b-4d87-ada5-c1f99929d803` permanece visível, promovida e agendada para **16/10/2026, 01:28:01.216846 UTC**. A elegibilidade será reavaliada nessa data; novas restrições/promoções podem adiar a exclusão.
- **11 fotos efetivamente removidas pelo Storage API**: outbox AUD-04 completa, uma tentativa por foto, nenhum erro; todos os 11 objetos ausentes em `storage.objects`. Resposta real do worker cron: HTTP 200, `cleanupQueued=11`, `cleanupCompleted=11`, `cleanupErrored=0`.
- Hashes agregados e contagens de ledger `economy_transactions`, compras, wallets e tabelas de casos financeiros permaneceram idênticos. As linhas de promoções e seus snapshots econômicos também permaneceram; somente os campos de estado/cancelamento do trigger já existente mudam para `target_removed` quando o alvo é removido.
- Primeiro lote: **148,586 ms**, 30 examinadas/excluídas, zero erros. Não houve comando SQL manual para iniciar a limpeza: a migration de ativação executou o lote inicial automaticamente.
- Cron **`expire-statuses`, ID 13**, único, ativo, `* * * * *`, usuário postgres. Três execuções periódicas pós-ativação confirmadas, sem novas exclusões ou erros; fila com 15 registros futuros, nenhum devido ou com erro. O cron existente da AUD-04 foi reutilizado sem duplicação.

## Causa raiz e solução

Não havia rotina de exclusão definitiva por expiração. Feed, prévias e leitura das fotos usavam somente `expires_at`; votos e comentários confiavam no prazo promocional denormalizado. Assim, uma publicação paga podia sair do feed e perder acesso à foto antes do fim do contrato; flags antigas podiam prolongar interações indevidamente.

A promoção é validada no banco por alvo/tipo, autor, comunidade, estado, cancelamento, início e vencimento na tabela de promoções, independentemente das flags. A view `status_publications`, com `security_invoker`, mantém RLS e relações do PostgREST e fornece datas verificadas para feed, destaques, prévias e contexto da publicação. Storage e RPCs de votos/comentários usam a mesma validade. Preços, débito, duração contratada e regras de comunidades permanecem os existentes.

A fila indexada agenda somente posts com expiração automática, preservando permanentes/sem expiração. A rotina interna revalida cada linha bloqueada, preserva promoções efetivas, treinos futuros e suporte aberto, processa 50 por cron (limite parametrizado 1–100), usa advisory lock e `SKIP LOCKED`, e registra eventos/contadores sem conteúdo pessoal. Falhas parciais revertem cascades/outbox daquele registro e recebem backoff de até uma hora. Logs próprios retêm 30 dias, com remoção limitada por ciclo. `statement_timeout=20s` e `lock_timeout=2s` limitam cada chamada do cron.

A compra de promoção bloqueia o status antes do débito, serializando com a limpeza. A exclusão usa diretamente o PostgreSQL e os triggers existentes, incluindo cascades, histórico de suporte com `SET NULL`, histórico promocional e captura AUD-04. Não chama a exclusão administrativa defeituosa da AUD-05. O worker processou naturalmente os jobs legados de alvos já removidos sem erros; não foi necessário alterar nem republicar Edge Functions.

A claim de Storage ignora objetos ainda referenciados. Locks por caminho normalizado e rejeição de novas referências a fotos já enfileiradas impedem que inserções concorrentes reintroduzam um arquivo durante a limpeza; referências compartilhadas vivas foram verificadas em SQL e no Storage local.

## Arquivos e migrations

- `supabase/migrations/20261028000001_status_expiration.sql`: instalação pausada, helpers, view, fila, triggers, logs, rotina e cron; ajustes de comentários/Storage/votos/compra.
- `supabase/migrations/20261028000002_status_feed_pagination_index.sql`: índice completo de paginação e locks de referências de fotos.
- `supabase/migrations/20261028000003_activate_status_expiration.sql`: valida prerequisites, privilégios e dependências conhecidas; ativa e executa automaticamente o lote inicial.
- `src/services/statusesService.js`, `src/services/promotionsService.js`: leituras com datas e promoção verificadas.
- Testes dos serviços em `communityActivityService.test.js`, `feedPageService.test.js`, `sharedStatus.test.js`, `statusVoteCounts.test.js`.
- `supabase/tests/status_expiration_test.sql`, `supabase/tests/status_expiration_performance.sql`, `scripts/verify-status-expiration-local.mjs`.
- Este relatório e `VERIFICACAO_EXPIRACAO_PUBLICACOES.json`, com candidatos, hashes, resultados e métricas sanitizados.

As três migrations foram aplicadas uma única vez, em etapas. Antes da ativação: pré-diagnóstico somente leitura, inspeção das FKs/triggers reais, comprovação do débito da promoção protegida, comparação de hashes financeiros e dos corpos das funções publicadas, RLS/grants, cron único e dry-runs isolados. Histórico **126 → 129**; dry-run final sem pendências. Nenhuma migration anterior foi editada.

## Testes e performance

**1.890 testes JavaScript aprovados; 145 testes Edge Functions aprovados e um skip preexistente; 35 assertions pgTAP novas e 557 de regressão aprovadas; 20 verificações de integração/concorrência aprovadas.** Lint sem erros (14 avisos preexistentes); build aprovado (aviso preexistente de chunks grandes).

Cobertura: todos os cinco tipos de publicação; permanente, futura, promoção válida/encerrada/cancelada/alvo inválido/autor ou comunidade divergentes/início futuro e flag sem promoção; comentários, votos e participantes em cascade; suporte aberto/fechado; snapshots de compras/ledger/promoções; falha parcial com rollback; backoff/retry; RLS e privilégios; referências compartilhadas; remoção física/retry/idempotência no Storage; sessões concorrentes com row lock e advisory lock; integração real do embed PostgREST da view.

Em 20 mil posts sintéticos, inclusive timestamps iguais, seleção indexada dos candidatos **0,138 ms**, feed com 11 itens **1,154 ms**, exclusão de 20 **16,888 ms**. O índice adicional eliminou a ordenação que inicialmente levava cerca de 391 ms. Valores locais servem como evidência desse cenário, não garantia universal de latência.

A suíte JavaScript foi repetida fora do sandbox porque testes de fuso usam subprocessos bloqueados com EPERM. Configurações e dados sintéticos antigos da homologação foram isolados/restaurados; cron remoto da homologação permaneceu desativado.

## Operação e limites

Acompanhar `status_expiration_runs/events`, tentativas/erros/datas em `status_expiration_queue`, backlog/erros da `storage_cleanup_tasks`, `cron.job_run_details` e respostas do worker. Suporte aberto é reavaliado em uma hora; conteúdo permanente não entra na fila. Em incidente, pausar `status_expiration_control.enabled` como operação administrativa, mantendo logs e tarefas. Não apagar registros financeiros nem reabrir privilégios de cliente.

Os logs verificados foram os do PostgreSQL/cron e as respostas HTTP persistidas de `pg_net`; não houve exportação de logs de console do runtime hospedado. A AUD-05 administrativa continua fora deste escopo. Não há pendências de limpeza no lote publicado.

Implementação baseada nos recursos nativos documentados em [Supabase Cron](https://supabase.com/docs/guides/cron) e na [view com security_invoker do PostgreSQL](https://www.postgresql.org/docs/current/sql-createview.html).
