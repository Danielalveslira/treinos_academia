# Fase 4 — inventário anterior à implementação

Base aprovada `finance-commercial-phase3`, commit local `cd0fb0e`; branch isolada `finance-storefront-phase4`. Planejamento mestre integral e relatórios 0–3 consultados. Sem acesso/modificação em produção.

`/vitrine` é HTML público com ilha React (`PublicProductsIsland`), filtros, agrupamento por marca e modal Primer. Consulta `public_product_catalog` diretamente com chave anon e `cache:no-store`; o cabeçalho utiliza o cliente Auth único. `/minha-vitrine` é de profissionais/estabelecimentos e não será transformada nesta fase.

`CommercialAdmin` administra leads e faz CRUD direto de `partner_products`; `PartnerProductForm/List` e seus testes têm consumidores ativos. Produtos existentes não têm dono nem agrupamento, recebem URLs externas, aprovação e janela manual. Sua RLS e RPC pública não conhecem o motor financeiro. O trigger atual exige imagem até em novos rascunhos, o que deverá ser ajustado apenas para produtos vinculados a vitrines.

Reutilizar as cinco tabelas públicas e `private.commercial_resources` da Fase 3, sem alterar cálculo financeiro, carteira, ledger ou InfinitePay. A vitrine concreta terá FK composta com a âncora, proprietário sincronizado e oferta fixa. Revisão/aprovação ficarão na âncora; vencimento exclusivamente no entitlement. Toda edição material interrompe a publicação até nova aprovação, sem reiniciar prazo; suspensão administrativa não é removida por edição/pagamento.

Novas mídias: bucket privado; upload Edge validando bytes WebP com helper existente, caminhos alocados pelo banco e sem overwrite; entrega Edge autorizada a cada requisição e no-store, sem URLs assinadas permanentes. Proprietário mantém acesso privado após expiração. Conteúdo já recebido/copiado por terceiros não é revogável. Produtos legados sem vínculo ficam acessíveis somente ao superadmin, preservados até decisão explícita de migração; sem inventar dono ou gratuidade perpétua.

Limites de produtos/vitrines configuráveis, inicialmente não definidos: cadastros bloqueados até configuração administrativa auditada, sem tratar números de teste como política comercial. Preview terá configuração e preço estritamente sintéticos.

Sequência: migration aditiva e RPCs/RLS → mídia → gerenciamento/moderação e catálogo público → fixtures SQL/HTTP/browser/concorrência/performance → gates e entrega. Readiness da oferta só após filtros e vínculos instalados; vendas permanecem pausadas e sem preços oficiais.
