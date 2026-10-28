# Fase 5 — auditoria e sequência anterior à implementação

Base `finance-storefront-phase4-1`, commit local `2555661`, recuperada e revalidada (350 asserções SQL e 20 testes JS). Worktree persistente `.finance-local/phase5`, branch `finance-profiles-phase5`. Planejamento mestre lido integralmente e entregas/inventários 0–4.1 consultados. Sem alteração de produção.

## Entidades e divergências reais

`professional_listings.kind` distingue `professional` e `space`; não existe outra entidade de estabelecimentos. `unique(owner_id)` permite um cadastro de um dos tipos por conta, não múltiplos locais. Será preservada. `professional_listing_drafts` e `published_professional_listings` já separam edição/publicação; serão reutilizadas como rascunho e snapshot aprovado, sem novas tabelas de perfis.

`/minha-vitrine` é o gerenciador real. `/profissionais` é atualmente HTML esqueleto, enquanto `/profissionais/:id` monta React. `/locais` não existe. A implementação dará a `/locais` uma projeção do mesmo diretório, com `kind=space`, e manterá `/minha-vitrine` para os dois tipos.

O fluxo antigo prepare/finalize publica por iniciativa do próprio dono, sem moderação comercial. A versão efetiva de `prepare_professional_listing_publish` não exige aceite jurídico para publicar: termos são ciência informativa desde a migration de acknowledgement. Preservar a política/arquivo de termos e a ciência; não inventar um novo gate jurídico.

A gravação atual do rascunho pode remover `avatar_path` do snapshot aprovado ao desmarcar o avatar global. O avatar compartilhado é entregue por Storage e cache de fotos, inadequados para mídia comercial expirada. A correção separará imagem comercial via pipeline protegido existente. Bytes/URLs pessoais antigos serão preservados privadamente; nenhum arquivo global será apagado pela migração.

## Reutilização e fronteiras

Motor financeiro inteiro da Fase 3 permanece: ofertas independentes já existem (`professional_profile`, `establishment_profile`), preços versionados, quotes/orders, ledger e entitlement único por recurso. `CommercialLeasePurchase` será compartilhado. Nenhuma RPC nova de débito.

Mídia: reutilizar `storefront_media`, bucket privado, Edge `storefront-media`, compressão, autorização antes/depois de IO e coletor da Fase 4.1. O campo histórico `storefront_id` passará a referenciar a âncora comercial, mantendo as APIs e o caminho `resource/id.webp`. FKs compostas dos rascunhos/publicações restringirão a imagem ao mesmo perfil. Extrair guard editorial e predicado relacional comum; não duplicar o versionamento entre professional e space.

Leituras a fechar: `public_list_professionals`, `public_get_professional`, `list_published_professional_listings`, RLS/grants de `published_professional_listings`, `public_professional_avatar_visible`, rotas diretas, sitemap, metadados e service worker. As tabelas privadas não precisarão de SELECT direto pelo cliente; getters autorizados permanecem.

Administração existente `/admin/vitrines` e motor `/admin/parcerias?tab=engine`. Manter listagem paginada, detalhe com rascunho e snapshot, incorporar decisão CAS/reautenticação, estado comercial, histórico e auditoria. Não criar precificação paralela.

## Legado e riscos

O baseline histórico da Fase 0 registra um perfil publicado e um listing. Não representa contagem atual de produção. Proprietário é verificável pela FK existente; migração cria apenas âncora privada, sem aprovação nova ou direito gratuito. Preservar dados e snapshot histórico. Mídia antiga ficará privada até upload protegido e nova revisão. Publicação anterior sem direito não poderá contornar o novo predicado.

## Sequência

1. Migration aditiva de vínculo concreto, guard/predicado editorial compartilhado, moderação CAS e reutilização da mídia/coletor.
2. Projeções públicas/Storage/SEO, fechamento de endpoints antigos e preservação dos termos.
3. Gerenciamento e moderação nas rotas existentes; diretórios público/locais e detalhes.
4. Fixtures, testes SQL/RLS/concorrência, browser dos dois tipos, SEO HTTP, planos comparáveis e regressões 1–4.1; build/lint/budget/scanners.

Preços/vendas oficiais continuam ausentes/desabilitados na migration. Somente o launcher de homologação pode semear tarifas e saldos sintéticos. Nenhuma alteração da InfinitePay, publicidade, novas carteiras, venda de fichas, comissão ou renovação automática integra esta fase.
