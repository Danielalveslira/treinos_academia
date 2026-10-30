# Central comercial — PR1

## Escopo

- `/admin/parcerias` abre uma central com seis áreas orientadas a tarefas.
- O menu administrativo compartilhado chama essa rota de **Central comercial**.
- A Visão geral consulta separadamente campanhas comerciais, vitrines de produtos e solicitações de reembolso. Cada falha aparece apenas no card afetado. Os registros são paginados; a interface mostra exemplos recentes, sem inventar totais.
- As rotas `/admin/compras-evocash`, `/admin/vitrines` e `/admin/promocoes` seguem disponíveis. Os links antigos `?tab=campaigns`, `?tab=metrics`, `?tab=advertisers`, `?tab=autonomous`, `?tab=commercial` e `?tab=engine`, assim como `?report=metrics`, continuam resolvendo para a área correspondente.
- O painel institucional de anúncios continua separado dos anúncios comerciais. Nenhuma RPC financeira, migration ou regra de elegibilidade foi alterada.

## Limites desta fase

- Aprovações ainda encaminha aos painéis existentes. A fila unificada e a revisão em diálogo pertencem ao PR2.
- A configuração de espaços e a separação visual entre revisão e configuração no painel atual pertencem aos PR2 e PR3.
- Os painéis financeiros e de vitrines continuam com seus fluxos existentes até os PR4 e PR5.

## Verificação

- `node --test src/pages/AdminSponsoredAds.test.js src/components/AdminNav.test.js`
- `node_modules/.bin/eslint src/pages/AdminSponsoredAds.jsx src/pages/AdminSponsoredAds.test.js src/components/CommercialOverview.jsx src/constants/adminNav.js`
- `npm run build`
