# Vitrine: implementação e verificação

Data: 2026-10-21. Publicado em produção no commit `5bfbb05d373a0de90d7de0aea0a1e4ff71c6d833` após a migração do banco.

## Dados e ordenação

- O modelo possui apenas `brand` em texto. As seções são apresentadas como **marcas**, agrupadas por texto com espaços normalizados e caixa ignorada. Isso não identifica empresas distintas nem funde marcas diferentes em uma entidade empresarial.
- Sem filtros: marcas em ordem alfabética pela chave normalizada; até cinco produtos por marca em ordem `created_at DESC, id DESC`; cinco marcas por página. `Ver todos` abre o filtro daquela marca.
- Com busca, categoria ou marca: até 20 produtos por página, na mesma ordem de produtos. Busca cobre nome, marca e categoria. Contagens e categorias vêm apenas de itens publicados.
- A função `public_product_catalog` é `SECURITY INVOKER`, respeita RLS e repete as condições de aprovação/vigência. O frontend usa somente a chave pública e recusa destinos que não sejam HTTPS. Não há cache de resposta ou snapshot Turbo para a Vitrine; a janela de publicação é reavaliada em cada consulta.
- A migração `20261108000002_public_product_catalog.sql` foi aplicada antes do frontend e consta no journal remoto do projeto `ywrjojrjgozdfpddkkuy`.

## Verificações

| Verificação | Resultado |
| --- | --- |
| `npm run build` | Passou |
| `npm run lint` | 0 erros; 16 avisos já existentes em outros arquivos |
| `npm test` | 2.070 testes passaram |
| `node scripts/public-turbo-smoke.mjs` | Passou |
| `node scripts/public-browser-smoke.mjs` | Passou; mock atualizado para a nova RPC |
| `node scripts/public-products-smoke.mjs` | Passou com 0, 1, 6, 36 e 205 produtos simulados; filtros, paginação, URL, modal, Turbo e larguras 320, 375, 390, 768, 1024 e 1440 px |
| `supabase/tests/public_commercial_test.sql` em PostgreSQL local limpo | 20 verificações passaram, incluindo leitura `anon` para rascunhos, itens futuros e vencidos, contagens, categorias e filtros combinados |
| Produção `https://www.evolutus.com.br/vitrine` | Deployment `dpl_6avF5rWKNbCx31L9pg1i5pW4Wqae` Ready; RPC `categories` e `groups` HTTP 200; um produto publicado, sem erros no console |
| Navegador em produção | 320, 375, 390, 768, 1024 e 1440 px: dropdown, categoria + busca, URL, resultado vazio e ausência de overflow aprovados; quatro respostas RPC 200 por largura |

As capturas de antes/depois estão em `docs/vitrine-filters/`. Os produtos das capturas locais são simulados apenas pela interceptação de rede no navegador.

## Medidas locais

| Medida | Antes | Depois |
| --- | ---: | ---: |
| JavaScript da Vitrine, bytes de fonte | 11.488 | 19.035 (`public-pages.js` + `public-products.js`) |
| JavaScript da Vitrine, gzip local | 3.613 B | 5.877 B |
| CSS específico da Vitrine, gzip local | 0 B | 1.708 B |
| Produtos transferidos na carga inicial | até 100 | até 25 em cinco prévias de marca |
| Chamadas de catálogo na carga inicial | 1 | 2 (categorias e primeira página) |

O JavaScript compartilhado diminuiu de 11.488 para 6.715 bytes de fonte. O código novo é carregado apenas na Vitrine. O CSS e a RPC adicionam requisições, enquanto o limite inicial de produtos e imagens cai de 100 para 25.

`EXPLAIN (ANALYZE, BUFFERS)` em PostgreSQL local, com 300 produtos aprovados simulados e páginas iniciais: 15,7 ms / 883 blocos em cache para grupos e 7,6 ms / 875 blocos em cache para busca + categoria. São números de laboratório, com banco aquecido, e não representam latência do Supabase remoto. Não há dados de campo para LCP, INP ou CLS, nem medição confiável em celular físico; as metas do prompt continuam sem validação em produção. Imagens externas usam sua URL original porque o esquema permite servidores arbitrários, sem transformação de miniatura confiável.
