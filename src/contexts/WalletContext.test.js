import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Testa o WalletProvider de verdade (não uma versão simplificada) renderizado com
// react-test-renderer, com fixtures pra firebase/firestore (onSnapshot fake,
// controlável pelo teste), ../hooks/useAuth (usuário trocável em runtime, via um
// pub/sub mínimo) e ../services/economyService (getWallet fake, pro bootstrap). async
// act() trava neste ambiente sem DOM/scheduler real (mesmo problema já encontrado em
// CopyButton.test.js) -- por isso o padrão aqui é sempre: dispara o evento fake, aguarda
// a Promise relevante FORA de act(), e só então faz um act(() => {}) síncrono vazio pra
// flushar qualquer atualização pendente antes de inspecionar o resultado.
let directory
let harness
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wallet-context-tests-'))
  const outfile = join(directory, 'harness.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement, useContext } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { WalletProvider, WalletContext } from './WalletContext.jsx'

        function Consumer() {
          const ctx = useContext(WalletContext)
          globalThis.__walletContextValue = ctx
          return null
        }

        export function renderProvider() {
          let component
          act(() => {
            component = TestRenderer.create(createElement(WalletProvider, null, createElement(Consumer, null)))
          })
          return component
        }

        export function unmount(component) {
          act(() => {
            component.unmount()
          })
        }

        export function flushSync() {
          act(() => {})
        }

        // globalThis.__setWalletTestUser (do fixture de useAuth) precisa ser chamado
        // DENTRO de act() pro React garantir que o re-render que ele dispara (via
        // forceRender no useAuth fake) já esteja aplicado antes da próxima asserção --
        // chamar direto de fora do bundle (sem o MESMO act importado aqui) deixava o
        // listener novo do useEffect ainda não registrado no momento da checagem.
        export function setUser(user) {
          act(() => {
            globalThis.__setWalletTestUser(user)
          })
        }

        export function setDeletionStatus(status) {
          act(() => {
            globalThis.__setWalletTestDeletionStatus(status)
          })
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
    plugins: [
      {
        name: 'wallet-context-fixtures',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /firebase\/firestore$/ }, (args) => ({
            path: args.path,
            namespace: 'firestore-fixture',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'firestore-fixture' }, () => ({
            contents: `
              export const doc = (...args) => args
              export const onSnapshot = (ref, onNext, onError) => {
                // ref[0] é o placeholder de \`db\` (objeto fixture, não uma string) --
                // o path de verdade é só os segmentos depois dele.
                const path = ref.slice(1).join('/')
                const handler = { path, onNext, onError, unsubscribed: false }
                globalThis.__snapshotHandlers = globalThis.__snapshotHandlers || []
                globalThis.__snapshotHandlers.push(handler)
                globalThis.__snapshotSubscribeCount = (globalThis.__snapshotSubscribeCount || 0) + 1
                return () => { handler.unsubscribed = true }
              }
            `,
          }))
          pluginBuild.onResolve({ filter: /\/firebase\/config$/ }, (args) => ({
            path: args.path,
            namespace: 'config-fixture',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'config-fixture' }, () => ({
            contents: 'export const db = {}',
          }))
          // useAuth fake com pub/sub mínimo -- globalThis.__setWalletTestUser (chamado
          // pelo teste) notifica todo Consumer montado, disparando um re-render real, do
          // mesmo jeito que onAuthStateChanged dispararia na implementação de verdade.
          pluginBuild.onResolve({ filter: /\/hooks\/useAuth$/ }, (args) => ({
            path: args.path,
            namespace: 'auth-fixture',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'auth-fixture' }, () => ({
            contents: `
              import { useEffect, useState } from 'react'
              let currentUser = null
              let currentDeletionStatus = null
              const listeners = new Set()
              globalThis.__setWalletTestUser = (user) => {
                currentUser = user
                listeners.forEach((l) => l())
              }
              globalThis.__setWalletTestDeletionStatus = (status) => {
                currentDeletionStatus = status
                listeners.forEach((l) => l())
              }
              export function useAuth() {
                const [, forceRender] = useState(0)
                useEffect(() => {
                  const listener = () => forceRender((n) => n + 1)
                  listeners.add(listener)
                  return () => listeners.delete(listener)
                }, [])
                return { user: currentUser, deletionStatus: currentDeletionStatus }
              }
            `,
            loader: 'jsx',
            resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
          }))
          pluginBuild.onResolve({ filter: /\/services\/economyService$/ }, (args) => ({
            path: args.path,
            namespace: 'economy-fixture',
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'economy-fixture' }, () => ({
            contents: `
              export const getWallet = async (uid) => {
                globalThis.__bootstrapCalls = (globalThis.__bootstrapCalls || 0) + 1
                const results = globalThis.__bootstrapResults || {}
                return results[uid] || { coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 0 }
              }
            `,
          }))
        },
      },
    ],
  })
  harness = createRequire(import.meta.url)(outfile)
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

beforeEach(() => {
  globalThis.__snapshotHandlers = []
  globalThis.__snapshotSubscribeCount = 0
  globalThis.__bootstrapCalls = 0
  globalThis.__bootstrapResults = {}
  globalThis.__walletContextValue = undefined
  harness.setUser(null)
  harness.setDeletionStatus(null)
})

function activeHandlersForPath(path) {
  return globalThis.__snapshotHandlers.filter((h) => h.path === path && !h.unsubscribed)
}

test('no user: renders the empty wallet immediately, not loading, no listener created', async () => {
  const component = harness.renderProvider()
  await Promise.resolve()
  harness.flushSync()
  assert.deepEqual(globalThis.__walletContextValue.wallet, {
    coinBalance: 0,
    lifetimeCoinsEarned: 0,
    cashBalance: 0,
  })
  assert.equal(globalThis.__walletContextValue.loading, false)
  assert.equal(globalThis.__snapshotSubscribeCount, 0)
  harness.unmount(component)
})

test('initial snapshot updates the wallet exposed by the context', async () => {
  const component = harness.renderProvider()
  harness.setUser({ uid: 'alice' })
  await Promise.resolve()
  harness.flushSync()

  const [handler] = activeHandlersForPath('users/alice/wallet/current')
  assert.ok(handler, 'um listener deveria ter sido criado pro uid autenticado')
  handler.onNext({ exists: () => true, data: () => ({ coinBalance: 61, lifetimeCoinsEarned: 61, cashBalance: 0 }) })
  harness.flushSync()

  assert.equal(globalThis.__walletContextValue.wallet.coinBalance, 61)
  assert.equal(globalThis.__walletContextValue.loading, false)
  harness.unmount(component)
})

test('a second snapshot updates the context again -- coinBalance changes without any reload/refresh call', async () => {
  const component = harness.renderProvider()
  harness.setUser({ uid: 'alice' })
  await Promise.resolve()
  harness.flushSync()
  const [handler] = activeHandlersForPath('users/alice/wallet/current')

  handler.onNext({ exists: () => true, data: () => ({ coinBalance: 61, lifetimeCoinsEarned: 61, cashBalance: 0 }) })
  harness.flushSync()
  assert.equal(globalThis.__walletContextValue.wallet.coinBalance, 61)

  // Exemplo do relato original: gastar 3 EvoCoins num voto -- o backend grava
  // 58, o MESMO listener (nunca um novo) entrega o próximo valor.
  handler.onNext({ exists: () => true, data: () => ({ coinBalance: 58, lifetimeCoinsEarned: 61, cashBalance: 0 }) })
  harness.flushSync()
  assert.equal(globalThis.__walletContextValue.wallet.coinBalance, 58)
  assert.equal(globalThis.__snapshotSubscribeCount, 1, 'nunca um segundo listener pra receber o segundo evento')
  harness.unmount(component)
})

test('cashBalance also updates live from a subsequent snapshot', async () => {
  const component = harness.renderProvider()
  harness.setUser({ uid: 'alice' })
  await Promise.resolve()
  harness.flushSync()
  const [handler] = activeHandlersForPath('users/alice/wallet/current')

  handler.onNext({ exists: () => true, data: () => ({ coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 120 }) })
  harness.flushSync()
  assert.equal(globalThis.__walletContextValue.wallet.cashBalance, 120)

  handler.onNext({ exists: () => true, data: () => ({ coinBalance: 0, lifetimeCoinsEarned: 0, cashBalance: 275 }) })
  harness.flushSync()
  assert.equal(globalThis.__walletContextValue.wallet.cashBalance, 275)
  harness.unmount(component)
})

test('a stale cache value from bootstrap is immediately replaced once the snapshot answers, even if the snapshot answers first', async () => {
  globalThis.__bootstrapResults = { alice: { coinBalance: 999, lifetimeCoinsEarned: 999, cashBalance: 0 } }
  const component = harness.renderProvider()
  harness.setUser({ uid: 'alice' })

  // O snapshot responde ANTES do bootstrap (getWallet) resolver -- simula a corrida real
  // entre as duas leituras.
  const [handler] = activeHandlersForPath('users/alice/wallet/current')
  handler.onNext({ exists: () => true, data: () => ({ coinBalance: 5, lifetimeCoinsEarned: 5, cashBalance: 0 }) })
  harness.flushSync()
  assert.equal(globalThis.__walletContextValue.wallet.coinBalance, 5)

  // Bootstrap resolve DEPOIS -- nunca deveria sobrescrever o valor já confirmado pelo
  // snapshot (a garantia central pedida: o snapshot sempre vence, imediatamente).
  await Promise.resolve()
  await Promise.resolve()
  harness.flushSync()
  assert.equal(
    globalThis.__walletContextValue.wallet.coinBalance,
    5,
    'o cache atrasado nunca deveria substituir o valor real já recebido'
  )
  harness.unmount(component)
})

test('logout (user becomes null) unsubscribes the listener', async () => {
  const component = harness.renderProvider()
  harness.setUser({ uid: 'alice' })
  await Promise.resolve()
  harness.flushSync()
  assert.equal(activeHandlersForPath('users/alice/wallet/current').length, 1)

  harness.setUser(null)
  assert.equal(activeHandlersForPath('users/alice/wallet/current').length, 0, 'logout deveria desinscrever o listener')
  assert.deepEqual(globalThis.__walletContextValue.wallet, {
    coinBalance: 0,
    lifetimeCoinsEarned: 0,
    cashBalance: 0,
  })
  harness.unmount(component)
})

test('switching users never reuses the previous wallet -- a late snapshot from the old user is ignored', async () => {
  const component = harness.renderProvider()
  harness.setUser({ uid: 'alice' })
  await Promise.resolve()
  harness.flushSync()
  const [aliceHandler] = activeHandlersForPath('users/alice/wallet/current')
  aliceHandler.onNext({ exists: () => true, data: () => ({ coinBalance: 500, lifetimeCoinsEarned: 500, cashBalance: 0 }) })
  harness.flushSync()
  assert.equal(globalThis.__walletContextValue.wallet.coinBalance, 500)

  harness.setUser({ uid: 'bob' })
  // A troca de usuário reseta pro estado vazio até o novo listener responder -- nunca
  // continua mostrando o saldo de alice pro bob.
  assert.deepEqual(globalThis.__walletContextValue.wallet, {
    coinBalance: 0,
    lifetimeCoinsEarned: 0,
    cashBalance: 0,
  })

  // Um evento atrasado do listener ANTIGO (alice) chegando depois da troca nunca deveria
  // vazar pro estado do bob.
  aliceHandler.onNext({ exists: () => true, data: () => ({ coinBalance: 999, lifetimeCoinsEarned: 999, cashBalance: 0 }) })
  harness.flushSync()
  assert.equal(globalThis.__walletContextValue.wallet.coinBalance, 0, 'evento atrasado de alice nunca deveria afetar bob')

  await Promise.resolve()
  harness.flushSync()
  const [bobHandler] = activeHandlersForPath('users/bob/wallet/current')
  assert.ok(bobHandler, 'um novo listener deveria existir pro bob')
  bobHandler.onNext({ exists: () => true, data: () => ({ coinBalance: 10, lifetimeCoinsEarned: 10, cashBalance: 0 }) })
  harness.flushSync()
  assert.equal(globalThis.__walletContextValue.wallet.coinBalance, 10)
  harness.unmount(component)
})

test('a listener error is captured, never throws, and never crashes the app', async () => {
  const component = harness.renderProvider()
  harness.setUser({ uid: 'alice' })
  await Promise.resolve()
  harness.flushSync()
  const [handler] = activeHandlersForPath('users/alice/wallet/current')

  assert.doesNotThrow(() => {
    handler.onError(new Error('permission-denied'))
  })
  harness.flushSync()
  assert.ok(globalThis.__walletContextValue.error)
  assert.equal(globalThis.__walletContextValue.loading, false)
  harness.unmount(component)
})

test('never creates a duplicate listener across re-renders for the same user', async () => {
  const component = harness.renderProvider()
  harness.setUser({ uid: 'alice' })
  await Promise.resolve()
  harness.flushSync()
  assert.equal(globalThis.__snapshotSubscribeCount, 1)

  // Notifica os listeners de useAuth de novo com o MESMO usuário (mesmo uid) -- não
  // deveria recriar o listener do zero.
  harness.setUser({ uid: 'alice' })
  await Promise.resolve()
  harness.flushSync()
  assert.equal(globalThis.__snapshotSubscribeCount, 1, 'mesmo uid não deveria recriar o listener')
  harness.unmount(component)
})

test('unmounting the provider unsubscribes the listener (cleanup)', async () => {
  const component = harness.renderProvider()
  harness.setUser({ uid: 'alice' })
  await Promise.resolve()
  harness.flushSync()
  assert.equal(activeHandlersForPath('users/alice/wallet/current').length, 1)

  harness.unmount(component)
  assert.equal(activeHandlersForPath('users/alice/wallet/current').length, 0)
})

// Bug "conta com exclusão bloqueada": antes desta correção, o listener da carteira era
// totalmente alheio ao estado de exclusão do AuthContext -- continuava tentando e
// registrando "Wallet onSnapshot: permission-denied" indefinidamente mesmo com a conta
// já sinalizada como bloqueada/em exclusão em outro lugar do app.
test('a known deletion status stops the wallet listener and clears the wallet, even with a user still set', async () => {
  const component = harness.renderProvider()
  harness.setUser({ uid: 'alice' })
  await Promise.resolve()
  harness.flushSync()
  assert.equal(activeHandlersForPath('users/alice/wallet/current').length, 1)

  harness.setDeletionStatus('blocked_financial_review')
  assert.equal(
    activeHandlersForPath('users/alice/wallet/current').length,
    0,
    'o listener deveria ser encerrado assim que a exclusão é conhecida'
  )
  assert.deepEqual(globalThis.__walletContextValue.wallet, {
    coinBalance: 0,
    lifetimeCoinsEarned: 0,
    cashBalance: 0,
  })
  assert.equal(globalThis.__walletContextValue.loading, false)
  assert.equal(globalThis.__walletContextValue.error, null)
  harness.unmount(component)
})

test('a deletion status already known when the user appears never creates a listener at all', async () => {
  harness.setDeletionStatus('blocked_financial_review')
  const component = harness.renderProvider()
  harness.setUser({ uid: 'alice' })
  await Promise.resolve()
  harness.flushSync()
  assert.equal(globalThis.__snapshotSubscribeCount, 0)
  harness.unmount(component)
})

test('clearing the deletion status (e.g. an unrelated transient flag) resubscribes normally', async () => {
  harness.setDeletionStatus('blocked_financial_review')
  const component = harness.renderProvider()
  harness.setUser({ uid: 'alice' })
  await Promise.resolve()
  harness.flushSync()
  assert.equal(globalThis.__snapshotSubscribeCount, 0)

  harness.setDeletionStatus(null)
  await Promise.resolve()
  harness.flushSync()
  const [handler] = activeHandlersForPath('users/alice/wallet/current')
  assert.ok(handler, 'deveria voltar a assinar depois que o status de exclusão deixa de existir')
  harness.unmount(component)
})
