import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Mesmo padrão de cashPurchaseService.test.js/economyService.test.js: bundleia
// privilegeService.js de verdade com esbuild, substituindo firebase/firestore e
// firebase/functions por fixtures em memória.
async function service({ configDoc = null, callableResults = {} } = {}) {
  const { outputFiles } = await build({
    entryPoints: ['src/services/privilegeService.js'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'firebase-fixture',
        setup(pluginBuild) {
          pluginBuild.onResolve(
            { filter: /firebase\/firestore|firebase\/functions|firebase\/config$/ },
            (args) => ({ path: args.path, namespace: 'fixture' })
          )
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
            if (path.endsWith('config')) {
              return { contents: 'export const db = {}\nexport const functions = {}' }
            }
            if (path.endsWith('functions')) {
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
            }
            return {
              contents: `
                const CONFIG = ${JSON.stringify(configDoc)}
                export const doc = (...args) => args
                export const getDoc = async (ref) => {
                  const exists = ref[1] === 'economyConfig/current' && CONFIG != null
                  return { exists: () => exists, data: () => CONFIG }
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

const PRIVILEGE_CONFIG = {
  version: 1,
  privileges: {
    createCommunity: {
      minimumLifetimeCoins: 200,
      minimumAccountAgeDays: 7,
      requireEmailVerified: true,
      cashCost: 50,
    },
  },
}

test('getCreateCommunityPrivilege reads privileges.createCommunity from economyConfig/current', async () => {
  const { api } = await service({ configDoc: PRIVILEGE_CONFIG })
  const privilege = await api.getCreateCommunityPrivilege()
  assert.deepEqual(privilege, PRIVILEGE_CONFIG.privileges.createCommunity)
})

test('getCreateCommunityPrivilege returns null when the config document is missing, never a hardcoded default', async () => {
  const { api } = await service({ configDoc: null })
  assert.equal(await api.getCreateCommunityPrivilege(), null)
})

test('createCommunityWithCash calls the callable with exactly name/description/iconName/requestId', async () => {
  const { api, callableCalls } = await service({
    callableResults: { createCommunityWithCash: { communityId: 'c1', alreadyExisted: false } },
  })
  const result = await api.createCommunityWithCash({
    name: 'Corrida de Rua',
    description: 'Para quem ama correr',
    iconName: 'flame',
    requestId: 'req-1',
  })
  assert.deepEqual(result, { communityId: 'c1', alreadyExisted: false })
  assert.deepEqual(callableCalls('createCommunityWithCash')[0].args, {
    name: 'Corrida de Rua',
    description: 'Para quem ama correr',
    iconName: 'flame',
    requestId: 'req-1',
  })
})

test('createCommunityWithCash forwards the exact same requestId on a retry (idempotency reaches the callable)', async () => {
  const { api, callableCalls } = await service({
    callableResults: { createCommunityWithCash: { communityId: 'c1', alreadyExisted: true } },
  })
  const values = { name: 'Corrida de Rua', description: '', iconName: 'flame', requestId: 'same-request-id' }
  await api.createCommunityWithCash(values)
  await api.createCommunityWithCash(values)
  const calls = callableCalls('createCommunityWithCash')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].args.requestId, 'same-request-id')
  assert.equal(calls[1].args.requestId, 'same-request-id')
})
