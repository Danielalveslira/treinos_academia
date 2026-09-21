import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Mesmo padrão de promotionsService.test.js: bundleia o service de verdade com esbuild,
// só firebase/firestore e firebase/config viram fixtures em memória -- utils/pageCache.js
// NÃO é mockado, é o módulo real, pra provar que joinCommunity/leaveCommunity realmente
// invalidam a mesma chave (communities:{uid}) que useCommunities.js/CommunityDetail.jsx
// leem, e nenhuma outra.
async function harness() {
  const { outputFiles } = await build({
    stdin: {
      contents: `
        export * as members from './services/communityMembersService.js'
        export * from './utils/pageCache.js'
      `,
      resolveDir: 'src',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'firebase-fixture',
        setup(pluginBuild) {
          pluginBuild.onResolve(
            { filter: /firebase\/firestore|firebase\/config$/ },
            (args) => ({ path: args.path, namespace: 'fixture' })
          )
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
            if (path.endsWith('config')) return { contents: 'export const db = {}' }
            return {
              contents: `
                export const doc = (...args) => args
                export const setDoc = async () => {}
                export const deleteDoc = async () => {}
                export const serverTimestamp = () => 'SERVER_TIMESTAMP'
                export const collection = (_db, name) => ({ name })
                export const query = (base, ...clauses) => ({ name: base.name, clauses })
                export const where = () => ({ type: 'where' })
                export const orderBy = () => ({ type: 'orderBy' })
                export const limit = () => ({ type: 'limit' })
                export const getDocs = async () => ({ docs: [] })
                export const getDoc = async () => ({ exists: () => false, data: () => undefined })
                export const getCountFromServer = async () => ({ data: () => ({ count: 0 }) })
              `,
            }
          })
        },
      },
    ],
  })
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
}

test('joinCommunity invalidates only the joining user\'s communities cache', async () => {
  const { members, setCached, getCached } = await harness()
  setCached('communities:alice', { communities: ['stale'] })
  setCached('communities:bob', { communities: ['untouched'] })
  await members.joinCommunity('c1', 'alice')
  assert.equal(getCached('communities:alice'), undefined)
  assert.deepEqual(getCached('communities:bob'), { communities: ['untouched'] })
})

test('leaveCommunity invalidates only the leaving user\'s communities cache', async () => {
  const { members, setCached, getCached } = await harness()
  setCached('communities:alice', { communities: ['stale'] })
  setCached('communities:bob', { communities: ['untouched'] })
  await members.leaveCommunity('c1', 'alice')
  assert.equal(getCached('communities:alice'), undefined)
  assert.deepEqual(getCached('communities:bob'), { communities: ['untouched'] })
})
