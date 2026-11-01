# Espaços de anúncio — PR3

## Escopo

- `AdvertisingAdmin.jsx` (seção **Configurações** de `/admin/parcerias`) deixa de ser um
  formulário técnico permanentemente aberto e passa a ser três blocos:
  1. **Espaços de anúncio** — um card por posicionamento (nome, descrição, limite de
     campanhas simultâneas, badges de "Aceitando contratações"/"Contratações pausadas" e
     "Exibição permitida"/"Exibição desligada"), com um botão "Configurar" que abre um
     diálogo. Justificativa e senha (reautenticação) só aparecem dentro desse diálogo, nunca
     soltas no topo da página.
  2. **Campanhas ativas** — só campanhas já aprovadas (`moderation_state` `approved` ou
     `suspended`), com card simplificado (título, anunciante, posicionamentos, status em
     português) e a ação Suspender/Retomar veiculação, também via diálogo com justificativa
     e senha.
  3. **Histórico de operações** (sem mudança de comportamento, só nomenclatura).
- Aprovar/reprovar campanhas e impulsionamentos saiu completamente deste componente: isso já
  é feito pela fila unificada do PR2 (`ApprovalsQueue.jsx`, seção Aprovações). Duplicar a
  mesma decisão em dois lugares era exatamente o problema que a reestruturação pediu para
  eliminar.
- **Aceitar novas contratações** (`sales_enabled`) e **Permitir exibição** (`delivery_enabled`)
  continuam dois controles independentes dentro do mesmo diálogo, cada um com uma legenda
  curta explicando o que controla -- nenhum dos dois foi fundido num único interruptor.
- O pacote global de posicionamentos ("Posicionamentos do pacote global") ganhou o mesmo
  tratamento: resumo em texto + diálogo de configuração, em vez de checkboxes soltos na
  página.
- Nenhuma RPC, migration, regra de elegibilidade ou o algoritmo de rodízio publicitário (PR
  #96) foi alterado. As únicas chamadas usadas já existiam:
  `admin_configure_advertising_placement`, `admin_set_advertising_network`,
  `interrupt_advertising_campaign`, `admin_resume_advertising_campaign`,
  `admin_advertising_operations`.

## Limites desta fase

- Sem "prévia dos impactos" (quantos contratos vigentes seriam afetados antes de reduzir um
  limite, por exemplo): as RPCs atuais não expõem essa contagem, e calculá-la só no frontend
  a partir de campos isolados violaria a regra de não inventar métricas financeiras. Ficaria
  para uma RPC dedicada, se necessário.
- Card de campanha "ideal" da seção 7 do prompt original (ocultar `moderation_state`,
  `delivery_state`, UUIDs) foi aplicado aqui só para campanhas ativas/suspensas -- a
  listagem completa de todas as campanhas (qualquer estado) com paginação permanece como
  estava, pois pertence à fila de Aprovações (PR2) e não a este painel.

## Verificação

- `node_modules/.bin/eslint src/components/AdvertisingAdmin.jsx`
- `node --test src/pages/AdminSponsoredAds.test.js src/components/AdminNav.test.js src/utils/approvalsQueue.test.js`
- `npm run build`
- `npm test` (suíte completa) -- sem regressões; não existe teste de render dedicado para
  `AdvertisingAdmin.jsx` antes ou depois desta mudança.
