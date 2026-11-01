// Normaliza anúncios, vitrines e impulsionamentos comerciais num único formato de linha
// para a fila unificada de aprovações (ApprovalsQueue.jsx). Mantido como módulo puro --
// sem React -- para poder ser testado sem montar a árvore de componentes (Dialog/Portal
// do Primer trava a saída limpa do `node --test` quando a árvore é renderizada com um
// efeito assíncrono real; ver o histórico do PR2 da Central comercial).
export const TYPE_LABELS = { ad: 'Anúncio', storefront: 'Vitrine', boost: 'Impulsionamento' }

// A revisão editorial (c.state) e a veiculação (moderation_state) são dimensões
// independentes: uma campanha aprovada editorialmente pode estar suspensa na entrega.
export const STATUS_LABELS = {
  submitted: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Reprovado',
  suspended: 'Suspenso',
  archived: 'Arquivado',
}

const STATUS_TO_FILTER = { submitted: 'pending', approved: 'approved', rejected: 'rejected' }

export function adRow(c) {
  return {
    type: 'ad',
    key: `ad:${c.ad_id}`,
    title: c.title,
    subtitle: c.partner_name,
    status: c.state,
    suspended: c.moderation_state === 'suspended',
    raw: c,
  }
}

export function storefrontRow(s) {
  return {
    type: 'storefront',
    key: `storefront:${s.id}`,
    title: s.name,
    subtitle: `${s.productCount} ${s.productCount === 1 ? 'produto' : 'produtos'}`,
    status: s.editorialState,
    suspended: false,
    raw: s,
  }
}

export function boostRow(p) {
  return {
    type: 'boost',
    key: `boost:${p.id}`,
    title: p.title || 'Conteúdo original indisponível',
    subtitle: p.target_type === 'post' ? 'Publicação' : 'Comunidade',
    status: p.moderation_state,
    suspended: false,
    raw: p,
  }
}

// Rascunhos (state/editorialState/moderation_state === 'draft') nunca aparecem: o
// proprietário ainda não enviou nada para a administração decidir.
export function buildApprovalItems({ ads = [], storefronts = [], boosts = [] }) {
  return [
    ...ads.filter((r) => r.state !== 'draft').map(adRow),
    ...storefronts.filter((r) => r.editorialState !== 'draft').map(storefrontRow),
    ...boosts.filter((r) => r.moderation_state !== 'draft').map(boostRow),
  ]
}

export function filterApprovalItems(items, { statusFilter, typeFilter }) {
  return items.filter(
    (item) =>
      (typeFilter === 'all' || item.type === typeFilter) &&
      (statusFilter === 'all' || STATUS_TO_FILTER[item.status] === statusFilter)
  )
}
