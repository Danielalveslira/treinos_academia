import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Privacidade de "Não apoiar": a identidade de quem não apoiou não pode ser pedida por nenhuma
// parte do frontend (e a RPC que permitia isso foi removida no banco -- ver a migration
// 20261006000001 e post_support_reactions_test.sql). Estes testes protegem o código contra a
// reintrodução acidental de uma listagem de não apoiadores.
const SRC = new URL('..', import.meta.url).pathname

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(js|jsx)$/.test(name) && !/\.test\.js$/.test(name) ? [path] : []
  })
}

test('no frontend source calls the removed list_post_economy_voters RPC or its old wrappers', () => {
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /list_post_economy_voters|listPostEconomyVoters/, file)
  }
})

test('the only voters-listing RPC the frontend calls is list_post_supporters, and it takes no direction', () => {
  const calls = []
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/rpc\('(list_post_[a-z_]+)'/g)) calls.push(match[1])
  }
  assert.deepEqual([...new Set(calls)], ['list_post_supporters'])
  const service = readFileSync(join(SRC, 'services/economyService.js'), 'utf8')
  assert.doesNotMatch(service, /p_direction/)
})

test('no component offers a list of people who did not support (no "negativos" tab, no negative voters dialog)', () => {
  for (const file of sourceFiles(join(SRC, 'components'))) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(
      text,
      /Negativos \(|votersByDirection|initialDirection|'negative'\s*\)/,
      file
    )
  }
})
