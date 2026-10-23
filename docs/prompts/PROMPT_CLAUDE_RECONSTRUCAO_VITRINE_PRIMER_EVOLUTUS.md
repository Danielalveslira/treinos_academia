# EVOLUTUS — Reconstrução completa da Vitrine pública com Primer

## Missão

**Implemente a nova página `/vitrine` agora. Não entregue apenas uma auditoria, wireframe ou plano.**

A Vitrine foi intencionalmente esvaziada para reconstrução. O estado atual (conforme print fornecido) contém somente o header público, o título “Vitrine” e o footer. Construa **uma Vitrine funcional, elegante, compacta, mobile-first e consistente com a nova arquitetura pública do Evolutus**, baseada em **componentes reais do Primer React**, sem ressuscitar o código visual antigo.

Objetivo do visitante: **encontrar produtos publicados por marcas parceiras, pesquisar, filtrar, ampliar fotos e acessar a loja do parceiro**. Não transforme a página em uma landing page longa ou um marketplace com checkout próprio.

## 1. Escopo e limites inegociáveis

**Pode alterar:** somente a implementação da Vitrine pública, seus módulos de UI específicos, styles específicos estritamente necessários e testes/smokes relacionados.

**Não pode alterar:**

- **Todo o `/app`**, incluindo `src/main.jsx`, `src/App.jsx`, `src/components/Layout.jsx`, `src/components/exerciseVisuals/ExerciseVisualPreview.jsx`, temas, navegação e CSS privados. Consulte somente como referência visual/técnica.
- **Header/hamburger públicos e footer compartilhados:** manter exatamente os que já foram reconstruídos. Não substitua, redesenhe ou duplique.
- Home `/`, `/como-funciona`, `/para-empresas`, `/profissionais`, autenticação e qualquer outra rota.
- API, banco de dados, políticas RLS, fluxos administrativos, publicação de produtos, uploads ou cadastro de marcas; somente leitura dos contratos existentes.
- Não restaurar `/funcionalidades` ou `/guia-registro-treino`, previamente removidas.

Não use `git reset`, `git checkout`, revert global, dependências novas desnecessárias ou mudanças de configuração global para contornar falhas locais. Não faça deploy sem autorização.

## 2. Inspeção técnica rápida antes de codificar

Verifique no **repositório atual** — não suponha que o ZIP antigo represente o código vigente:

1. Como `/vitrine` é gerada no build público, como seus módulos são carregados, como o tema e os tokens Primer funcionam e como a navegação Turbo limpa/reinicializa a página.
2. Quais componentes reais de `@primer/react` e ícones Octicons já existem e quais padrões públicos podem ser reaproveitados **sem importar o bundle do `/app`**.
3. O contrato vigente do catálogo público e os campos efetivamente disponíveis. A implementação anterior utilizava a RPC Supabase **`public_product_catalog`**, com modos de categorias, grupos por marca e resultados filtrados. Confirme se esse contrato continua válido antes de reutilizá-lo.
4. Quais estilos, scripts e componentes da Vitrine antiga já foram removidos. Não recrie arquivos ou estruturas obsoletas somente por familiaridade.

Faça a inspeção necessária em silêncio; **não gaste tokens com um relatório intermediário**. Em seguida, implemente.

## 3. Experiência visual — composição obrigatória

A página deve parecer parte do mesmo produto que o `/app`, mas permanecer **muito mais simples e leve**.

### A. Cabeçalho de conteúdo compacto

- Logo abaixo do header compartilhado, um **H1 “Vitrine”**, em tamanho moderado e proporcional no celular; não usar título hero gigante.
- Uma frase curta, por exemplo: “Produtos de marcas parceiras, em um só lugar.”
- Margens, largura máxima e ritmo vertical alinhados ao padrão da home pública.
- **Nada de banners, ilustrações genéricas, números falsos, grandes áreas vazias ou CTAs repetidos.**

### B. Busca e filtros minimalistas

- Campo principal: **“Buscar produtos ou marcas”**, com componente oficial Primer adequado à versão instalada e ícone de busca.
- Filtro de **categoria** com Primer (`Select`, `SelectPanel`, `ActionMenu` ou equivalente suportado); mantenha o controle realmente acessível em teclado/touch.
- `Limpar filtros` somente quando houver filtros ativos.
- Desktop: filtros em linha, com dimensões equilibradas; mobile: empilhar ou reorganizar sem overflow.
- Categorias devem vir do catálogo publicado, não de dados hardcoded.
- Buscas combinadas com categoria e, quando aplicável, marca; permitir URL compartilhável preservando os parâmetros públicos existentes (`busca`, `categoria`, `marca`) **se ainda fizerem parte do contrato vigente**.
- Busca com debounce curto e cancelamento/identificação de requisições obsoletas; não disparar consultas concorrentes descontroladas nem alterar a URL a cada render.

### C. Catálogo e cards

- **Mobile-first**: uma coluna confortável em telas estreitas; grid responsivo à medida que houver largura.
- Cards compactos, consistentes e visualmente limpos, com imagem em contêiner de proporção estável (`object-fit: contain`), nome, marca e informação secundária curta quando existente.
- Descrições extensas devem ser resumidas visualmente sem esconder informações essenciais de acessibilidade.
- Rótulo **“Patrocinado”** quando aplicável; não inventar avaliações, preços, descontos, disponibilidade ou quantidade de vendas.
- Um CTA evidente e estável: **“Ver na loja”**. Use a aparência/tokens Primer e o verde da identidade Evolutus se esse for o padrão compartilhado. **A cor não pode mudar após hidratação, troca de tema ou espera de alguns segundos.**
- O card não deve esticar exageradamente quando houver somente **um produto**; controlar largura máxima e distribuição do grid.
- Sem imagem disponível: placeholder discreto e consistente, sem ícone quebrado.
- Se o catálogo vigente suportar **agrupamento por marca sem filtros**, preserve essa lógica; ao filtrar, mostre resultados diretos e claros. Não invente categorias ou modelo de dados novo.
- Paginação ou “Carregar mais” com o contrato do backend, evitando trazer todo o catálogo para o cliente. Preserve ordem e limites existentes, salvo defeito comprovado.
- Estados visíveis, acessíveis e sem ruído: **carregando**, **nenhum resultado**, **erro com tentar novamente**, **sucesso**.

### D. Ampliação de imagem — requisito crítico

O problema da ampliação já causou múltiplas falsas entregas. **Este item só está concluído se a imagem realmente abrir um popup visível no navegador.**

- Ao clicar/tocar **na imagem do produto**, abrir um `Dialog` **real do Primer**, visualmente equivalente ao popup de imagens de exercícios do sistema: centralizado, com superfície opaca, sombra, backdrop, botão fechar, título do produto e foto ampliada **sem recorte** (`object-fit: contain`).
- Mostrar nome, marca, descrição curta e link externo para a loja, quando existirem.
- Fechar por **X, Esc e backdrop** (se o comportamento padrão do componente permitir); aprisionar foco adequadamente e devolvê-lo ao gatilho ao fechar.
- **A ação “Ver na loja” é independente**: abre o link do parceiro, nunca dispara a ampliação.
- Link externo somente com URL segura validada; `target="_blank"`, `rel="noopener noreferrer"` e `sponsored` quando for patrocinado. Não usar HTML remoto inserido sem sanitização.
- **Atenção especial ao defeito anterior:** o Vite deduplicava CSS de tokens Primer com o bundle privado, deixando o `Dialog` público transparente/invisível. Garanta que o CSS/tokens do modal estejam **disponíveis na própria Vitrine**, nos temas claro e escuro, **sem depender de CSS importado exclusivamente pelo `/app`**.
- Se a abordagem atual usar `?inline` ou `<style>`: confira a CSP real e evite injeções duplicadas por abertura/reabertura ou navegação Turbo. Prefira a forma mais estável e compatível com o build público.
- Carregue o código pesado do modal **sob demanda no primeiro clique**, sem adicioná-lo ao boot comum, quando viável. Não carregue o app privado para mostrar uma foto.

## 4. Arquitetura e implementação

- Reuse a arquitetura pública existente (HTML inicial/geração de página + componentes React isolados quando necessário). **Não converta todas as rotas em uma SPA** para implementar a Vitrine.
- Para elementos visuais interativos novos, use **componentes oficiais de `@primer/react`**, não HTML com classes que imitam Primer. HTML semântico (`main`, `section`, `h1` etc.) é permitido.
- Prefira pequenos componentes reutilizáveis e responsabilidades separadas: layout da Vitrine, filtros, cards, acesso ao catálogo e popup. **Não crie abstrações genéricas novas** se não houver reutilização real.
- **CSS próprio mínimo**, apenas para medidas e disposição inevitáveis; cores, bordas, tipografia, estados e espaçamento devem usar tokens Primer. Proibido acumular overrides, `!important`, seletores globais e arquivos de correção em cascata.
- Descarte com segurança CSS, JS e templates antigos **exclusivos da Vitrine** que estiverem órfãos. Antes de remover, confira referências reais em outras rotas.
- Preserve integração de tema público e o comportamento durante transições Turbo. Evite handlers duplicados, múltiplas raízes React, vazamento de listeners e requests não cancelados.
- Não exponha dados privados nem altere o controle de publicação. Somente produtos efetivamente públicos podem aparecer; mantenha a autorização/RLS do backend e a chave **pública**, nunca service-role no frontend.
- Preserve tratamento de dados malformados, respostas vazias, erro de API e URL externa insegura, sem travar a interface.

## 5. SEO, acessibilidade e performance

**SEO**

- Mantenha `/vitrine` acessível, com `200`, título, meta description, canonical, Open Graph e `h1` únicos e corretos; verifique os valores atuais antes de alterar.
- Estrutura semântica indexável **no HTML inicial** ao menos para a apresentação principal. Não finja que produtos buscados somente por JavaScript aparecem no HTML inicial; se não houver SSR/prerender existente para o catálogo, registre essa limitação sem redesenhar a arquitetura global.
- Links reais, legíveis por crawlers, quando renderizados; não invente schema de produto, preço, reviews ou oferta sem dados confiáveis.

**Acessibilidade**

- Teclado, foco visível, labels, contraste, alvo de toque confortável, `aria` apropriado, nomes acessíveis no botão de ampliar, imagens com `alt` útil e suporte a movimento reduzido.

**Performance**

- Imagens com dimensões conhecidas para evitar CLS, carregamento lazy abaixo da dobra e decodificação adequada; não marcar indiscriminadamente todas como `fetchpriority="high"`.
- Evite bibliotecas extras, fetch de todos os registros e boot de chunks pesados. A página deve carregar com **um único produto** e com **centenas**, sem layout quebrado.
- Compare JS/CSS gzip e requisições antes/depois. A pendência histórica de `npm run budget` deve ser **mensurada e relatada**, nunca ocultada atualizando o baseline sem autorização.

## 6. Validação obrigatória — não aceitar somente testes verdes

Execute em navegador real (Chromium/Playwright, se disponível) **contra o build atual**, não screenshots antigas. Testar **320, 390, 768 e 1440 px**, nos temas **claro e escuro**.

**Checklist visual e funcional:**

1. `/vitrine` carrega com header/footer atuais, título curto, filtros alinhados e cards proporcionais. Sem overflow, enorme espaço vazio artificial, imagens cortadas ou botões sobrepostos.
2. Capturas **após o primeiro paint e depois de pelo menos 3 segundos**: botões, superfícies e tokens **não mudam inesperadamente**.
3. Cenários de **0, 1, vários e muitos produtos** com dados do backend ou mocks isolados de teste (nunca dados falsos em produção).
4. Busca, categoria, marca (quando aplicável), limpar, paginação, histórico/URL, respostas lentas, erros e ausência de resultados.
5. **Clique real na imagem → `role=dialog` visível → imagem ampliada → fundo e backdrop corretos → fechar por X/Esc/backdrop → reabrir.** Repetir nos dois temas e no mobile.
6. Clique real em “Ver na loja”: URL válida, abertura separada, sem abrir popup; verificar `rel` correto para patrocinados.
7. Navegação para outras rotas e volta com Turbo (se aplicável); sem dupla montagem, mudança de tema ou CSS faltando.
8. Inspecionar console, erros de rede, foco/teclado, layout e HTML inicial; confirmar que **a homepage, header, footer e `/app` permanecem intactos**.

**Comandos a executar conforme existam no repositório:** `npm run build`, `npm run lint`, `npm test`, smoke de produtos (`scripts/public-products-smoke.mjs`), smokes públicos/Turbo, testes de segurança relevantes, `npm run budget` e `git diff --check`. Atualize testes referentes ao visual removido; **não desative verificações para obter verde**.

Se a infraestrutura de navegador estiver indisponível, declare isso explicitamente. **Não diga que validou visualmente algo que não viu.**

## 7. Critérios de conclusão

Esta tarefa só termina quando:

- A Vitrine **deixa de ser uma página vazia**, exibe dados reais autorizados, busca/filtros e cards Primer coerentes.
- **A foto amplia de verdade** em modal Primer com tema claro/escuro corretamente estilizado.
- **“Ver na loja” mantém sua aparência** desde o carregamento até depois da hidratação e funciona de modo independente.
- Tudo funciona em 320 px e desktop sem CSS improvisado, duplicação ou regressão.
- O legado exclusivo da Vitrine não utilizado é removido com segurança.
- Header, footer, home, outras rotas e **todo o `/app`** permanecem intocados.
- Há evidências reproduzíveis de navegação, screenshots e testes. Nenhum erro real é classificado como “aprovado”.

## 8. Entrega — resposta final curta

Responda apenas com:

1. **Implementado:** resumo do que o visitante consegue fazer.
2. **Arquivos alterados/removidos:** e código legado eliminado.
3. **Provas:** caminhos das capturas mobile/desktop, light/dark, e resultado do teste de ampliação real.
4. **Testes/performance:** comandos e resultados; tamanho do bundle e status do budget (inclusive pendências).
5. **Escopo:** confirmação das partes protegidas sem modificações.

**Não avance para Profissionais, Para empresas ou Como funciona após concluir a Vitrine. Aguarde as próximas instruções.**
