import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const script = readFileSync(new URL('../../public/recovery-token-boot.js', import.meta.url), 'utf8')

test('recovery: o token antigo na query sai da URL antes do app iniciar', () => {
  const replaces = []
  const window = {
    location: { pathname: '/redefinir-senha', search: '?token_hash=secret&type=recovery', hash: '' },
    history: { state: null, replaceState: (...args) => replaces.push(args) },
  }
  runInNewContext(script, { window, URLSearchParams })
  assert.equal(window.__EVOLUTUS_RECOVERY_TOKEN.tokenHash, 'secret')
  assert.equal(window.__EVOLUTUS_RECOVERY_TOKEN.type, 'recovery')
  assert.deepEqual(replaces, [[null, '', '/redefinir-senha']])
})

test('recovery: o template novo usa fragmento e o token não entra na requisição HTTP', () => {
  const template = readFileSync(new URL('../../supabase/templates/recovery.html', import.meta.url), 'utf8')
  assert.match(template, /\/redefinir-senha#token_hash=/)
  assert.doesNotMatch(template, /\/redefinir-senha\?token_hash=/)
})
