# Financeiro e EvoCash — PR4

## Investigação

Antes de qualquer mudança, os quatro componentes financeiros existentes foram lidos
integralmente: `AdminCashPurchases.jsx`, `EvoCashPricing.jsx`, `Refunds.jsx` e
`CommercialEngineAdmin.jsx` (2360 linhas no total).

Conclusão: a maior parte do que a Fase 4 do prompt original pede já estava implementada
antes desta sessão, em trabalho anterior não relacionado à Central comercial. Especificamente:

- **Confirmações sensíveis só no momento da operação**: as três telas já usam diálogo
  dedicado (justificativa + reautenticação + checkbox de confirmação), nunca campos soltos
  no topo da página. `EvoCashPricing.jsx` e `CommercialEngineAdmin.jsx` seguem exatamente o
  padrão que o PR3 levou para `AdvertisingAdmin.jsx`.
- **Separação preço de aquisição (reais) vs. preço de serviço (EvoCash)**: já são painéis
  fisicamente distintos (`EvoCashPricingPanel`/`EvoCashPriceHistory` vs.
  `CommercialEngineAdmin`), e o segundo já declara isso explicitamente no próprio texto
  ("Preços em EvoCash independentes do valor de aquisição em reais").
- **Reembolsos**: `Refunds.jsx` já oculta os campos técnicos de comprovação
  (`externalId`, `transactionNsu`, etc.) até a ação `confirm_provider` ser selecionada, já
  distingue claramente o prazo de arrependimento (7 dias) da duração comercial, e já deixa
  explícito que nenhum estorno externo é disparado automaticamente.
- **Histórico financeiro**: `CommercialEngineAdmin.jsx` já tinha uma aba de auditoria com
  data/ator/justificativa visíveis e o payload técnico dentro de um `<details>` colapsável —
  exatamente o que a Fase 4 pede.

Ou seja: não havia um "painel técnico demais" para simplificar aqui, como havia em
`AdvertisingAdmin.jsx` antes do PR3. O trabalho real e seguro desta fase foi de
**nomenclatura e navegação**, não de reconstrução de fluxo.

## O que mudou

- `CommercialEngineAdmin.jsx`: cabeçalho "Motor comercial" → **Preços e contratações**; aba
  "Direitos" → **Publicações contratadas**; aba "Auditoria" → **Histórico de operações**
  (nomes exatos da tabela de nomenclatura do prompt original). Nenhuma lógica, RPC ou
  validação foi tocada — só os literais de texto dos cabeçalhos/abas.
- `AdminSponsoredAds.jsx`: a seção Financeiro da Central comercial ganhou um quinto link
  ("Histórico de preços do EvoCash" → `/admin/compras-evocash?tab=prices`), que antes só era
  alcançável a partir da aba "Precificação"; e a descrição do link "Preços e contratações"
  passou a citar publicações contratadas e histórico, cobrindo as 3 abas que esse link na
  verdade abre.

## Por que não uma reconstrução maior

Mesclar `AdminCashPurchases.jsx` (`/admin/compras-evocash`) e `CommercialEngineAdmin.jsx`
(dentro de `/admin/parcerias`) numa única página de 5 abas, como a redação literal da Fase 4
sugere, exigiria fundir duas rotas `SuperAdminRoute` distintas com hooks e estados de
paginação próprios -- risco real para código financeiro já correto, sem ganho de clareza
proporcional (os dois já são curtos, 2 cliques, e cruzados por TaskLinks desde o PR1). Preservar
as duas rotas, cada uma com seu escopo, segue a mesma decisão já tomada no PR1 para as demais
rotas legadas.

## Preservado integralmente

Nenhuma RPC, migration, regra de ledger, RLS, idempotência (os pares `signature`/`requestId`
em `EvoCashPricing.jsx` e `CommercialEngineAdmin.jsx`) ou autenticação foi alterada. Nenhum
valor real, preço ou disponibilidade de compra foi modificado nesta investigação -- os preços
sintéticos vistos na homologação existem só no harness local, nunca no banco.

## Verificação

- `node_modules/.bin/eslint src/components/CommercialEngineAdmin.jsx src/pages/AdminSponsoredAds.jsx`
- `node --test src/pages/AdminSponsoredAds.test.js src/components/AdminNav.test.js src/utils/approvalsQueue.test.js`
- `npm run build`
- Homologação em navegador (harness local com dados sintéticos, mesmo padrão do PR1-3):
  seção Financeiro com os 5 links corretos, `?section=finance&tab=engine` mostrando o novo
  cabeçalho e as abas renomeadas, rota legada `?tab=engine` resolvendo para Financeiro, sem
  rolagem horizontal em 390px, dark mode correto.
