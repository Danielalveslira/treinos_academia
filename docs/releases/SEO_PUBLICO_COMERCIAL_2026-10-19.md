# Evolutus: páginas públicas, SEO e propostas comerciais

## Correção do roteamento no Vite de desenvolvimento

O plugin inicial atendia as páginas estáticas apenas em `configurePreviewServer`. Em `vite dev` (porta 5173), o fallback SPA entregava `index.html` para `/para-empresas` e as demais rotas públicas; o React Router mostrava sua página 404 apesar do HTTP 200. O gerador de conteúdo foi separado em `scripts/public-pages-template.mjs`, usado tanto pelo build quanto pelo middleware `configureServer` do Vite. O middleware atende as quatro URLs e `/public-config.js` antes do fallback; `/app` e as rotas React continuam no shell existente. O link da marca no layout de autenticação força navegação de documento quando aponta para `/`, para sair corretamente do React Router e chegar à landing estática.

Validação final: `npm run build`, `npm run lint` (0 erros, 14 avisos existentes), `node --test tests/public-pages.test.mjs scripts/domain-redirect.test.mjs` (9/9) e `scripts/public-browser-smoke.mjs` passaram. O smoke rodou em Chromium contra Vite `:5173` e preview `:4173`, em 390 e 1366 px, verificando URL direta, F5, links entre as quatro páginas, retorno do login React à landing, H1 correto e console sem erros nas páginas públicas. O catálogo Supabase foi simulado apenas nesse smoke de roteamento; no projeto remoto configurado em `.env`, `partner_products` responde 404 enquanto a migration comercial não é aplicada. Nenhum deploy foi feito.

## Diagnóstico e arquitetura

Em 19/10/2026, `main` e `origin/main` estavam no mesmo commit (`c5ed401`), após `git fetch origin main`. Alterações locais preexistentes em `docs/prompts` e `artifacts/` foram preservadas. O app usava `/` para o dashboard protegido; o fallback da Vercel entregava `index.html` indistintamente, sem conteúdo público rastreável.

O build Vite continua gerando o app React. Uma etapa posterior guarda esse HTML em `app-shell.html` e gera quatro documentos públicos estáticos, com CSS/JS leves próprios. A Vercel reescreve somente as rotas conhecidas do app para o shell; rotas públicas inválidas ficam sem rewrite e retornam 404. Isso evita migrar autenticação e treinos para SSR. O Service Worker agora precacheia `app-shell.html`; o `id` do manifest permanece `/`, preservando a identidade da instalação, e `start_url` passa a `/app`.

## Arquivos e funções

- `scripts/build-public-pages.mjs`, `public/public-pages.css`, `public/public-light.css`, `public/public-pages.js`: HTML inicial, conteúdo, prévia de elementos reais do app sem dados simulados, SEO, formulário e catálogo público.
- `vercel.json`, `vite.config.js`, `scripts/public-preview-plugin.js`: roteamento, HTML específico e status de URLs inválidas, mantendo CSP e cabeçalhos existentes.
- `src/App.jsx`, `src/routeLoaders.js`, `src/components/Layout.jsx`, `src/components/PublicLayout.jsx`, login, cadastro e atalhos: dashboard em `/app` e retorno ao app após autenticação.
- `public/manifest.webmanifest`, `scripts/pwa-plugin.js`, `scripts/service-worker.js`, `src/utils/offlineRoutes.js`: shell e abertura offline em `/app`.
- `supabase/migrations/20261108000001_public_commercial.sql`: leads privados, RPC pública validada e limitada; produtos separados das vitrines de profissionais, com RLS de aprovação/vigência e CRUD só para superadmin.
- `src/components/CommercialAdmin.jsx`, `src/pages/AdminSponsoredAds.jsx`: aba de propostas e produtos na administração de parcerias existente; campanhas e métricas atuais seguem como estão.
- `tests/public-pages.test.mjs`, `supabase/tests/public_commercial_test.sql`, `scripts/public-browser-smoke.mjs` e testes de rotas/PWA ajustados: verificação de HTML gerado, 404, responsividade, migração de URLs, RLS e limites comerciais.

## Rotas e indexação

| Rotas | Política |
| --- | --- |
| `/`, `/como-funciona`, `/para-empresas` | HTML estático específico; index,follow; sitemap |
| `/vitrine` | HTML institucional real; noindex até haver catálogo estático rastreável no build |
| `/profissionais` e detalhes | Mantidos no app; noindex do shell até haver renderização pública confiável |
| `/login`, `/cadastro`, recuperação, `/app`, demais rotas internas e admin | Shell com noindex; fora do sitemap |
| `/vitrine/:slug` e URLs públicas desconhecidas | Sem página de detalhe; 404 |

O host canônico é `https://www.evolutus.com.br`: em 19/10/2026, o host sem `www` retornou 308 para `www`, que respondeu 200. O antigo domínio `treinosacademia-ten.vercel.app` mantém o redirecionamento de navegação para o host canônico. Produtos individuais só deverão entrar no índice após existir HTML público atualizado por produto e status 404/410 para removidos.

## Segurança e operação

`commercial_leads` não concede leitura anônima. A RPC usa limites de tamanho, consentimento, honeypot, até três envios por e-mail e teto diário global de 500; uma trava transacional serializa a contagem e a inserção para não exceder o teto sob concorrência. O cliente mostra sucesso somente depois da resposta positiva do Supabase e distingue limites de envio de erro de conexão. A política permite leitura e mudança de status apenas para superadmin. `partner_products` só é público quando aprovado e vigente; links exigem HTTPS, host com domínio e ausência de credenciais, e o destino é mostrado no link externo. Produtos patrocinados recebem identificação e `rel="sponsored"`. Não há carrinho ou checkout.

Para publicar, aplicar a migration em homologação, validar inserção real de lead e negação de leitura anônima, validar CRUD de produtos com conta superadmin e não admin, e só então planejar a migration de produção. Configurar `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no build; sem elas, formulário e vitrine exibem indisponibilidade, sem falso sucesso. `VITE_GOOGLE_SITE_VERIFICATION` e `VITE_BING_SITE_VERIFICATION` são opcionais e só geram meta tags com valores fornecidos. Submeter `https://www.evolutus.com.br/sitemap.xml` aos serviços de busca após publicação. Os eventos personalizados de CTA/cadastro dependem do plano de Web Analytics da Vercel que os aceite; nenhum dado pessoal entra nesses eventos.

## Evidências e limites

- `npm run lint`: passou, com 14 avisos preexistentes e 0 erros.
- `npm run build`: passou; documentos públicos, sitemap, robots e shell gerados.
- `npm run budget`: passou após atualização justificada da base de boot de 307092 para 319704 bytes gzip de JS; as páginas públicas não carregam esse bundle.
- `node --test tests/public-pages.test.mjs scripts/domain-redirect.test.mjs`: passou; HTML pré-JavaScript, canonical, sitemap, noindex e regex de 404.
- Preview local: `/`, `/como-funciona`, `/para-empresas`, `/vitrine` e `/app` responderam 200; `/vitrine/produto-removido` respondeu 404; `/sitemap.xml` e `/robots.txt` responderam 200. A resposta real na Vercel precisa ser conferida em uma implantação de homologação.
- HTTP de produção atual, somente leitura: `https://evolutus.com.br/` respondeu 308 diretamente para `https://www.evolutus.com.br/`, que respondeu 200. Isso confirma a escolha do host canônico, mas a nova entrega ainda não foi publicada.
- `node scripts/public-browser-smoke.mjs`: passou em Chromium, 390 px e 1366 px, sem transbordamento; valida também H1, navegação e campos obrigatórios. Após o ajuste final, o teste também confere, com resposta de catálogo simulada, destino externo HTTPS e identificação `Patrocinado`.
- `npm run test:backfill` e `npm run test:functions`: passaram.
- `npm run release:offline-check`: bloqueou antes da suíte completa de pgTAP por ausência de `PG_TEST_CONTAINER` com todas as migrations do projeto. O teste comercial isolado descrito acima foi executado separadamente.
- `npm test`: as execuções dentro do sandbox tiveram falhas intermitentes em arquivos sem alteração deste escopo (`useHomeDashboard.test.js`, `authColdStart.test.js`, `businessDate.test.js`); os arquivos passaram isoladamente. A repetição completa fora do sandbox passou: **2048 testes, 0 falhas**.
- `supabase/tests/public_commercial_test.sql`: 13/13 verificações passaram em PostgreSQL temporário com a migration comercial aplicada. O teste confirmou inserção real pela RPC, negação de leitura/escrita anônima, validação, limite por e-mail e filtro por aprovação/vigência. A função `is_superadmin()` foi simulada como `false` nesse teste isolado; o papel superadmin real ainda exige homologação na stack completa.

**Pendente em homologação:** integração da RPC e RLS com os papéis reais da stack Supabase, em especial superadmin; instalação e atualização de PWA já instalado; push/sync offline; URLs/cabeçalhos na borda Vercel; Lighthouse/Core Web Vitals e verificação de domínio no Search Console/Bing. Não há alegação de metas LCP/INP/CLS atingidas sem medição de campo.

## Rollback

1. Se a publicação ainda não ocorreu, descartar apenas os arquivos desta entrega, preservando as alterações locais preexistentes identificadas acima.
2. Se já publicada, redeploy da versão anterior restaura `/` como dashboard e o shell/PWA anteriores; monitorar instalações existentes durante a troca de Service Worker.
3. Antes de remover tabelas comerciais, exportar os leads recebidos e retirar o formulário público. A migration não é revertida automaticamente para evitar perda de dados.

Nenhum deploy, push, alteração de DNS ou migration em produção foi realizado nesta entrega.
