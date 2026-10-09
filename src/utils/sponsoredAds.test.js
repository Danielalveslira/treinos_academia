import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formValuesFromAd,
  composeCommunityAds,
  interleaveAds,
  nextExpiry,
  referenceNow,
  selectBannerAds,
} from './sponsoredAds.js'
import { observeServerDate, resetServerClock, serverNow } from './serverClock.js'

const ad = (id, displayMode, expiresAt = null) => ({ id, displayMode, expiresAt })
const ids = (list) => list.map((item) => item.id)

test('campanha vencida sai dos dois espaços; sem validade nunca vence', () => {
  const { bannerAds, feedAds } = composeCommunityAds(
    [ad('old', ['banner', 'feed'], 50), ad('open', ['feed']), ad('live', ['banner'], 200)],
    100
  )
  assert.deepEqual(ids(bannerAds), ['live'])
  assert.deepEqual(ids(feedAds), ['open'])
})

test('campanha nos dois modos mantém as duas exposições: banner no topo e card no meio do feed', () => {
  const ads = [
    ad('both', ['banner', 'feed']),
    ad('feedOnly', ['feed']),
    ad('bannerOnly', ['banner']),
  ]
  const { bannerAds, feedAds, inlineFeedAds } = composeCommunityAds(ads, 100)
  assert.deepEqual(ids(bannerAds), ['both', 'bannerOnly'])
  assert.deepEqual(ids(feedAds), ['feedOnly'])
  assert.deepEqual(ids(inlineFeedAds), ['both'])
})

test('interleaveAds: 1ª campanha depois de 3 publicações, demais a cada 4, nenhuma descartada', () => {
  const items = Array.from({ length: 10 }, (_, i) => `p${i}`)
  const order = interleaveAds(
    items,
    ['A', 'B', 'C'].map((id) => ({ id }))
  ).map((e) => (e.type === 'ad' ? e.ad.id : e.item))
  assert.deepEqual(order, [
    'p0',
    'p1',
    'p2',
    'A',
    'p3',
    'p4',
    'p5',
    'p6',
    'B',
    'p7',
    'p8',
    'p9',
    'C',
  ])
})

test('interleaveAds: poucas publicações levam a campanha para o fim; sem publicações ela aparece', () => {
  const two = interleaveAds(['p0', 'p1'], [{ id: 'A' }])
  assert.deepEqual(
    two.map((e) => e.type),
    ['item', 'item', 'ad']
  )
  assert.deepEqual(
    interleaveAds([], [{ id: 'A' }]).map((e) => e.type),
    ['ad']
  )
  assert.deepEqual(
    interleaveAds(['p0'], []).map((e) => e.type),
    ['item']
  )
})

test('nextExpiry: menor vencimento futuro, ignorando vencidas e campanhas sem validade', () => {
  assert.equal(
    nextExpiry(
      [ad('a', ['feed']), ad('b', ['feed'], 50), ad('c', ['feed'], 300), ad('d', ['feed'], 200)],
      100
    ),
    200
  )
  assert.equal(nextExpiry([ad('a', ['feed'])], 100), null)
})

test('relógio do servidor prevalece sobre o do aparelho e ignora amostra antiga', () => {
  resetServerClock()
  const device = Date.parse('2026-01-01T00:00:00Z')
  observeServerDate('Fri, 09 Oct 2026 12:00:00 GMT', device)
  assert.equal(serverNow(device), Date.parse('2026-10-09T12:00:00.500Z'))
  observeServerDate('Fri, 09 Oct 2026 11:00:00 GMT', device)
  assert.equal(serverNow(device), Date.parse('2026-10-09T12:00:00.500Z'))
  observeServerDate('lixo', device)
  assert.equal(serverNow(device), Date.parse('2026-10-09T12:00:00.500Z'))
  resetServerClock()
  assert.equal(serverNow(device), device)
})

test('campanha só de feed nunca é deduplicada; lista vazia ou ausente não quebra', () => {
  assert.deepEqual(ids(composeCommunityAds([ad('a', ['feed']), ad('b', ['feed'])], 1).feedAds), [
    'a',
    'b',
  ])
  assert.deepEqual(composeCommunityAds(undefined), {
    bannerAds: [],
    feedAds: [],
    inlineFeedAds: [],
  })
})

test('selectBannerAds (Home) ignora feed-only e vencidas', () => {
  const list = [ad('f', ['feed']), ad('b', ['banner']), ad('x', ['banner'], 10)]
  assert.deepEqual(ids(selectBannerAds(list, 100)), ['b'])
})

test('sem relógio do servidor a revalidação local é dispensada (nunca usa o relógio do aparelho)', () => {
  resetServerClock()
  const list = [ad('old', ['banner'], 50), ad('open', ['banner'])]
  assert.equal(referenceNow(), null)
  assert.deepEqual(ids(composeCommunityAds(list).bannerAds), ['old', 'open'])
  assert.equal(nextExpiry(list), null)
  observeServerDate('Fri, 09 Oct 2026 12:00:00 GMT')
  assert.equal(typeof referenceNow(), 'number')
  assert.deepEqual(ids(composeCommunityAds(list).bannerAds), ['open'])
  resetServerClock()
})

test('formValuesFromAd: campos opcionais nulos do banco viram string vazia (editar não quebra)', () => {
  const empty = {
    title: '',
    imageUrl: '',
    ctaLabel: '',
    ctaType: 'external',
    ctaTarget: '',
    expiresAt: '',
    communityIds: [],
  }
  const fromDb = {
    id: 'x',
    title: 'T',
    imageUrl: null,
    ctaLabel: null,
    ctaType: null,
    ctaTarget: null,
    expiresAt: null,
    communityIds: ['c1'],
    createdBy: 'u',
  }
  const values = formValuesFromAd(empty, fromDb)
  assert.deepEqual(values, {
    title: 'T',
    imageUrl: '',
    ctaLabel: '',
    ctaType: 'external',
    ctaTarget: '',
    expiresAt: '',
    communityIds: ['c1'],
  })
  assert.equal(typeof values.imageUrl.trim(), 'string')
  assert.equal(formValuesFromAd(empty, null), empty)
  assert.equal(formValuesFromAd(empty, { imageUrl: 'https://a/b.png' }).imageUrl, 'https://a/b.png')
})
