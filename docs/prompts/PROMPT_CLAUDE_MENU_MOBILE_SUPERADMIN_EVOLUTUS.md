# Evolutus — Redesign do menu hambúrguer mobile (incluindo superadmin)

## Objetivo

Corrigir o menu da conta/hambúrguer no **mobile**, hoje excessivamente alto para superadmin e com as últimas opções difíceis de tocar. Criar uma navegação **compacta, intuitiva, acessível, premium e leve**, especialmente para celulares modestos. **Implemente no código e valide localmente**, mas não faça commit, push, deploy nem migração sem autorização.

## Código existente a inspecionar

Revise primeiro a versão **atual do repositório** (não presuma que esteja igual ao ZIP antigo):

- `src/components/AccountMenu.jsx`: `ActionMenu`/`ActionList`, menus condicionais de perfil e superadmin, tema e os dois tipos de logout.
- `src/styles/navigation.css`: `.account-menu-overlay`, `.account-menu-trigger`, `.mobile-nav`, breakpoints e safe areas.
- `src/components/Layout.jsx`: `AccountMenu`, `Navigation mobile`, callbacks de logout e confirmação.
- `src/styles/app.css`: regras de camadas/stacking que podem interferir com overlays.
- Testes e componentes de Primer já instalados; reutilize o design system/tokens do Evolutus.

### Problemas observados no snapshot analisado

1. O superadmin recebe **7 atalhos administrativos adicionais**, todos expandidos no meio do menu, tornando a lista longa. Há até **16 entradas acionáveis no total** quando `Minha vitrine` está presente.
2. `.account-menu-overlay` tem `max-height: calc(100dvh - 96px - env(safe-area-inset-top))`, mas não reserva explicitamente o espaço da navegação inferior (`--bottom-navigation-space`, ~76px + safe area), o que pode deixar opções sobrepostas ou desconfortáveis.
3. `.mobile-nav` é `position: fixed` com `z-index: 20`; verifique a **pilha real de sobreposição** do menu `ActionMenu.Overlay` do Primer. Não resolva às cegas com `z-index: 99999`.
4. Os itens do menu têm `min-height: 38px`, menor do que o alvo de toque recomendado para esta interface (adotar 44–48px).
5. As ações de logout ficam no fim da lista longa. A ação `Sair de todos os dispositivos` deve **continuar distinta, confirmada e protegida**, sem disparos acidentais.

## Experiência desejada

### Mobile (até 767px)

- Reorganize o menu em **seções claras**, mantendo todas as rotas/ações existentes:
  - **Minha conta:** perfil, profissionais e locais, vitrine (somente quando já exibida pela regra atual), EvoCash e promoções.
  - **Administração:** um **único item recolhível**, visível só para `isSuperAdmin`, com contador/indicação de 7 ferramentas; **recolhido por padrão**, expande sob toque e mantém todas as 7 rotas originais.
  - **Preferências e ajuda:** alternar tema, ajuda e atendimento.
  - **Sessão:** sair da conta; sair de todos os dispositivos, com distinção visual e confirmação original.
- **Escolha o padrão mais leve adequado ao projeto:** um menu/painel mobile próprio com header compacto, área central de rolagem e rodapé de sessão sempre alcançável, ou adapte corretamente o `ActionMenu` existente caso ele comporte essa estrutura com acessibilidade íntegra. Justifique a escolha brevemente e **não recrie a infraestrutura de acessibilidade do Primer sem necessidade**.
- Se usar painel/sheet, evite cobrir ações sem rota de retorno; preserve a barra de navegação inferior quando o menu estiver fechado. Enquanto aberto, o menu deve ficar **acima dela** ou reservar espaço de forma comprovadamente segura.
- Cabeçalho com título e botão **Fechar**; administração recolhível com `aria-expanded` e `aria-controls` adequados; feche ao navegar e ao tocar fora, quando aplicável.
- Dimensões adaptáveis para 320×568, 360×640 e 390×844; suporte a landscape, barra do navegador e `safe-area-inset-top/bottom`. Nenhum botão pode ficar escondido ou inacessível.
- Use `100dvh`/`100svh` com fallback apropriado e **uma única área de rolagem real**, sem scroll duplo nem movimentos bruscos. Rodapé fixo/sticky apenas se não obstruir o conteúdo ou o teclado.
- Manter tema claro/escuro e os tokens atuais. Ícones vetoriais existentes (Primer/Octicons ou Lucide já instalado); **não usar emojis nativos**.
- Ações com alvo tocável de **44px ou mais**, texto legível e foco visível; não compactar diminuindo o espaço de toque.

### Desktop (a partir de 768px)

- Preservar o comportamento visual/funcional atual, salvo pequeno ajuste estritamente necessário para corrigir bug comprovado.
- Não alterar a navegação inferior de cinco atalhos (`Navigation mobile`) nem o fluxo normal das páginas.

## Performance — obrigatório

- Preferir CSS e componentes **já instalados**. Não adicionar bibliotecas, animações pesadas, carrosséis, efeitos de blur/backdrop-filter grandes, imagens novas ou observadores/listeners redundantes.
- Renderizar a lista administrativa expandida somente quando necessário se isso simplificar e melhorar o custo; sem requisições extras, sem consultas ao Supabase para montar menu, sem cálculos/layout em cada scroll.
- Abertura/fechamento imediatos; no máximo transição discreta de `opacity`/`transform` e respeitando `prefers-reduced-motion`. Também é aceitável não animar.
- Limpar event listeners e restaurar o scroll/foco após fechar; evitar rerenders em cascata da app shell. Medir bundle/long tasks se o ambiente permitir; não inventar métricas.

## Acessibilidade e segurança funcional

- Manter **100% das rotas, autorização condicional, logout local, logout global com confirmação e lógica de single-flight**. Não mudar contratos de `useAuth`, `useLogout` e `confirmAndLogoutAll`.
- Caso o menu seja modal: foco inicial dentro, foco contido enquanto aberto, `Escape` fecha, foco retorna ao gatilho ao fechar, conteúdo por trás não interativo. Use primitive acessível do projeto quando possível.
- Links/ações não podem ficar por trás da navegação inferior, cabeçalho, notificações, avisos ou teclado virtual; investigar CSS stacking/portal real antes de aplicar solução.
- **Não expor ações administrativas a contas comuns** nem confiar apenas na ocultação visual como proteção: manter os gates/autorização que já existem.
- Manter `Minha vitrine` condicional segundo `profile?.usageProfile`, e os demais itens já existentes. Não excluir opções para o menu parecer menor.
- Na seção de sessão, preservar os textos de loading/erro/aviso offline do logout. A ação global não deve disparar o logout local antes da confirmação.

## Validação obrigatória

1. Contas **comum, profissional e superadmin**: conferir as opções condicionais; nenhum link some ou muda de rota.
2. Em **320×568, 360×640, 390×844, landscape**, iOS/Android quando possível: abrir, expandir Administração, rolar até a última opção, clicar na última e confirmar acessibilidade dos dois logouts.
3. Verificar sobreposição com `.mobile-nav`, cabeçalho, notificações/sino, safe areas, teclado virtual e PWA instalada; nenhum elemento bloqueia os botões.
4. Fechar por botão, toque fora, Escape e mudança de rota; testar foco e rolagem de fundo/menus.
5. Temas claro e escuro; `prefers-reduced-motion`; navegação pelo teclado e leitor de tela se disponível.
6. Rodar testes relevantes, `npm test`, `npm run lint`, `npm run build`; reportar números reais e regressões. Adicionar testes de render/visibilidade por perfil, expansão, navegação e logout **sem substituir verificações manuais de usabilidade**.

## Entrega esperada

Implemente a melhoria em código, com mudanças enxutas. Responda com: **diagnóstico confirmado**, descrição objetiva da solução escolhida, arquivos modificados, resultado dos testes, limitações da validação visual e antes/depois (se tiver acesso ao navegador). Não faça migration, commit, push ou deploy sem minha autorização explícita.
