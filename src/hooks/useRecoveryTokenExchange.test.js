import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Achado da revisão de segurança: token_hash/type ficavam na barra de endereço (e no
// histórico do navegador) durante toda a etapa de "defina sua nova senha" em
// /redefinir-senha -- um copiar-e-colar do link, um F5 ou o Referer de qualquer requisição
// futura nesta aba reexpunha o mesmo token. O hook agora limpa a query ANTES do resultado
// do verifyOtp, não depois -- o token só continua em memória (variável local) até esse uso.
let directory
let mount

// IS_REACT_ACT_ENVIRONMENT=false + wait() por setTimeout real (em vez de act(async () =>
// ...) para resolver a promise do verifyOtp) -- mesma saída de src/hooks/useCommunities.test.js:
// act(async () => ...) aqui some com o bundle CJS do esbuild + react-router-dom, sem nunca
// resolver nem lançar (processo trava à espera de um handle que nenhum teste deste projeto
// chega a fechar).
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'use-recovery-token-exchange-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter, useLocation } from 'react-router-dom'
        import { useRecoveryTokenExchange } from './useRecoveryTokenExchange.js'

        export const mount = (initialEntry) => {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          const box = { status: null, location: null }
          function Probe() {
            box.status = useRecoveryTokenExchange()
            box.location = useLocation()
            return null
          }
          let renderer
          act(() => {
            renderer = TestRenderer.create(
              createElement(MemoryRouter, { initialEntries: [initialEntry] }, createElement(Probe))
            )
          })
          return { box, renderer }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    // useRecoveryTokenExchange -> services/authService.js -> supabase/config.js: só precisa
    // não explodir ao montar o módulo e deixar a gente controlar auth.verifyOtp (mesmo
    // padrão de src/services/authRecoveryFlow.test.js).
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
              auth: { verifyOtp: (...a) => globalThis.__verifyOtp(...a) },
            }`,
          }))
        },
      },
    ],
  })
  ;({ mount } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(() => {
  globalThis.__verifyOtp = () => {
    throw new Error('verifyOtp chamado sem um stub configurado pelo teste')
  }
})

test('a query (token_hash/type) é limpa da URL antes do verifyOtp terminar, não depois', async () => {
  let resolveVerify
  globalThis.__verifyOtp = () =>
    new Promise((resolve) => {
      resolveVerify = resolve
    })
  const { box } = mount('/redefinir-senha?token_hash=segredo123&type=recovery')
  assert.equal(box.status, 'checking')
  assert.equal(box.location.pathname, '/redefinir-senha')
  assert.equal(box.location.search, '')
  resolveVerify({ error: null })
  await wait()
  assert.equal(box.status, 'ready')
})

test('o token_hash já removido da URL ainda é o valor usado no verifyOtp (fica em memória até o uso)', async () => {
  const calls = []
  globalThis.__verifyOtp = (args) => {
    calls.push(args)
    return Promise.resolve({ error: null })
  }
  mount('/redefinir-senha?token_hash=segredo123&type=recovery')
  assert.deepEqual(calls, [{ token_hash: 'segredo123', type: 'recovery' }])
})

test('type diferente de recovery cai em invalid sem chamar verifyOtp, e a URL permanece limpa', async () => {
  globalThis.__verifyOtp = () => {
    throw new Error('não deveria ser chamado com type != recovery')
  }
  const { box } = mount('/redefinir-senha?token_hash=segredo123&type=signup')
  assert.equal(box.status, 'invalid')
  assert.equal(box.location.search, '')
})

test('sem token_hash a URL (já sem query) permanece limpa e o status cai em invalid', async () => {
  globalThis.__verifyOtp = () => {
    throw new Error('não deveria ser chamado sem token_hash')
  }
  const { box } = mount('/redefinir-senha')
  assert.equal(box.status, 'invalid')
  assert.equal(box.location.search, '')
})

test('um token_hash inválido/expirado propaga para invalid (erro do GoTrue)', async () => {
  globalThis.__verifyOtp = () => Promise.resolve({ error: new Error('otp_expired') })
  const { box } = mount('/redefinir-senha?token_hash=expirado&type=recovery')
  await wait()
  assert.equal(box.status, 'invalid')
})
