# Arquivos e remoções

Todos os caminhos são relativos ao worktree `.finance-local/phase6`. A branch permanece `finance-advertising-phase6`; nenhuma operação de push/merge/deploy foi realizada.

| Grupo | Arquivos | Motivo |
| --- | --- | --- |
| Recuperação | `src/utils/advertisingRecovery.js`, `src/hooks/useAdvertisingSelection.js`, `src/hooks/useAdvertisingValidity.js` | Orçamento compartilhado, leases curtas, diagnóstico limitado e commit protegido. |
| Regressão | `src/hooks/advertisingRecovery.test.js` | Falha backend/canal, timers, foco, esgotamento, respostas antigas e desmontagem, para os dois hooks. |
| Páginas | `src/pages/Communities.jsx`, `src/pages/CommunityDetail.jsx` | Adiam alteração de estado até autorização atual; consulta duplicada eliminada. |
| Preview | `src/pages/MyAds.jsx` | Aviso DEV de campanhas/preços/métricas sintéticas. |
| Limpeza | `src/services/promotionsService.js`, comentário de `src/hooks/useCommunityFeed.js` | Removidos `getPromotionPackages` e `createPromotion`, sem importadores/chamadores em src/tests/scripts; comentário atualizado para motor comercial. |
| Banco | `supabase/migrations/20261206000001_finance_consolidation_guards.sql` | Correção aditiva do drift de constraints/default/grant; sem dados financeiros alterados. |
| Integridade | `scripts/check-migration-integrity.mjs`, `.test.mjs`, `MIGRATIONS_BASELINE.json` | Imutabilidade dos 203 arquivos históricos e adições por versão única/avante. |
| CI | `.github/workflows/supabase-tests.yml` | Gate de migrations e container correto no finance-e2e. |
| Harness financeiro | `scripts/homolog/finance/http-integration.mjs`, `prepare-runtime.mjs` | Fixtures com aceite sintético, URL explicitamente limitada a loopback e alias HTTPS do mock local. |
| Harnesses concorrentes | `scripts/commercial-engine-concurrency.mjs`, `supabase/tests/evocoins_concurrency.sh` | Precondições da política legal vigente nas fixtures; nenhuma proteção/teste removido. |
| Harnesses publicitários | `phase6-seed.mjs`, `phase6-browser.mjs`, `phase6-live-browser.mjs`, `phase6-reinstall.mjs` em `scripts/homolog/finance` | Preservar capacidade, título único, verificar fallback real e incluir migration de consolidação no upgrade. |
| Auditoria reproduzível | `scripts/homolog/finance/consolidation-readonly.sql`, `consolidation-audit.mjs`, `consolidation-clean.mjs`, `consolidation-schema.mjs`, `consolidation-registry.mjs`, `consolidation-rotation.mjs`, `consolidation-visual.mjs` | Diagnóstico sem mutação, instalação vazia, paridade e 13 rotas responsivas. |
| Instalador local | `scripts/homolog/finance/migrate.mjs` | Allowlist adicional estrita de containers descartáveis da consolidação. |
| Documentação | Documentos desta pasta, manifesto histórico e link no checklist geral | Entrega atual, responsabilidades, segurança, migrations, performance e lançamento. |

## O que não foi removido

Ledger, compras/pacotes históricos, eventos, revisões, mecanismos de cancelamento/exclusão de conta, helpers de dívida, gateway/coletor de mídia, CRUD editorial legado com consumidores e primitivas InfinitePay. A RPC histórica `create_promotion` permanece para replay seguro; foi removido somente seu wrapper frontend sem consumidor, não o histórico.

Tabelas editoriais distintas não foram unificadas artificialmente. Nenhuma dependência nova, carteira, ledger, upload, leilão, CPC/CPM ou configuração comercial oficial foi introduzida.

## Evidências

Resultados reexecutados das fases anteriores são copiados para `evidence/previous-phase-rerun`, preservando o caminho de origem. Os arquivos históricos das fases não foram substituídos pelos novos resultados. `evidence` contém também os logs finais da consolidação; logs exploratórios/falhas de ambiente não são apresentados como aprovação. Capturas PNG são regeneráveis, ficam localmente e são ignoradas pelo Git.
