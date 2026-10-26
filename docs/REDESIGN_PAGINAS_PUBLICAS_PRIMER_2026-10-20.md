# Redesign local das páginas públicas — 20/10/2026

Atualização posterior: as prévias HTML/CSS desta etapa foram substituídas pelos [banners oficiais em 21/10](BANNERS_OFICIAIS_PUBLICOS_2026-10-21.md). As capturas e medidas abaixo documentam a etapa de 20/10.

## Contexto e escopo

- Checkout inicial: `main`, SHA `78e0625478967dabfbe0c11dae520f2822782874`. Antes do trabalho, já havia a exclusão de `docs/prompts/PROMPT_AJUSTE_BRANDING_HEADER_MOBILE_EVOLUTUS.md` e o arquivo não rastreado `docs/prompts/PROMPT_REDESIGN_PAGINAS_PUBLICAS_PRIMER_EVOLUTUS.md`. Ambos foram preservados.
- Páginas geradas pelo sistema público: `/`, `/como-funciona`, `/funcionalidades`, `/guia-registro-treino`, `/para-empresas` e `/vitrine`. O gerador é `scripts/public-pages-template.mjs`; `scripts/build-public-pages.mjs` grava o HTML após o Vite. `scripts/public-preview-plugin.js` e `vercel.json` servem as rotas limpas. `public/public-pages.js` cuida do formulário, da Vitrine e da analítica pública. O shell privado permanece separado, com `noindex`.
- O relatório `docs/SEO_IMPLEMENTACAO_2026-10-20.md` foi lido como histórico. Os contratos SEO foram conferidos no HTML gerado e nos testes atuais.
- Não houve alteração remota, commit, push ou deploy. A validação de navegação é do preview local, com Vitrine simulada.

## Diagnóstico visual

As capturas anteriores mostraram tipografia e cartões praticamente idênticos em todas as páginas, repetição da foto nos heróis e pouca distinção entre a jornada, os recursos e o guia editorial. A Vitrine vazia tinha tratamento próprio, mas o carregamento não reservava espaço para os produtos. O cabeçalho ficava apertado em larguras intermediárias após a adoção dos controles Primer; o menu móvel agora entra até 1100 px.

O produto usa a marca gráfica em `public/icons/icon-192.png`, fontes de sistema com Inter em primeiro lugar e os tokens em `src/styles/app.css`: `--fitness-accent: #3fb950`; no claro, `--fitness-accent-strong: #27863a`, `--fitness-accent-soft: #eaf7ec`, `--fitness-surface: #f5f7f2`, `--fitness-ink: #151814`; no escuro, `#56d364`, `#17271a`, `#151a1f` e `#f2f5ed` respectivamente. O redesenho usa esses valores na camada pública e `--base-size-*` do Primer para medidas repetidas. O app mantém `ThemeProvider` e `BaseStyles`; nas páginas estáticas, o HTML do Primer é renderizado no build e a seleção de tema existente é aplicada por `boot-theme.js`, sem hidratação do shell.

## Implementação

- `scripts/public-primer.mjs` renderiza no servidor **Box, Heading, Text, Label, Link, Button, FormControl, TextInput, Select e Textarea** de `@primer/react` 37.31.0. Links e CTAs aparecem em todas as páginas; Box, Heading, Text e Label estruturam cartões e seções; FormControl e campos compõem o formulário comercial e o filtro da Vitrine. Os ícones dos recursos usam `@primer/octicons-react` 19.35.0. O CSS de `@primer/react` e os tokens de `@primer/primitives` 11.10.0 vêm do arquivo Primer já emitido pelo build do app. Não há React ou Primer JS nas páginas públicas.
- O stylesheet `public/public-redesign.css` aplica a identidade da Evolutus e diferencia o ritmo das páginas. Home combina a foto oficial e prévia do registro; Como funciona traz a prévia na primeira dobra e a jornada; Funcionalidades mostra prévia e ícones oficiais; Para empresas destaca formatos, processo e formulário; o Guia ganhou sumário, âncoras e exemplo explicitamente genérico; a Vitrine recebeu carregamento com espaço reservado, vazio e erro coerentes. O menu continua um `details` nativo para funcionar sem JS.
- Campos, validação nativa, consentimento, honeypot, endpoint RPC, status e mensagens do formulário foram preservados. O filtro e o fetch da Vitrine foram preservados; o contêiner passa de `aria-busy=true` para `false` após resposta ou erro. URLs externas continuam verificadas e itens pagos continuam identificados.
- A arquitetura continua estática: H1, conteúdo, links, canonical, description, robots, Open Graph, Twitter e JSON-LD constam no HTML inicial. A Vitrine continua `noindex`, fora do sitemap; páginas autenticadas seguem no shell `noindex`. O redirect de visitantes autenticados na home não mudou.

As APIs e os limites do tema foram conferidos na [documentação oficial do Primer React](https://primer.style/product/getting-started/react/) e em [Theming](https://primer.style/product/getting-started/react/theming/). O código instalado confirma a API usada. [Primer Brand](https://primer.style/brand/) foi avaliado como biblioteca de marketing; os componentes já instalados e os tokens da Evolutus cobrem esta entrega, então não foi adicionada dependência.

## Capturas do preview local

Cada link aponta para uma captura de página inteira. O diretório contém também capturas posteriores em 320, 768 e 1024 px, menu móvel nos dois temas e formulário em várias larguras. As capturas da Vitrine usam resposta vazia simulada; carregamento (captura removida) e erro (captura removida) foram capturados depois. Esses dois estados não tiveram captura anterior específica.

| Página | Antes desktop | Depois desktop | Antes mobile | Depois mobile |
| --- | --- | --- | --- | --- |
| Home | 1366 (captura removida) | 1366 (captura removida) | 375 (captura removida) | 375 (captura removida) |
| Como funciona | 1366 (captura removida) | 1366 (captura removida) | 375 (captura removida) | 375 (captura removida) |
| Funcionalidades | 1366 (captura removida) | 1366 (captura removida) | 375 (captura removida) | 375 (captura removida) |
| Guia de registro | 1366 (captura removida) | 1366 (captura removida) | 375 (captura removida) | 375 (captura removida) |
| Para empresas | 1366 (captura removida) | 1366 (captura removida) | 375 (captura removida) | 375 (captura removida) |
| Vitrine | 1366 (captura removida) | 1366 (captura removida) | 375 (captura removida) | 375 (captura removida) |

## Validação e custo de transferência

- `npm run build`: passou, com os avisos já existentes sobre import misto do módulo offline e chunks grandes do app. `node --test tests/public-pages.test.mjs`: 8/8. `npm test`: 2068/2068, incluindo `authColdStart.test.js`. `npm run budget`: passou (boot app: JS gzip 320.658 B, CSS gzip 75.816 B; baseline 320.749/75.572 B). Esses números são bytes estimados de bundle, não LCP/INP/CLS.
- `scripts/public-browser-smoke.mjs` verificou rotas, recarga, navegação, formulário, Vitrine simulada, H1 e ausência de overflow em 320, 375, 768, 1024 e 1366 px. `scripts/public-redesign-smoke.mjs` complementa com dois temas, visita sem service worker, teclado, filtro, movimento reduzido e metadados. As capturas foram inspecionadas visualmente em 320, 375, 768, 1024 e 1366 px. A produção não foi medida nem alterada. No tema claro, o verde usado em texto pequeno foi ajustado para `#216934`; seu contraste calculado com o fundo `#f5f7f2` é 6,21:1. O texto escuro sobre o CTA normal tem 6,47:1.
- HTML gzip da home: 2.416 → 2.860 B; Como funciona: 2.401 → 2.794 B; Funcionalidades: 2.403 → 3.708 B; Guia: 2.303 → 2.819 B; Empresas: 3.041 → 3.906 B; Vitrine: 1.513 → 2.132 B. O aumento maior em Funcionalidades vem da prévia real já renderizada no HTML.
- CSS público compartilhado antes: 8.092 B gzip (`public-pages.css` + `public-light.css`). Depois: cerca de 35.141 B gzip, incluindo 2.687 B da nova camada e 24.365 B do CSS Primer que o app já produzia. JS público: 2.712 → 2.725 B gzip; não foi acrescentado bundle React às páginas. A diferença de CSS é o principal custo de transferência do uso de componentes oficiais, embora o arquivo Primer possa estar em cache para visitantes que acessaram o app.
- Não havia medição confiável de Lighthouse/DevTools ou dados de campo para LCP, INP e CLS neste trabalho; nenhuma pontuação foi inferida de tamanhos de arquivo. Service worker de retorno real, autenticação e RLS remota não foram reproduzidos pelo preview.

## Arquivos alterados

`scripts/public-primer.mjs`, `scripts/public-pages-template.mjs`, `public/public-redesign.css`, `public/public-pages.css`, `public/public-pages.js`, `scripts/public-browser-smoke.mjs`, `scripts/public-redesign-smoke.mjs`, `scripts/capture-public-redesign.mjs`, `tests/public-pages.test.mjs`, este relatório e suas capturas. `vercel.json`, app autenticado, migrations e arquivos em `docs/prompts` não foram editados por este trabalho.
