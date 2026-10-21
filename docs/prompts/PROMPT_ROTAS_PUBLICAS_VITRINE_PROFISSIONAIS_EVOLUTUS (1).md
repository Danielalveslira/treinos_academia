# EVOLUTUS — Padronização de todas as rotas públicas com Primer React

## Objetivo

**Implemente no código** um design system público único, baseado em **componentes oficiais do Primer React**, com identidade visual própria da Evolutus. Padronize **todas as páginas públicas de apresentação existentes**, inclusive `/vitrine` e `/profissionais`, mantendo particularidades de conteúdo e finalidade de cada página.

As páginas devem ser **visualmente sofisticadas, leves, acessíveis e responsivas**; jamais um clone do GitHub, uma troca superficial de CSS ou um conjunto de componentes falsamente chamados de Primer.

Além do redesign, ajuste a navegação do aplicativo para apresentar **exatamente dois acessos de descoberta** que abram suas respectivas rotas **públicas, fora do shell autenticado**:

| Link no app (desktop/mobile) | Rota pública | Finalidade |
| --- | --- | --- |
| **Vitrine de produtos** | `/vitrine` | Descobrir produtos reais e visitar lojas parceiras. |
| **Profissionais e locais** | `/profissionais` | Encontrar profissionais/espaços e acessar seus perfis públicos. |

**Executar apenas localmente. Não fazer commit, push, migrações remotas nem deploy sem autorização explícita.**

## 1. Diagnóstico obrigatório antes de editar

1. Inspecione o checkout **atual**: branch, SHA, `git status`, arquivos alterados e rotas efetivamente existentes. **Preserve alterações anteriores**, inclusive prompts/documentação.
2. Inventarie **todas as páginas públicas de apresentação**, em vez de tratar `/como-funciona` ou `/vitrine` isoladamente. Escopo mínimo, se presente:
   - `/` — Home;
   - `/como-funciona`;
   - `/funcionalidades`;
   - `/para-empresas`;
   - `/guia-registro-treino` (se implementado);
   - `/vitrine`;
   - `/profissionais`;
   - `/profissionais/:listingId` — detalhe público existente, com tratamento de compatibilidade definido abaixo;
   - cabeçalho, menu mobile, rodapé, CTAs, filtros, formulários e estados compartilhados.
3. Inclua outras **landing pages públicas produzidas pelo mesmo pipeline**, se existirem. Páginas legais públicas devem manter URLs, conteúdo e acessibilidade; alinhe o chrome visual apenas quando couber, **sem modificar o texto jurídico**.
4. **Não redesenhar** o aplicativo interno, perfis privados, dashboards, finanças, autenticação, comunidades, moderação ou administração. `/minha-vitrine` é área **privada de gestão** e não deve ser confundida com `/vitrine` (produtos públicos).
5. Localize os equivalentes atuais de `scripts/public-pages-template.mjs`, `scripts/build-public-pages.mjs`, `scripts/public-preview-plugin.js`, `public/public-pages.css`, `public/public-light.css`, `public/public-pages.js`, `vercel.json`, `src/App.jsx`, `src/components/AccountMenu.jsx` e testes.
6. Leia `docs/SEO_IMPLEMENTACAO_2026-10-20.md` **se existir**; valide o código atual, não tome documentação histórica como prova de funcionamento.
7. Confirme versões e APIs **realmente instaladas** de `@primer/react`, `@primer/primitives`, `@primer/octicons-react`, React e Vite no package/lockfile. Como referência, no ZIP analisado havia React 18 e Primer React 37; **o checkout atual prevalece**.
8. Registre evidências antes da mudança: capturas desktop/mobile das páginas, inspeção do HTML sem JS, regras de indexação, navegação, comportamento no tema claro/escuro e tamanhos atuais de HTML/CSS/JS. Se algum teste visual for impossível, declare a limitação.

## 2. Padrão visual e Primer — obrigatório em todo o público

Crie uma linguagem visual **Evolutus + Primer**, reutilizável e coerente, aplicada em todas as páginas do escopo.

- **Componentes reais de `@primer/react`** devem compor de forma substancial a UI: controles, botões, links, tipografia, estrutura de layout, navegação, formulários e superfícies/cartões **conforme APIs suportadas pela versão instalada**. Não implemente cópias artesanais dos componentes para apenas parecer Primer.
- Use tokens reais de `@primer/primitives` e os tokens de marca Evolutus para tipografia, cores, espaçamento, raios, bordas, foco e superfícies. Centralize o tema e as variantes em uma **camada pública compartilhada**; evite hexadecimais repetidos e CSS divergente por rota.
- Inspecione o `ThemeProvider` e `BaseStyles` usados no app. **Reutilize a base visual**, mas **não importe o shell autenticado** nas páginas públicas.
- Utilize os ícones oficiais existentes (`@primer/octicons-react` quando adequado) e o **símbolo original da Evolutus**. Exiba o texto da marca como **“Evolutus”**, sem `.com`; mantenha `evolutus.com.br` **inalterado** em domínios, links, canonical, e-mails e configurações.
- Preserve os modos claro/escuro, quando já disponíveis, incluindo persistência de preferência e ausência de flash perceptível de tema. Identidade da Evolutus: verde da marca, fundos/superfícies próprios, alto contraste, ritmo visual limpo. **Primer é infraestrutura visual, não a identidade GitHub.**
- Padronize **header público**, menu mobile, footer, containers, grid, botões, filtros, labels, estados, navegação de retorno e foco. Mantenha **hierarquia visual própria para cada página**, sem repetir um hero ou grid genérico em todas.
- Inclua hover/focus/disabled/error/loading com tokens consistentes, responsividade e `prefers-reduced-motion`. Nenhum elemento decorativo deve prejudicar leitura ou desempenho.
- Consulte documentação correspondente à versão instalada: [Primer React](https://primer.style/product/getting-started/react/), [Theming](https://primer.style/product/getting-started/react/theming/) e, como **opção a avaliar**, [Primer Brand](https://primer.style/brand/). **Não adicionar Primer Brand ou atualizar major versions automaticamente**; justifique qualquer dependência.

### Regra arquitetural inegociável: Primer sem comprometer páginas públicas

O pipeline atual gera **HTML público estático** e isso deve continuar onde for adequado. **Não converta as landings para CSR nem carregue todo o app React para desenhar a página.**

1. Faça **uma prova de conceito** na página pública mais simples usando componentes Primer reais renderizados durante o **build** (por exemplo, React `renderToStaticMarkup` com pipeline e CSS compatíveis). Valide HTML final, tema, CSS gerado, links, build, tamanho de payload e ausência de conteúdo crítico dependente de JS.
2. Reutilize a abordagem validada no gerador público. Prefira composição de componentes e **layout compartilhado** em vez de duplicar HTML/CSS ou introduzir uma segunda aplicação pesada.
3. **Somente interações necessárias** (filtro, menu, formulário, busca) devem carregar JavaScript/hidratação localizada. Não hidrate toda a página para viabilizar um único componente.
4. Confirme explicitamente que estilos do Primer funcionam no **HTML servido** (e não só no dev); resolva corretamente extração/inclusão de CSS, ThemeProvider e eventuais incompatibilidades SSR. **Não declare concluída uma migração com HTML sem estilo ou hydration mismatch.**
5. Caso uma API específica do Primer não suporte renderização estática, **substitua aquele controle por outra API oficial compatível ou isole a interação**. Preserve SEO/segurança/performance; não use isso como justificativa para entregar páginas públicas apenas em CSR ou abandonar o uso substancial do Primer.
6. Documente os **componentes Primer efetivamente usados por página** e o impacto de HTML/CSS/JS antes/depois.

## 3. Redesign por rota — conteúdo verdadeiro e foco próprio

| Rota | Experiência requerida |
| --- | --- |
| `/` | Hero forte com proposta de valor real, prévia/imagem oficial do produto, caminho claro para cadastro, funcionamento e recursos. Respeitar redirecionamento atual de usuários autenticados. |
| `/como-funciona` | Jornada visual objetiva desde início até registro, histórico e evolução. Etapas claras, prévias fiéis e FAQ existente quando válido. |
| `/funcionalidades` | Agrupar planejamento, exercícios, treino, histórico, progresso e comunidades por benefício; CTAs coerentes e sem anunciar acesso público a dados privados. |
| `/para-empresas` | Página comercial confiável e direta: formatos de parceria reais e formulário com campos, validação, consentimento, submissão, sucesso e erro preservados. |
| `/guia-registro-treino` | Conteúdo editorial com âncoras, etapas e exemplos genéricos; sem inventar resultados pessoais. Incluir somente se a rota existir. |
| `/vitrine` | Página pública de produtos com hero compacto, grid responsivo, filtro funcional, informações reais, selo de patrocínio quando aplicável, CTA externo seguro e estados vazio/erro/loading. |
| `/profissionais` | Diretório público independente com filtros, cards de profissionais/espaços autorizados, CTA de perfil, paginação e estados. Ênfase em correspondência, confiança baseada em dados e localização divulgada. |
| `/profissionais/:listingId` | Detalhe público compartilhável com informações realmente publicáveis, contato autorizado, compartilhamento e denúncia; preservar URLs existentes durante eventual migração. |

**Objetivo dos vieses de apresentação:** na Vitrine, clareza de benefícios e descoberta; em Profissionais, relevância, especialidade, localização e confiança **comprovável**. **Proibido:** urgência falsa, avaliações inexistentes, falsos selos/certificações, rankings sem critérios, preços inventados, métricas fictícias ou depoimentos gerados.

### Vitrine de produtos

- **Evoluir a rota `/vitrine` existente**, com fetch apenas onde necessário. Não criar versão duplicada dentro de `/app`.
- Cada card apresenta os campos aprovados disponíveis (imagem otimizada, marca, produto, categoria e descrição curta), com estados de indisponibilidade claros. Não presumir preço, estoque, desconto ou garantia.
- Filtro e busca apenas quando agregarem valor, com loading, vazio, erro e retry acessíveis. `rel="noopener noreferrer"` em links externos, `rel="sponsored"` se aplicável e **HTTPS/host validado**.
- CTA “Ver na loja”; explicitar que compra, entrega e suporte são feitos com o parceiro. **Sem checkout interno**.
- Preserve consulta/permissões atuais dos produtos aprovados e **`noindex` até existir inventário publicável no HTML inicial e condições reais para indexação**; JavaScript client-side sozinho não comprova SEO.

### Profissionais e locais: rota pública leve

- Gerar `/profissionais` pelo pipeline público, com conteúdo estrutural/metadata em HTML inicial e interface Primer renderizada de modo econômico.
- Ajustar `vercel.json` para `/profissionais` → página pública gerada **antes do fallback React**; atualizar desenvolvimento/preview e testes correspondentes.
- A rota React atual `src/pages/Professionals.jsx` deve sair do roteamento do app **somente após** a alternativa pública funcionar com refresh, acesso direto, sem login e links de retorno. Não manter implementações duplicadas.
- Filtros objetivos: tipo (profissional/estabelecimento), especialidade/modalidade, UF/cidade, atendimento presencial/online/híbrido **somente se os dados reais suportarem**; reutilizar taxonomias centrais. Manter compatibilidade com `?tipo=` e considerar query strings compartilháveis.
- Cards: nome público, tipo, especialidades, cidade/UF, modalidade, atendimento e imagem **explicitamente pública**; CTA “Ver perfil”. Sem dados pessoais não publicados.
- Paginar com limite validado no servidor; não baixar o banco inteiro. Debounce/cancelamento de requisições quando aplicável. Estados: carregando, zero publicados, filtro sem resultados, erro/retry.
- Informar que contato/contratação se dá diretamente com o profissional; não prometer certificação/verificação sem dados. Ação discreta “Voltar ao aplicativo” → `/app`.

### Detalhes `/profissionais/:listingId`

- Preservar IDs, compartilhamento, URLs existentes, contatos e denúncia. **Não remover a rota antiga enquanto a nova solução não estiver funcional.**
- Preferir resposta pública leve com conteúdo e metadados específicos **se a arquitetura de dados permitir renderizar o detalhe por ID com status HTTP correto**.
- Se não houver SSR/edge seguro ou geração estática para registros dinâmicos, **manter temporariamente o detalhe React público existente como exceção documentada**, alinhando seu visual ao design system e conectando-o ao endpoint público seguro. Não fingir status 404/410 por exibir erro dentro de HTML com 200.
- Aplicar `noindex` até haver HTML realmente indexável, URLs canônicas confiáveis e conteúdo público autorizado.

## 4. Navegação do aplicativo: exatamente dois acessos públicos

Em `src/components/AccountMenu.jsx` (ou equivalente atual):

1. Agrupe em **Explorar** apenas `Vitrine de produtos` → `/vitrine` e `Profissionais e locais` → `/profissionais`.
2. Exiba os dois em desktop e mobile para usuários comuns, sem dependência de perfil de uso. Remova a ocorrência anterior de Profissionais em `Minha conta` para não duplicar.
3. Use link nativo (`<a href>` ou equivalente Primer que faça **navegação real de documento**); não deixar o React Router interceptar e servir o `app-shell.html` para essas rotas.
4. Reutilize a configuração e o renderizador do menu, conservando teclado, foco, Escape, fechamento e retorno ao app/PWA.
5. Não criar abas extras no rodapé móvel. Não mover nem alterar o fluxo privado `/minha-vitrine`, nem `/admin/vitrines`.
6. Na **navegação pública compartilhada**, inclua acesso a Vitrine e Profissionais em desktop/mobile sem excesso de itens; permita descoberta recíproca quando fizer sentido.

## 5. Segurança Supabase — bloqueio antes de liberar o diretório anônimo

No ZIP de referência, `list_published_professional_listings` e a policy `SELECT` em `published_professional_listings` exigem `has_app_access()`. **Confirme no checkout atual. Se permanecer assim, abrir a página publicamente não basta: consultas anônimas falharão.**

Implemente **uma superfície pública mínima de leitura**, com migração incremental versionada (nunca editar migração aplicada):

- RPC/endpoint read-only de **listagem e detalhe publicados**, autorizado a visitante `anon` com limites/paginação/filtros server-side e validação de entradas.
- Retorne apenas campos explicitamente publicados: identificador público, nome público/comercial, tipo, especialidades, região divulgada, modalidade, atendimento, biografia publicável, contatos consentidos e referência a foto publicada.
- **Nunca** inclua e-mails internos/owner, dados de conta, mídia privada, denúncias, moderação, pendências, registros suspensos/despublicados, IDs técnicos confidenciais ou informações administrativas.
- Não conceda `SELECT *` anônimo nem remova genericamente `has_app_access()` do restante do banco. Se usar `SECURITY DEFINER`, restringir `EXECUTE`, schema/search_path e validar regras de publicação em toda consulta; evitar bypass de RLS indevido.
- Fotos públicas: verificar permissões reais; se necessário, usar derivação pública aprovada com mecanismo de revogação. **Nunca** tornar um bucket privado inteiro público.
- Jamais colocar `service_role`, credenciais privadas ou tokens secretos no browser/HTML/metadata. Sanitizar texto; validar URLs de imagem/contato e protocolos.
- Validar com clientes **sem sessão**, usuário comum, titular e admin; cobrir publicação, suspensão, despublicação e exclusão. Nenhuma página pública pode revelar dados de rascunho em API/cache/HTML.

## 6. SEO, arquitetura, acessibilidade e performance — sem regressões

**SEO / geração:**
- Entregar conteúdo principal, headings e links das páginas indexáveis no **HTML inicial**, sem exigir execução de JS. Preservar títulos, descrições, `canonical` absoluto, `robots`, pt-BR, Open Graph/Twitter Cards, JSON-LD válido, sitemap, redirects e status HTTP.
- Manter `/vitrine` e páginas de profissionais **`noindex` quando o conteúdo real só existir após fetch no cliente**; só revisar indexação com HTML renderizado contendo inventário público confiável, regras aprovadas e testes. Rotas privadas continuam não indexáveis e protegidas.
- Preservar o relatório SEO existente, regras de domínio, CSP e headers. Evitar duplicar meta tags e inventar dados estruturados.

**Performance:**
- Importar JS/CSS apenas na rota que usa; nenhuma página de marketing deve carregar bundles autenticados, contextos de sessão ou buscas Supabase desnecessárias.
- Pré-carregar apenas assets acima da dobra; imagens otimizadas (AVIF/WebP quando disponíveis), `width/height` ou aspect-ratio, lazy loading abaixo da dobra e sem CLS causado por cards.
- Medir HTML/CSS/JS transferidos antes/depois e executar `npm run budget`; justificar todo aumento. Não tratar bundle size como medição de LCP/INP/CLS; usar Lighthouse/DevTools se disponíveis.
- Testar visita sem cache/Service Worker e retorno com cache; verificar que rotas públicas, assets e retorno ao PWA não sofrem interceptações inesperadas.

**Acessibilidade / responsividade:**
- Testar 320, 375, 390, 768, 1024 e 1366 px, menu e filtros sem overflow, conteúdo cortado ou CTA sobreposto.
- Landmarks, um H1 por página, link “Pular para o conteúdo”, labels, mensagens de status anunciadas, foco visível, fluxo de teclado, alvos de toque, alt, contraste WCAG AA e `prefers-reduced-motion`.
- Navegação pública funciona sem login, link direto, refresh e aba anônima; erros e estados vazios têm mensagens reais, não silenciam falhas.

## 7. Ordem de execução — evitar trabalho duplicado

1. **Inventário + baseline** de rotas, design, SEO, acessibilidade, bundle e segurança.
2. **Prova de Primer no HTML público gerado**: SSR/build, estilos e peso; definir layout/tokens/componentes compartilhados sem shell do app.
3. **Padronização global** das páginas de marketing (home, como funciona, funcionalidades, empresas, guia), com conteúdo verdadeiro e diferenças de composição.
4. **Vitrine**: aproveitar dados/HTML atuais, aplicar sistema visual e corrigir estados/filtros/links, sem checkout.
5. **Profissionais**: endpoint público seguro, página independente, rewrites, filtros/cards; tratar compatibilidade do detalhe sem quebras.
6. **Links no menu do app** e navegação pública, sem duplicar rotas ou alterar áreas privadas.
7. **Auditar/testar** no build, preview, sem JS quando aplicável e, quando possível, com navegador em desktop/mobile. Apresentar diff local.

## 8. Arquivos prioritários (validar nomes atuais)

- Gerador público: `scripts/public-pages-template.mjs`, `scripts/build-public-pages.mjs`, `scripts/public-preview-plugin.js`.
- Estilos e interatividade públicos: `public/public-pages.css`, `public/public-light.css`, `public/public-pages.js` e novos módulos **somente se necessários**.
- Primer/tema: `package.json`, lockfile, tema/tokens/BrandMark atuais do app; novos componentes compartilhados do público no menor número razoável de arquivos.
- Rotas/navegação: `vercel.json`, `src/App.jsx`, `src/components/AccountMenu.jsx` e seus testes.
- Profissionais: `src/pages/Professionals.jsx`, `src/pages/ProfessionalListing.jsx`, `src/services/professionalListingsService.js`, políticas/RPC Supabase, nova migration e testes.
- Qualidade: `tests/public-pages.test.mjs`, `scripts/public-browser-smoke.mjs`, testes SEO e redirects, `scripts/bundle-budget.mjs`, `docs/SEO_IMPLEMENTACAO_2026-10-20.md` se existente.

> Esses caminhos refletem o ZIP usado como referência. **Inspecione o repositório atual** antes de modificar ou excluir qualquer arquivo.

## 9. Critérios de aceite e entrega

- [ ] Todas as rotas públicas de apresentação inventariadas seguem **um design system Evolutus/Primer**, sem virar cópias umas das outras; uso substancial dos componentes oficiais documentado e verificável.
- [ ] Páginas públicas indexáveis continuam entregando conteúdo verdadeiro, H1, links, SEO e CSS adequado no HTML inicial; nada essencial depende de JS. Catálogos/detalhes sem conteúdo HTML rastreável permanecem `noindex`.
- [ ] `/vitrine` e `/profissionais` são **páginas públicas leves** abertas pelos **dois links únicos de Explorar** no menu desktop/mobile; `reload`, acesso direto e uso anônimo funcionam.
- [ ] `/profissionais/:listingId` mantém compatibilidade e dados seguros; eventual exceção React fica explicitamente documentada. `/minha-vitrine` e `/admin/vitrines` permanecem privados e íntegros.
- [ ] Visitantes anônimos obtêm **somente dados publicados e permitidos**. Nenhum afrouxamento de RLS, vazamento de dados privados ou credenciais no cliente.
- [ ] Header, footer, formulários, filtros, estados, temas, teclado, contraste e layout passam nos testes mobile/desktop. Nenhum fluxo existente perde funcionalidade.
- [ ] `npm run lint`, `npm run build`, `npm test`, `npm run budget`, testes públicos/SEO, testes de acesso anônimo e smoke browser são executados **quando disponíveis**. Registrar comandos, saída relevante, falhas preexistentes e impossibilidades sem inventar resultados.
- [ ] O relatório final inclui: **rotas/arquivos alterados, componentes Primer usados, estratégia SSR/build, tokens compartilhados, screenshots antes/depois quando obtidos, HTML/metadados verificados, impacto no bundle, testes e pendências**. Distinguir código local de produção.

**Entrega:** implementar com mudanças coesas e revisáveis, preservar o working tree e retornar resumo técnico sucinto. **Não fazer commit, push, aplicar migração remota ou publicar sem autorização.**
