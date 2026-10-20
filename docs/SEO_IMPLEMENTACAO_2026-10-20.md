# SEO Evolutus — implementação local em 20/10/2026

## Fase 0: evidência e limites

- Checkout: `main`, SHA `51baafe5eae05f90e57e6ebccdef1aa58921af8f`. Antes das edições, o working tree já continha a exclusão de `docs/prompts/PROMPT_AJUSTE_BRANDING_HEADER_MOBILE_EVOLUTUS.md` e o arquivo não rastreado `docs/prompts/PROMPT_IMPLEMENTACAO_SEO_EVOLUTUS.md`. Ambos foram preservados. O ZIP citado no prompt não está no workspace; não foi possível comparar seus bytes. O diagnóstico do prompt foi tratado como referência histórica, e as respostas atuais foram medidas novamente.
- Build: Vite gera o shell React, depois `scripts/build-public-pages.mjs` grava HTML completo para páginas públicas. `vercel.json` reescreve rotas estáticas e as rotas de app. O shell tem `noindex,follow`; `robots.txt` permite rastreamento e aponta ao sitemap. `public/public-pages.js` busca produtos só após JavaScript. O service worker do PWA não substitui o HTML inicial público.
- Produção por GET e HEAD: `/`, `/como-funciona`, `/funcionalidades`, `/para-empresas`, `robots.txt` e `sitemap.xml` retornaram 200. `/como-funciona.html` retornou 200, `/como-funciona/` retornou 404, `/como-funciona?utm_source=teste` retornou 200, rota desconhecida retornou 404 e detalhe profissional com UUID inexistente retornou 200 no shell `noindex`. O apex HTTPS e o domínio HTTP redirecionaram por 308 para `https://www.evolutus.com.br/`. `treinosacademia-ten.vercel.app` retornou 404; a posse e o tráfego do alias não foram confirmados, e a regra existente ficou intacta.
- HTML de produção teve `Cache-Control: public, max-age=0, must-revalidate` e gzip quando solicitado. O JS versionado teve cache imutável de um ano; AVIF, cache de 30 dias. `robots.txt` e sitemap retornaram 200. A validação de respostas do novo guia e redirects do Vercel é de preview local; nada foi publicado.
- O repositório contém políticas RLS que exigem `has_app_access()` para leitura de anúncios profissionais e para a RPC de listagem; isso não comprova o estado remoto. Não houve acesso administrativo à base para comparar migrations, grants e policies aplicadas. Nenhuma política, RPC, migration ou ambiente foi alterado.

## Matriz de rotas

| URL / grupo | Produção antes | HTML inicial e acesso | Robots / canonical / sitemap antes | Depois no preview local | Decisão |
| --- | --- | --- | --- | --- | --- |
| `/` | 200 | Estático público | index / absoluto `/` / sim | 200, WebSite, links ao guia | Indexar |
| `/como-funciona` | 200 | Estático público | index / URL limpa / sim | 200, WebPage, FAQ contextual | Indexar |
| `/funcionalidades` | 200 | Estático público | index / URL limpa / sim | 200, WebPage, link ao guia | Indexar |
| `/para-empresas` | 200 | Estático público | index / URL limpa / sim | 200, WebPage | Indexar |
| `/guia-registro-treino` | 404 antes de publicar | Novo HTML estático público | ausente | 200, index, canonical próprio, WebPage, sitemap | Indexar após publicação e verificação |
| `/vitrine` | 200 | Apresentação estática; produtos via JS/API | noindex / URL limpa / não | 200, noindex, fora do sitemap | Não indexar até inventário e HTML aprovados |
| `.html` e barra final das cinco rotas estáticas não raiz | `.html` 200; barra final 404 (amostra `/como-funciona`) | Variante | canonical apontava à limpa | 301 local para URL limpa, preserva query | Validar no Vercel antes de publicar |
| `/login`, `/cadastro`, recuperação; `/app`, exercícios, treino, histórico, progresso, perfil e administração | Shell | React; autenticação conforme rota | noindex / sem sitemap | Sem mudança | Não indexar |
| `/entenda-suas-moedas`, `/evocash` e demais áreas financeiras | Shell | React autenticado; dados da conta | noindex / sem sitemap | Sem mudança | Não indexar |
| `/comunidades`, publicações, comentários, perfis de membros | Shell | React e acesso condicionado; conteúdo privado | noindex / sem sitemap | Sem mudança | Não indexar |
| `/profissionais`, `/profissionais/:id` | Shell; detalhe inexistente 200 | React; leitura condicionada por RLS/RPC no SQL local | noindex / sem sitemap | Sem mudança de acesso; filtro cidade com debounce | Não indexar; detalhe 404/410 requer servidor elegível |
| Legais e `/atendimento` | Shell | React, conteúdo dependente de JS | noindex / sem sitemap | Sem mudança | Não indexar nesta entrega |
| URL pública desconhecida | 404 | Sem HTML público | ausente | 404 no preview | Não indexar |

O canonical de páginas com query continua a URL limpa absoluta; parâmetros não criam URLs no sitemap. A decisão de indexação é explícita no objeto de cada página: `indexable: false` só na Vitrine; as demais páginas geradas são públicas e indexáveis.

## Mudanças locais

- `scripts/public-pages-template.mjs`: guia original e verificável sobre registro de séries, repetições e peso, links contextuais, WebPage em páginas internas e WebSite na home, `sizes` no AVIF e prioridade para imagens de primeira tela. O gerador mantém title, description, canonical, OG, Twitter, idioma e H1 por página. JSON-LD usa textos fixos do código e escapa `<` na serialização. Nenhum dado de usuário entra no HTML.
- `vercel.json`: redirects 301 de `.html` e barra final para as URLs públicas limpas; rewrite do novo guia. Escopo limitado às páginas estáticas, sem atingir assets, API, app ou service worker. O preview implementa os mesmos redirects para a verificação local.
- `src/pages/Professionals.jsx`: espera 350 ms após a última edição da cidade antes de consultar. Respostas obsoletas já eram ignoradas pelo efeito; filtros mantidos.
- `tests/public-pages.test.mjs` e `scripts/public-browser-smoke.mjs`: incluem o guia, schema, sitemap, variantes e larguras 320, 375, 768, 1024 e 1366 px.

## Validação

- `npm run build`: passou. Avisos já existentes de chunk grande e import misto do módulo offline permanecem. O React já usa lazy routes, e o HTML institucional carrega CSS e JS públicos separados do shell.
- `node --test tests/public-pages.test.mjs`: 7/7. `npx eslint src/pages/Professionals.jsx` e `git diff --check`: passaram.
- A primeira execução de `npm test` apresentou falhas intermitentes em `authColdStart.test.js` e `useHomeDashboard.test.js`: ambos esperavam 80–100 ms fixos para operações assíncronas. Os testes passaram isolados; as esperas desses pontos foram trocadas por verificação do estado esperado com limite de tempo. A repetição completa fora do sandbox passou: **2065 testes, 0 falhas**. O código de autenticação e da Home em produção não foi alterado.
- `npm run budget`: passou. Boot JS gzip 320.627 bytes versus baseline 320.749 (−122); CSS gzip 75.816 versus 75.572 (+244), dentro da tolerância de 3%. Isso mede transferência estimada do bundle, não Core Web Vitals.
- Preview por GET: cinco páginas institucionais e Vitrine em 200; novo guia com H1; Vitrine e shell com noindex; `.html` e barra final do guia em 301 preservando `utm_source`; desconhecida em 404. Shell de detalhe profissional inexistente continua 200 noindex. Cabeçalhos do preview são `no-cache` do Vite, não equivalem aos do Vercel.
- Smoke de navegador: navegação, reload, H1 único, ausência de overflow, formulário e console nas larguras acima. Imagens da primeira tela verificadas por decode. O smoke não reproduz autenticação real, RLS remota ou service worker de retorno.
- Em 320 px com `prefers-reduced-motion: reduce`, o primeiro Tab focou “Pular para o conteúdo”, a preferência foi reconhecida e não houve overflow horizontal.
- Lighthouse/DevTools para LCP e CLS e dados de campo para LCP, INP e CLS não estavam disponíveis de forma confiável neste ambiente. Nenhuma pontuação ou INP de laboratório foi inferida. A prioridade de imagem e `sizes` corrigem contratos observáveis, sem promessa de métrica.

## Bloqueios e riscos residuais

O diretório e seus detalhes precisam de decisão de produto sobre consentimento específico para indexação, critérios de publicação e revogação, projeção pública mínima, moderação, contato deliberado, HTML anônimo seguro e 404/410 no servidor. A policy local e o shell atual não cumprem isso. Nenhuma tabela/RPC foi aberta ao papel `anon`. Comunidades e perfis requerem regras próprias de visibilidade, consentimento e expiração. A Vitrine precisa de inventário aprovado e conteúdo principal no HTML inicial. A página privada de moedas não foi publicada; um guia genérico exigiria revisão das regras vigentes. Não houve dados de campo, inventário nem verificação administrativa de migrations. A regra do alias legado não deve ser revista sem confirmar posse e tráfego.

## Plano de publicação sujeito a autorização separada

Conferir a semântica das regras 301 em preview Vercel real, inclusive parâmetros, cache e ausência de loops; conferir SHA e estado READY, GET/HEAD de todas as URLs e variantes, HTML sem JavaScript, sitemap/robots, cache/compressão e navegação mobile/teclado. Inspecionar Google Search Console e Bing Webmaster Tools após publicar. Resposta rastreável e permissão para indexar não comprovam indexação efetiva. O usuário autorizou a publicação em mensagem posterior; registrar o resultado efetivo em documento de release separado.
