import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Mesmo padrão de cashPurchaseService.test.js: bundleia pixPaymentAdminService.js de
// verdade com esbuild, substituindo firebase/functions e firebase/config por fixtures em
// memória -- exercita o service real (quais argumentos chegam em cada callable) sem
// precisar de um app Firebase nem do emulador. Esta service só embrulha callables (nunca
// lê Firestore direto -- privatePaymentConfig/pix é server-only), então não precisa da
// fixture de firestore que cashPurchaseService.test.js usa.
async function service({ callableResults = {} } = {}) {
  const { outputFiles } = await build({
    entryPoints: ['src/services/pixPaymentAdminService.js'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'firebase-fixture',
        setup(pluginBuild) {
          pluginBuild.onResolve(
            { filter: /firebase\/functions|firebase\/config$/ },
            (args) => ({ path: args.path, namespace: 'fixture' })
          )
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
            if (path.endsWith('config')) {
              return { contents: 'export const functions = {}' }
            }
            return {
              contents: `
                const RESULTS = ${JSON.stringify(callableResults)}
                export const httpsCallable = (app, name) => async (args) => {
                  globalThis.__callableCalls = globalThis.__callableCalls || []
                  globalThis.__callableCalls.push({ name, args })
                  return { data: RESULTS[name] ?? null }
                }
              `,
            }
          })
        },
      },
    ],
  })
  globalThis.__callableCalls = []
  const api = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
  )
  return {
    api,
    callableCalls: (name) => globalThis.__callableCalls.filter((call) => call.name === name),
  }
}

test('listPixPaymentMethods calls the callable with no arguments and returns its data', async () => {
  const result = { enabled: true, activeMethodId: 'pix_a', methods: [{ id: 'pix_a' }] }
  const { api, callableCalls } = await service({ callableResults: { listPixPaymentMethods: result } })
  const returned = await api.listPixPaymentMethods()
  assert.deepEqual(returned, result)
  assert.deepEqual(callableCalls('listPixPaymentMethods')[0].args, undefined)
})

test('savePixPaymentMethod forwards exactly methodId/label/key/keyType/recipientName, defaulting methodId to null when creating', async () => {
  const { api, callableCalls } = await service({ callableResults: { savePixPaymentMethod: { id: 'pix_new' } } })
  await api.savePixPaymentMethod({ label: 'Conta principal', key: 'x@evolutus.app', keyType: 'email', recipientName: 'Evolutus' })
  assert.deepEqual(callableCalls('savePixPaymentMethod')[0].args, {
    methodId: null,
    label: 'Conta principal',
    key: 'x@evolutus.app',
    keyType: 'email',
    recipientName: 'Evolutus',
  })
})

test('savePixPaymentMethod forwards an explicit methodId when editing', async () => {
  const { api, callableCalls } = await service({ callableResults: { savePixPaymentMethod: { id: 'pix_a' } } })
  await api.savePixPaymentMethod({
    methodId: 'pix_a',
    label: 'Editada',
    key: 'y@evolutus.app',
    keyType: 'email',
    recipientName: 'Evolutus',
  })
  assert.equal(callableCalls('savePixPaymentMethod')[0].args.methodId, 'pix_a')
})

test('setActivePixPaymentMethod sends exactly the given methodId', async () => {
  const { api, callableCalls } = await service({ callableResults: { setActivePixPaymentMethod: { activeMethodId: 'pix_b' } } })
  await api.setActivePixPaymentMethod('pix_b')
  assert.deepEqual(callableCalls('setActivePixPaymentMethod')[0].args, { methodId: 'pix_b' })
})

test('deletePixPaymentMethod sends exactly the given methodId', async () => {
  const { api, callableCalls } = await service({ callableResults: { deletePixPaymentMethod: { deleted: true } } })
  await api.deletePixPaymentMethod('pix_b')
  assert.deepEqual(callableCalls('deletePixPaymentMethod')[0].args, { methodId: 'pix_b' })
})

test('setPixPaymentsEnabled sends exactly the given boolean', async () => {
  const { api, callableCalls } = await service({ callableResults: { setPixPaymentsEnabled: { enabled: false } } })
  await api.setPixPaymentsEnabled(false)
  assert.deepEqual(callableCalls('setPixPaymentsEnabled')[0].args, { enabled: false })
})
