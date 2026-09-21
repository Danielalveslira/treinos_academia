import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let exercise

// REACT-1: add/edit/toggleActive/remove precisam invalidar a mesma chave
// `communities:{uid}` que useCommunities.js lê, senão um superadmin que também navega em
// /comunidades vê dado desatualizado por até 5min depois de mexer no painel admin (mesma
// classe de bug que o commit 79b2854 corrigiu para entrar/sair de comunidade). utils/pageCache.js
// NÃO é mockado aqui -- é o módulo real, igual ao padrão de communityMembersService.test.js.
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'admin-communities-tests-'))
  const outfile = join(directory, 'admin-communities.cjs')
  await build({
    stdin: {
      contents: `
        import { useAdminCommunities } from './useAdminCommunities.js'
        import { getCached, setCached } from '../utils/pageCache'

        export async function exercise(action) {
          setCached('communities:admin-uid', { communities: ['stale'] })
          const hook = useAdminCommunities()
          await action(hook)
          return getCached('communities:admin-uid')
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'admin-communities-test-stubs',
        setup(buildContext) {
          buildContext.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }))
          buildContext.onResolve({ filter: /services\/communitiesService$/ }, () => ({
            path: 'communities-service',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /services\/communityMembersService$/ }, () => ({
            path: 'members-service',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /utils\/firestoreError$/ }, () => ({
            path: 'firestore-error',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /\.\/useAuth$/ }, () => ({ path: 'use-auth', namespace: 'stub' }))
          buildContext.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
            contents: `
              export const useCallback = (fn) => fn
              export const useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}]
              export const useEffect = () => {}
            `,
          }))
          buildContext.onLoad({ filter: /^use-auth$/, namespace: 'stub' }, () => ({
            contents: `export const useAuth = () => ({ user: { uid: 'admin-uid' } })`,
          }))
          buildContext.onLoad({ filter: /^communities-service$/, namespace: 'stub' }, () => ({
            contents: `
              export const listCommunitiesPage = async () => ({ items: [], nextCursor: null })
              export const createCommunity = async () => {}
              export const updateCommunity = async () => {}
              export const setCommunityActive = async () => {}
              export const setMemberCount = async () => {}
              export const deleteCommunity = async () => {}
            `,
          }))
          buildContext.onLoad({ filter: /^members-service$/, namespace: 'stub' }, () => ({
            contents: `export const countMembers = async () => 0`,
          }))
          buildContext.onLoad({ filter: /^firestore-error$/, namespace: 'stub' }, () => ({
            contents: `export const describeFirestoreError = () => 'erro'`,
          }))
        },
      },
    ],
  })
  ;({ exercise } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('add invalidates the admin communities cache', async () => {
  const cache = await exercise((hook) => hook.add({ name: 'Nova' }))
  assert.equal(cache, undefined)
})

test('edit invalidates the admin communities cache', async () => {
  const cache = await exercise((hook) => hook.edit('c1', { name: 'Editada' }))
  assert.equal(cache, undefined)
})

test('toggleActive invalidates the admin communities cache', async () => {
  const cache = await exercise((hook) => hook.toggleActive('c1', false))
  assert.equal(cache, undefined)
})

test('remove invalidates the admin communities cache', async () => {
  const cache = await exercise((hook) => hook.remove('c1'))
  assert.equal(cache, undefined)
})
