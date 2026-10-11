# Evolutus — Correção urgente da rolagem do menu hambúrguer mobile

## Problema reproduzido em celular real

Após o redesign de `AccountMenu.jsx`, o menu abre em fullscreen, mas **não é possível rolar seu conteúdo com o dedo**. Na captura fornecida, ao expandir **Administração**, a lista ultrapassa o limite inferior do viewport e fica cortada na seção **Preferências e ajuda**; as ações finais não podem ser alcançadas. A página por trás também está bloqueada, conforme esperado para um menu modal, mas o próprio menu não rola.

**Objetivo:** quando o menu estiver aberto, **somente o interior do hambúrguer deve receber a rolagem**; a página por trás deve permanecer imóvel e sem interação. Ao fechar, restaurar a interação e a posição de rolagem da página.

## Audite a versão ATUAL do código antes de modificar

Verifique `src/components/AccountMenu.jsx`, `src/styles/navigation.css`, `src/components/Layout.jsx` e os estilos efetivos do `ActionMenu.Overlay` do Primer instalado. Não presuma que o ZIP antigo seja o código atual. Investigue especialmente:

- `variant={{ regular: 'anchored', narrow: 'fullscreen' }}` e o DOM efetivo do Portal/Overlay.
- `body:has(.account-menu-overlay[data-responsive='fullscreen']) { overflow: hidden; }` e outros bloqueios globais de scroll ou listeners de `touchmove`.
- `.account-menu-overlay`, `.account-menu-content`, `.account-menu-scroll`, `.account-menu-session` e todas as regras concorrentes (`overflow`, `height`, `max-height`, `min-height`, `display`, `flex`, `position`, `touch-action`, paddings e safe areas).
- Se o elemento que deveria rolar tem altura **realmente limitada** e `scrollHeight > clientHeight`. Confirme que o `scrollTop` dele muda ao executar scroll de toque/gesto no navegador.
- Se o layout do Primer adiciona wrappers, margens ou estilos que impedem `flex:1; min-height:0` de funcionar como esperado.

**Não conclua a causa apenas pelo CSS escrito.** Inspecione o elemento real que recebe o gesto e, se houver navegador, os estilos computados e suas dimensões.

## Comportamento obrigatório após a correção

1. **Menu aberto:** conteúdo do hambúrguer desliza verticalmente com o dedo, inclusive com Administração expandida. É possível chegar a **todos** os itens, incluindo Ajuda e os dois logouts.
2. **Fundo travado:** a página atrás do menu não rola nem recebe cliques/toques; não permitir scroll chaining para o `body` quando chegar ao topo/fim da lista.
3. **Menu fechado:** a página volta a rolar imediatamente na posição anterior, sem travas residuais nem overlay invisível interceptando toques.
4. **Layout:** cabeçalho e botão X permanecem operáveis; área central é rolável; a seção Sessão fica acessível e não encobre a lista. Em viewport muito baixo/paisagem, priorize acessibilidade de **todas** as ações, usando fallback responsivo se o rodapé fixo não couber.
5. **Mobile:** funcionar no navegador e PWA, incluindo Android e iOS quando possível, com safe areas, barra de URL dinâmica, telas 320×568, 360×640, 390×844 e modo paisagem.
6. **Desktop:** manter o ActionMenu ancorado exatamente como está; não alterar as cinco opções da navegação inferior.
7. **Acessibilidade:** foco/Escape/retorno de foco do Primer, controles ≥44px e o diálogo de confirmação de “Sair de todos os dispositivos” devem continuar funcionando. Administração continua recolhida ao reabrir.

## Direção técnica (não aplicar sem confirmar a causa)

- Preferir **um único contêiner rolável** dentro do fullscreen com `overflow-y: auto`, `overscroll-behavior: contain`, `min-height: 0` em **todos os flex items necessários**, altura limitada pelo viewport real (`100dvh` com fallback) e `-webkit-overflow-scrolling: touch` quando pertinente. Garantir que o elemento rolável consiga receber gestos (`touch-action: pan-y`, se adequado).
- Evitar `overflow: visible !important` no overlay caso ele permita que os filhos transbordem sem criar uma área rolável efetiva. Revisar regras herdadas do dropdown desktop que possam conflitar com fullscreen.
- **Não** resolver desbloqueando a rolagem do `body`: ele deve continuar bloqueado enquanto o painel estiver aberto. Também não aplicar `preventDefault()` global em `touchmove` nem forçar scrolling via JavaScript se o CSS nativo resolver.
- Preservar o ajuste de empilhamento contra `.mobile-nav`/`.app-header`, sem regressão de z-index, e a confirmação de logout global. Não criar outro menu nem adicionar bibliotecas.
- Evitar qualquer listener ou processamento contínuo durante o scroll: solução simples, nativa e leve para celulares fracos.

## Validação obrigatória

- Em navegador real, abrir menu superadmin, expandir Administração e **arrastar para cima com o dedo/gesto** até mostrar e acionar o último item; arrastar de volta para o topo. Verificar também rolagem pelo mouse/trackpad e teclado quando aplicável.
- Medir/logar, em desenvolvimento, `clientHeight`, `scrollHeight` e a mudança em `scrollTop` do contêiner correto para confirmar que ele rola; remover logs temporários depois.
- Com menu aberto, tentar rolar a página por trás: deve permanecer imóvel. Fechar o menu: rolagem normal restaurada. Repetir abrir/fechar algumas vezes.
- Verificar os dois logouts e o diálogo de confirmação, incluindo cancelar, sem quebra de foco ou camada escondida.
- Testar temas claro/escuro, contas comum e superadmin, dispositivos pequenos e paisagem.
- Rodar `npm test`, `npm run lint` e `npm run build`. Acrescentar teste de integração/browser para overlay aberto e scroll, se disponível; **testes de funções puras não substituem o teste no DOM real**. Se o ambiente não dispõe de navegador, documentar essa limitação explicitamente e não afirmar que o bug foi resolvido visualmente.

## Entrega

**Corrija o bug no código agora**, sem redesenhar o menu inteiro. Informe causa raiz observada, arquivos alterados, como garantiu o scroll interno e o bloqueio do fundo, evidências dos testes e limitações. **Não faça commit, push, deploy nem migration sem autorização.**
