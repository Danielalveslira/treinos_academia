import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readAdHint, widthBucket, writeAdHint } from './adSlotHint.js'
import { clearPageCache } from './pageCache.js'

beforeEach(() => {
  const data = new Map()
  globalThis.localStorage = {
    get length() {
      return data.size
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  }
})

test('sem dica nada é reservado; a dica vale só para aquele usuário e comunidade', () => {
  assert.deepEqual(readAdHint('u1', 'c1', 'm'), { banner: false, feedTop: 0, feedOnly: false })
  writeAdHint('u1', 'c1', { banner: true, feedTop: 462 }, 'm')
  assert.deepEqual(readAdHint('u1', 'c1', 'm'), { banner: true, feedTop: 462, feedOnly: true })
  assert.deepEqual(readAdHint('u2', 'c1', 'm'), { banner: false, feedTop: 0, feedOnly: false })
  assert.deepEqual(readAdHint('u1', 'c2', 'm'), { banner: false, feedTop: 0, feedOnly: false })
})

test('altura do topo só vale na mesma faixa de largura (mobile x desktop); banner vale sempre', () => {
  writeAdHint('u1', 'c1', { banner: true, feedTop: 462 }, 'm')
  assert.deepEqual(readAdHint('u1', 'c1', 'd'), { banner: true, feedTop: 0, feedOnly: true })
  assert.equal(widthBucket(390), 'm')
  assert.equal(widthBucket(1280), 'd')
})

test('altura -1 = cards só de feed existem mas não foram medidos (entraram tarde)', () => {
  writeAdHint('u1', 'c1', { banner: false, feedTop: -1 }, 'm')
  assert.deepEqual(readAdHint('u1', 'c1', 'm'), { banner: false, feedTop: 0, feedOnly: true })
})

test('quando a comunidade perde os anúncios a dica é apagada; valores absurdos são limitados', () => {
  writeAdHint('u1', 'c1', { banner: true, feedTop: 300 }, 'm')
  writeAdHint('u1', 'c1', { banner: false, feedTop: 0, feedOnly: false }, 'm')
  assert.deepEqual(readAdHint('u1', 'c1', 'm'), { banner: false, feedTop: 0, feedOnly: false })
  writeAdHint('u1', 'c1', { banner: false, feedTop: 99999 }, 'm')
  assert.equal(readAdHint('u1', 'c1', 'm').feedTop, 1200)
  globalThis.localStorage.setItem('adSlotHint:u1:c1', 'lixo')
  assert.deepEqual(readAdHint('u1', 'c1', 'm'), { banner: false, feedTop: 0, feedOnly: false })
})

test('logout/troca de conta (clearPageCache) apaga as dicas', () => {
  writeAdHint('u1', 'c1', { banner: true, feedTop: 300 }, 'm')
  clearPageCache()
  assert.deepEqual(readAdHint('u1', 'c1', 'm'), { banner: false, feedTop: 0, feedOnly: false })
})

test('storage indisponível não quebra', () => {
  delete globalThis.localStorage
  assert.deepEqual(readAdHint('u1', 'c1', 'm'), { banner: false, feedTop: 0, feedOnly: false })
  assert.doesNotThrow(() => writeAdHint('u1', 'c1', { banner: true, feedTop: 10 }, 'm'))
})
