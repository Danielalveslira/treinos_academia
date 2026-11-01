# Central de Aprovações — PR2

## Escopo

- A seção **Aprovações** de `/admin/parcerias` (`?section=approvals`) agora mostra uma fila
  unificada real (`ApprovalsQueue.jsx`), não apenas links para os painéis existentes.
- Três categorias com o mesmo ciclo de vida editorial (`submitted → approved/rejected`,
  reautenticação + justificativa de 5-500 caracteres exigidas pelo backend) aparecem juntas:
  anúncios comerciais, vitrines de produtos e impulsionamentos (promoções de posts/comunidades).
  Rascunhos (`state`/`editorialState`/`moderation_state === 'draft'`) nunca aparecem — o
  proprietário ainda não enviou nada para decisão.
- Filtros por status (Pendentes/Aprovadas/Reprovadas/Todas) e por tipo. Cada item mostra uma
  prévia (texto, imagem, destino/contato) e, se pendente, abre um diálogo com justificativa,
  senha (reautenticação) e as ações Aprovar/Reprovar — os únicos campos sensíveis ficam dentro
  do diálogo, nunca permanentemente visíveis na página.
- Itens já decididos abrem o mesmo diálogo em modo somente leitura (sem campos de decisão):
  suspender, retomar ou revogar continuam nos painéis completos de cada categoria.
- `CommercialOverview.jsx`: os cards "Anúncios aguardando análise" e "Vitrines aguardando
  análise" agora levam direto à fila de aprovações, em vez da configuração ou do fluxo antigo.
- Nenhuma RPC, migration ou regra de elegibilidade foi alterada. Todas as ações usam as RPCs já
  existentes (`admin_review_advertising_campaign`, `set_storefront_editorial`,
  `admin_review_commercial_promotion`) com a mesma reautenticação (`reauthenticatePricingAdmin`)
  já usada em `AdvertisingAdmin.jsx`/`AdminStorefrontView.jsx`.

## Por que só estas três categorias

- Ads, vitrines de produtos e impulsionamentos compartilham o mesmo vocabulário de estado
  (`commercial_resources.moderation_state`) e podem ser decididos diretamente a partir da
  própria linha da listagem (sem uma segunda consulta).
- **Profissionais e estabelecimentos** (`/admin/vitrines`) usa um fluxo de duas etapas
  (listar → buscar revisão individual antes de decidir) e permanece como link avulso em
  "Outras moderações", dentro da seção Aprovações.
- **Promoções (EvoCash)** (`/admin/promocoes`, nome parecido mas domínio diferente) é um painel
  de monitoramento/cancelamento, sem estado `submitted`/aprovação — não é uma fila de aprovação
  e continua fora desta tela, acessível pelo menu administrativo.

## Limites desta fase

- `AdvertisingAdmin.jsx` (seção Configurações) ainda mistura configuração de espaços com a
  revisão de campanhas/impulsionamentos antiga — a extração completa (separar config de
  aprovação) fica para o PR3, junto da reformulação dos "Espaços de anúncio".
- Suspender/retomar/revogar não estão na fila unificada; continuam nos painéis completos.

## Verificação

- `node --test src/utils/approvalsQueue.test.js` — lógica pura de normalização e filtro
  (anúncio aprovado mas suspenso, rascunhos excluídos, filtros por status/tipo).
- `node --test src/pages/AdminSponsoredAds.test.js src/components/AdminNav.test.js`
- `node_modules/.bin/eslint src/components/ApprovalsQueue.jsx src/utils/approvalsQueue.js src/utils/approvalsQueue.test.js src/pages/AdminSponsoredAds.jsx src/components/CommercialOverview.jsx`
- `npm run build`
- `npm test` (suíte completa, 2333 testes) — sem regressões.

### Por que não há teste de render para `ApprovalsQueue.jsx`

Montar a árvore completa (Primer `Dialog` + um efeito assíncrono real de `useEffect`) com
`react-test-renderer` sob `node --test` impede a saída limpa do processo: o pacote `scheduler`
cria um `MessageChannel` que mantém o event loop vivo indefinidamente assim que um `act()`
assíncrono agenda um callback de baixa prioridade. Isso não é específico deste componente —
nenhum outro componente com `Dialog` neste projeto (`AdminStorefrontView.jsx`, por exemplo) tem
teste de render pelo mesmo motivo. A lógica de negócio (normalização por tipo, status
"aprovado mas suspenso", exclusão de rascunhos, filtros) foi extraída para
`src/utils/approvalsQueue.js`, um módulo puro sem React, e testada ali sem montar nada.
