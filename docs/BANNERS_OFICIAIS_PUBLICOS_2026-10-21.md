# Banners oficiais nas páginas públicas — 21/10/2026

## Implementação

Os quatro PNGs mais recentes recebidos em `public/img/` foram preservados sem alteração em `docs/banner-sources/`, substituindo os PNGs anteriores que só serviam de entrada à conversão. As versões WebP de 960 e 1774 px foram regeneradas em `public/img/banners/`, com nomes sem espaços. `scripts/optimize-public-banners.mjs` permite refazer a conversão com Chromium local. O build público entrega apenas os WebP; os PNGs de origem não são copiados para `dist`.

| Banner | Uso no HTML público |
| --- | --- |
| `quadro-geral` | Hero principal da Home. |
| `exercicio` | Área de treino da Home e hero de Como funciona e Guia de registro. |
| `progresso` | Hero de Funcionalidades e seção de acompanhamento em Como funciona. |
| `comunidade` | Seção de comunidades em Funcionalidades. |

O gerador `scripts/public-pages-template.mjs` usa um helper de `<picture>` com `srcset` e `sizes`, dimensões `1774×887`, proporção 2:1 e texto alternativo por contexto. A primeira imagem de cada página usa `loading="eager"` e `fetchpriority="high"`; as demais usam `loading="lazy"`. Nenhuma imagem recebe `object-fit: cover`, portanto textos e interfaces dentro dos banners não são cortados. Os títulos, descrições, links e CTAs editoriais continuam no HTML fora das imagens, junto de canonical, robots, OG/Twitter e JSON-LD. O hero da Home tem um H1 próprio, distinto da frase do banner. Primer permanece responsável por navegação, botões, links, tipografia, cartões e formulários.

Os painéis artificiais `.product-preview` e o ornamento `.features-hero-art` saíram do HTML. Regras CSS exclusivas desses elementos, incluindo seletores `.preview-*`, `.feature-orbit`, `.floating-label`, `.hero-art` e `.page-hero-visual`, foram removidas de `public/public-pages.css` e `public/public-redesign.css`. Etapas textuais e cartões de recursos permanecem porque explicam funcionalidades fora das imagens.

## Tamanho e carregamento

| Arquivo | PNG original | WebP 960 | WebP 1774 |
| --- | ---: | ---: | ---: |
| Quadro geral | 1.836.084 B | 78.456 B | 190.962 B |
| Exercício | 1.784.754 B | 75.536 B | 180.168 B |
| Progresso | 1.806.662 B | 75.886 B | 175.942 B |
| Comunidade | 1.992.302 B | 92.730 B | 228.830 B |

Os quatro originais somam 7.419.802 B; as oito variantes WebP somam 1.098.510 B (redução de 85,2% no conjunto de assets). Cada página solicita apenas seus banners pertinentes, e os que ficam abaixo da primeira dobra são lazy. Funcionalidades exibe `progresso` como primeiro banner e `comunidade` na seção social, sem repetir `progresso`. Essas medidas de arquivo não são LCP, INP ou CLS.

## Capturas e verificação

O preview local foi capturado em [375](banner-captures/home-375.png), [768](banner-captures/home-768.png) e [1440 px](banner-captures/home-1440.png) para a Home; o diretório [banner-captures](banner-captures) contém as mesmas larguras das outras três páginas, além de 320 e 1366 px. No mobile, o banner mantém a proporção integral e o texto editorial externo garante leitura do conteúdo essencial. As imagens originais têm texto e telas compostos internamente; a inspeção desses detalhes é mais confortável na imagem em tamanho desktop.

`npm run build`, `npm run lint` (0 erros, 16 avisos), `node --test tests/public-pages.test.mjs` (11/11) e `node scripts/public-banners-smoke.mjs` (`PUBLIC_BANNERS_SMOKE_OK`) passaram após a substituição. O smoke dos banners verificou as quatro rotas em 320, 375, 768, 1366 e 1440 px, carregamento/decodificação, proporção sem distorção, prioridade/lazy e ausência de overflow.

A suíte completa do aplicativo foi repetida antes da publicação: **2.070 testes aprovados, 0 falhas**. A publicação de banco e frontend é acompanhada separadamente no relatório de release.
