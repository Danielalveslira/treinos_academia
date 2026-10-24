# Auditoria do sistema de temas claro/escuro

## Sintoma

Com o dark mode ativado, alguns elementos apareciam com fundo branco ao serem abertos (diálogos
específicos) — quebrando a consistência visual, embora o restante do app estivesse correto.

## Causa raiz

Primer monta `ThemeProvider`/`BaseStyles` uma vez em `main.jsx`. `BaseStyles` renderiza um
`<div data-portal-root data-color-mode="..." data-light-theme="..." data-dark-theme="...">` — é
nesses três atributos, juntos, que `@primer/primitives` (`light.css`/`dark.css`) ancora **todas**
as variáveis CSS de tema (`--bgColor-default`, `--button-*-bgColor-rest` etc.), via seletores como:

```css
[data-color-mode="dark"][data-dark-theme="dark"] { --bgColor-default: #0d1117; ... }
```

Todo overlay **nativo** do Primer (`ActionMenu`, `Dialog`, `Tooltip`, `SelectPanel`, `Overlay` —
49 arquivos no projeto) usa o `Portal` do próprio Primer, que procura exatamente esse
`[data-portal-root]` e portaleia para dentro dele — herdam o tema de graça, nunca foram o problema.

O nosso `ModalSheet` (base de `ShareProgressDialog`, `CommunityProgressShare`,
`TrainingPlanDialog` e, desde a Fase 4, a ficha do Catálogo Evolutus) usa `createPortal(...,
document.body)` por fora desse `<div>` — necessário pra escapar de overflow/stacking context de
qualquer ancestral (ver comentário em `ModalSheet.jsx`). Isso o torna **irmão**, não descendente,
do `<div data-portal-root>`; `<html>` é o único ancestral comum que sobra.

`ThemeSync.jsx` existe exatamente pra cobrir esse caso — espelhando os mesmos atributos em
`<html>` sempre que o tema muda. Só que ele copiava **apenas** `data-color-mode`, nunca
`data-light-theme`/`data-dark-theme`. Sem a dupla completa, o seletor acima nunca batia em
`<html>`, e **toda** variável de tema usada dentro de um `ModalSheet` ficava indefinida —
`background: var(--bgColor-default)` cai no valor inicial da propriedade (`transparent`), deixando
a página branca por trás aparecer. Isso afeta tanto o CSS nosso (`app.css`, que já usa
`var(--bgColor-default)` etc. diretamente) quanto os próprios componentes Primer mais recentes
(`Button` e outros migrados pra CSS Modules + custom properties, classes `prc-*`) — não só o
conteúdo "nosso" dentro do diálogo, mas botões do próprio Primer renderizados lá dentro também.

Um sintoma colateral da mesma causa: `TrainingPlanDialog.jsx` já tinha um contorno manual pra isso
(`document.getElementById('app-content')?.closest('[data-color-mode]')`, passado como
`portalContainer` do `ModalSheet`) — introduzido quando esse diálogo migrou de `Dialog` do Primer
pro `ModalSheet` (commit `c5ed401`). Funcionava só para ele; `ShareProgressDialog`,
`CommunityProgressShare` e a nova ficha do catálogo continuavam expostos. Era exatamente o tipo de
"correção isolada" que este trabalho deveria eliminar — removido agora que a causa real está
corrigida na raiz (`ThemeSync`).

## Por que não é (nem precisa ser) mais amplo

- **Estados hover/focus/active/selected/checked/disabled**: resolvem pelas mesmas variáveis CSS
  (`--control-checked-bgColor-*`, `--button-*-bgColor-hover` etc.) — corrigidos pela mesma causa,
  sem tratamento em separado.
- **Componentes legados baseados em `styled-components`** (ex.: `Flash`, `Box` com `sx`) recebem
  tema via **contexto React** do `ThemeProvider`, que atravessa fronteiras de portal normalmente
  (contexto React segue a árvore de componentes, não a árvore DOM) — nunca foram afetados.
- **`<select>` nativo** (menu de opções do SO): `ThemeSync` já setava
  `document.documentElement.style.colorScheme` corretamente antes desta correção; navegadores
  modernos usam isso pra escurecer a lista de opções nativa sozinhos. Não é um bug do app.

## Correção

- **`src/components/ThemeSync.jsx`**: agora também espelha `data-light-theme`/`data-dark-theme`
  em `<html>` (únicos tokens oficiais do `@primer/primitives`, sem cor hardcoded e sem
  `!important`). `data-color-mode` continua com a fórmula **original** (sempre resolvido --
  "light"/"dark", nunca o literal "auto") de propósito: `PublicHeaderMenu.jsx`,
  `PublicProductsIsland.jsx` e regras de `app.css` (`[data-color-mode='dark']` em
  `training-plan-dialog`, `community-access.css`) já leem esse atributo esperando um valor
  concreto, com "light" como fallback — escrever "auto" ali quebraria essas páginas em silêncio
  pra maioria de quem nunca trocou o tema manualmente (o padrão é `colorMode="auto"`).
- **`src/components/TrainingPlanDialog.jsx`**: removido o contorno manual (`themeContainer`) —
  obsoleto agora que `ThemeSync` cobre `document.body` na raiz.

## Testes de regressão

- **`src/components/ThemeSync.test.js`** (novo, 6 casos): claro/escuro explícitos batendo as 3
  pernas do seletor; "auto" com sistema claro (nunca escreve o literal `"auto"` em
  `data-color-mode`); "auto" com sistema escuro resolvendo pra `"dark"` concreto; troca de tema em
  tempo real sem remontar; `dayScheme`/`nightScheme` customizados espelhados como vieram.
- Verificação visual real (Playwright + Chromium, descartável, fora da suíte): fundo computado de
  `.modal-sheet` passou de `rgba(0,0,0,0)` (transparente -- o bug) para `rgb(13,17,23)` (token
  real `--bgColor-default` do dark mode) em três cenários -- modo escuro explícito, modo "auto"
  com SO escuro, e `TrainingPlanDialog` especificamente após remover o contorno manual.

## Resultado

- `npm test`: 2150/2150 (2144 da Fase 4 + 6 novos de `ThemeSync.test.js`).
- `npm run lint`: 0 erros (16 avisos pré-existentes, inalterados).
- `npm run build`: aprovado.
- Smokes de navegador existentes (`phase3-exercises-browser-smoke.mjs`,
  `phase4-catalog-browser-smoke.mjs`, `public-auth-header-smoke.mjs`): sem regressão.

## Arquivos

- `docs/DARK_MODE_AUDIT.md`
- `src/components/ThemeSync.jsx`
- `src/components/ThemeSync.test.js`
- `src/components/TrainingPlanDialog.jsx`
