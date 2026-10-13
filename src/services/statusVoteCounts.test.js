import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import {
  applyEconomyVoteCountDelta,
  economyVoteCountDelta,
} from '../utils/economyVoteCountDelta.js'

// Regressão: os totais de Curtir/Não curtir voltavam a 0 ao atualizar a página. cast_vote grava os totais
// em statuses.positive_vote_count/negative_vote_count, mas mapStatusRow não os lia -- o card só mostrava
// o delta local da sessão. Agora todo status carregado do banco traz os totais persistidos.
let directory
async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'status-vote-counts-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `export { mapStatusRow } from './statusesService.js'`,
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
            namespace: 'fake',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
            contents: 'export const supabase = {}',
          }))
        },
      },
    ],
  })
  return createRequire(import.meta.url)(outfile)
}

const { mapStatusRow } = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const row = (extra) => ({
  id: 's1',
  community_id: 'c1',
  author_id: 'a1',
  author_username: 'ana',
  author_is_superadmin: false,
  type: 'text',
  text: 'oi',
  created_at: '2026-10-02T10:00:00Z',
  expires_at: '2026-10-04T10:00:00Z',
  promoted: false,
  promoted_until: null,
  active_promotion_id: null,
  ...extra,
})

test('persisted totals survive a reload: positive_vote_count/negative_vote_count are mapped (the "volta a zero" bug)', () => {
  const status = mapStatusRow(row({ positive_vote_count: 5, negative_vote_count: 2 }))
  assert.equal(status.positiveVoteCount, 5)
  assert.equal(status.negativeVoteCount, 2)
})

test('totals are mapped for every status type that shows reactions', () => {
  const extras = {
    text: {},
    achievement: {
      type: 'achievement',
      text: null,
      achievement_day: '2026-10-02',
      achievement_text: 'x',
      achievement_entries: 1,
      achievement_sets: 3,
    },
    photo: { type: 'photo', text: null, photo_path: 'p.webp', photo_caption: 'c' },
  }
  for (const [type, extra] of Object.entries(extras)) {
    const status = mapStatusRow(row({ ...extra, positive_vote_count: 3, negative_vote_count: 1 }))
    assert.equal(status.type, type)
    assert.equal(status.positiveVoteCount, 3, type)
    assert.equal(status.negativeVoteCount, 1, type)
  }
})

test('missing or null totals become 0, never undefined/NaN', () => {
  for (const extra of [{}, { positive_vote_count: null, negative_vote_count: null }]) {
    const status = mapStatusRow(row(extra))
    assert.equal(status.positiveVoteCount, 0)
    assert.equal(status.negativeVoteCount, 0)
  }
})

test('like / unlike / dislike / undo: local delta on top of the persisted totals matches what the backend stores', () => {
  const persisted = mapStatusRow(row({ positive_vote_count: 4, negative_vote_count: 1 }))
  // curtir (sem voto -> 👍)
  let status = applyEconomyVoteCountDelta(persisted, economyVoteCountDelta(null, 1))
  assert.deepEqual([status.positiveVoteCount, status.negativeVoteCount], [5, 1])
  // recarregar a página: o banco devolve 5/1 e o card mostra exatamente isso
  const reloaded = mapStatusRow(row({ positive_vote_count: 5, negative_vote_count: 1 }))
  assert.deepEqual([reloaded.positiveVoteCount, reloaded.negativeVoteCount], [5, 1])
  // trocar 👍 -> 👎
  status = applyEconomyVoteCountDelta(reloaded, economyVoteCountDelta(1, -1))
  assert.deepEqual([status.positiveVoteCount, status.negativeVoteCount], [4, 2])
  // remover o 👎
  status = applyEconomyVoteCountDelta(status, economyVoteCountDelta(-1, null))
  assert.deepEqual([status.positiveVoteCount, status.negativeVoteCount], [4, 1])
})

test('promoção verificada pelo servidor prevalece sobre flags canceladas ou inválidas', () => {
  const status = mapStatusRow(row({
    promoted: true,
    promoted_until: '2099-01-01T00:00:00Z',
    verified_promoted_until: null,
    interaction_expires_at: '2026-10-04T10:00:00Z',
  }))
  assert.equal(status.promoted, false)
  assert.equal(status.promotedUntil, null)
  assert.equal(status.commentsCloseAt, '2026-10-04T10:00:00Z')
})

test('promoção válida preserva exibição mesmo com flags antigas e expiração normal passada', () => {
  const status = mapStatusRow(row({
    promoted: false,
    verified_promoted_until: '2026-10-16T00:00:00Z',
    interaction_expires_at: '2026-10-16T00:00:00Z',
  }))
  assert.equal(status.promoted, true)
  assert.equal(status.promotedUntil, '2026-10-16T00:00:00Z')
  assert.equal(status.commentsCloseAt, status.promotedUntil)
})
