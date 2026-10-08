import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareFeedOrder, mergeFirstPage } from './feedOrder.js'

const at = (id, createdAt, extra = {}) => ({ id, createdAt, ...extra })
const ids = (list) => list.items.map((item) => item.id)

test('ordem = created_at desc com precisão de microssegundos e desempate por id desc', () => {
  const a = at('a', '2026-10-08T18:26:06.287298+00:00')
  const b = at('b', '2026-10-08T18:26:06.287299+00:00')
  assert.ok(
    compareFeedOrder(b, a) < 0,
    'mais novo vem antes, mesmo diferindo só em 1 microssegundo'
  )
  assert.ok(compareFeedOrder(a, b) > 0)
  // fração com zeros finais omitidos (como o Postgres imprime) vale o mesmo que preenchida
  assert.equal(
    compareFeedOrder(
      at('x', '2026-10-08T18:26:06.28+00:00'),
      at('x', '2026-10-08T18:26:06.280000+00:00')
    ),
    0
  )
  // empate total de data: o id maior vem antes
  assert.ok(
    compareFeedOrder(at('z', '2026-10-08T18:26:06+00:00'), at('c', '2026-10-08T18:26:06+00:00')) < 0
  )
  // Date local x string do servidor
  assert.ok(
    compareFeedOrder(
      at('l', new Date('2026-10-08T19:00:00Z')),
      at('s', '2026-10-08T18:59:59.999+00:00')
    ) < 0
  )
})

test('mesclar: item novo entra no topo, páginas de baixo permanecem, contadores vêm da página nova', () => {
  const current = {
    items: [
      at('s3', '2026-10-08T12:03:00+00:00', { votes: 1 }),
      at('s2', '2026-10-08T12:02:00+00:00'),
      at('s1', '2026-10-08T12:01:00+00:00'),
      at('s0', '2026-10-08T12:00:00+00:00'),
    ],
    hasMore: true,
  }
  const fresh = {
    items: [
      at('n1', '2026-10-08T12:10:00+00:00'),
      at('s3', '2026-10-08T12:03:00+00:00', { votes: 9 }),
      at('s2', '2026-10-08T12:02:00+00:00'),
    ],
    hasMore: true,
  }
  const merged = mergeFirstPage(current, fresh)
  assert.deepEqual(ids(merged), ['n1', 's3', 's2', 's1', 's0'])
  assert.equal(merged.items[1].votes, 9, 'contador atualizado')
  assert.equal(merged.hasMore, true)
  assert.equal(new Set(ids(merged)).size, merged.items.length, 'sem duplicatas')
})

test('mesclar: o que sumiu da janela da página nova (removido/expirado) é descartado', () => {
  const current = {
    items: [
      at('s3', '2026-10-08T12:03:00+00:00'),
      at('s2', '2026-10-08T12:02:00+00:00'),
      at('s1', '2026-10-08T12:01:00+00:00'),
    ],
    hasMore: true,
  }
  const fresh = {
    items: [at('s3', '2026-10-08T12:03:00+00:00'), at('s1', '2026-10-08T12:01:00+00:00')],
    hasMore: true,
  }
  assert.deepEqual(ids(mergeFirstPage(current, fresh)), ['s3', 's1'])
})

test('mesclar: se a primeira página cobre o feed inteiro (sem próxima página), ela substitui tudo', () => {
  const current = {
    items: [at('old', '2026-10-01T00:00:00+00:00'), at('s1', '2026-10-08T12:01:00+00:00')],
    hasMore: false,
  }
  const fresh = { items: [at('s1', '2026-10-08T12:01:00+00:00')], hasMore: false }
  assert.deepEqual(mergeFirstPage(current, fresh), { items: fresh.items, hasMore: false })
})

test('mesclar: hasMore respeita as páginas já carregadas', () => {
  const page = (n) =>
    Array.from({ length: n }, (_, i) =>
      at(`s${100 - i}`, `2026-10-08T12:${String(59 - i).padStart(2, '0')}:00+00:00`)
    )
  const loadedAll = { items: page(25), hasMore: false }
  const fresh = { items: page(10), hasMore: true }
  assert.equal(
    mergeFirstPage(loadedAll, fresh).hasMore,
    false,
    'já tinha carregado até o fim: continua sem próxima página'
  )
  assert.equal(mergeFirstPage(loadedAll, fresh).items.length, 25)
  const onlyFirst = { items: page(10), hasMore: true }
  assert.equal(mergeFirstPage(onlyFirst, fresh).hasMore, true)
})

test('mesclar: publicação otimista local mais nova que a página nova é mantida; foto local é preservada', () => {
  const local = at('mine', new Date('2026-10-08T12:30:00Z'))
  const current = {
    items: [
      local,
      at('p1', '2026-10-08T12:01:00+00:00', { _localPhotoBlob: 'blob' }),
      at('p0', '2026-10-08T12:00:00+00:00'),
    ],
    hasMore: true,
  }
  const fresh = {
    items: [at('p1', '2026-10-08T12:01:00+00:00'), at('x', '2026-10-08T12:00:30+00:00')],
    hasMore: true,
  }
  const merged = mergeFirstPage(current, fresh)
  assert.deepEqual(ids(merged), ['mine', 'p1', 'x', 'p0'])
  assert.equal(merged.items[1]._localPhotoBlob, 'blob')
})

test('mesclar: nenhuma duplicata mesmo com itens no limite da janela', () => {
  const current = {
    items: [
      at('b', '2026-10-08T12:02:00+00:00'),
      at('a', '2026-10-08T12:01:00+00:00'),
      at('z', '2026-10-08T12:00:00+00:00'),
    ],
    hasMore: true,
  }
  const fresh = {
    items: [
      at('c', '2026-10-08T12:03:00+00:00'),
      at('b', '2026-10-08T12:02:00+00:00'),
      at('a', '2026-10-08T12:01:00+00:00'),
    ],
    hasMore: true,
  }
  const merged = mergeFirstPage(current, fresh)
  assert.deepEqual(ids(merged), ['c', 'b', 'a', 'z'])
})
