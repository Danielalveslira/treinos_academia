import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_FILTERS,
  buildRpcArgs,
  cacheKey,
  classifyError,
  classifySnapshot,
  fillDailySeries,
  formatCount,
  formatDay,
  formatPercent,
  organizeCampaigns,
  placementLabel,
  validateCustomRange,
} from './metrics.js'

test('formatação: pt-BR, CTR nulo vira traço (nunca 0% inventado)', () => {
  assert.equal(formatCount(1234567), '1.234.567')
  assert.equal(formatCount(null), '—')
  assert.equal(formatPercent(4.03), '4,03%')
  assert.equal(formatPercent(0), '0,00%')
  assert.equal(formatPercent(null), '—')
  assert.equal(formatPercent(125.5), '125,50%')
  assert.equal(formatDay('2026-10-09'), '09/10')
})

test('rótulos de posicionamento são legíveis e cobrem os quatro valores', () => {
  assert.equal(placementLabel('home_banner'), 'Banner da Home')
  assert.equal(placementLabel('community_banner'), 'Banner da comunidade')
  assert.equal(placementLabel('community_feed'), 'Card no feed da comunidade')
  assert.equal(placementLabel('progress_banner'), 'Banner no Progresso')
  assert.equal(placementLabel('x'), 'Posição desconhecida')
})

test('argumentos da RPC: predefinição manda só p_days; personalizado manda datas; filtros viram parâmetros', () => {
  assert.deepEqual(buildRpcArgs(DEFAULT_FILTERS), {
    p_days: 30,
    p_from: null,
    p_to: null,
    p_ad_id: null,
    p_community_id: null,
    p_placement: null,
  })
  assert.deepEqual(
    buildRpcArgs({
      ...DEFAULT_FILTERS,
      days: null,
      from: '2026-09-01',
      to: '2026-09-30',
      adId: 'a',
      communityId: 'c',
      placement: 'home_banner',
    }),
    {
      p_days: null,
      p_from: '2026-09-01',
      p_to: '2026-09-30',
      p_ad_id: 'a',
      p_community_id: 'c',
      p_placement: 'home_banner',
    }
  )
})

test('chave de cache: igual para a mesma consulta, diferente quando algo muda', () => {
  assert.equal(cacheKey(DEFAULT_FILTERS), cacheKey({ ...DEFAULT_FILTERS }))
  assert.notEqual(cacheKey(DEFAULT_FILTERS), cacheKey({ ...DEFAULT_FILTERS, days: 7 }))
  assert.notEqual(cacheKey(DEFAULT_FILTERS), cacheKey({ ...DEFAULT_FILTERS, adId: 'x' }))
})

test('validação do intervalo personalizado', () => {
  assert.equal(validateCustomRange('2026-09-01', '2026-09-30', '2026-10-09'), null)
  assert.match(validateCustomRange('', '2026-09-30'), /Informe/)
  assert.match(validateCustomRange('2026-09-30', '2026-09-01'), /posterior/)
  assert.match(validateCustomRange('2025-01-01', '2026-09-01'), /366/)
  assert.equal(
    validateCustomRange('2025-09-01', '2026-09-01'),
    null,
    '366 dias (inclusivo) é aceito'
  )
  assert.match(validateCustomRange('2026-10-01', '2026-10-20', '2026-10-09'), /futuro/)
  assert.match(validateCustomRange('2019-12-01', '2020-01-02'), /anterior/)
  assert.match(validateCustomRange('01/09/2026', '30/09/2026'), /inválidas/)
})

test('série diária: preserva ausência de registro como null e marca recorded=false', () => {
  const period = { from: '2026-10-07', to: '2026-10-09' }
  const series = fillDailySeries(
    [{ day: '2026-10-08', visible_impressions: 10, clicks: 2 }],
    period
  )
  assert.deepEqual(series, [
    { day: '2026-10-07', impressions: null, clicks: null, recorded: false },
    { day: '2026-10-08', impressions: 10, clicks: 2, recorded: true },
    { day: '2026-10-09', impressions: null, clicks: null, recorded: false },
  ])
  assert.deepEqual(fillDailySeries([], null), [])
  // virada de mês/ano sem deslocamento de fuso
  assert.deepEqual(
    fillDailySeries([], { from: '2026-12-31', to: '2027-01-01' }).map((d) => d.day),
    ['2026-12-31', '2027-01-01']
  )
})

const rows = [
  {
    ad_id: 'b',
    partner_name: 'Beta',
    title: 'Oferta B',
    visible_impressions: 100,
    clicks: 5,
    ctr_qualified: 5,
  },
  {
    ad_id: 'a',
    partner_name: 'Alfa',
    title: 'Oferta A',
    visible_impressions: 100,
    clicks: 9,
    ctr_qualified: 9,
  },
  {
    ad_id: 'c',
    partner_name: 'Gama',
    title: 'Café',
    visible_impressions: 300,
    clicks: 0,
    ctr_qualified: 0,
  },
  {
    ad_id: 'd',
    partner_name: 'Delta',
    title: 'Sem imp',
    visible_impressions: 0,
    clicks: 2,
    ctr_qualified: null,
  },
]

test('campanhas: ordenação local determinística (empate por ad_id) e busca sem acento sensível a caixa', () => {
  assert.deepEqual(
    organizeCampaigns(rows, { sort: 'impressions' }).map((r) => r.ad_id),
    ['c', 'a', 'b', 'd']
  )
  assert.deepEqual(
    organizeCampaigns(rows, { sort: 'clicks' }).map((r) => r.ad_id),
    ['a', 'b', 'd', 'c']
  )
  assert.deepEqual(
    organizeCampaigns(rows, { sort: 'ctr' }).map((r) => r.ad_id),
    ['a', 'b', 'c', 'd'],
    'CTR nulo vai por último'
  )
  assert.deepEqual(
    organizeCampaigns(rows, { sort: 'name' }).map((r) => r.partner_name),
    ['Alfa', 'Beta', 'Delta', 'Gama']
  )
  assert.deepEqual(
    organizeCampaigns(rows, { search: 'CAFÉ' }).map((r) => r.ad_id),
    ['c']
  )
  assert.deepEqual(
    organizeCampaigns(rows, { search: 'alfa' }).map((r) => r.ad_id),
    ['a']
  )
  assert.deepEqual(organizeCampaigns(rows, { search: 'zzz' }), [])
  assert.equal(rows.length, 4, 'não muta a lista original')
})

test('estado do snapshot: coleta desligada x sem dados no período x pronto', () => {
  assert.equal(classifySnapshot({ has_data: true, collection: {} }), 'ready')
  assert.equal(
    classifySnapshot({
      has_data: false,
      collection: { server_enabled: false, has_any_data: false },
    }),
    'collection_off'
  )
  assert.equal(
    classifySnapshot({
      has_data: false,
      collection: { server_enabled: true, has_any_data: false },
    }),
    'empty'
  )
  assert.equal(
    classifySnapshot({
      has_data: false,
      collection: { server_enabled: false, has_any_data: true },
    }),
    'empty'
  )
  assert.equal(classifySnapshot(null), 'empty')
})

test('erro: offline, sem permissão, filtro inválido, backend ausente e rede são situações distintas', () => {
  assert.equal(classifyError({ message: 'x' }, false), 'offline')
  assert.equal(classifyError({ code: 'P0001', message: 'PERMISSION_DENIED' }), 'forbidden')
  assert.equal(classifyError({ code: '42501', message: 'permission denied' }), 'forbidden')
  assert.equal(classifyError({ code: 'P0001', message: 'INVALID_RANGE' }), 'invalid')
  assert.equal(
    classifyError({
      code: 'PGRST202',
      message: 'Could not find the function public.get_sponsored_ad_metrics_dashboard',
    }),
    'unavailable'
  )
  assert.equal(classifyError({ code: '42883', message: 'function does not exist' }), 'unavailable')
  assert.equal(classifyError(new TypeError('Failed to fetch')), 'network')
})
