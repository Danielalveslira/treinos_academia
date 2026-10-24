// Funções puras do dashboard de métricas de patrocinados (sem React, sem rede): rótulos, fórmulas de exibição, chaves
// de cache, validação de intervalo e organização local de listas. Os números vêm prontos da RPC
// get_sponsored_ad_metrics_dashboard; aqui só se formata e se organiza, nunca se recalcula CTR a partir de somas parciais.

export const PLACEMENT_LABELS = {
  home_banner: 'Banner da Home',
  community_banner: 'Banner da comunidade',
  community_feed: 'Card no feed da comunidade',
}
export const PLACEMENTS = Object.keys(PLACEMENT_LABELS)
export const PERIOD_PRESETS = [7, 30, 90]
export const DEFAULT_DAYS = 30
export const MAX_RANGE_DAYS = 366

export const DEFAULT_FILTERS = Object.freeze({
  days: DEFAULT_DAYS,
  from: null,
  to: null,
  adId: null,
  communityId: null,
  placement: null,
})

const nf = new Intl.NumberFormat('pt-BR')
const pf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatCount(value) {
  return Number.isFinite(Number(value)) && value !== null ? nf.format(Number(value)) : '—'
}

// CTR chega como número (2 casas) ou null quando não há impressões: null vira "—", nunca "0%" inventado.
export function formatPercent(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : `${pf.format(Number(value))}%`
}

export function placementLabel(placement) {
  return PLACEMENT_LABELS[placement] || 'Posição desconhecida'
}

// 'YYYY-MM-DD' -> 'dd/mm' (sem passar por Date: sem deslocamento de fuso)
export function formatDay(isoDay) {
  const [, month, day] = String(isoDay).split('-')
  return month && day ? `${day}/${month}` : String(isoDay)
}

export function formatPeriod(period) {
  if (!period) return ''
  return `${formatDay(period.from)} a ${formatDay(period.to)}${period.from.slice(0, 4) === period.to.slice(0, 4) ? `/${period.to.slice(0, 4)}` : ''}`
}

// Argumentos da RPC. Predefinição (7/30/90) manda só p_days: o servidor decide "hoje" em America/Sao_Paulo.
export function buildRpcArgs(filters) {
  const custom = Boolean(filters.from && filters.to)
  return {
    p_days: custom ? null : filters.days || DEFAULT_DAYS,
    p_from: custom ? filters.from : null,
    p_to: custom ? filters.to : null,
    p_ad_id: filters.adId || null,
    p_community_id: filters.communityId || null,
    p_placement: filters.placement || null,
  }
}

// Mesma consulta => mesma chave => reaproveita o cache em memória.
export function cacheKey(filters) {
  return JSON.stringify(buildRpcArgs(filters))
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const dayNumber = (iso) =>
  Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000

// Validação de UX do intervalo personalizado (o servidor valida de novo). Devolve a mensagem de erro ou null.
export function validateCustomRange(from, to, today = null) {
  if (!from || !to) return 'Informe a data inicial e a final.'
  if (
    !DAY_RE.test(from) ||
    !DAY_RE.test(to) ||
    [from, to].some(
      (day) => new Date(dayNumber(day) * 86_400_000).toISOString().slice(0, 10) !== day
    )
  )
    return 'Datas inválidas.'
  if (to < from) return 'A data final deve ser igual ou posterior à inicial.'
  if (dayNumber(to) - dayNumber(from) + 1 > MAX_RANGE_DAYS)
    return `O intervalo pode ter no máximo ${MAX_RANGE_DAYS} dias.`
  if (today && to > today) return 'A data final não pode estar no futuro.'
  if (from < '2020-01-01') return 'A data inicial é anterior ao início das métricas.'
  return null
}

// Série densa para o gráfico: dias sem registro entram com null e `recorded: false` (o gráfico não os apresenta como medição).
export function fillDailySeries(daily, period) {
  if (!period) return []
  const byDay = new Map((daily || []).map((row) => [row.day, row]))
  const out = []
  const start = dayNumber(period.from)
  const end = dayNumber(period.to)
  for (let n = start; n <= end; n += 1) {
    const day = new Date(n * 86_400_000).toISOString().slice(0, 10)
    const row = byDay.get(day)
    out.push({
      day,
      impressions: row ? row.visible_impressions : null,
      clicks: row ? row.clicks : null,
      recorded: Boolean(row),
    })
  }
  return out
}

export const CAMPAIGN_SORTS = {
  impressions: {
    label: 'Impressões',
    compare: (a, b) => b.visible_impressions - a.visible_impressions,
  },
  clicks: { label: 'Cliques', compare: (a, b) => b.clicks - a.clicks },
  ctr: {
    label: 'CTR qualificado',
    compare: (a, b) => (b.ctr_qualified ?? -1) - (a.ctr_qualified ?? -1),
  },
  name: {
    label: 'Nome',
    compare: (a, b) => campaignName(a).localeCompare(campaignName(b), 'pt-BR'),
  },
}

export function campaignName(row) {
  return row.partner_name || row.title || 'Campanha sem nome'
}

// Busca e ordenação locais sobre a lista já carregada (sem nova consulta). Desempate estável por ad_id.
export function organizeCampaigns(rows, { search = '', sort = 'impressions' } = {}) {
  const term = search.trim().toLocaleLowerCase('pt-BR')
  const compare = (CAMPAIGN_SORTS[sort] || CAMPAIGN_SORTS.impressions).compare
  return (rows || [])
    .filter(
      (row) =>
        !term ||
        `${row.partner_name || ''} ${row.title || ''}`.toLocaleLowerCase('pt-BR').includes(term)
    )
    .sort((a, b) => compare(a, b) || String(a.ad_id).localeCompare(String(b.ad_id)))
}

// Estado honesto da tela a partir de um snapshot válido (carregamento e erro são tratados fora daqui).
//   collection_off: nunca houve coleta e a chave do servidor está desligada (ou o build do app não coleta)
//   empty:          há/pode haver coleta, mas nada no recorte pedido
//   ready:          há números
export function classifySnapshot(snapshot) {
  if (!snapshot) return 'empty'
  if (snapshot.has_data) return 'ready'
  const { server_enabled: enabled, has_any_data: hasAny } = snapshot.collection || {}
  return !enabled && !hasAny ? 'collection_off' : 'empty'
}

// Erro da RPC/rede -> categoria de tela. 'unavailable' = função inexistente (migration não aplicada neste ambiente).
export function classifyError(error, online = true) {
  if (!online) return 'offline'
  const code = String(error?.code ?? '')
  const message = String(error?.message ?? '')
  if (/PERMISSION_DENIED/.test(message) || code === '42501') return 'forbidden'
  if (/INVALID_RANGE|INVALID_FILTER/.test(message)) return 'invalid'
  if (
    code === 'PGRST202' ||
    code === '42883' ||
    /Could not find the function|does not exist/i.test(message) ||
    error?.status === 404
  ) {
    return 'unavailable'
  }
  return 'network'
}

export const ERROR_MESSAGES = {
  offline: 'Sem conexão. As métricas só podem ser consultadas online.',
  forbidden: 'Acesso restrito ao superadmin.',
  invalid: 'Período ou filtro inválido. Ajuste e tente de novo.',
  unavailable:
    'O relatório de métricas ainda não está disponível neste ambiente (a migration das métricas não foi aplicada).',
  network: 'Não foi possível carregar as métricas. Verifique a conexão e tente novamente.',
}
