# EVOLUTUS — Refinar header, navegação e filtros públicos com Primer React

## Objetivo

**Implemente no repositório atual** uma revisão visual e funcional do **layout compartilhado de todas as páginas públicas**, especialmente `/profissionais` (captura de referência) e `/vitrine`. Substitua componentes improvisados, controles nativos sem acabamento e o menu mobile com ícone de *hambúrguer* por uma interface **realmente baseada no Primer React**, elegante, minimalista, consistente com a identidade **Evolutus** e com baixo custo de carregamento.

**Não basta aplicar CSS cosmético.** Reuse componentes oficiais compatíveis com a versão instalada, preserve toda a navegação e o conteúdo público e entregue alterações funcionando. Não modificar áreas autenticadas.

## Problemas concretos a corrigir na captura

1. O botão de hambúrguer (`☰`) é genérico e abre uma lista grande que se sobrepõe à página; o menu parece desconectado do restante do produto.
2. A tipografia do hero ocupa espaço excessivo no mobile, quebra muitas linhas e compete com o menu.
3. Os filtros exibem elementos `<select>` sem padronização, setas/artefatos visuais e colunas apertadas em viewport estreita.
4. Header, links de CTA, campos e superfícies têm densidade/espaçamento pouco coerentes com o aplicativo.
5. O mesmo problema não deve reaparecer em `/vitrine` ou em outras rotas que usam o layout público.

## 1. Diagnóstico antes de editar

- Inspecione branch, SHA, `git status`, código e estilos efetivamente utilizados; preserve alterações preexistentes.
- Localize os componentes e geradores de header, menu, hero, filtros e layout público. Verifique, conforme existirem, `scripts/public-pages-template.mjs`, `scripts/build-public-pages.mjs`, `public/public-pages.css`, `public/public-light.css`, `public/public-pages.js` e rotas/regras de `vercel.json`. Use nomes reais do checkout.
- Confirme as APIs instaladas em `@primer/react`, `@primer/primitives` e `@primer/octicons-react` e os tokens Evolutus vigentes. Não usar componentes ou props inexistentes.
- Preserve o trabalho anterior de padronização pública com Primer, SEO e separação de `/vitrine` e `/profissionais` do shell autenticado.

## 2. Novo header e menu mobile — sem hambúrguer

**Substituir, em todas as páginas públicas, o botão de três traços por um botão identificado por texto**:

- À esquerda: símbolo original + nome **Evolutus**, sem `.com` no texto da marca.
- À direita no mobile: botão Primer compacto **`Explorar` + `ChevronDownIcon`**, com estilo Evolutus, alvo de toque de pelo menos 44×44 px, foco visível e área clicável clara. **Não usar ícone hambúrguer**, nem apenas trocar seus traços por outro ícone sem identificação.
- Ao ativar, abrir navegação ancorada/overlay discreto usando **`ActionMenu`/`ActionList` do Primer**, ou componente oficial equivalente disponível, sem ocupar a tela inteira desnecessariamente. Limitar largura à viewport, adicionar padding e separar links de descoberta e conta com hierarquia clara.
- Preservar os destinos existentes: Como funciona, Funcionalidades, Guia de registro (se existir), Para empresas, Vitrine, Profissionais, Entrar e Criar conta. **Não duplicar links nem remover rotas**. Destacar no máximo uma ação principal, como Criar conta.
- `aria-expanded`, nome acessível, navegação por teclado, Escape, foco gerenciado, fechamento ao navegar e ao clicar fora, sem *scroll lock* indevido. Não ocultar conteúdo com menu aberto de maneira que impeça navegação.
- Em desktop, navegação horizontal com links reais e CTA coerente; o botão `Explorar` fica apenas quando o espaço exigir. Evitar overflow e mudanças bruscas no breakpoint.
- Um **único componente/layout público** compartilhado deve controlar a navegação; não construir headers divergentes por página.

## 3. Substituir controles e padronizar as páginas com Primer real

**Em `/profissionais`:**

- Recriar formulário de filtros com **`FormControl`, `Select`, `TextInput`, `Button` e controles equivalentes oficiais** conforme a versão instalada. Eliminar as setas duplicadas e estilos de `<select>` conflitantes. Preservar exatamente as opções, filtros, busca, paginação, ordenação e regras atuais.
- Mobile (320–430 px): **uma coluna**, labels visíveis, campos de largura total, gaps consistentes, ação para aplicar/limpar filtros quando fizer sentido; jamais três selects comprimidos lado a lado. Tablet/desktop: grid adaptativo de duas ou três colunas conforme espaço real.
- Reorganizar o hero com **tipografia Primer + tokens Evolutus**: H1 mais equilibrado em mobile, largura de leitura controlada, subtítulo objetivo e CTAs de hierarquia evidente. Preservar a mensagem e os links verdadeiros sem inserir marketing fictício.
- Renderizar resultados usando superfícies/composição Primer (por exemplo `Box`, texto, botões e labels oficiais), com estados de carregamento, vazio, erro e paginação consistentes.

**Em `/vitrine`:**

- Aplicar os mesmos componentes de busca/filtro, labels, botões, grids, cartões de produto e estados; adaptar a composição ao objetivo de descoberta de produtos, sem repetir exatamente o hero de Profissionais.
- Preservar inventário, imagens, patrocinados, redirecionamentos externos seguros e política de indexação atual.

**Em todas as rotas públicas existentes** (`/`, `/como-funciona`, `/funcionalidades`, `/para-empresas`, `/guia-registro-treino` se existir, `/vitrine`, `/profissionais` e detalhes públicos):

- Reutilizar header, navegação, footer, tokens, botões, links, campos e superfícies compartilhados. Corrigir inconsistências visuais sem reescrever conteúdo desnecessariamente.
- Usar **componentes oficiais do Primer substantivamente**, não clones artesanais de Primer com CSS. Onde não houver componente apropriado/compatível com o renderizador estático, explicar e usar composição semântica mínima com tokens da biblioteca.
- Visual Evolutus: paleta escura/verde existente, contraste legível, sombras e bordas discretas, espaçamento confortável, sem gradientes exagerados, efeitos pesados ou aparência padrão do GitHub.

## 4. Arquitetura, performance e SEO — requisitos obrigatórios

- Preservar **HTML público gerado/SSR/estático com conteúdo principal, H1, links e metadados disponíveis sem JavaScript**. Não converter páginas públicas para CSR nem importar `App.jsx`, sessão, roteador autenticado ou bundles privados.
- Verificar a renderização e o CSS efetivo dos componentes Primer no HTML final. Para `ActionMenu` e outros controles interativos, carregar somente o JS/hidratação **mínima e localizada**, sem hidratar o layout inteiro. Evitar dependências extras salvo justificativa técnica.
- Preservar `canonical`, `robots`, Open Graph, JSON-LD, sitemap, redirects, status HTTP e as regras de `noindex` vigentes para páginas de catálogo sem conteúdo rastreável.
- Evitar CLS: reservar dimensões dos elementos, não inserir menu causando deslocamento de página, otimizar ícones e não adicionar animações custosas. Respeitar `prefers-reduced-motion`.
- Manter todas as interações e consultas existentes; não relaxar permissões Supabase nem expor dados não publicados.
- Comparar o tamanho de HTML/CSS/JS antes/depois e executar o orçamento de bundle do repositório quando disponível.

## 5. Validação e critérios de aceite

1. Capturas **antes/depois** em 320, 375, 390, 768, 1024 e 1366 px; avaliar menu fechado/aberto, hero e formulário de filtros. Sem sobreposição indevida, corte ou scroll horizontal.
2. Nenhuma página pública apresenta o antigo hambúrguer; o botão **Explorar** é acessível e o menu mantém **todos os destinos** e funções, em mouse, toque e teclado.
3. Em `/profissionais`, filtros Primer reais aparecem **empilhados no mobile** e funcionam corretamente; sem setas sobrepostas nem desconfiguração do CSS.
4. `/vitrine` e as demais páginas usam os **mesmos componentes e tokens compartilhados**, respeitando conteúdo e layout apropriados a cada rota.
5. Navegação anônima, refresh, URL direta, retorno ao aplicativo, login/cadastro, filtros, links e estados de erro continuam íntegros.
6. HTML indexável e metas permanecem corretos **sem JS**; sem regressão material injustificada de performance e acessibilidade.
7. Executar build, lint, testes de rotas/SEO, smoke de navegador e `npm run budget` quando disponíveis; relatar falhas e limitações honestamente.

## Entrega

**Implemente as mudanças locais**, apresente diff revisável e resumo curto com arquivos alterados, componentes Primer utilizados, capturas antes/depois, resultados de testes e custo de bundle. **Não fazer commit, push, migração remota ou deploy sem autorização explícita.**
