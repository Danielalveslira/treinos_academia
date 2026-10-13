import { before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { CATALOG, SET, USER, loadHandler, post, resetFake } from '../_shared/edgeTestKit.js'
import { deletionFiles, objectMissing } from './worker.js'
let handler, fake, job
before(async () => {
  handler = await loadHandler(new URL('./index.ts', import.meta.url))
})
beforeEach(() => {
  job = {
    visual_set_id: SET,
    catalog_id: CATALOG,
    version: 3,
    lease_token: 'lease',
    status: 'pending',
  }
  job.files = ['exercise-visual-drafts', 'exercise-visuals'].flatMap((bucket) =>
    ['start.webp', 'end.webp', 'thumb.webp'].map((file) => ({
      bucket,
      path: `${CATALOG}/${bucket === 'exercise-visuals' ? 'v3' : SET}/${file}`,
    }))
  )
  fake = resetFake()
  fake.tables.exercise_visual_deletions = [job]
  for (const file of job.files) fake.buckets[file.bucket].set(file.path, new Uint8Array([1]))
  fake.rpcResult = (name, args) => {
    if (name === 'claim_exercise_visual_deletions') {
      if (job.status === 'complete') return { data: [], error: null }
      job.status = 'processing'
      return { data: [job], error: null }
    }
    if (name === 'finish_exercise_visual_deletion') {
      job.status = args.p_error ? 'pending' : 'complete'
      return { data: true, error: null }
    }
    return { data: null, error: null }
  }
})
async function call(body = { visualSetId: SET }, opts) {
  const response = await handler(post(body, opts))
  return { status: response.status, body: await response.json() }
}

test('somente superadmin pode processar; método, UUID e versão inexistente são recusados', async () => {
  assert.equal((await call(undefined, { auth: null })).status, 401)
  fake.authUser = { id: USER }
  assert.equal((await call()).status, 403)
  assert.equal(fake.removed.length, 0)
  fake.authUser = { id: '11111111-1111-4111-8111-111111111111' }
  assert.equal((await call({ visualSetId: '../../evil' })).status, 400)
  assert.equal((await call({ visualSetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })).status, 404)
  assert.equal((await handler(new Request('https://fn.test', { method: 'GET' }))).status, 405)
})
test('remove os seis paths previstos e só conclui após comprovar ausência; repetição é idempotente', async () => {
  const response = await call()
  assert.deepEqual(response, {
    status: 200,
    body: { visualSetId: SET, status: 'complete', complete: true },
  })
  assert.equal(fake.removed.length, 2)
  assert.equal(fake.downloads.length, 6)
  assert.equal(
    fake.buckets['exercise-visuals'].size + fake.buckets['exercise-visual-drafts'].size,
    0
  )
  assert.equal((await call()).body.complete, true)
  assert.equal(fake.removed.length, 2)
})
test('Storage indisponível deixa pendente; retry termina e nunca remove outro arquivo', async () => {
  const unrelated = `${CATALOG}/v99/start.webp`
  fake.buckets['exercise-visuals'].set(unrelated, new Uint8Array([2]))
  fake.fail.remove = true
  assert.equal((await call()).body.complete, false)
  assert.equal(job.status, 'pending')
  fake.fail.remove = false
  assert.equal((await call()).body.complete, true)
  assert.equal(fake.buckets['exercise-visuals'].has(unrelated), true)
})
test('paths forjados não atingem o Storage e retornam falha recuperável', async () => {
  job.files[0].path = '../someone.webp'
  assert.equal(deletionFiles(job), null)
  assert.equal((await call()).body.complete, false)
  assert.equal(fake.removed.length, 0)
  assert.equal(fake.rpcCalls.at(-1)[1].p_error, 'INVALID_REFERENCE')
})
test('erro genérico 404 não comprova remoção física; bytes ainda presentes também impedem sucesso', async () => {
  assert.equal(objectMissing({ status: 404, message: 'route missing' }), false)
  const original = fake.client
  fake.client = (key) => {
    const client = original(key)
    if (key === 'service-key') {
      const from = client.storage.from
      client.storage.from = (bucket) => ({
        ...from(bucket),
        download: async () => ({ data: null, error: { status: 404, message: 'route missing' } }),
      })
    }
    return client
  }
  assert.equal((await call()).body.complete, false)
})
test('perda de confirmação no banco não declara sucesso; nova execução permanece recuperável', async () => {
  const original = fake.rpcResult
  fake.rpcResult = (name, args) =>
    name === 'finish_exercise_visual_deletion' ? { data: false, error: null } : original(name, args)
  assert.equal((await call()).body.complete, false)
  fake.rpcResult = original
  assert.equal((await call()).body.complete, true)
})
