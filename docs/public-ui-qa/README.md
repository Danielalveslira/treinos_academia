# Revisão das rotas públicas

## Escopo e isolamento

- As sete páginas HTML públicas mantêm conteúdo e metadados no HTML inicial. A Vitrine usa uma ilha React carregada somente ao abrir a imagem de um produto.
- O tema e a folha de estilos novos vivem em `public/boot-public-theme.js` e `public/public-foundation.css`, carregados somente pelo HTML público.
- Após a correção de escopo, `git diff --exit-code HEAD` retornou zero para `index.html`, `public/boot-theme.js`, `src/App.jsx`, `src/main.jsx`, `src/components/Layout.jsx`, `src/components/PublicLayout.jsx`, `src/components/ThemeSync.jsx`, `src/components/exerciseVisuals/ExerciseVisualPreview.jsx`, `src/styles/app.css` e `src/styles/navigation.css`. O item “Início” de `Layout.jsx` já consta no `HEAD` e foi preservado.
- A entrada do modal da Vitrine foi excluída do precache do service worker; as entradas preexistentes continuam listadas.

## Evidência e testes

- Capturas reais, em tema claro: início 390 px (captura removida), início 1366 px (captura removida), empresas 390 px (captura removida), Vitrine 390 px (captura removida), profissionais 390 px (captura removida).
- `npm run build`: passou. `npm run lint`: zero erros, 17 avisos. `npm test`: 2070/2070 passaram em execução autorizada fora do sandbox; a tentativa dentro do sandbox teve `EPERM` ao criar subprocesso. Testes direcionados de menu, visuais de exercícios e detalhe profissional: 47/47.
- `node --test tests/public-pages.test.mjs`: 11/11. `node scripts/security-headers.test.mjs`: 2/2. Smokes de Vitrine, profissionais, Turbo, banners, navegador geral e redesenho: passaram. O smoke de redesenho cobre 7 rotas, 6 larguras, temas claro/escuro e movimento reduzido.
- `git diff --check`: passou.

## Tamanho e limites

| Recurso público | Antes, gzip | Depois, gzip |
| --- | ---: | ---: |
| CSS público principal, redesenho, tema e Vitrine | 13.538 B | 13.098 B |
| JavaScript da Vitrine | 4.842 B | 4.046 B |
| HTML da Vitrine | 3.349 B | 3.087 B |

O novo entrypoint do modal tem 1.041 B de JavaScript e 644 B de CSS gzip, além de dependências Primer carregadas na primeira abertura. `npm run budget` continua falhando: o baseline versionado aceita 6 arquivos e 320.749 B de JavaScript gzip no boot, enquanto o build atual registra 8 arquivos e 348.504 B. A entrada nova do modal não consta no boot; o baseline parece anterior às entradas públicas já presentes no `HEAD`. Não foi alterado sem uma medição de referência equivalente.

Não foram medidos CLS, LCP, INP ou tráfego real de produção. As capturas listadas não incluem tema escuro; esse tema foi coberto pelo smoke do navegador.
