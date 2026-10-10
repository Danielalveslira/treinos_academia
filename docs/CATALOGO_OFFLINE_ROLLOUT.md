# Catálogo de Exercícios Offline — rollout

Implementação do snapshot completo de texto (catálogo + taxonomia) e preparação seletiva de
imagens oficiais para uso offline do Catálogo de Exercícios. Ver
`docs/prompts/EVOLUTUS_PROMPT_CATALOGO_OFFLINE_COMPLETO.md` para o pedido original.

## Variáveis de ambiente

**Nenhuma flag nova é obrigatória.** A feature funciona com a configuração padrão do app
(`VITE_OFFLINE_READ_ENABLED` != `'false'`, que já é o padrão). Ela é **independente** de:

- `VITE_OFFLINE_WRITE_ENABLED` (escrita offline da outbox) — não relacionado.
- `VITE_OFFLINE_COLD_START_ENABLED` (abrir o app 100% sem rede, PWA fechado e reaberto) — **não
  depende e não deve ser ativado para "corrigir" esta feature**. O snapshot/preparação de imagens
  funcionam com o app já aberto perdendo a rede, que é o caso de uso principal do prompt original.
  Com o cold start desligado (padrão), abrir o PWA já fechado 100% offline continua limitado pelas
  mesmas regras de sempre — documentado abaixo, não escondido.

## O que foi entregue

1. **Snapshot completo do catálogo** (`src/services/offline/exerciseCache.js`,
   `src/services/offline/catalogSnapshot.js`): todos os exercícios ativos ficam disponíveis
   offline (busca, filtros, taxonomia, detalhe), com zero-resultado verdadeiro distinto de cache
   incompleto. Download em lotes de 50 (teto real do servidor) por keyset em `id` — determinístico,
   imune a nomes repetidos e a alterações concorrentes durante a varredura.
2. **Atualização barata**: fora da janela de 24h e sem clique em "Atualizar", **zero** chamadas de
   rede — só leitura local. Dentro da janela/forçado, uma única chamada de revisão antes de decidir
   se baixa tudo de novo.
3. **Imagens oficiais da rotina**: preparo seletivo (concorrência 2–3) com confirmação real via
   Cache Storage (não só o `fetch()` resolver), priorizadas na eviction do Service Worker por um
   manifesto gravado no próprio Cache Storage (sobrevive a reinício/atualização do worker).
4. **UI compacta** no Catálogo (`CatalogOfflineStatus.jsx`): status do snapshot + "X de Y imagens
   da rotina disponíveis", sem banner/modal.

## Estratégia de revisão — pendência conhecida

A revisão barata do catálogo (`get_exercise_catalog_revision`) e a varredura determinística
(`list_exercise_catalog_for_sync`) dependem de uma migration **local, ainda não aplicada**:
`supabase/migrations/20261025000001_exercise_catalog_offline_sync.sql` (+ teste pgTAP
`supabase/tests/exercise_catalog_offline_sync_test.sql`). Puramente aditiva — não altera
`search_exercise_catalog`, RLS ou nenhuma função existente.

**Sem essa migration aplicada**, o cliente trata a RPC como inexistente (erro `42883`) e cai para
a política de janela amortizada de 24h: o snapshot ainda funciona e se mantém atualizado, só paga
o custo de uma redownload completa extra na primeira vez que a janela expira após cada sincronização
(em vez de comparar revisão e só baixar se algo mudou de fato). Documentado, não escondido.

## Limites conhecidos

- **Cobertura real de fotos publicadas**: não medida nesta etapa (exigiria acesso de leitura ao
  Supabase de produção, fora do escopo local). Não assumir que todo exercício tem `start`/`end`/
  `thumbnail` publicados — a UI já trata ausência de mídia como estado honesto, nunca como erro.
- **Orçamento de imagens por bytes**: a redução de teto do `EXERCISE_IMAGE_CACHE` sob pressão de
  espaço (`navigator.storage.estimate()`) é uma heurística por CONTAGEM de entradas (reduz o teto de
  100 para 50), não uma contabilidade exata de bytes por imagem — simplificação deliberada; o teto
  de 100 entradas já é a defesa primária.
- **Sem garantia de armazenamento permanente**: o navegador pode limpar o Cache Storage/IndexedDB
  por falta de espaço em qualquer momento (não é um bug — é o contrato de cache, não de storage
  persistente).
- **Cold start 100% offline (PWA fechado e reaberto sem rede)** continua gated por
  `VITE_OFFLINE_COLD_START_ENABLED` + rollout por usuário, como já era antes desta feature —
  catálogo/imagens preparados aparecem nesse cenário SE o cold start estiver habilitado para aquele
  usuário, senão a tela de catálogo segue as mesmas regras gerais de cold start desligado.

## Plano de habilitação e reversão

- **Habilitação**: nenhuma flag a virar. A feature já está ativa para todo usuário com leitura
  offline habilitada (padrão). O botão "Preparar para uso offline"/"Preparar imagens" é sempre uma
  ação explícita do usuário — não há rollout percentual necessário, já que não há custo/risco de
  ativação automática.
- **Reversão**: revert dos arquivos listados no relatório final. Nenhuma migration remota foi
  aplicada, então não há rollback de schema a fazer. Dispositivos que já sincronizaram um snapshot
  completo continuam com ele em cache (dado público, inofensivo) até expirar naturalmente ou até o
  usuário limpar os dados do site — não é necessário nenhum passo de limpeza para reverter.
- **Aplicação futura da migration** (`20261025000001_exercise_catalog_offline_sync.sql`): revisão
  humana + `supabase db push` (ou equivalente) em uma etapa separada, com autorização explícita —
  não faz parte desta entrega.
