import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Reducer puro testado isoladamente (mesmo raciocínio de EconomyVotersDialog.test.js:
// nunca use act()/TestRenderer neste projeto quando o bundle precisa de um plugin do
// esbuild pra mockar módulos que tocam firebase -- essa combinação trava a saída do
// processo `node --test`, investigado a fundo na Fase "Ver quem votou"). O componente
// em si (PromoteDialogBody) só faz wiring fino em cima deste reducer + dos services já
// testados separadamente (promotionsService.test.js).
let directory
async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'promote-dialog-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    entryPoints: ['src/components/PromoteDialog.jsx'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [
      {
        name: 'services-fixture',
        setup(pluginBuild) {
          pluginBuild.onResolve(
            { filter: /\/services\/(economyService|promotionsService)$/ },
            (args) => ({ path: args.path, namespace: 'fixture' })
          )
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: `
              export const getWallet = async () => ({ cashBalance: 0 })
              export const getPromotionPackages = async () => []
              export const createPromotion = async () => ({})
            `,
          }))
        },
      },
    ],
    logLevel: 'silent',
  })
  return createRequire(import.meta.url)(outfile)
}

const { promoteDialogReducer, initialPromoteDialogState } = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('initial state starts loading, with no package selected yet', () => {
  const state = initialPromoteDialogState()
  assert.equal(state.loadingPackages, true)
  assert.equal(state.selectedPackageId, null)
  assert.equal(state.result, null)
})

test('packages_loaded auto-selects the first package and stops loading', () => {
  const state = promoteDialogReducer(initialPromoteDialogState(), {
    type: 'packages_loaded',
    packages: [{ packageId: 'post_boost_3d' }, { packageId: 'post_boost_7d' }],
  })
  assert.equal(state.loadingPackages, false)
  assert.equal(state.selectedPackageId, 'post_boost_3d')
})

test('packages_loaded never overrides a selection the user already made', () => {
  let state = promoteDialogReducer(initialPromoteDialogState(), {
    type: 'packages_loaded',
    packages: [{ packageId: 'a' }, { packageId: 'b' }],
  })
  state = promoteDialogReducer(state, { type: 'select_package', packageId: 'b' })
  state = promoteDialogReducer(state, {
    type: 'packages_loaded',
    packages: [{ packageId: 'a' }, { packageId: 'b' }],
  })
  assert.equal(state.selectedPackageId, 'b')
})

test('select_package switches the active selection', () => {
  const state = promoteDialogReducer(initialPromoteDialogState(), { type: 'select_package', packageId: 'x' })
  assert.equal(state.selectedPackageId, 'x')
})

test('wallet_loaded stores the balance without touching anything else', () => {
  const state = promoteDialogReducer(initialPromoteDialogState(), { type: 'wallet_loaded', balance: 42 })
  assert.equal(state.walletBalance, 42)
})

test('submit_start clears a previous error and marks submitting', () => {
  let state = { ...initialPromoteDialogState(), error: 'falhou antes' }
  state = promoteDialogReducer(state, { type: 'submit_start' })
  assert.equal(state.submitting, true)
  assert.equal(state.error, '')
})

test('submit_success stores the result, stops submitting, and clears the pending retry attempt', () => {
  let state = { ...initialPromoteDialogState(), pendingAttempt: { key: 'x', requestId: 'r1' } }
  state = promoteDialogReducer(state, { type: 'submit_success', result: { promotionId: 'p1' } })
  assert.equal(state.submitting, false)
  assert.deepEqual(state.result, { promotionId: 'p1' })
  assert.equal(state.pendingAttempt, null)
})

test('submit_error stores the message and the retry attempt (for idempotent resubmission), stops submitting', () => {
  const state = promoteDialogReducer(initialPromoteDialogState(), {
    type: 'submit_error',
    message: 'saldo insuficiente',
    pendingAttempt: { key: 'post_boost_3d', requestId: 'r1' },
  })
  assert.equal(state.submitting, false)
  assert.equal(state.error, 'saldo insuficiente')
  assert.deepEqual(state.pendingAttempt, { key: 'post_boost_3d', requestId: 'r1' })
})
