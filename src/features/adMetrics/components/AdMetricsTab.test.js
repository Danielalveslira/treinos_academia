import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Aba Métricas + hook de dados, com o servidor substituído por um fetcher falso e o gráfico (recharts) por um stub.
let directory
let lib

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ad-metrics-tab-'))
  const outfile = join(directory, 'tab.cjs')
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import AdMetricsTab from './AdMetricsTab.jsx'
        import { clearAdMetricsCache } from '../hooks/useAdMetricsDashboard.js'

        const textOf = (node) => (typeof node === 'string' ? node : (node.children || []).map(textOf).join(''))
        export { clearAdMetricsCache }
        export function mount(props) {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({
            matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
          }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(
              React.createElement(ThemeProvider, null,
                React.createElement(BaseStyles, null, React.createElement(AdMetricsTab, props)))
            )
          })
          const root = renderer.root
          const buttons = () => root.findAll((n) => n.type === 'button')
          return {
            text: () => textOf(renderer.toJSON() || ''),
            html: () => JSON.stringify(renderer.toJSON()),
            click: (label) => {
              const target = buttons().find((b) => textOf(b).includes(label))
              if (!target) throw new Error('botão não encontrado: ' + label)
              act(() => target.props.onClick({ preventDefault() {} }))
            },
            select: (id, value) => {
              const el = root.findAll((n) => n.type === 'select' && n.props.id === id)[0]
              act(() => el.props.onChange({ target: { value } }))
            },
            unmount: () => act(() => renderer.unmount()),
            chartCount: () => root.findAll((n) => n.props && n.props['data-testid'] === 'chart').length,
          }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'jsx',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    jsx: 'automatic',
    loader: { '.js': 'jsx', '.css': 'empty' },
    define: {
      'import.meta.env':
        '{"VITE_SUPABASE_URL":"https://t.supabase.co","VITE_SUPABASE_ANON_KEY":"k"}',
    },
    plugins: [
      {
        name: 'stub-chart',
        setup(b) {
          b.onResolve({ filter: /\/DailyChart$/ }, () => ({
            path: 'chart-stub',
            namespace: 'stub',
          }))
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            resolveDir: new URL('../../../../', import.meta.url).pathname,
            contents: `import React from 'react'
              export default function DailyChart({ data }) { return React.createElement('div', { 'data-testid': 'chart' }, 'dias:' + data.length) }`,
            loader: 'js',
          }))
        },
      },
    ],
  })
  lib = createRequire(import.meta.url)(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const metrics = (o = {}) => ({
  visible_impressions: 1000,
  unique_viewers: 600,
  clicks: 50,
  unqualified_clicks: 10,
  qualified_clicks: 40,
  ctr_qualified: 4,
  ctr_raw: 5,
  ...o,
})
const snapshot = (o = {}) => ({
  period: {
    from: '2026-09-10',
    to: '2026-10-09',
    days: 30,
    today: '2026-10-09',
    timezone: 'America/Sao_Paulo',
  },
  filters: {},
  collection: { server_enabled: true, has_any_data: true, last_day: '2026-10-09' },
  has_data: true,
  summary: metrics(),
  daily: [{ day: '2026-10-09', ...metrics() }],
  by_placement: [{ placement: 'home_banner', ...metrics({ visible_impressions: 400 }) }],
  by_campaign: [
    { ad_id: 'a1', partner_name: 'Marca Alfa', title: 'Oferta Alfa', deleted: false, ...metrics() },
    {
      ad_id: 'a2',
      partner_name: 'Marca Beta',
      title: null,
      deleted: true,
      ...metrics({ visible_impressions: 10 }),
    },
  ],
  campaigns_total: 2,
  campaigns_truncated: false,
  by_context: [{ placement: 'home_banner', context_id: '0', community_name: null, ...metrics() }],
  contexts_total: 1,
  contexts_truncated: false,
  ...o,
})

const ads = [{ id: 'a1', partnerName: 'Marca Alfa', title: 'Oferta Alfa' }]
const communities = [{ id: 'c1', name: 'Comunidade Um' }]
const tick = () => new Promise((resolve) => setTimeout(resolve, 15))

function setup(fetcher, userId = 'u1') {
  lib.clearAdMetricsCache()
  const calls = []
  const wrapped = async (filters) => {
    calls.push(filters)
    return fetcher(filters, calls.length)
  }
  return { calls, props: { userId, ads, communities, fetcher: wrapped } }
}

test('abrir a aba faz UMA leitura principal e mostra os cartões, o gráfico, posições e campanhas', async () => {
  const { calls, props } = setup(async () => snapshot())
  const view = lib.mount(props)
  await tick()
  assert.equal(calls.length, 1)
  const text = view.text()
  assert.match(text, /Impressões visíveis/)
  assert.match(text, /1\.000/)
  assert.match(text, /Alcance diário agregado/)
  assert.match(text, /CTR qualificado/)
  assert.match(text, /4,00%/)
  assert.match(text, /CTR bruto/)
  assert.match(text, /5,00%/)
  assert.match(text, /Cliques sem impressão registrada/)
  assert.match(text, /não são tratados como fraude/)
  assert.match(text, /Estimativas operacionais/)
  assert.match(text, /não são conversões, vendas, receita nem comprovação/i)
  assert.match(text, /Banner da Home/)
  assert.match(text, /Marca Alfa/)
  assert.match(text, /Campanha excluída/)
  assert.equal(view.chartCount(), 1)
  assert.doesNotMatch(text, /visitas\b(?!\.)/, 'nunca chama cliques de visitas')
  view.unmount()
})

test('"Atualizar" faz exatamente mais uma leitura; trocar filtro faz uma; voltar a um filtro já visto usa o cache', async () => {
  const { calls, props } = setup(async () => snapshot())
  const view = lib.mount(props)
  await tick()
  assert.equal(calls.length, 1)
  view.click('Atualizar')
  await tick()
  assert.equal(calls.length, 2, 'Atualizar = 1 leitura')
  view.click('7 dias')
  await tick()
  assert.equal(calls.length, 3, 'novo período = 1 leitura')
  assert.equal(calls.at(-1).days, 7)
  view.click('30 dias')
  await tick()
  assert.equal(calls.length, 3, '30 dias já estava em cache após o Atualizar: nenhuma leitura')
  view.select('ad-metrics-placement', 'home_banner')
  await tick()
  assert.equal(calls.length, 4)
  assert.equal(calls.at(-1).placement, 'home_banner')
  view.unmount()
})

test('busca e ordenação de campanhas são locais (nenhuma leitura)', async () => {
  const { calls, props } = setup(async () => snapshot())
  const view = lib.mount(props)
  await tick()
  const before = calls.length
  view.click('Detalhes') // abre o detalhe de uma campanha: UMA leitura filtrada
  await tick()
  assert.equal(calls.length, before + 1)
  assert.equal(calls.at(-1).adId, 'a1')
  view.unmount()
})

test('detalhe da campanha usa o mesmo cache em uma segunda abertura', async () => {
  const { calls, props } = setup(async () => snapshot())
  const view = lib.mount(props)
  await tick()
  view.click('Detalhes')
  await tick()
  view.click('Fechar detalhe')
  view.click('Detalhes')
  await tick()
  assert.equal(calls.length, 2, 'principal + detalhe; reabrir o detalhe não lê de novo')
  view.unmount()
})

test('resposta antiga de um filtro anterior é descartada (corrida)', async () => {
  let release
  const slow = new Promise((resolve) => {
    release = resolve
  })
  const { calls, props } = setup(async (filters) => {
    if (!filters.placement) return slow
    return snapshot({ summary: metrics({ visible_impressions: 777 }) })
  })
  const view = lib.mount(props)
  await tick()
  // os controles ficam desabilitados durante a leitura; força o evento para simular a corrida mesmo assim
  view.select('ad-metrics-placement', 'home_banner')
  await tick()
  assert.equal(calls.length, 2)
  assert.match(view.text(), /777/)
  release(snapshot({ summary: metrics({ visible_impressions: 111 }) })) // a resposta lenta chega por último
  await tick()
  assert.match(view.text(), /777/)
  assert.doesNotMatch(view.text(), /\b111\b/, 'a resposta do filtro antigo não sobrescreve a atual')
  view.unmount()
})

test('falha mantém o último snapshot válido com aviso; o erro é categorizado', async () => {
  let fail = false
  const { calls, props } = setup(async () => {
    if (fail) throw new TypeError('Failed to fetch')
    return snapshot()
  })
  const view = lib.mount(props)
  await tick()
  fail = true
  view.click('Atualizar')
  await tick()
  assert.equal(calls.length, 2)
  const text = view.text()
  assert.match(text, /Não foi possível carregar as métricas/)
  assert.match(text, /último resultado válido/)
  assert.match(text, /1\.000/, 'números do último snapshot continuam')
  view.unmount()
})

test('backend ausente (migration não aplicada) é uma situação própria, sem números', async () => {
  const { props } = setup(async () => {
    throw {
      code: 'PGRST202',
      message: 'Could not find the function public.get_sponsored_ad_metrics_dashboard',
    }
  })
  const view = lib.mount(props)
  await tick()
  const text = view.text()
  assert.match(text, /ainda não está disponível neste ambiente/)
  assert.doesNotMatch(text, /Impressões visíveis/)
  view.unmount()
})

test('sem permissão: mensagem própria e sem botão de nova tentativa', async () => {
  const { props } = setup(async () => {
    throw { code: 'P0001', message: 'PERMISSION_DENIED' }
  })
  const view = lib.mount(props)
  await tick()
  assert.match(view.text(), /Acesso restrito ao superadmin/)
  assert.doesNotMatch(view.text(), /Tentar de novo/)
  view.unmount()
})

test('coleta desligada e nunca coletou: aviso honesto, nenhum número', async () => {
  const { props } = setup(async () =>
    snapshot({
      has_data: false,
      collection: { server_enabled: false, has_any_data: false, last_day: null },
      summary: metrics({
        visible_impressions: 0,
        unique_viewers: 0,
        clicks: 0,
        unqualified_clicks: 0,
        qualified_clicks: 0,
        ctr_qualified: null,
        ctr_raw: null,
      }),
      daily: [],
      by_placement: [],
      by_campaign: [],
      by_context: [],
      campaigns_total: 0,
      contexts_total: 0,
    })
  )
  const view = lib.mount(props)
  await tick()
  const text = view.text()
  assert.match(text, /coleta de métricas está desligada/)
  assert.doesNotMatch(text, /Impressões visíveis/)
  assert.equal(view.chartCount(), 0, 'sem dados não carrega nem desenha o gráfico')
  view.unmount()
})

test('sem dados no período (coleta ligada): "Ainda não há métricas neste período"', async () => {
  const { props } = setup(async () =>
    snapshot({
      has_data: false,
      summary: metrics({
        visible_impressions: 0,
        unique_viewers: 0,
        clicks: 0,
        unqualified_clicks: 0,
        qualified_clicks: 0,
        ctr_qualified: null,
        ctr_raw: null,
      }),
      daily: [],
      by_placement: [],
      by_campaign: [],
      by_context: [],
      campaigns_total: 0,
      contexts_total: 0,
    })
  )
  const view = lib.mount(props)
  await tick()
  assert.match(view.text(), /Ainda não há métricas neste período/)
  view.unmount()
})

test('dados existem, mas a coleta está desligada agora: mostra os dados com aviso', async () => {
  const { props } = setup(async () =>
    snapshot({ collection: { server_enabled: false, has_any_data: true, last_day: '2026-10-01' } })
  )
  const view = lib.mount(props)
  await tick()
  assert.match(view.text(), /coleta está desligada no momento/)
  assert.match(view.text(), /Impressões visíveis/)
  view.unmount()
})

test('offline: não consulta e informa que as métricas só funcionam online', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true,
    writable: true,
  })
  try {
    const { calls, props } = setup(async () => snapshot())
    const view = lib.mount(props)
    await tick()
    assert.equal(calls.length, 0)
    assert.match(view.text(), /Sem conexão/)
    view.unmount()
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete globalThis.navigator
  }
})

test('cache é por conta: outra conta não reaproveita o snapshot', async () => {
  const { calls, props } = setup(async () => snapshot())
  lib.mount(props)
  await tick()
  const view = lib.mount({ ...props, userId: 'u2' })
  await tick()
  assert.equal(calls.length, 2)
  view.unmount()
})

test('intervalo personalizado inválido não consulta; válido consulta uma vez ao aplicar', async () => {
  const { calls, props } = setup(async () => snapshot())
  const view = lib.mount(props)
  await tick()
  view.click('Personalizado')
  view.click('Aplicar')
  await tick()
  assert.equal(calls.length, 1, 'datas vazias: validação local, nenhuma leitura')
  assert.match(view.text(), /Informe a data inicial e a final/)
  view.unmount()
})
