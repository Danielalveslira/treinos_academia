import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// O cálculo da frase é 100% local e síncrono: nenhum módulo do núcleo pode ler/gravar nada nem depender de
// fontes não determinísticas. (As únicas escritas do recurso ficam em greetingPreferencesService.js, chamado
// só pelo ACK das boas-vindas e pela troca de preferência.)
const CORE = ['catalog', 'format', 'select', 'context', 'clock', 'welcome', 'config']
const FORBIDDEN = [
  /\bfetch\s*\(/,
  /supabase/i,
  /services\//,
  /localStorage|sessionStorage|indexedDB/,
  /Math\.random/,
  /Date\.now/,
  /setInterval/,
  /dangerouslySetInnerHTML/,
]

for (const name of CORE) {
  test(`núcleo sem I/O nem aleatoriedade: ${name}.js`, () => {
    const source = readFileSync(new URL(`./${name}.js`, import.meta.url), 'utf8')
    // comentários não contam
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const pattern of FORBIDDEN) assert.doesNotMatch(code, pattern, `${name}.js: ${pattern}`)
  })
}

test('o cabeçalho renderiza texto puro (nunca HTML)', () => {
  const source = readFileSync(new URL('./DashboardGreeting.jsx', import.meta.url), 'utf8')
  const code = source.replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /dangerouslySetInnerHTML/)
  assert.doesNotMatch(code, /aria-live/)
})

test('só o serviço de escrita fala com o servidor, e só por RPC (nenhuma leitura)', () => {
  const source = readFileSync(
    new URL('../../services/greetingPreferencesService.js', import.meta.url),
    'utf8'
  )
  assert.doesNotMatch(source, /\.from\(|\.select\(/)
  assert.deepEqual([...source.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]).sort(), [
    'ack_greeting_welcome',
    'set_greeting_voice',
  ])
})
