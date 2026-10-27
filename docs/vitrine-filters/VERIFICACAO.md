# Correção dos filtros da Vitrine — 2026-10-21

## Causa e solução

O filtro anterior misturava o `Select` renderizado pelo Primer (com wrapper e ícone próprios) com regras globais de `select` e uma grade de duas colunas no celular. Isso deixava a categoria estreita, cortava o texto e criava alturas e indicadores visuais inconsistentes. A barra agora usa controles públicos simples de 44 px, com largura máxima de 900 px no desktop e campos empilhados até 640 px.

O seletor nativo permanece como fallback sem JavaScript. Com JavaScript, um botão e uma lista curta substituem somente a apresentação. A lista mostra o item selecionado, aceita setas, Home, End, Enter, espaço e Escape, fecha com clique externo ou Tab, mantém foco visível e abre acima do controle se faltar espaço abaixo. Não há React hidratado nem dependência nova. Seleção, busca, URL, paginação e Turbo continuam usando a lógica já existente.

## API conectada

No preview local com a configuração pública conectada, as chamadas `categories` e `groups` retornaram **HTTP 404 / PGRST202**. O PostgREST informou que não encontrou `public.public_product_catalog` no cache de schema, tanto para `p_mode` quanto para a assinatura completa `p_brand, p_category, p_limit, p_mode, p_offset, p_search`. A assinatura do frontend corresponde à função na migração local `20261108000002_public_product_catalog.sql`, que passou nos testes SQL locais. A causa observada é a ausência da função no banco conectado; nenhuma migração remota foi aplicada.

O frontend mostra **“A vitrine está temporariamente indisponível”** e a ação de tentar novamente. O erro não vira lista vazia. A implantação do catálogo continua dependente da migração autorizada pelo responsável pelo banco.

## Evidência visual e funcional

Capturas reais de Chromium, com respostas de catálogo simuladas somente na rede do navegador:

- Antes, 390 px (captura removida) e antes, 1440 px (captura removida).
- Depois, 390 px, menu aberto (captura removida), seleção e resultado vazio (captura removida) e tema claro (captura removida).
- Depois, 1440 px, menu aberto (captura removida). Há capturas de menu fechado, aberto e selecionado para 320, 375, 390, 768, 1024 e 1440 px em `after/`.

`node scripts/public-products-smoke.mjs` passou com 0, 1, 6, 36 e 205 produtos simulados, seis larguras, altura uniforme, ausência de overflow, menu dentro da viewport, seleção por teclado e toque, fechamento por Escape, Tab e clique externo, busca combinada com categoria, URL, carregamento lento, erro PGRST202, modal e retorno por Turbo. `node scripts/public-browser-smoke.mjs` e `node scripts/public-turbo-smoke.mjs` passaram. `npm run build` passou; `npm run lint` terminou com 0 erros e 16 avisos preexistentes em outros arquivos. `git diff --check` passou.
