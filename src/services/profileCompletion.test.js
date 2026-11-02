import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let mod

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'profile-completion-tests-'))
  const outfile = join(directory, 'flow.cjs')
  await build({
    stdin: {
      contents: `export { completeUserProfile } from './profileCompletion.js'`,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'supabase-stub',
        setup(ctx) {
          ctx.onResolve({ filter: /supabase\/config$/ }, () => ({
            path: 'supabase',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /^supabase$/, namespace: 'stub' }, () => ({
            contents: `export const supabase = {
              auth: { updateUser: (...a) => globalThis.__updateUser(...a) },
              rpc: (...a) => globalThis.__rpc(...a),
            }`,
          }))
        },
      },
    ],
  })
  mod = createRequire(import.meta.url)(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

let calls
beforeEach(() => {
  calls = []
  globalThis.__updateUser = (args) => {
    calls.push({ fn: 'updateUser', args })
    return Promise.resolve({ error: null })
  }
  globalThis.__rpc = (name, args) => {
    calls.push({ fn: name, args })
    return Promise.resolve({ error: null, data: null })
  }
})

test('completeUserProfile: chama todas as RPCs com os dados do formulário', async () => {
  await mod.completeUserProfile('u1', {
    username: 'Maria',
    sexo: 'feminino',
    birthDate: '2000-01-01',
    usageProfile: 'common',
    residenceMunicipalityCode: 2412500,
  })
  const names = calls.map((c) => c.fn)
  assert.ok(names.includes('ensure_user_profile'))
  assert.ok(names.includes('set_birth_info'))
  assert.ok(names.includes('updateUser'))
  assert.ok(names.includes('set_usage_profile'))
  assert.ok(names.includes('set_username'))
  assert.deepEqual(calls.find((c) => c.fn === 'set_residence_municipality')?.args, { p_code: 2412500 })
})

test('completeUserProfile: set_username é a ÚLTIMA chamada (prova que o resto já rodou)', async () => {
  await mod.completeUserProfile('u1', {
    username: 'maria',
    sexo: 'feminino',
    birthDate: '2000-01-01',
    usageProfile: 'common',
    residenceMunicipalityCode: 2412500,
  })
  const names = calls.map((c) => c.fn)
  assert.equal(names.at(-1), 'set_username', `última chamada foi "${names.at(-1)}", esperado "set_username"`)
  // E não é só a última -- as outras três (as que precisam ter sucesso) vêm antes dela.
  const usernameIndex = names.indexOf('set_username')
  assert.ok(names.indexOf('ensure_user_profile') < usernameIndex)
  assert.ok(names.indexOf('set_birth_info') < usernameIndex)
  assert.ok(names.indexOf('updateUser') < usernameIndex)
  assert.ok(names.indexOf('set_residence_municipality') < usernameIndex)
})

test('completeUserProfile: falha em ensureUserProfile nunca chega a chamar set_username', async () => {
  globalThis.__rpc = (name, args) => {
    calls.push({ fn: name, args })
    if (name === 'ensure_user_profile') return Promise.resolve({ error: new Error('boom') })
    return Promise.resolve({ error: null, data: null })
  }
  await assert.rejects(
    mod.completeUserProfile('u1', { username: 'maria', sexo: 'feminino', birthDate: '2000-01-01', usageProfile: 'common', residenceMunicipalityCode: 2412500 })
  )
  assert.ok(!calls.some((c) => c.fn === 'set_username'))
})

test('completeUserProfile: set_usage_profile é best-effort -- a falha não impede set_username', async () => {
  globalThis.__rpc = (name, args) => {
    calls.push({ fn: name, args })
    if (name === 'set_usage_profile') return Promise.resolve({ error: new Error('boom') })
    return Promise.resolve({ error: null, data: null })
  }
  const warn = console.error
  console.error = () => {}
  try {
    await mod.completeUserProfile('u1', {
      username: 'maria',
      sexo: 'feminino',
      birthDate: '2000-01-01',
      usageProfile: 'common',
      residenceMunicipalityCode: 2412500,
    })
  } finally {
    console.error = warn
  }
  assert.ok(calls.some((c) => c.fn === 'set_username'))
})

const base = { username: 'maria', sexo: 'feminino', birthDate: '2000-01-01', usageProfile: 'common' }

test('completeUserProfile: sem cidade selecionada não grava nada da cidade nem o username', async () => {
  await assert.rejects(mod.completeUserProfile('u1', { ...base, residenceMunicipalityCode: null }), {
    message: 'INVALID_MUNICIPALITY',
  })
  assert.ok(!calls.some((c) => c.fn === 'set_residence_municipality'))
  assert.ok(!calls.some((c) => c.fn === 'set_username'))
})

test('completeUserProfile: código com formato inválido é barrado antes do servidor', async () => {
  for (const code of ['2412500', 123, 99999999, Number.NaN]) {
    calls = []
    await assert.rejects(mod.completeUserProfile('u1', { ...base, residenceMunicipalityCode: code }), {
      message: 'INVALID_MUNICIPALITY',
    })
    assert.ok(!calls.some((c) => c.fn === 'set_username'))
  }
})

test('completeUserProfile: código recusado pelo servidor (fora do catálogo) mantém o perfil incompleto', async () => {
  globalThis.__rpc = (name, args) => {
    calls.push({ fn: name, args })
    if (name === 'set_residence_municipality')
      return Promise.resolve({ error: { message: 'INVALID_MUNICIPALITY', code: 'P0001' } })
    return Promise.resolve({ error: null, data: null })
  }
  await assert.rejects(mod.completeUserProfile('u1', { ...base, residenceMunicipalityCode: 1234567 }), {
    message: 'INVALID_MUNICIPALITY',
  })
  assert.ok(!calls.some((c) => c.fn === 'set_username'))
})

test('completeUserProfile: retomada repete a sequência inteira com os mesmos dados (idempotente)', async () => {
  await mod.completeUserProfile('u1', { ...base, residenceMunicipalityCode: 2412500 })
  const first = calls.map((c) => c.fn)
  calls = []
  await mod.completeUserProfile('u1', { ...base, residenceMunicipalityCode: 2412500 })
  assert.deepEqual(calls.map((c) => c.fn), first)
})
