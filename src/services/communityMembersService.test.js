import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// O estado de acesso à comunidade vem do servidor (RPC get_community_access); o cliente só o
// repassa e, diante de qualquer resposta desconhecida, nega. O Supabase aqui é um fake que grava
// a chamada; a regra real (RLS + RPC) é coberta por supabase/tests/community_member_removal_test.sql.
let directory
let service

async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'community-members-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `export { getCommunityAccess, joinCommunity, listMyCommunityAccess } from './communityMembersService.js'`,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'fakes',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/supabase\/config(\.js)?$/ }, (args) => ({
            path: args.path,
            namespace: 'fake-supabase',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fake-supabase' }, () => ({
            contents: `export const supabase = { rpc: (name, args) => { globalThis.__rpcCalls.push({ name, args }); return Promise.resolve(globalThis.__rpcResponse) } }`,
            loader: 'js',
          }))
          pluginBuild.onResolve({ filter: /\/utils\/pageCache(\.js)?$/ }, (args) => ({
            path: args.path,
            namespace: 'fake-cache',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fake-cache' }, () => ({
            contents:
              'export const invalidateCommunitiesCache = (uid) => { globalThis.__invalidated.push(uid) }',
            loader: 'js',
          }))
        },
      },
    ],
  })
  return createRequire(import.meta.url)(outfile)
}

beforeEach(async () => {
  globalThis.__rpcCalls = []
  globalThis.__invalidated = []
  globalThis.__rpcResponse = { data: 'member', error: null }
  service ??= await bundle()
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('getCommunityAccess pergunta ao servidor e devolve o estado conhecido', async () => {
  for (const state of ['member', 'not_member', 'banned', 'unavailable']) {
    globalThis.__rpcResponse = { data: state, error: null }
    assert.equal(await service.getCommunityAccess('c1'), state)
  }
  assert.deepEqual(globalThis.__rpcCalls[0], {
    name: 'get_community_access',
    args: { p_community_id: 'c1' },
  })
})

test('getCommunityAccess nega (unavailable) diante de resposta desconhecida', async () => {
  for (const data of [null, undefined, '', 'owner', true, 'MEMBER']) {
    globalThis.__rpcResponse = { data, error: null }
    assert.equal(await service.getCommunityAccess('c1'), 'unavailable')
  }
})

test('getCommunityAccess propaga o erro do servidor em vez de assumir acesso', async () => {
  const failure = new Error('boom')
  globalThis.__rpcResponse = { data: null, error: failure }
  await assert.rejects(service.getCommunityAccess('c1'), failure)
})

test('joinCommunity devolve o estado do servidor; banido e indisponível NÃO são exceção', async () => {
  for (const state of ['joined', 'already_member', 'banned', 'unavailable']) {
    globalThis.__rpcResponse = { data: state, error: null }
    assert.equal(await service.joinCommunity('c1', 'u1'), state)
  }
  assert.deepEqual(globalThis.__rpcCalls[0], {
    name: 'join_community',
    args: { p_community_id: 'c1' },
  })
  // qualquer resultado definitivo invalida a lista da conta, para a próxima leitura refletir o servidor
  assert.equal(globalThis.__invalidated.length, 4)
})

test('joinCommunity propaga falhas reais (rede/inesperado) e rejeita resposta desconhecida', async () => {
  const network = { message: 'TypeError: Failed to fetch', code: '' }
  globalThis.__rpcResponse = { data: null, error: network }
  await assert.rejects(service.joinCommunity('c1', 'u1'), (thrown) => thrown === network)
  globalThis.__rpcResponse = { data: 'banido-talvez', error: null }
  await assert.rejects(service.joinCommunity('c1', 'u1'), /resposta desconhecida/)
  assert.equal(globalThis.__invalidated.length, 0)
})

test('listMyCommunityAccess: UMA chamada devolve o estado de todas as comunidades (sem N+1)', async () => {
  const rows = []
  for (let i = 0; i < 60; i += 1)
    rows.push({ community_id: `c${i}`, access: i % 10 === 0 ? 'banned' : 'member' })
  rows.push({ community_id: 'x', access: 'qualquer-coisa' })
  globalThis.__rpcResponse = { data: rows, error: null }
  const map = await service.listMyCommunityAccess()
  assert.equal(globalThis.__rpcCalls.length, 1)
  assert.deepEqual(globalThis.__rpcCalls[0], { name: 'list_my_community_access', args: undefined })
  assert.equal(Object.keys(map).length, 60)
  assert.equal(map.c0, 'banned')
  assert.equal(map.c1, 'member')
  assert.equal(map.x, undefined)
})
