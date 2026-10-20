import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let service

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'economy-guide-read-'))
  const outfile = join(directory, 'service.cjs')
  await build({
    entryPoints: [new URL('./economyService.js', import.meta.url).pathname],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'supabase-read-stub',
        setup(ctx) {
          ctx.onResolve({ filter: /supabase\/config$/ }, () => ({
            path: 'supabase',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /^supabase$/, namespace: 'stub' }, () => ({
            contents: `
            globalThis.__economyGuideReadCalls = []
            export const supabase = {
              from(table) {
                globalThis.__economyGuideReadCalls.push(['from', table])
                return {
                  select(columns) { globalThis.__economyGuideReadCalls.push(['select', columns]); return this },
                  eq(column, value) { globalThis.__economyGuideReadCalls.push(['eq', column, value]); return this },
                  order(column, options) { globalThis.__economyGuideReadCalls.push(['order', column, options]); return this },
                  limit(value) { globalThis.__economyGuideReadCalls.push(['limit', value]); return Promise.resolve({ data: [] }) },
                }
              },
            }
          `,
          }))
        },
      },
    ],
  })
  service = require(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('extrato consulta somente lançamentos próprios e não chama operações de escrita', async () => {
  assert.deepEqual(await service.listMyEconomyTransactions('my-user'), [])
  assert.deepEqual(globalThis.__economyGuideReadCalls, [
    ['from', 'economy_transactions'],
    ['select', 'id,asset,direction,amount,reason,created_at'],
    ['eq', 'user_id', 'my-user'],
    ['order', 'created_at', { ascending: false }],
    ['limit', 12],
  ])
})
