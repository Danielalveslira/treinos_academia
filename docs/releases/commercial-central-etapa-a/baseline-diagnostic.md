# Central Comercial — Etapa A: baseline de performance do Início

> **Correção (revisão do PR #148):** a primeira versão deste documento media o tempo até o
> título estático do cartão aparecer (ex. "Aprovações pendentes"), que é renderizado
> incondicionalmente antes da consulta ao servidor resolver — então o número reportado
> (~310ms antes, ~250ms depois) media tempo-até-primeiro-paint, não tempo-até-dados, e por
> isso não comprovava a melhoria de velocidade declarada. Os números abaixo substituem os
> anteriores, medindo o tempo até o **rótulo numérico real** (ex. "3 pendentes") aparecer.

## Ambiente

- Build de produção real (`npm run build`), mesma configuração do CI.
- Chromium headless via Playwright (`playwright-core`, já em `devDependencies`), mesma técnica de `scripts/*-browser-smoke.mjs`: `esbuild` monta o componente real isolado, serviços de dados stubados (contam chamadas, não fazem rede real), servidos por um HTTP local efêmero.
- Cada versão: 1 execução de aquecimento (descartada) + 5 amostras válidas, novo contexto de navegador por amostra, mesmo navegador/máquina/dados simulados em toda a rodada.

## Metodologia

1. **Chamadas de rede ao montar**: cada serviço stubado registra seu próprio nome ao ser chamado; o total de chamadas distintas na montagem é o que se mede (chamadas simuladas, não requisições HTTP reais — não há backend nesta medição).
2. **Tempo até conteúdo útil**: tempo entre `page.goto` e o primeiro **rótulo numérico real** (`/\d+\s*pendente/`) aparecer — nunca o título estático do cartão, que é renderizado antes da consulta resolver nas duas versões. Se em vez disso aparecer a mensagem de erro de consulta, a amostra falha explicitamente (não é contada como sucesso).
3. **Tamanho do chunk**: `npm run build` real, lido o arquivo gerado para `CommercialOverview` em `dist/assets/`, bytes brutos e gzip nível 9 (mesma função de `scripts/bundle-budget.mjs`).
4. **Cliques até Aprovações/Publicidade/Financeiro**: contagem estrutural (não cronometrada) — inalterada pela Etapa A.

Reprodução: `node scripts/commercial-overview-performance.mjs <antes.jsx> <rótulo> <depois.jsx> <rótulo>`, com os dois arquivos dentro de `src/components/` (esbuild resolve `node_modules` a partir do arquivo importado). O "antes" é `git show d28a7f4:src/components/CommercialOverview.jsx`.

## Resultado anterior (commit `d28a7f4`, 4 cartões)

- 4 chamadas de serviço simuladas na montagem: `getAdvertisingCampaigns`, `listStorefronts`, `listRefundRequests`, `getCommercialPendingCounts`.
- Amostras de tempo até dados reais (ms): 203.15, 190.91, 295.53, 203.94, 202.80.
- **Mediana: 203.15 ms.**
- Chunk `CommercialOverview`: 3881 bytes brutos / 1708 bytes gzip.

## Resultado posterior (Etapa A, 2 cartões)

- 1 chamada de serviço simulada na montagem: `getCommercialPendingCounts`.
- Amostras de tempo até dados reais (ms): 255.61, 198.48, 217.36, 188.12, 172.32.
- **Mediana: 198.48 ms.**
- Chunk `CommercialOverview`: 2343 bytes brutos / 1188 bytes gzip.

## Diferença observada

- Chamadas de rede simuladas ao abrir o Início: **4 → 1 (-75%)** — estrutural, comprovada por teste automatizado (`monta com exatamente uma consulta de resumo`), não depende desta medição de tempo.
- Chunk do componente: **3881→2343 bytes brutos (-40%), 1708→1188 bytes gzip (-30%)**.
- Tempo até dados reais: mediana 203.15ms → 198.48ms (~2%). **Essa diferença está dentro da variação observada entre as próprias amostras de cada versão** (203-296ms antes, 172-256ms depois) — **não há ganho de velocidade comprovado de forma confiável** nesta medição local. Não declaramos "X% mais rápido" porque a amostra não sustenta essa afirmação.
- Cliques até Aprovações/Publicidade/Financeiro: inalterado (1 clique).
- Chamadas duplicadas: nenhuma, antes ou depois (cada serviço é chamado uma única vez por montagem).
- Nenhum carregamento de módulo pesado de Publicidade/Financeiro foi introduzido; lazy loading do componente (`AdminSponsoredAds.jsx`) permanece inalterado.

## Limitações

- `samplesMs`/mediana medem render em Chromium headless local com serviços stubados (sem rede real nem RPC real) — proxy comparável *entre as duas versões*, nunca uma medição de rede/Supabase de produção. A distinção entre "requisições reais ao backend" e "chamadas de serviço simuladas" é explícita em `performance.json` (`localBrowserTimeToDataMs_disclaimer`).
- Com apenas 5 amostras por versão e variação de ~100ms dentro da mesma versão (provavelmente ruído do ambiente compartilhado de execução, não do código), a medição de tempo não tem poder estatístico para declarar uma melhoria de velocidade — por isso a conclusão é "sem ganho comprovado", não "sem ganho". Mais amostras ou um ambiente dedicado poderiam reduzir esse ruído, mas isso está fora do escopo desta correção.
- Não existia nenhuma medição formal anterior a este documento (gap identificado na auditoria); o "antes" foi reconstruído a partir do código do commit `d28a7f4` sob as mesmas condições do "depois", não comparado com um número histórico gravado antes da reestruturação original (PR0–PR4a).
- "Comportamento em dispositivos móveis de baixo desempenho" não foi medido com throttling de CPU/rede explícito; a responsividade (320–1440px, sem overflow) foi verificada via `scripts/commercial-central-nav-browser-smoke.mjs`, que monta o componente real nas 6 larguras exigidas, sem rolagem horizontal em nenhuma.

## Conclusão

A simplificação do Início da Etapa A tem benefício estrutural real e mensurável: 75% menos chamadas de rede simuladas por montagem (comprovado por teste automatizado, independente de qualquer medição de tempo) e chunk 30-40% menor. **O tempo de render local não mostrou uma melhoria estatisticamente confiável** com a metodologia corrigida — a diferença de mediana é pequena e cabe dentro do ruído das próprias amostras, então não é apresentada como ganho de velocidade. Isso não invalida a simplificação: menos requisições ao servidor é uma melhoria estrutural válida por si só, mesmo sem um ganho de tempo de render local comprovado.
