// Higiene de logs e armazenamento: nada que identifique a subscription, a chave VAPID ou o segredo do
// worker pode ir para console, localStorage ou resposta. Varredura estática do código de produção.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = new URL('../../../', import.meta.url).pathname
const SENSITIVE =
  /(endpoint|p256dh|\bauth\b|subscription|secret|vapid|private_?key|token|password|authorization|Bearer)/i

async function sources(dir, accept) {
  const out = []
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await sources(path, accept)))
    else if (accept.test(entry.name) && !/\.test\./.test(entry.name)) out.push(path)
  }
  return out
}

function consoleCalls(text) {
  const calls = []
  const pattern = /console\.(log|info|warn|error|debug)\(/g
  let match
  while ((match = pattern.exec(text))) {
    let depth = 1
    let index = pattern.lastIndex
    while (index < text.length && depth > 0) {
      if (text[index] === '(') depth += 1
      if (text[index] === ')') depth -= 1
      index += 1
    }
    calls.push(text.slice(match.index, index))
  }
  return calls
}

test('console.* do pipeline de Push nunca recebe endpoint, chaves, tokens ou segredos', async () => {
  const files = [
    ...(await sources('supabase/functions/process-push-outbox', /\.(js|ts)$/)),
    ...(await sources('src/features/notifications', /\.(js|jsx)$/)),
    'scripts/service-worker.js',
    'src/hooks/useLogout.js',
  ]
  assert.ok(files.length > 8)
  for (const file of files) {
    const text = await readFile(join(ROOT, file), 'utf8')
    for (const call of consoleCalls(text)) {
      // Mensagens fixas são permitidas; argumentos que são identificadores sensíveis não.
      const withoutStrings = call.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '')
      assert.ok(!SENSITIVE.test(withoutStrings), `${file}: ${call.slice(0, 120)}`)
    }
  }
})

test('armazenamento local permite apenas opt-out e calendário não sensível do convite', async () => {
  // Cache API do PWA (shell/assets/imagens públicos) não entra: aqui só storage de chave/valor do navegador.
  const files = [
    ...(await sources('src/features/notifications', /\.(js|jsx)$/)),
    'scripts/service-worker.js',
    'src/hooks/useLogout.js',
  ]
  const keysUsed = new Set()
  for (const file of files) {
    const text = await readFile(join(ROOT, file), 'utf8')
    for (const match of text.matchAll(
      /(?:localStorage|sessionStorage)\??\.(?:getItem|setItem|removeItem)\(\s*([A-Za-z_.]+)/g
    ))
      keysUsed.add(match[1])
    assert.ok(!/indexedDB/.test(text), `${file} usa IndexedDB`)
  }
  assert.deepEqual(
    [...keysUsed].sort(),
    ['key', 'optOutKey'],
    'somente opt-out e dispensa do convite'
  )
  const schedule = await readFile(
    join(ROOT, 'src/features/notifications/utils/pushNoticeSchedule.js'),
    'utf8'
  )
  assert.match(schedule, /const record = \{ day: businessDayKey\(now\), at: now, count: /)
  assert.match(schedule, /setItem\(key, JSON.stringify\(record\)\)/)
  assert.ok(!/endpoint|p256dh|subscription|token|email|password/i.test(schedule))
  const service = await readFile(
    join(ROOT, 'src/features/notifications/services/pushService.js'),
    'utf8'
  )
  assert.match(service, /optOutKey = \(userId\) => `evolutus:push-optout:\$\{userId\}`/)
  assert.match(
    service,
    /setItem\(optOutKey\(userId\), '1'\)/,
    'o valor guardado é só um sinalizador'
  )
})

test('o segredo do worker e a chave VAPID só são lidos de variáveis de ambiente do servidor', async () => {
  const frontend = [...(await sources('src', /\.(js|jsx)$/))]
  for (const file of frontend) {
    const text = await readFile(join(ROOT, file), 'utf8')
    assert.ok(
      !/PUSH_WORKER_SECRET|VAPID_PRIVATE_KEY|SUPABASE_SERVICE_ROLE_KEY|service_role_key|X-Push-Worker-Secret/i.test(
        text
      ),
      `${file} referencia segredo de servidor`
    )
  }
  const index = await readFile(
    join(ROOT, 'supabase/functions/process-push-outbox/index.ts'),
    'utf8'
  )
  assert.match(index, /Deno\.env\.get\('VAPID_PRIVATE_KEY'\)/)
})
