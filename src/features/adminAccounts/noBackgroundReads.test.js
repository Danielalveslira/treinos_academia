import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Guarda do critério "nenhum polling / realtime / refetch automático" da tela de Contas:
// varre o código da feature e da página procurando as APIs que criariam leitura em segundo plano.
const root = new URL('.', import.meta.url).pathname
const page = new URL('../../pages/AdminAccounts.jsx', import.meta.url).pathname

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(jsx?|mjs)$/.test(name) && !/\.test\.js$/.test(name) ? [path] : []
  })
}

// Comentários podem citar os termos proibidos (ex.: "nada aqui usa service_role").
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const FORBIDDEN = [
  [/\b(localStorage|sessionStorage|indexedDB)\b/, 'persistent administrative data'],
  [/setInterval\s*\(/, 'setInterval'],
  [/\.channel\s*\(/, 'supabase realtime (.channel)'],
  [/\.subscribe\s*\(\s*\)?\s*$/m, 'subscription de realtime'],
  [/postgres_changes/, 'postgres_changes'],
  [/visibilitychange/, 'refetch ao trocar de aba'],
  [/addEventListener\(\s*['"](focus|online)['"]/, 'refetch ao focar/reconectar'],
  [/service_role/i, 'service_role no browser'],
  [/\.from\s*\(\s*['"]/, 'leitura direta de tabela'],
  [/auth\.users/, 'auth.users no browser'],
]

test('a tela de Contas não cria leituras em segundo plano nem acessa tabelas direto', () => {
  const files = [...sources(root), page]
  assert.ok(files.length > 8)
  for (const file of files) {
    const text = stripComments(readFileSync(file, 'utf8'))
    for (const [pattern, name] of FORBIDDEN) {
      assert.doesNotMatch(text, pattern, `${file}: ${name}`)
    }
  }
})

test('única leitura da lista: nenhum effect do hook do snapshot ou da página chama refresh', () => {
  const hook = stripComments(readFileSync(join(root, 'hooks/useAdminAccountsSnapshot.js'), 'utf8'))
  const pageText = stripComments(readFileSync(page, 'utf8'))
  assert.doesNotMatch(hook, /useEffect\([^]*?refresh\(/)
  for (const effect of pageText.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[\]\)/g))
    assert.doesNotMatch(effect[1], /refresh\(/)
})
