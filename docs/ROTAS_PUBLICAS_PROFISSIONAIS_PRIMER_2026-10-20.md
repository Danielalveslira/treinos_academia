# Rotas públicas, diretório e refinamento Primer — 20/10/2026

Atualização visual posterior: os mockups HTML das páginas de treino foram substituídos pelos [quatro banners oficiais](BANNERS_OFICIAIS_PUBLICOS_2026-10-21.md) em 21/10. Os números e capturas abaixo registram a etapa anterior a essa substituição.

## Escopo e ponto de partida

- Checkout inicial: `main`, `78e0625478967dabfbe0c11dae520f2822782874`. A exclusão já existente de `docs/prompts/PROMPT_AJUSTE_BRANDING_HEADER_MOBILE_EVOLUTUS.md`, os prompts recebidos e todo o redesign local anterior foram preservados. Nada foi publicado, enviado ou aplicado à base remota.
- Rotas públicas de apresentação inventariadas: `/`, `/como-funciona`, `/funcionalidades`, `/guia-registro-treino`, `/para-empresas`, `/vitrine` e agora `/profissionais`. O detalhe `/profissionais/:listingId` continua uma exceção pública React `noindex` por depender de ID dinâmico sem SSR/edge que forneça HTML e status HTTP específicos. As páginas legais continuam no shell público React sem alteração do texto jurídico. `/minha-vitrine` e `/admin/vitrines` continuam privadas.
- A base visual anterior já renderizava componentes oficiais do Primer no build e mantinha HTML estático. `/profissionais` ainda caía no app shell; a policy `published_professional_listings_select` e a RPC antiga `list_published_professional_listings` exigiam `has_app_access()`, bloqueando visitantes anônimos. A análise histórica em `docs/SEO_IMPLEMENTACAO_2026-10-20.md` foi conferida contra o código atual.
- Versões instaladas: `@primer/react` 37.31.0, `@primer/primitives` 11.10.0, `@primer/octicons-react` 19.35.0, React 18.3.1, Vite 7.3.7. [Primer React](https://primer.style/product/getting-started/react/), [Theming](https://primer.style/product/getting-started/react/theming/) e [Primer Brand](https://primer.style/brand/) foram consultados; não houve dependência nova nem atualização de major.

## Arquitetura e design

- `scripts/public-pages-template.mjs` gera `/profissionais.html` com H1, texto, links, filtros e metadados no HTML inicial. O CSS Primer emitido pelo build e `public/public-redesign.css` são compartilhados pelas sete páginas. `scripts/public-primer.mjs` usa Box, Heading, Text, Label, Link, Button, FormControl, Select, TextInput e ActionList oficiais de `@primer/react`; usa Octicons para ícones. Os cards dinâmicos da Vitrine e do diretório clonam templates que já contêm Box, Heading, Text, Label e Button renderizados durante o build. Dados são inseridos apenas via `textContent` e URLs validadas. Não há hidratação do layout nem bundle React nas páginas estáticas.
- O header compartilhado tem marca Evolutus, navegação horizontal no desktop e botão Primer **Explorar** com `ChevronDownIcon` no mobile. O painel ancorado usa ActionList renderizada estaticamente; JS pequeno controla `aria-expanded`, foco, Escape, clique fora e fechamento ao navegar. Essa composição usa componentes oficiais e evita carregar React apenas para um disclosure. O menu preserva todas as rotas de descoberta, Entrar e Criar conta. O estilo, temas, tokens Evolutus e preferência persistida permanecem no pipeline público.
- O diretório usa filtros Primer por tipo, modalidade, UF, cidade e atendimento, com taxonomias importadas de `src/constants/professionalListingTaxonomy.js`. A grade passa a 2 e 1 coluna conforme largura. `public/public-professionals.js` gerencia query string, debounce de cidade, cancelamento de requisição, paginação, loading, vazio, erro/retry e imagem publicada. O retorno ao app é um link real `/app`; o contato/contratação é informado como externo.
- A Vitrine mantém a consulta aprovada, link HTTPS externo, `rel="noopener noreferrer"` e `sponsored` quando aplicável, filtro, estados, imagem e `noindex`. Só produtos com URL de loja válida entram na contagem exibida. Não há checkout interno.
- `src/components/AccountMenu.jsx` oferece exatamente dois itens em **Explorar** para todos os perfis, em desktop/mobile: Vitrine de produtos → `/vitrine`; Profissionais e locais → `/profissionais`. Ambos são links nativos de documento. Minha vitrine permanece em Minha conta sob sua condição anterior. O link ao diretório saiu desse grupo.

| Página | Composição Primer no HTML inicial |
| --- | --- |
| Home | Box, Heading, Text, Label, Link, Button; prévia e CTAs de cadastro. |
| Como funciona | Box, Heading, Text, Label, Link, Button; etapas e FAQ. |
| Funcionalidades | Box, Heading, Text, Label, Link, Button e Octicons; grupos por benefício. |
| Guia de registro | Box, Heading, Text, Label, Link, Button; sumário editorial e âncoras. |
| Para empresas | Box, Heading, Text, Label, Link, Button, FormControl, TextInput, Select e Textarea; formulário comercial. |
| Vitrine | Box, Heading, Text, Label, Link, Button, FormControl e Select; filtro e template de produto. |
| Profissionais | Box, Heading, Text, Label, Link, Button, FormControl, Select e TextInput; filtros e template de perfil. |

O header único dessas sete páginas acrescenta Button e ActionList/LinkItem Primer. O detalhe por ID mantém o shell público React existente e foi alinhado nos links de navegação; ele é a exceção arquitetural descrita acima.

## Leitura pública e compatibilidade

- A migration incremental `20261110000001_public_professional_directory.sql` adiciona RPCs read-only `public_list_professionals` e `public_get_professional`, com `EXECUTE` apenas para `anon` e `authenticated`, paginação com limite de 20 e offset máximo validado, filtros no servidor e projeção explícita de campos publicados. As consultas exigem linha publicada, ciclo de vida `published`, conta ativa e ausência de restrição de conta vigente. Elas não retornam owner ID, e-mail, rascunho, moderação ou IDs de mídia internos. A policy original da tabela continua exigindo `has_app_access()`; nenhum `SELECT *` anônimo foi concedido.
- A policy de leitura do bucket privado `profile-avatars` passa a consultar `public_professional_avatar_visible(path)`, que exige a mesma publicação e estado ativo. Despublicação, suspensão e desativação deixam de autorizar a foto pelo caminho publicado. O browser só tenta exibir caminho WebP da projeção pública, com fallback visual; não há `service_role` nem token privado no HTML/JS.
- `/profissionais` reescreve para HTML estático **antes** do fallback React em `vercel.json`, com variantes `.html`/barra final redirecionadas. `src/App.jsx` já não tem listagem duplicada. O detalhe existente permanece acessível pela URL antiga, e sua leitura foi conectada à RPC pública mínima; links de retorno usam navegação de documento. O detalhe segue `noindex` e ainda responde com o status do shell (200) inclusive quando a aplicação mostra indisponibilidade; um 404/410 real requer servidor dinâmico seguro. O service worker deixa de servir o shell autenticado como fallback offline para rotas estáticas públicas.

## SEO, segurança e desempenho

- Páginas indexáveis mantêm conteúdo, H1, links, canonical absoluto, robots, OG/Twitter e JSON-LD no HTML inicial. `/vitrine` e `/profissionais` permanecem `noindex,follow`, fora do sitemap, porque inventário e detalhes só são obtidos após fetch. O shell React também continua `noindex`. Nenhum texto jurídico, CSP, domínio canônico ou credencial privada foi alterado.
- O teste SQL local executa a migration num Postgres Supabase **descartável**, com fixture mínima, como `anon` e `authenticated`. Cobre projeção, filtros, paginação, rejeição de entrada, publicação, suspensão, restrição, conta desativada, despublicação e revogação de avatar. Não verifica o estado das migrations, grants e dados na produção. Browser usa respostas simuladas para o diretório; não houve consulta real à base remota nesta entrega.
- Os números gzip e comandos de validação são registrados após o último build. Esses bytes são transferência estimada, não LCP/INP/CLS; não houve medição de campo nem Lighthouse confiável.

## Capturas e validação

As capturas anteriores do redesign estão em [before](redesign-captures/before) e [after](redesign-captures/after) para seis páginas. A base anterior tem comparação direta em 375 e 1366 px; não há captura anterior equivalente em todas as seis larguras. A antiga `/profissionais` não teve captura comparável antes da migração: a página React dependia de sessão/RPC fechada ao visitante e não existe como revisão versionada deste working tree.

| Estado posterior no preview local | 320 | 375 | 390 | 768 | 1024 | 1366 |
| --- | --- | --- | --- | --- | --- | --- |
| Profissionais, tema claro | imagem (captura removida) | imagem (captura removida) | imagem (captura removida) | imagem (captura removida) | imagem (captura removida) | imagem (captura removida) |
| Profissionais, menu/filtros | menu (captura removida) · filtros (captura removida) | menu (captura removida) · filtros (captura removida) | menu (captura removida) · filtros (captura removida) | menu (captura removida) · filtros (captura removida) | menu (captura removida) · filtros (captura removida) | filtros (captura removida) |
| Vitrine, tema claro | imagem (captura removida) | imagem (captura removida) | imagem (captura removida) | imagem (captura removida) | imagem (captura removida) | imagem (captura removida) |

O menu não aparece em 1366 px porque a navegação horizontal cabe nessa largura. Capturas de Vitrine usam inventário vazio simulado, e as de Profissionais usam resposta vazia simulada; esses arquivos documentam a UI, não os dados de produção. Há também erro da Vitrine com retry (captura removida) e estado de carregamento (captura removida). As páginas anteriores têm estados antes/depois, conforme a [tabela do redesign inicial](REDESIGN_PAGINAS_PUBLICAS_PRIMER_2026-10-20.md#capturas-do-preview-local).

## Validação e transferência

- `npm run build`: passou. `npm run lint`: passou com os avisos não bloqueantes do projeto. `node --test tests/public-pages.test.mjs src/components/AccountMenu.test.js`: 22/22. `node scripts/public-browser-smoke.mjs`: `PUBLIC_BROWSER_SMOKE_OK`, inclusive falha HTTP e retry na Vitrine. `node scripts/public-redesign-smoke.mjs`: `PUBLIC_REDESIGN_SMOKE_OK` em 320, 375, 390, 768, 1024 e 1366 px, claro/escuro. `node scripts/public-professionals-smoke.mjs`: `PUBLIC_PROFESSIONALS_SMOKE_OK`, com respostas simuladas. `git diff --check`: passou. O pgTAP da migration no banco Docker descartável: 23/23.
- `npm test` falhou em 1 arquivo de 235, `src/utils/businessDate.test.js`, sem mensagem de asserção do runner; os demais 234 arquivos passaram. A repetição com `--test-concurrency=1` teve o mesmo resultado. Executado isoladamente, `node --test src/utils/businessDate.test.js` passou 17/17. O arquivo não foi alterado nesta entrega; a causa da falha apenas na suíte agrupada não foi determinada.
- `npm run budget`: passou. Boot do app: 321.039 B JS gzip e 75.816 B CSS gzip, contra baseline de 320.749/75.572 B, dentro da tolerância de 3%. Esse orçamento mede o app, não substitui o custo das páginas públicas.
- Após o build final, HTML Vitrine: 3.087 B gzip (2.132 B na etapa anterior ao refinamento); HTML Profissionais: 4.292 B gzip (rota nova). CSS público compartilhado: cerca de 36.193 B gzip (`public-pages.css` 6.955 + `public-light.css` 952 + `public-redesign.css` 3.921 + CSS Primer 24.365); antes do refinamento, cerca de 35.141 B. JS comum público: 3.045 B gzip (2.725 B na etapa anterior); JS exclusivo do diretório: 2.671 B gzip. O aumento vem do menu, templates/cards Primer, filtros e retry. As páginas estáticas não carregam o bundle React do app.
- Sem execução de JavaScript, o HTML continua a conter H1, conteúdo, links, canonical, robots e metadados das páginas indexáveis. O navegador local confirmou CSS Primer efetivo no preview; os diretórios usam dados simulados e a migração não foi aplicada remotamente. Não há pontuação de Lighthouse ou dados de Core Web Vitals para esta revisão.

## Arquivos principais

Gerador e UI pública: `scripts/public-primer.mjs`, `scripts/public-pages-template.mjs`, `public/public-pages.css`, `public/public-redesign.css`, `public/public-pages.js`, `public/public-professionals.js`. Rotas/app: `vercel.json`, `src/App.jsx`, `src/components/AccountMenu.jsx`, `src/components/PublicLayout.jsx`, `src/pages/ProfessionalListing.jsx`, `src/services/professionalListingsService.js`, `scripts/service-worker.js`; a listagem React duplicada `src/pages/Professionals.jsx` saiu. Segurança: migration e pgTAP citados. Qualidade: `tests/public-pages.test.mjs`, `src/components/AccountMenu.test.js`, `src/pwa/serviceWorker.test.js` e smokes públicos.
