import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectRoutineImageUrls,
  countAvailableRoutineImages,
  prepareRoutineImages,
} from './exerciseImagePrep.js'

const START = 'https://proj.supabase.co/storage/v1/object/public/exercise-visuals/c1/v1/start.webp'
const END = 'https://proj.supabase.co/storage/v1/object/public/exercise-visuals/c1/v1/end.webp'
const THUMB = 'https://proj.supabase.co/storage/v1/object/public/exercise-visuals/c1/v1/thumb.webp'
const OTHER_START = 'https://proj.supabase.co/storage/v1/object/public/exercise-visuals/c2/v1/start.webp'

let store
let fetchCalls
// Simula o Service Worker: por padrão, todo fetch() bem-sucedido "grava" no Cache Storage (efeito
// colateral invisível à página, exatamente como no navegador real) -- URLs em `fetchFailures`
// resolvem sem gravar nada (simula CORS/MIME/quota rejeitando a gravação) ou rejeitam de verdade.
let fetchFailures
let fetchRejections

beforeEach(() => {
  store = new Map()
  fetchCalls = []
  fetchFailures = new Set()
  fetchRejections = new Set()
  globalThis.caches = {
    open: async () => ({
      match: async (url) => store.get(String(url)),
      put: async (url, response) => void store.set(String(url), response),
    }),
  }
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url))
    if (fetchRejections.has(String(url))) throw new TypeError('network error')
    if (!fetchFailures.has(String(url))) store.set(String(url), new Response('bytes'))
    return new Response('bytes', { status: 200 })
  }
})

afterEach(() => {
  delete globalThis.caches
  delete globalThis.fetch
})

test('collectRoutineImageUrls: dedup, ignora vazios/ausentes, thumbnail primeiro', () => {
  const exercises = [
    { images: [START, END], thumbnail: THUMB },
    { images: [START], thumbnail: null }, // duplicado -- não conta de novo
    { images: [], thumbnail: '' }, // thumbnail vazio não entra
    { images: [OTHER_START] },
    null,
    {},
  ]
  assert.deepEqual(collectRoutineImageUrls(exercises), [THUMB, START, END, OTHER_START])
  assert.deepEqual(collectRoutineImageUrls([]), [])
  assert.deepEqual(collectRoutineImageUrls(undefined), [])
})

test('prepareRoutineImages: baixa tudo, confirma via Cache Storage e reporta progresso', async () => {
  const progress = []
  const result = await prepareRoutineImages([{ images: [START, END], thumbnail: THUMB }], {
    concurrency: 2,
    onProgress: (p) => progress.push(p),
  })
  assert.deepEqual(result, { done: 3, failed: 0, total: 3 })
  assert.equal(progress.length, 3)
  assert.deepEqual(progress[progress.length - 1], { done: 3, failed: 0, total: 3 })
  assert.equal(fetchCalls.length, 3)
})

test('prepareRoutineImages: imagem já em cache não refaz fetch (conta como sucesso de qualquer forma)', async () => {
  store.set(START, new Response('já estava aqui'))
  const result = await prepareRoutineImages([{ images: [START], thumbnail: null }])
  assert.deepEqual(result, { done: 1, failed: 0, total: 1 })
  assert.equal(fetchCalls.length, 0, 'não refaz download do que já está confirmado no cache')
})

test('prepareRoutineImages: fetch "ok" mas o Service Worker não grava (CORS/MIME/quota) conta como falha', async () => {
  fetchFailures.add(START)
  const result = await prepareRoutineImages([{ images: [START], thumbnail: null }])
  assert.deepEqual(result, { done: 0, failed: 1, total: 1 })
})

test('prepareRoutineImages: erro de rede numa imagem não aborta as demais', async () => {
  fetchRejections.add(START)
  const result = await prepareRoutineImages([{ images: [START, END], thumbnail: null }])
  assert.equal(result.total, 2)
  assert.equal(result.failed, 1)
  assert.equal(result.done, 1)
})

test('prepareRoutineImages: cancelamento (AbortController) para sem lançar e sem terminar tudo', async () => {
  const controller = new AbortController()
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url))
    controller.abort() // cancela assim que a primeira começa
    store.set(String(url), new Response('bytes'))
    return new Response('bytes', { status: 200 })
  }
  const result = await prepareRoutineImages([{ images: [START, END, THUMB], thumbnail: null }], {
    concurrency: 1,
    signal: controller.signal,
  })
  assert.ok(result.done + result.failed < result.total, 'parou antes de processar tudo')
})

test('prepareRoutineImages: sem Cache Storage no navegador, degrada sem tentar nada', async () => {
  delete globalThis.caches
  const result = await prepareRoutineImages([{ images: [START], thumbnail: null }])
  assert.deepEqual(result, { done: 0, failed: 0, total: 1 })
  assert.equal(fetchCalls.length, 0)
})

test('prepareRoutineImages: lista vazia não chama fetch nem abre o cache', async () => {
  let opened = false
  globalThis.caches.open = async () => {
    opened = true
    return { match: async () => undefined, put: async () => {} }
  }
  const result = await prepareRoutineImages([])
  assert.deepEqual(result, { done: 0, failed: 0, total: 0 })
  assert.equal(opened, false)
})

test('prepareRoutineImages: grava o manifesto de paths protegidos (pathnames, não URLs completas)', async () => {
  await prepareRoutineImages([{ images: [START, END], thumbnail: THUMB }])
  const manifestResponse = store.get('/__exercise-image-manifest__')
  assert.ok(manifestResponse, 'manifesto foi gravado no mesmo cache')
  const manifest = await manifestResponse.json()
  assert.deepEqual(manifest.paths.sort(), [
    '/storage/v1/object/public/exercise-visuals/c1/v1/end.webp',
    '/storage/v1/object/public/exercise-visuals/c1/v1/start.webp',
    '/storage/v1/object/public/exercise-visuals/c1/v1/thumb.webp',
  ])
  assert.equal(typeof manifest.updatedAt, 'number')
})

test('countAvailableRoutineImages: conta só o que está REALMENTE em cache agora, nunca um flag lembrado', async () => {
  store.set(START, new Response('bytes'))
  const result = await countAvailableRoutineImages([{ images: [START, END], thumbnail: THUMB }])
  assert.deepEqual(result, { available: 1, total: 3 })
})

test('countAvailableRoutineImages: sem imagens publicadas (total 0) nunca finge disponibilidade', async () => {
  assert.deepEqual(await countAvailableRoutineImages([{ images: [], thumbnail: null }]), {
    available: 0,
    total: 0,
  })
})
