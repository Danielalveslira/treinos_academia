import test from 'node:test'
import assert from 'node:assert/strict'
import { reportCsv, reportPdf, csvCell, reportUrl } from './reports.js'
import { fetchCompleteReport, reportMatchesSnapshot } from '../api/adMetrics.api.js'
const metrics = {
  visible_impressions: 10,
  unique_viewers: 5,
  clicks: 20,
  qualified_clicks: 18,
  unqualified_clicks: 2,
  ctr_qualified: 180,
  ctr_raw: 200,
}
function snapshot(overrides = {}) {
  return {
    account: { name: 'Empresa A' },
    generated_at: '2026-10-24T10:00:00Z',
    period: { from: '2026-10-01', to: '2026-10-24', timezone: 'America/Sao_Paulo' },
    filters: { ad_id: 'A', placement: 'home_banner' },
    summary: metrics,
    daily: [{ day: '2026-10-24', ...metrics }],
    by_campaign: [{ ad_id: 'A', title: '=HYPERLINK("evil")', ...metrics }],
    by_context: [],
    by_placement: [{ placement: 'home_banner', ...metrics }],
    ...overrides,
  }
}
test('CSV neutraliza fórmulas, controles e aspas; null não vira zero', () => {
  for (const value of ['=1+1', '+cmd', '-2', '@SUM(A1)', '\t=cmd', '\r@cmd', '\u0001=cmd'])
    assert.match(csvCell(value), /^"'/)
  assert.equal(csvCell(null), '""')
  assert.equal(csvCell(0), '"0"')
  assert.equal(csvCell('a"b'), '"a""b"')
  const csv = reportCsv(snapshot())
  assert.match(csv, /Empresa A/)
  assert.match(csv, /qualified_clicks/)
  assert.match(csv, /180/)
  assert.match(csv, /America\/Sao_Paulo/)
  assert.match(csv, /A =HYPERLINK/)
  assert.match(reportCsv(snapshot({ account: { name: '=HYPERLINK("evil")' } })), /"'=HYPERLINK/)
  assert.doesNotMatch(csv, /Empresa B/)
})
test('PDF real paginado tem offsets xref corretos e os mesmos KPIs autorizados', () => {
  const pdf = reportPdf(
    snapshot({ daily: Array.from({ length: 100 }, (_, i) => ({ day: `dia ${i}`, ...metrics })) })
  )
  assert.ok(pdf.startsWith('%PDF-1.4'))
  const text = pdf.replace(/\\([\\()])/g, '$1')
  assert.match(text, /visible_impressions\): 10/)
  assert.match(text, /ctr_qualified\): 180/)
  assert.match(pdf, /Empresa A/)
  assert.doesNotMatch(pdf, /Empresa B/)
  assert.match(pdf, /\/Count [3-9]/)
  const offset = Number(pdf.match(/startxref\n(\d+)/)[1])
  assert.equal(pdf.slice(offset, offset + 4), 'xref')
  for (const match of pdf.matchAll(/(\d{10}) 00000 n/g))
    assert.match(pdf.slice(Number(match[1])), /^\d+ 0 obj/)
  for (const match of pdf.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g))
    assert.equal(Number(match[1]), match[2].length)
})
test('compartilhamento inclui escopo e filtros em URL autenticada sem tokens', () => {
  const u = new URL(
    reportUrl(
      {
        accountId: 'A',
        adId: 'C',
        from: '2026-10-01',
        to: '2026-10-24',
        placement: 'home_banner',
        token: 'never',
      },
      'https://example.invalid'
    )
  )
  assert.equal(u.pathname, '/meus-anuncios')
  assert.equal(u.searchParams.get('accountId'), 'A')
  assert.equal(u.searchParams.get('adId'), 'C')
  assert.ok(!u.searchParams.has('token'))
})
test('exportação busca todas as páginas mantendo o escopo e janela fixos', async () => {
  const calls = []
  const full = await fetchCompleteReport({ accountId: 'A' }, async (filters) => {
    calls.push(filters)
    return snapshot({
      campaigns_total: 101,
      contexts_total: 0,
      campaigns_truncated: !filters.campaignOffset,
      contexts_truncated: false,
      by_campaign: Array.from({ length: filters.campaignOffset ? 1 : 100 }, (_, i) => ({
        ad_id: `A-${i + (filters.campaignOffset || 0)}`,
        ...metrics,
      })),
    })
  })
  assert.equal(full.by_campaign.length, 101)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].accountId, 'A')
  assert.equal(calls[1].from, '2026-10-01')
})
test('exportação falha sem resultado parcial em revogação ou mudança concorrente', async () => {
  await assert.rejects(
    fetchCompleteReport({ accountId: 'A' }, async (f) => {
      if (f.campaignOffset) throw Object.assign(new Error('PERMISSION_DENIED'), { code: '42501' })
      return snapshot({ campaigns_truncated: true })
    }),
    /PERMISSION_DENIED/
  )
  await assert.rejects(
    fetchCompleteReport({ accountId: 'A' }, async (f) =>
      snapshot({
        campaigns_truncated: !f.campaignOffset,
        summary: f.campaignOffset ? { ...metrics, clicks: 99 } : metrics,
      })
    ),
    /mudaram/
  )
})

test('exportação recusa mudança de período ou série, mesmo com totais iguais', () => {
  const original = snapshot()
  assert.equal(reportMatchesSnapshot(snapshot(), original), true)
  assert.equal(
    reportMatchesSnapshot(snapshot({ period: { ...original.period, to: '2026-10-25' } }), original),
    false
  )
  assert.equal(reportMatchesSnapshot(snapshot({ daily: [] }), original), false)
})
