# EVOLUTUS — Reestruturação do cadastro administrativo de produtos da Vitrine

## Objetivo

Reestruture **a interface de cadastro e gestão de produtos** em **Administração → Anúncios e parcerias → Propostas e produtos**, preservando integralmente as regras de negócio e a integração atual. A referência é a tela em que o formulário aparece com campos HTML sem estilos, labels coladas aos inputs e botões nativos de navegador.

**Execute a implementação. Não entregue apenas diagnóstico, planejamento ou sugestões.** Investigue apenas os arquivos necessários e evite alterações fora do escopo.

## Limites obrigatórios (trabalho em paralelo)

- **Escopo autorizado:** apenas a seção administrativa de **Produtos da vitrine** e componentes/estilos locais estritamente necessários.
- **Não alterar:** Vitrine pública (`/vitrine`), home, header/footer públicos, outras páginas, navegação global do `/app`, campanhas, métricas, propostas comerciais ou lógica de autenticação.
- **Não alterar contratos da API, banco de dados ou critérios de publicação** sem necessidade comprovada. O catálogo público deve continuar recebendo os mesmos dados e respeitando aprovação, patrocínio e período de exibição.
- **Há outra implementação em paralelo na Vitrine pública.** Não tocar seus arquivos nem refatorar componentes compartilhados de forma a criar conflitos. Se encontrar acoplamento, isole a UI administrativa localmente.
- **Não reverter trabalho alheio** nem executar `git reset`, limpeza global ou formatação indiscriminada.

## 1. Investigue a implementação existente

Localize a tela, o formulário e os handlers reais de criação, edição, exclusão e listagem. Identifique os componentes Primer e tokens já usados no `/app`, a origem dos estilos quebrados e as validações/autorização existentes. **Corrija a causa**, sem soluções baseadas em CSS global, `!important` em cascata, duplicação de formulários ou novas dependências desnecessárias.

## 2. Reconstrua a interface com Primer React

Use os **componentes oficiais disponíveis na versão instalada** (confirme as APIs no repositório), com os mesmos tokens, cores, tipografia, densidade e modos claro/escuro do aplicativo principal.

- Transforme o bloco de cadastro em um **formulário legível e compacto**, dentro de uma superfície Primer discreta.
- **Mobile-first:** uma coluna em telas pequenas e grade responsiva de duas colunas em telas largas quando fizer sentido; todos os campos devem ter `label` visível, espaçamento consistente e largura adequada.
- Organize os campos por significado, sem poluição visual:
  - **Produto:** nome, marca, categoria e descrição.
  - **Links e mídia:** URL da loja (HTTPS) e URL da imagem (HTTPS, opcional).
  - **Publicação:** início/fim opcionais, patrocinado e aprovado para publicação.
- Destaque **Cadastrar produto** como ação principal, com estados `loading`/desabilitado durante envio. Ações secundárias devem ser discretas.
- Prefira controles Primer reais para inputs, textarea, seleção, checkboxes, botões, status e feedback. CSS local somente para layout que o Primer não resolve com suas primitivas; sem estilos globais improvisados.
- Mostre **prévia pequena da imagem** quando a URL for válida, com proporções corretas, fallback e tratamento de falha. Não exija upload se o backend atual só aceita URL.
- Preserve os campos e suas semânticas atuais, sem inventar informações obrigatórias.

## 3. Torne a gestão dos produtos útil

Reestruture a listagem atual (hoje aparece basicamente como texto com “Editar” e “Excluir”) em **itens ou cards compactos e responsivos**, sem excesso de elementos:

- Miniatura quando disponível, nome, marca, categoria e **status derivado das regras reais** de aprovação, vigência e patrocínio.
- Ações claras de **Editar** e **Excluir**, com confirmação explícita antes da exclusão.
- Na edição, preencher dados reais, diferenciar claramente o modo de edição do cadastro, permitir cancelar e impedir duplicações acidentais.
- Feedback de sucesso/erro, estados de carregamento, vazio e falha de rede. Manter dados consistentes após cada operação.
- Não criar pesquisa, paginação, endpoints ou funcionalidades que a API não suporta só por estética. Se a listagem já possui recursos desse tipo, preserve-os.

## 4. Segurança, acessibilidade e comportamento

- Preservar autorização de administrador **no servidor**; esconder botões não substitui verificação de permissão.
- Validar dados com o contrato existente: URLs HTTPS válidas, datas coerentes e limites de tamanho; exibir erros próximos aos campos e manter validação no backend.
- Não usar `dangerouslySetInnerHTML`, HTML injetado ou interpolação insegura para descrição/links.
- Links externos devem seguir os requisitos de segurança já adotados (`noopener noreferrer` conforme aplicável).
- Controle completo via teclado, foco visível, labels associados, mensagens acessíveis, alvos de toque adequados e contraste em light/dark.
- Evitar mudanças visuais após hidratação/carregamento ou CSS faltando por code splitting.

## 5. Critérios de aceite verificáveis

Valide em **navegador real**, tema claro e escuro, ao menos 360 px, 768 px e 1440 px:

1. Nenhum campo ou label colado, cortado, sobreposto ou com aparência de HTML nativo sem estilo.
2. Nenhum scroll horizontal causado pela seção; formulário e ações cabem em mobile.
3. Cadastrar produto com dados válidos funciona pela API existente; erros inválidos são mostrados corretamente.
4. Editar e cancelar edição funcionam; excluir exige confirmação e atualiza a listagem.
5. Os estados **patrocinado**, **aprovado** e **datas opcionais** persistem sem mudanças involuntárias.
6. Listagem mantém-se estável após reload, com miniaturas e status corretos.
7. Campanhas, métricas, propostas e Vitrine pública continuam funcionando; nenhum contrato de dados foi alterado.
8. Não surgiram novos erros de console, warnings relevantes, regressões de acessibilidade ou CSS global.

Execute `npm run build`, `npm run lint` e **testes relevantes existentes**, além de smoke/E2E direcionado para cadastro, edição, exclusão e temas. Não declare testes como aprovados se não forem executados. Se dados reais forem sensíveis, use ambiente de teste/mocks controlados e não exclua produtos de produção.

## Entrega objetiva

Responda apenas com:

- **Arquivos alterados** e o que mudou em cada um (resumido).
- **Causa principal** do formulário sem estilo e como foi corrigida.
- **Testes executados e resultados reais**, incluindo evidências visuais e larguras testadas.
- **Pendências** concretas, se houver.

**Condição de conclusão:** o cadastro deve ter aparência consistente com o `/app`, edição e exclusão íntegras, layout mobile-first e integração existente preservada. Não avance para outras telas.
