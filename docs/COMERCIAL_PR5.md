# Vitrines, Parceiros e Produtos Legados — PR5

## Investigação

Três arquivos liam juntos a mesma área: `AdminStorefrontView.jsx` (577 linhas, moderação de
vitrines de produtos), `CommercialAdmin.jsx` (269 linhas, misturava propostas comerciais,
vitrines de produtos e produtos legados numa única página rolante) e
`AdminProfessionalListings.jsx` (319 linhas, profissionais/estabelecimentos).

`AdminProfessionalListings.jsx` já estava adequado: decisão (aprovar/reprovar/suspender/
arquivar) só dentro de um diálogo com justificativa e reautenticação, nenhum campo sensível
solto na página, uma única ação principal ("Moderar cadastro") no painel de detalhe. Esse
domínio continua fora da fila de Aprovações do PR2 por decisão já documentada lá: a decisão
exige buscar a revisão individual (`adminGetProfessionalListing`) antes de agir, diferente dos
outros três tipos que decidem direto da própria linha da lista. **Não foi alterado.**

Os outros dois tinham problemas reais e comprovados:

## O que mudou

### `CommercialAdmin.jsx` — separar os três domínios

Antes: propostas comerciais (`commercial_leads`), vitrines de produtos modernas
(`StorefrontManager`/`AdminStorefrontView`) e produtos legados (`partner_products` +
formulário sempre visível) apareciam concatenados verticalmente na mesma página, sem nenhuma
navegação entre eles -- exatamente o que a Fase 5 do prompt original pede para evitar.

Agora: três abas (`UnderlineNav`, mesmo padrão já usado em `AdminCashPurchases.jsx`),
dirigidas por `?sub=leads|storefronts|legacy` preservando `tab=commercial` para a seção
"Vitrines e parceiros" continuar resolvendo certo. Cada categoria carrega seus dados só quando
é aberta (antes, propostas e produtos legados eram buscados juntos na montagem, mesmo que o
admin só quisesse ver vitrines). As três entradas de `TaskLinks` da seção "Vitrines e
parceiros" agora apontam direto para a aba certa.

### `AdminStorefrontView.jsx` — reduzir botões e remover decisão duplicada

Antes: o painel de uma vitrine selecionada mostrava sete botões sempre visíveis (Prévia
privada, Editar vitrine, Adicionar produto, Enviar para aprovação, Arquivar vitrine, Histórico
de contratações, Moderar vitrine) mais um link condicional. "Moderar vitrine" abria um diálogo
com um `<Select>` de decisão com quatro opções: `approved`/`rejected`/`suspended`/`draft` --
ou seja, a mesma decisão de aprovar/reprovar que a fila unificada do PR2 já cobre, duplicada
aqui.

Agora: só duas ações ficam na linha principal (Editar vitrine; Ver vitrine pública quando
aplicável). As demais (Prévia privada, Adicionar produto, Enviar para aprovação quando
aplicável, Histórico de contratações, Suspender/Retomar vitrine, Arquivar vitrine quando
aplicável) foram agrupadas no `RowActionsMenu` já usado em outras seis telas do projeto
(`AdminSponsoredAds.jsx`, `AdminCommunities.jsx`, `Communities.jsx`, `History.jsx`,
`Exercises.jsx`, `AdvertiserAccountPanel.jsx`) -- componente reutilizado, não recriado.
`approved`/`rejected` saíram das opções do diálogo (essa decisão é exclusiva da Central de
Aprovações agora); sobrou só Suspender/Retomar, o mesmo par de ações que `AdvertisingAdmin.jsx`
já usa para campanhas desde o PR3 -- mesmo padrão, mesmo nível de fricção (justificativa +
reautenticação), sem `<Select>` porque a transição-alvo já está implícita no botão clicado.

De passagem: um texto da própria tela ainda citava a aba "Motor comercial", renomeada para
"Preços e contratações" no PR4 -- achado durante a homologação em navegador, corrigido junto.

## Por que não mais do que isso

`PartnerProductForm`/`PartnerProductList`/`StorefrontMaintenance`/`StorefrontManager` não
foram tocados por dentro -- cada um já resolve bem o próprio domínio; o problema era a falta de
separação entre eles, não a lógica interna de nenhum. Nenhuma migration, RPC, regra de ledger,
RLS ou contrato comercial foi alterada. Produtos legados continuam exatamente como estavam,
inclusive o formulário de cadastro/edição sempre visível naquela aba -- preservar
compatibilidade é o objetivo dessa categoria, não redesenhá-la.

## Verificação

- `node_modules/.bin/eslint src/components/CommercialAdmin.jsx src/components/CommercialAdmin.test.js src/components/storefront/AdminStorefrontView.jsx src/pages/AdminSponsoredAds.jsx`
- `node --test src/pages/AdminSponsoredAds.test.js src/components/AdminNav.test.js src/utils/approvalsQueue.test.js src/components/CommercialAdmin.test.js` (o teste existente de `CommercialAdmin.jsx` precisou ganhar um `MemoryRouter` no harness, já que o componente passou a usar `useSearchParams`; os 7 testes continuam cobrindo os mesmos dois defeitos históricos de produtos legados, sem mudança de comportamento)
- `npm run build`
- Homologação em navegador (harness local com dados sintéticos): as 3 abas isolando
  propostas/vitrines/legados corretamente, vitrine aprovada/suspensa/rascunho cada uma
  oferecendo só as ações válidas no menu, diálogo de suspender/retomar com texto e campos
  corretos, rota legada `?tab=commercial` (sem `sub`) resolvendo para a seção certa, sem
  rolagem horizontal em 390px, dark mode correto.
