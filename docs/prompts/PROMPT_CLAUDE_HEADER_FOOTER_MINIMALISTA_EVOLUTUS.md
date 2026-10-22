# EVOLUTUS — Ajuste final do header e footer públicos

## Objetivo

Execute **somente** a simplificação do header e footer das páginas públicas, seguindo os prints fornecidos. O resultado deve ser compacto, elegante, consistente com o Primer usado no `/app`, acessível e **mobile-first**. **Implemente** as alterações; não entregue apenas um diagnóstico.

## Escopo estrito

- **Permitido:** componentes, estilos e scripts exclusivos do header/footer públicos, e sua integração com o tema público.
- **Proibido:** alterar qualquer arquivo, rota, componente, navegação, estilo ou comportamento interno do `/app`; modificar o conteúdo das páginas, seus filtros, cards ou modais; reconstruir outras partes do site.
- Inspecione os componentes e tokens do `/app` **somente como referência**. Preserve alterações de outros trabalhos em andamento; não faça `git reset`/revert indiscriminado.

## 1. Header: remover a navegação central

- Remova **apenas do header visível** os links centrais “Como funciona”, “Para empresas”, “Vitrine” e “Profissionais”. Não apague suas rotas nem seus links do hamburger.
- Organize o header em dois grupos: **esquerda:** logo Evolutus com link para a página inicial pública; **direita:** controle de tema, “Entrar”, “Criar conta” e hamburger.
- Use componentes oficiais de `@primer/react` e tokens Primer, priorizando o mesmo padrão de ícones, tamanhos e estados do `/app`. Evite botões ou ícones improvisados em HTML/CSS.
- Em celulares estreitos, mantenha logo, tema, ação prioritária e hamburger sem cortes; distribua ou recolha as ações secundárias no menu quando necessário. Não esconda o hamburger.
- Preserve todos os links públicos no menu existente, seu foco, acionamento por teclado, `Escape`, clique fora e estados de abertura/fechamento. **Não crie um segundo hamburger.**

## 2. Alternância de tema

- Adicione junto aos botões “Entrar” e “Criar conta” um **`IconButton` Primer** de alternância claro/escuro, com ícones adequados ao estado atual (sol/lua), `aria-label` dinâmico e foco visível.
- Integre ao **mecanismo de tema público já existente**, sem criar estados concorrentes ou alterar a implementação do `/app`.
- Respeite a preferência salva; quando inexistente, use a preferência do sistema, se esse já for o comportamento da aplicação pública. Atualize imediatamente o ícone, os tokens e o estado acessível ao alternar.
- Evite flash de tema incorreto no carregamento, CSS conflitante e diferença de cor entre a renderização inicial e após hidratação/carregamento de scripts.

## 3. Footer: reduzir altura e simplificar

- Reconstrua o layout **somente do footer público** para ocupar pouca altura e ter espaçamento proporcional, sem grandes áreas vazias.
- Prefira **uma faixa horizontal compacta no desktop** com marca discreta, links essenciais (como atendimento, privacidade e termos, se existentes) e copyright. Em mobile, permita no máximo algumas linhas bem organizadas, sem colunas muito espaçadas.
- Não use logo com contraste incorreto, imagem invisível em tema escuro/claro ou estilo de link sublinhado por regras globais acidentais.
- Ajuste padding, gaps, alinhamento, largura máxima e tipografia usando Primer/tokens. CSS próprio só quando estritamente necessário ao layout, isolado por escopo; remova regras antigas **comprovadamente não utilizadas**.
- Preserve destinos de links válidos; não invente rotas. Mantenha contraste, semântica e foco acessível.

## 4. Critérios de aceite verificáveis

1. Não existem links de navegação no **centro do header**; continuam acessíveis pelo hamburger.
2. O header se mantém compacto e alinhado, sem quebras, em **320, 390, 768 e 1440 px**.
3. O botão de tema funciona nos dois sentidos, persiste como previsto, não causa flash e permanece visível/operável no mobile.
4. O footer é visualmente **mais baixo**, consistente em claro/escuro, legível e sem rolagem horizontal.
5. Não há regressão na abertura/fechamento do hamburger, no login/cadastro nem nas rotas públicas.
6. Compare capturas **reais do navegador** nas larguras acima, em claro e escuro, inclusive após alguns segundos de carregamento. Confirme que o estilo não muda inesperadamente.
7. Rode build, lint e os testes/smokes públicos relevantes. Inspecione `git diff` e confirme **zero alterações no `/app`**.

## Entrega

Faça as alterações diretamente no código. Ao finalizar, informe de forma objetiva: arquivos modificados, comportamento verificado, testes e eventuais pendências reais. **Não continue para o conteúdo das páginas públicas.**
