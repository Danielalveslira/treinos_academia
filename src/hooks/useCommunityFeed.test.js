import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Hook de feed paginado testado com React REAL (react-test-renderer, act síncrono) e um
// statusesService falso que grava as chamadas. pageCache e clock são os módulos reais.
let directory
let api

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'community-feed-tests-'))
  const outfile = join(directory, 'feed.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { useCommunityFeed } from './useCommunityFeed.js'
        import { invalidateCache, clearPageCache } from '../utils/pageCache'
        export { invalidateCache, clearPageCache }
        globalThis.IS_REACT_ACT_ENVIRONMENT = false

        export function mount(args) {
          const box = { current: null }
          function Probe(props) { box.current = useCommunityFeed(props.id, props.enabled, props.uid); return null }
          let renderer
          act(() => { renderer = TestRenderer.create(createElement(Probe, args)) })
          return {
            get hook() { return box.current },
            rerender: (next) => act(() => renderer.update(createElement(Probe, next))),
            unmount: () => act(() => renderer.unmount()),
          }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'feed-service-stub',
        setup(context) {
          context.onResolve({ filter: /services\/statusesService$/ }, () => ({
            path: 'statuses',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^statuses$/, namespace: 'stub' }, () => ({
            contents: `
              export const listCommunityFeedPage = (communityId, opts = {}) => globalThis.__feed.page(communityId, opts)
              export const deleteStatus = (id) => globalThis.__feed.del(id)
            `,
          }))
        },
      },
    ],
  })
  api = createRequire(import.meta.url)(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

// Banco falso: 25 publicações (as mais novas primeiro), páginas de 10 por cursor.
let pageCalls
let delayMs
let failNext
function makeItems(n, prefix = 's') {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    createdAt: new Date(Date.UTC(2026, 9, 8, 12, 0, 0) - i * 60000).toISOString(),
    expiresAt: null,
    retentionMode: 'no_auto_expiration',
    positiveVoteCount: 0,
    negativeVoteCount: 0,
  }))
}
let db
beforeEach(() => {
  pageCalls = []
  delayMs = 0
  failNext = false
  db = makeItems(25)
  api.invalidateCache('communityFeed:')
  globalThis.__feed = {
    async page(communityId, { cursor = null, pageSize = 10, signal = null } = {}) {
      pageCalls.push({ communityId, cursor, signal })
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (signal?.aborted) throw Object.assign(new Error('abort'), { name: 'AbortError' })
      if (failNext) {
        failNext = false
        throw new Error('rede caiu')
      }
      const start = cursor ? db.findIndex((item) => item.id === cursor.id) + 1 : 0
      const slice = db.slice(start, start + pageSize + 1)
      return { items: slice.slice(0, pageSize), hasMore: slice.length > pageSize }
    },
    async del() {},
  }
})
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

test('feed desligado não consulta nada e devolve lista vazia', async () => {
  const feed = api.mount({ id: 'c1', enabled: false, uid: 'u1' })
  await tick()
  assert.equal(pageCalls.length, 0)
  assert.deepEqual(feed.hook.statuses, [])
  assert.equal(feed.hook.hasMore, false)
  feed.unmount()
})

test('abertura carrega só a primeira página (10) e sabe que há mais, sem count(*) extra', async () => {
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  assert.equal(pageCalls.length, 1)
  assert.equal(pageCalls[0].cursor, null)
  assert.equal(feed.hook.statuses.length, 10)
  assert.equal(feed.hook.hasMore, true)
  assert.equal(feed.hook.loading, false)
  feed.unmount()
})

test('loadMore usa o cursor do último item, acrescenta sem duplicar e termina quando acaba', async () => {
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  await feed.hook.loadMore()
  await tick()
  assert.deepEqual(pageCalls[1].cursor, { createdAt: db[9].createdAt, id: 's9' })
  assert.equal(feed.hook.statuses.length, 20)
  await feed.hook.loadMore()
  await tick()
  assert.equal(feed.hook.statuses.length, 25)
  assert.equal(feed.hook.hasMore, false)
  await feed.hook.loadMore()
  assert.equal(pageCalls.length, 3, 'sem próxima página, loadMore não consulta')
  assert.deepEqual(new Set(feed.hook.statuses.map((s) => s.id)).size, 25)
  feed.unmount()
})

test('loadMore chamado várias vezes ao mesmo tempo faz UMA leitura (sentinela + clique)', async () => {
  delayMs = 40
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick(80)
  const first = feed.hook.loadMore()
  feed.hook.loadMore()
  feed.hook.loadMore()
  await first
  await tick(80)
  assert.equal(pageCalls.length, 2)
  assert.equal(feed.hook.statuses.length, 20)
  feed.unmount()
})

test('falha ao carregar mais mantém o que já está na tela e permite tentar de novo', async () => {
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  failNext = true
  await feed.hook.loadMore()
  await tick()
  assert.equal(feed.hook.statuses.length, 10)
  assert.ok(feed.hook.moreError)
  assert.equal(feed.hook.error, null, 'a falha da próxima página não vira erro da tela inteira')
  await feed.hook.loadMore()
  await tick()
  assert.equal(feed.hook.statuses.length, 20)
  assert.equal(feed.hook.moreError, null)
  feed.unmount()
})

test('desmontar (navegação rápida) cancela a próxima página em voo', async () => {
  delayMs = 60
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick(100)
  const pending = feed.hook.loadMore()
  await tick(10)
  feed.unmount()
  await pending
  assert.equal(pageCalls[1].signal.aborted, true)
})

test('voltar à comunidade repinta todas as páginas da cache, sem nova leitura', async () => {
  const first = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  await first.hook.loadMore()
  await tick()
  first.unmount()
  const calls = pageCalls.length
  const again = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  assert.equal(again.hook.statuses.length, 20, 'repinta já na primeira renderização')
  assert.equal(again.hook.loading, false)
  await tick()
  assert.equal(pageCalls.length, calls)
  again.unmount()
})

test('cache é segmentada por usuário e por comunidade', async () => {
  const a = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  a.unmount()
  const otherUser = api.mount({ id: 'c1', enabled: true, uid: 'u2' })
  assert.equal(otherUser.hook.statuses.length, 0, 'outro usuário não herda o feed')
  await tick()
  otherUser.unmount()
  const otherCommunity = api.mount({ id: 'c2', enabled: true, uid: 'u1' })
  assert.equal(otherCommunity.hook.statuses.length, 0)
  await tick()
  assert.equal(pageCalls.length, 3)
  otherCommunity.unmount()
})

test('refresh MESCLA a primeira página: publicação nova entra no topo e as páginas carregadas permanecem', async () => {
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  await feed.hook.loadMore()
  await tick()
  assert.equal(feed.hook.statuses.length, 20)
  db = [{ ...makeItems(1, 'novo')[0], createdAt: '2026-10-08T13:00:00.000000+00:00' }, ...db]
  await feed.hook.refresh()
  await tick()
  assert.equal(feed.hook.statuses.length, 21, 'as 20 já carregadas + a nova')
  assert.equal(feed.hook.statuses[0].id, 'novo0')
  assert.equal(new Set(feed.hook.statuses.map((s) => s.id)).size, 21, 'sem duplicatas')
  assert.equal(feed.hook.hasMore, true)
  assert.equal(feed.hook.refreshEpoch, 1, 'os cards de enquete/treino são avisados para recarregar')
  assert.equal(feed.hook.refreshing, false)
  assert.equal(pageCalls.length, 3, 'abertura + próxima página + 1 revalidação (nunca N)')
  feed.unmount()
})

test('publicações novas DURANTE a paginação não duplicam nem fazem pular itens', async () => {
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  // alguém publica 3 itens enquanto o usuário lê a primeira página
  db = [
    ...['n2', 'n1', 'n0'].map((id, i) => ({
      ...makeItems(1, id)[0],
      id,
      createdAt: `2026-10-08T13:0${3 - i}:00.000000+00:00`,
    })),
    ...db,
  ]
  await feed.hook.loadMore()
  await tick()
  const ids = feed.hook.statuses.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length, 'sem duplicatas')
  assert.deepEqual(
    ids,
    db.slice(3, 23).map((s) => s.id),
    'a página 2 continua exatamente de onde parou (s10..s19), sem as novas'
  )
  await feed.hook.refresh()
  await tick()
  assert.deepEqual(
    feed.hook.statuses.slice(0, 3).map((s) => s.id),
    ['n2', 'n1', 'n0'],
    'as novas aparecem no topo ao atualizar'
  )
  assert.equal(new Set(feed.hook.statuses.map((s) => s.id)).size, feed.hook.statuses.length)
  feed.unmount()
})

test('item removido no servidor some depois de atualizar, sem mexer nas páginas de baixo', async () => {
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  await feed.hook.loadMore()
  await tick()
  db = db.filter((item) => item.id !== 's2')
  await feed.hook.refresh()
  await tick()
  const ids = feed.hook.statuses.map((s) => s.id)
  assert.equal(ids.includes('s2'), false)
  assert.equal(ids.includes('s15'), true, 'o que já estava carregado abaixo continua')
  feed.unmount()
})

test('cache velho ao voltar: mostra na hora e revalida em segundo plano (1 leitura), mesclando', async () => {
  const first = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  first.unmount()
  const calls = pageCalls.length
  db = [{ ...makeItems(1, 'novo')[0], createdAt: '2026-10-08T13:00:00.000000+00:00' }, ...db]
  const realNow = Date.now
  Date.now = () => realNow() + 120 * 1000 // passaram 2 minutos
  try {
    const again = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
    assert.equal(again.hook.statuses.length, 10, 'repinta o que tinha, na primeira renderização')
    assert.equal(again.hook.loading, false, 'sem spinner')
    await tick()
    assert.equal(pageCalls.length, calls + 1, 'uma revalidação')
    assert.equal(again.hook.statuses[0].id, 'novo0')
    again.unmount()
  } finally {
    Date.now = realNow
  }
})

test('cache recente ao voltar NÃO consulta nada', async () => {
  const first = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  first.unmount()
  const calls = pageCalls.length
  const again = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  assert.equal(pageCalls.length, calls)
  again.unmount()
})

test('atualizações simultâneas (automática + manual) não duplicam a leitura', async () => {
  delayMs = 40
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick(120)
  const calls = pageCalls.length
  const [a, b] = [feed.hook.refresh(), feed.hook.refresh()]
  await Promise.all([a, b])
  assert.ok(
    pageCalls.length - calls <= 2,
    'no máximo uma por refresh, e a mesma requisição é compartilhada em voo'
  )
  feed.unmount()
})

test('falha ao atualizar manualmente mantém a lista e mostra o erro; a atualização automática falha em silêncio', async () => {
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  failNext = true
  await feed.hook.refresh()
  await tick()
  assert.equal(feed.hook.statuses.length, 10, 'a lista continua')
  assert.ok(feed.hook.error, 'o erro aparece (manual)')
  assert.equal(feed.hook.refreshing, false)
  await feed.hook.refresh()
  await tick()
  assert.equal(feed.hook.error, null, 'nova tentativa limpa o erro')
  feed.unmount()
})

test('comentário criado atualiza o contador do card e a cache', async () => {
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  feed.hook.updateCommentCount('s3', 2)
  feed.hook.updateCommentCount('inexistente', 1)
  await tick()
  assert.equal(feed.hook.statuses.find((s) => s.id === 's3').commentCount, 2)
  feed.unmount()
  const again = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  assert.equal(
    again.hook.statuses.find((s) => s.id === 's3').commentCount,
    2,
    'o retorno não mostra o número antigo'
  )
  again.unmount()
})

test('publicar localmente entra no topo, sem duplicar, e persiste na cache', async () => {
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  feed.hook.addStatusLocally({
    id: 'meu',
    createdAt: new Date(),
    expiresAt: null,
    retentionMode: 'no_auto_expiration',
  })
  feed.hook.addStatusLocally({
    id: 'meu',
    createdAt: new Date(),
    expiresAt: null,
    retentionMode: 'no_auto_expiration',
  })
  await tick()
  assert.equal(feed.hook.statuses.filter((s) => s.id === 'meu').length, 1)
  assert.equal(feed.hook.statuses[0].id, 'meu')
  feed.unmount()
  const again = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  assert.equal(again.hook.statuses[0].id, 'meu')
  again.unmount()
})

test('um item otimista local no fim não quebra o cursor (usa ISO do Date)', async () => {
  db = makeItems(12)
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  await feed.hook.loadMore()
  await tick()
  assert.equal(typeof pageCalls[1].cursor.createdAt, 'string')
  feed.unmount()
})

test('sem conexão: loadMore avisa na hora, não envia nada e ao reconectar tenta sozinho', async () => {
  const feed = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  const calls = pageCalls.length
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const events = {}
  const previousWindow = globalThis.window
  globalThis.window = {
    addEventListener: (name, fn) => (events[name] = fn),
    removeEventListener() {},
  }
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true })
  try {
    await feed.hook.loadMore()
    await tick()
    assert.equal(pageCalls.length, calls, 'nenhuma requisição enquanto offline')
    assert.match(feed.hook.moreError.message, /Sem conexão/)
    assert.equal(feed.hook.statuses.length, 10, 'o que já estava na tela continua')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous)
    globalThis.window = previousWindow
  }
  feed.unmount()
})

test('trocar de conta/encerrar a sessão (clearPageCache) apaga o feed em memória; a próxima sessão começa do zero', async () => {
  const first = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  await tick()
  await first.hook.loadMore()
  await tick()
  assert.equal(first.hook.statuses.length, 20)
  first.unmount()
  api.clearPageCache()
  const calls = pageCalls.length
  const next = api.mount({ id: 'c1', enabled: true, uid: 'u1' })
  assert.equal(next.hook.statuses.length, 0, 'nenhuma publicação da sessão anterior')
  assert.equal(next.hook.loading, true)
  await tick()
  assert.equal(pageCalls.length, calls + 1)
  assert.equal(next.hook.statuses.length, 10, 'só a primeira página, de novo')
  next.unmount()
})
