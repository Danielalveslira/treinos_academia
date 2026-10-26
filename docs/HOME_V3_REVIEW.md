# Home V3 — validação sem capturas versionadas

A Home mobile usa a fotografia como fundo integral do hero, com posicionamento absoluto, `inset: 0`, dimensões de 100%, `object-fit: cover` e gradiente escuro. O conteúdo usa a largura inteira e a altura mínima permite nomes longos sem corte. A composição desktop é preservada.

“Iniciar ficha” permanece a ação principal. “Ver fichas” reutiliza o mesmo Button secundário do desktop, com ícone, texto, contorno e área de toque de 48px. Apenas padding e espaçamento se adaptam à largura disponível. Os indicadores ficam separados no mobile, somente quando existem dados. A seção técnica sobre métricas/offline foi removida da interface conforme solicitado.

O problema de preenchimento vinha de `contain` herdado das fotos verticais e da altura fotográfica depender de conteúdo expansível. A fotografia não depende mais desse conteúdo. Rotação diária de São Paulo, fallback, métricas, recomendação, cache, autenticação, outbox e EvoCoins não foram alterados. O anúncio da Home foi compactado, preservando identificação, CTA e hooks de métricas.

## Validação

`node scripts/home-v2-browser-smoke.mjs` executa Chromium real e verifica 120 combinações (três perfis, quatro dias, cinco larguras e dois temas), incluindo preenchimento da foto e do gradiente, fallback, ausência de requests extras, botão secundário com ícone e contorno, áreas de toque, nomes longos e ausência de fichas/histórico. A simulação de CPU 4× lenta ocorre no CI isolado. O harness não salva prints; somente o resumo JSON em `.finance-local/home-v3-checks`, ignorado pelo Git e pelo upload de deployment.

Os 44 testes da Home e os gates completos do CI são executados sobre o commit final do PR. O excesso preexistente do budget global continua como débito separado; nenhum limite foi aumentado. Não há dependências ou imagens de runtime novas.

## Capturas

As capturas foram removidas do PR e dos diretórios locais por solicitação do usuário. Não há imagens documentais nesta entrega. O PR separado de limpeza remove também as capturas históricas da main e adiciona exclusões para impedir novo versionamento/upload. As imagens-fonte reais dos banners e os assets em public/imports são preservados.

## Limitação de dados preservada

Os indicadores descrevem atividade/dias com registros, não conclusão de sessões. Novos registros criados somente offline ainda não recebem associação automática à ficha e não compõem esses indicadores. Esta informação permanece apenas na documentação técnica.
