# Evolutus — Ajuste de marca e restauração das moedas no header mobile

## Objetivo

**Substituir a marca visual `Evolutus.com` por `Evolutus` em toda a interface** e **restaurar os indicadores de EvoCoins e EvoCash no header mobile**, com seus símbolos e saldos. O cabeçalho deve continuar compacto, sem cortar a marca nem provocar rolagem horizontal.

**Resultado esperado no mobile:**

```text
[Z] Evolutus    [Z 56] [Z 295] [🔔] [☰]
    marca        azul   verde
```

O desenho é ilustrativo: conservar o `BrandMark` SVG real, as cores atuais, os saldos dinâmicos e os ícones existentes. Não usar emojis nem valores fixos na implementação.

## Contexto do repositório

- `src/components/Layout.jsx`: marca autenticada; `<WalletHeaderBadges />`, notificações e menu já estão renderizados no header.
- `src/components/PublicLayout.jsx`: marca do header público/login também exibe `Evolutus.com`.
- `src/styles/navigation.css`: regras de layout, `.app-header .brand`, `.header-top`, `.header-actions`, `.wallet-header-badges`, `.wallet-badge`, `.wallet-badge-value`, breakpoint `< 768px` e ajustes `< 360px`.
- `src/styles/app.css`: estilos compartilhados da marca e do header público.
- `src/components/WalletHeaderBadges.jsx`: dois indicadores com `BrandMark` azul/verde, valores de `useWallet()`, estado de carregamento e link para `/entenda-suas-moedas`.
- `src/components/WalletHeaderBadges.test.js`: testes existentes para saldos, ícones, placeholders e navegação.

**Importante:** trabalhar sobre o estado **atual** do repositório. A versão anterior do prompt ocultava `.wallet-header-badges` no mobile; se essa alteração já foi aplicada, revertê-la. Não copiar cegamente trechos da versão antiga.

## Implementação

### 1. Padronizar a identidade visual como `Evolutus`

1. Em `src/components/Layout.jsx`, alterar o texto visível `Evolutus.com` para `Evolutus` e o `aria-label` para `Evolutus — início`.
2. Em `src/components/PublicLayout.jsx`, fazer a mesma troca no header público.
3. Procurar outras **ocorrências visíveis ao usuário** de `Evolutus.com` no projeto (interface, rodapé, textos institucionais, `aria-label`, `alt`, títulos/metadados e PWA, caso existam) e padronizá-las para `Evolutus`.
4. Manter inalterados `BrandMark`, favicon, paleta, tipografia e navegação, salvo ajustes dimensionais estritamente necessários.
5. **Não modificar** o domínio real `evolutus.com.br`, URLs, endpoints, links, e-mails, redirecionamentos, `hostname`, configurações de autenticação/segurança, testes que exercitam URLs, nem strings técnicas. O pedido é de **marca exibida**, não de troca de domínio. Não executar substituição global indiscriminada de `.com`.

### 2. Restaurar os dois indicadores no header mobile

1. Em `src/styles/navigation.css`, eliminar qualquer `display: none` ou regra equivalente que oculte `.wallet-header-badges` em `< 768px`.
2. Exibir **ambos** os indicadores com `BrandMark` colorido (EvoCoins azul, EvoCash verde) e saldos da carteira. Nunca esconder um indicador para abrir espaço para outro.
3. Preservar o link já existente `/entenda-suas-moedas`, inclusive navegação por teclado, foco visível e apresentação dos estados `loading` (`—`) e snapshot offline. Não adicionar novas buscas nem listeners.
4. Preservar a ordem visual: **marca | EvoCoins | EvoCash | notificações | menu**. Os dois badges continuam agrupados em seu link atual.
5. Para ganhar espaço no mobile, **ocultar apenas o ícone de interrogação** `.wallet-badges-help` (a função de ajuda permanece acessível ao tocar nos badges). No desktop, manter o `?`.

### 3. Ajustar responsividade sem truncar a marca

Trabalhar preferencialmente apenas nos estilos responsivos existentes:

- Manter `BrandMark` e texto **`Evolutus` integralmente visíveis**, com `white-space: nowrap` e sem `ellipsis`/recorte na marca mobile.
- Usar distribuição de largura previsível entre marca e `.header-actions`; reduzir `gap`, `padding` e dimensões dos badges **somente o necessário**. Revisar o `gap: 24px` herdado de `.header-top`, pois ocupa espaço excessivo no celular.
- Impedir que os indicadores ou ícones encolham de modo a desaparecer; preservar legibilidade dos números usuais (por exemplo, `56` e `295`).
- Para saldos excepcionalmente longos, permitir truncamento **somente no texto numérico**, mantendo os dois símbolos e seus badges identificáveis. O saldo integral precisa continuar acessível pelo título/descrição acessível e em `/entenda-suas-moedas`.
- Manter notificações (com contador) e botão do menu sempre visíveis e operacionais. Preservar alvo de toque de **44 × 44 px** para o menu e assegurar alvos confortáveis para os demais controles, sem sobreposição.
- Respeitar `safe-area-inset`, temas claro/escuro, modo offline e o menu fullscreen do Primer.
- Em `≥ 768px`, preservar a composição atual do header; a única alteração de branding também vale para o desktop.
- Não introduzir JS para monitorar tamanho da tela, novos breakpoints sem necessidade, dependências ou componentes duplicados.

### 4. Preservar a lógica e a navegação

- Reutilizar `WalletHeaderBadges`, `useWallet` e `WalletContext` sem alterar dados, saldo, regras de negócio ou Supabase.
- Os indicadores no header **não** substituem a central de moedas: `/entenda-suas-moedas` continua sendo a página de detalhes da carteira.
- Não mover saldos de volta para `/perfil`.
- Não alterar o menu da conta, o rodapé de navegação mobile, o sistema de notificações ou outros fluxos fora do escopo.

## Critérios de aceite

1. Nenhum texto de marca voltado ao usuário exibe `Evolutus.com`; a marca apresentada é `Evolutus` no app autenticado e nas páginas públicas.
2. Em **320, 360, 375, 390, 430 e 767 px**, aparecem simultaneamente: marca completa, **símbolo EvoCoins e saldo**, **símbolo EvoCash e saldo**, notificações e menu; sem corte da marca, colisão ou scroll horizontal.
3. Os saldos habituais (`56`, `295`) permanecem legíveis no mobile. Valores extensos não provocam overflow nem eliminam símbolos ou botões; saldos completos seguem acessíveis.
4. Em **768 e 1024 px**, estrutura e interações do header desktop permanecem inalteradas, exceto por `Evolutus.com` → `Evolutus`.
5. O clique/tap nos indicadores continua abrindo `/entenda-suas-moedas` e mostra os dados corretos; estados de carregamento, offline e saldo zero continuam corretos.
6. Menu, notificações, foco por teclado, temas claro/escuro e navegação inferior continuam funcionais.
7. Nenhum URL, domínio, e-mail, endpoint, autenticação, cookie ou redirecionamento foi alterado para remover `.com`.
8. Atualizar os testes relevantes e executar `npm run lint`, `npm test`, `npm run build` e `npm run format:check`. Reportar falhas preexistentes separadamente.

## Entrega

**Implementar diretamente**, com diff mínimo e sem redesign geral. Responder apenas com: arquivos alterados, resumo das mudanças, resultados dos testes e eventuais pendências reais.
