import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Remover, Banir e Desbanir são operações DISTINTAS e todas passam por RPC (a autorização é do
// servidor; o cliente nunca faz DELETE direto em community_members). O Supabase aqui é um fake que
// grava a chamada; o comportamento real está em supabase/tests/community_member_removal_test.sql.
let directory
let service

async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'community-moderation-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `export { removeCommunityMember, setCommunityMemberBan } from './communityModerationService.js'`,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'fake-supabase',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /\/supabase\/config(\.js)?$/ }, (args) => ({
            path: args.path,
            namespace: 'fake-supabase',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fake-supabase' }, () => ({
            contents: `export const supabase = {
              rpc: (name, args) => { globalThis.__rpcCalls.push({ name, args }); return Promise.resolve(globalThis.__rpcResponse) },
              from: () => { throw new Error('nenhuma escrita direta em tabela é permitida') },
            }`,
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
  globalThis.__rpcResponse = { data: null, error: null }
  service ??= await bundle()
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('Remover chama remove_community_member, sem banir e sem tocar em tabela', async () => {
  await service.removeCommunityMember({ communityId: 'c1', targetUserId: 'u1' })
  assert.deepEqual(globalThis.__rpcCalls, [
    { name: 'remove_community_member', args: { p_community_id: 'c1', p_target_user_id: 'u1' } },
  ])
})

test('Banir e Desbanir usam set_community_member_ban com banned true/false', async () => {
  await service.setCommunityMemberBan({
    communityId: 'c1',
    targetUserId: 'u1',
    banned: true,
    reason: 'motivo válido',
  })
  await service.setCommunityMemberBan({ communityId: 'c1', targetUserId: 'u1', banned: false })
  assert.equal(globalThis.__rpcCalls[0].name, 'set_community_member_ban')
  assert.equal(globalThis.__rpcCalls[0].args.p_banned, true)
  assert.equal(globalThis.__rpcCalls[1].args.p_banned, false)
})

test('erro do servidor (ator sem permissão, dono protegido) propaga: nada é assumido como feito', async () => {
  const failure = new Error('PERMISSION_DENIED')
  globalThis.__rpcResponse = { data: null, error: failure }
  await assert.rejects(
    service.removeCommunityMember({ communityId: 'c1', targetUserId: 'u1' }),
    failure
  )
  await assert.rejects(
    service.setCommunityMemberBan({
      communityId: 'c1',
      targetUserId: 'u1',
      banned: true,
      reason: 'motivo válido',
    }),
    failure
  )
})
