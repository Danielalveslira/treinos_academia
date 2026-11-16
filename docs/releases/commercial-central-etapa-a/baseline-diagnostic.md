# Central Comercial — Etapa A: baseline de performance do Início

## Ambiente

- Build de produção real (`npm run build`), mesma configuração do CI.
- Chromium headless via Playwright (`playwright-core`, já em `devDependencies`), mesma técnica de `scripts/*-browser-smoke.mjs`: `esbuild` monta o componente real isolado, serviços de dados stubados (contam chamadas, não fazem rede real), servidos por um HTTP local efêmero.
- Execução única, sequencial, na mesma máquina/navegador: medir "antes" e depois "depois" sem variação de hardware entre as duas.

## Metodologia

1. **Chamadas de rede ao montar**: cada serviço stubado registra seu próprio nome ao ser chamado; o total de chamadas distintas na montagem é o que se mede (não requisições HTTP reais, já que não há backend nesta medição — o objetivo é contar *quantas* RPCs o componente dispara, não a latência de rede de produção).
2. **Tempo até conteúdo útil**: tempo entre `page.goto` e o primeiro texto real de dados (`/pendente/`) aparecer — não o spinner de carregamento.
3. **Tamanho do chunk**: `npm run build` real, lido o arquivo gerado para `CommercialOverview` em `dist/assets/`, comparando bytes brutos e gzip nível 9 (mesma função usada por `scripts/bundle-budget.mjs`).
4. **Cliques até Aprovações/Publicidade/Financeiro**: contagem estrutural (não cronometrada) — inalterada pela Etapa A.

Reprodução: `node scripts/commercial-overview-performance.mjs <antes.jsx> <rótulo> <depois.jsx> <rótulo>` com os dois arquivos colocados dentro de `src/components/` (esbuild resolve `node_modules` a partir do arquivo importado). O "antes" usado aqui é `git show d28a7f4:src/components/CommercialOverview.jsx` (estado em produção imediatamente antes desta etapa).

## Resultado anterior (commit `d28a7f4`, 4 cartões)

- 4 chamadas de serviço na montagem: `getAdvertisingCampaigns`, `listStorefronts`, `listRefundRequests`, `getCommercialPendingCounts`.
- Tempo até conteúdo útil: 310 ms.
- Chunk `CommercialOverview`: 3881 bytes brutos / 1708 bytes gzip.

## Resultado posterior (Etapa A, 2 cartões)

- 1 chamada de serviço na montagem: `getCommercialPendingCounts`.
- Tempo até conteúdo útil: 250 ms.
- Chunk `CommercialOverview`: 2252 bytes brutos / 1159 bytes gzip.

## Diferença observada

- Chamadas de rede ao abrir o Início: **4 → 1 (-75%)**.
- Tempo até conteúdo útil: **310ms → 250ms (-19%)**.
- Chunk do componente: **-42% bruto, -32% gzip**.
- Cliques até Aprovações/Publicidade/Financeiro: inalterado (1 clique), já que a Etapa A não mexeu em navegação.
- Chamadas duplicadas: nenhuma, antes ou depois (cada serviço já era/é chamado uma única vez por montagem — confirmado por teste automatizado em `CommercialOverview.test.js`).
- Nenhum carregamento de módulo pesado de Publicidade/Financeiro foi introduzido; lazy loading do componente (`AdminSponsoredAds.jsx`) permanece inalterado.

## Limitações

- `timeToContentMs` mede o tempo de montagem/render local (esbuild + Chromium headless na mesma máquina, sem rede real nem RPC real), não o tempo real de usuário em produção — serve como proxy comparável *entre as duas versões*, não como métrica absoluta de produção. A diferença de 60ms reflete sobretudo o trabalho de render a menos (2 cartões vs 4, 3 chamadas a menos para aguardar), não necessariamente o que um usuário final sentiria em uma rede 3G real.
- Não existia nenhuma medição formal anterior a este documento (gap identificado na auditoria); por isso o "antes" aqui foi reconstruído a partir do código do commit `d28a7f4` sob as mesmas condições do "depois", em vez de comparado com um número histórico gravado antes da reestruturação original (PR0–PR4a). Essa limitação já estava documentada no planejamento consolidado como aceitável.
- "Comportamento em dispositivos móveis de baixo desempenho" não foi medido com throttling de CPU/rede explícito nesta rodada; a responsividade (320–1440px, sem overflow) foi verificada via `scripts/commercial-central-nav-browser-smoke.mjs`, que agora monta o componente real (antes usava um placeholder) nas 6 larguras exigidas, sem rolagem horizontal em nenhuma.

## Conclusão

A simplificação do Início da Etapa A tem benefício de performance real e mensurável (menos requisições, chunk menor, sem regressão de cliques ou de responsividade), não apenas estético. Os números absolutos de tempo são um proxy local, não uma medição de rede de produção — mas a redução proporcional de 4 para 1 chamada de servidor é estrutural e se sustenta independentemente do ambiente de medição.
