import { buildRpcArgs } from '../utils/metrics.js'
import { advertiserRpc } from './advertisers.api.js'

export async function fetchAdMetricsDashboard(filters) {
  return advertiserRpc(filters.accountId ? 'get_advertiser_metrics' : 'get_admin_ad_metrics_v2', {
    ...buildRpcArgs(filters),
    ...(filters.accountId ? { p_account_id: filters.accountId } : {}),
    p_campaign_offset: filters.campaignOffset || 0,
    p_context_offset: filters.contextOffset || 0,
  })
}

export async function fetchCompleteReport(filters, fetcher = fetchAdMetricsDashboard) {
  const first = await fetcher({ ...filters, campaignOffset: 0, contextOffset: 0 })
  const result = {
    ...first,
    by_campaign: [...first.by_campaign],
    by_context: [...first.by_context],
  }
  let page = first
  for (let offset = 100; page.campaigns_truncated || page.contexts_truncated; offset += 100) {
    if (offset > 100000) throw new Error('Limite de exportação atingido; refine os filtros.')
    page = await fetcher({
      ...filters,
      from: first.period.from,
      to: first.period.to,
      campaignOffset: offset,
      contextOffset: offset,
    })
    // Concurrent collection can change totals between pages: do not emit an inconsistent report.
    if (
      JSON.stringify(page.summary) !== JSON.stringify(first.summary) ||
      JSON.stringify(page.daily) !== JSON.stringify(first.daily) ||
      JSON.stringify(page.by_placement) !== JSON.stringify(first.by_placement) ||
      page.campaigns_total !== first.campaigns_total ||
      page.contexts_total !== first.contexts_total
    )
      throw new Error('Os dados mudaram durante a exportação. Atualize e tente novamente.')
    result.by_campaign.push(...page.by_campaign)
    result.by_context.push(...page.by_context)
  }
  if (
    (Number.isInteger(first.campaigns_total) &&
      result.by_campaign.length !== first.campaigns_total) ||
    (Number.isInteger(first.contexts_total) && result.by_context.length !== first.contexts_total)
  )
    throw new Error('Os dados mudaram durante a exportação. Atualize e tente novamente.')
  return result
}

export function reportMatchesSnapshot(full, snapshot) {
  for (const field of ['period', 'filters', 'summary', 'daily', 'by_placement'])
    if (JSON.stringify(full[field]) !== JSON.stringify(snapshot[field])) return false
  for (const field of ['by_campaign', 'by_context']) {
    const key = (row) =>
      field === 'by_campaign' ? row.ad_id : `${row.placement}|${row.context_id}`
    const rows = new Map(full[field].map((row) => [key(row), row]))
    for (const row of snapshot[field])
      if (JSON.stringify(rows.get(key(row))) !== JSON.stringify(row)) return false
  }
  return true
}
