# Navegação pública com Turbo Drive

As sete rotas públicas continuam geradas como HTML completo em `scripts/public-pages-template.mjs`. O bundle `src/publicTurbo.js` ativa o Turbo Drive somente para links dessas rotas. Links para conta, aplicativo, documentos legais, perfis individuais e destinos externos mantêm a navegação do navegador.

O header SSR usa `data-turbo-permanent`. Após cada visita, `public/public-pages.js` atualiza `aria-current`, reinicia apenas o comportamento da página atual e encerra listeners e consultas anteriores. O diretório é carregado sob demanda; sua atualização de filtros preserva `history.state` do Turbo. Vitrine, diretório e formulário comercial não entram no cache de páginas; as páginas informativas usam o cache de navegação. O prefetch por hover fica restrito ao header e ignora vitrine, diretório e conexões lentas ou com economia de dados.

O Turbo atualiza o título e os metadados ao trocar o HTML. A transição visual dura no máximo 150 ms em navegadores compatíveis e é desativada para `prefers-reduced-motion`. Cada URL continua acessível e indexável sem JavaScript.

## Comparação local

No smoke de navegação, cada clique tradicional sem JavaScript gerou **1 requisição de documento**. As visitas Turbo entre as páginas públicas geraram **0 requisições de documento** e preservaram o mesmo `window` e o mesmo nó do header; o HTML de destino é buscado via `fetch`. O bundle Turbo gerado mede **99,88 kB sem compressão / 27,45 kB gzip** e é carregado uma vez por sessão pública. Esses números medem requisições e tamanho do bundle, não uma melhora garantida de tempo em todas as redes.

## Validação

- `npm run build`
- `npm run lint` (0 erros; avisos preexistentes)
- `node --test tests/public-pages.test.mjs`
- `node scripts/public-turbo-smoke.mjs`
- `node scripts/public-browser-smoke.mjs`

O smoke Turbo cobre mobile e desktop, troca sem recarga, header, canonical, título, Voltar/Avançar, filtros, reload, saída tradicional para login, uso sem JavaScript e fallback quando uma requisição Turbo falha.
