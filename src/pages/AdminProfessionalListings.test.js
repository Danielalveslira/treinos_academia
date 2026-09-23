import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let harness

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'admin-listing-ui-'))
  const outfile = join(directory, 'admin.cjs')
  await build({
    stdin: {
      contents: `
        export { default as AdminProfessionalListings } from './AdminProfessionalListings.jsx'
        export { state } from '../services/professionalListingsService'
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    plugins: [
      {
        name: 'admin-ui-stubs',
        setup(context) {
          const root = new URL('../../', import.meta.url).pathname
          context.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, ({ path }) => ({
            path: require.resolve(path),
            external: true,
          }))
          context.onResolve({ filter: /^@primer\/react$/ }, () => ({
            path: 'primer',
            namespace: 'stub',
          }))
          context.onResolve({ filter: /\/services\/professionalListingsService$/ }, () => ({
            path: 'service',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^primer$/, namespace: 'stub' }, () => ({
            resolveDir: root,
            contents: `
            import { createElement } from 'react'
            export const Button = ({ children, loading, variant, size, ...props }) => createElement('button', { ...props, 'data-loading': !!loading }, children)
            export const Flash = ({ children, variant, ...props }) => createElement('div', { ...props, 'data-variant': variant }, children)
            export const Spinner = () => createElement('span', null, 'carregando')
          `,
          }))
          context.onLoad({ filter: /^service$/, namespace: 'stub' }, () => ({
            contents: `
            export const state = {
              pending: [{ id: 'listing1', displayName: 'Ana', kind: 'professional', city: 'Recife', uf: 'PE', bio: 'Bio', version: 1 }],
              reports: [], calls: [], release: null, fail: false,
            }
            export async function listPendingProfessionalListings() { return [...state.pending] }
            export async function listOpenShowcaseReports() { return [...state.reports] }
            export async function reviewProfessionalListing(id, decision, reason) {
              state.calls.push({ id, decision, reason })
              if (state.fail) throw new Error('Function indisponível')
              await new Promise((resolve) => { state.release = resolve })
              state.pending = state.pending.filter((item) => item.id !== id)
            }
            export async function resolveProfessionalListingReport() {}
          `,
          }))
        },
      },
    ],
  })
  harness = require(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('aprovação chama a Function uma vez, desabilita decisões simultâneas e atualiza a fila', async () => {
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(harness.AdminProfessionalListings))
  })
  const button = (label) =>
    renderer.root.findAllByType('button').find((item) => item.children.join('') === label)
  assert.ok(button('Aprovar'))
  await act(async () => {
    button('Aprovar').props.onClick()
    button('Aprovar').props.onClick()
  })
  assert.equal(harness.state.calls.length, 1)
  assert.equal(button('Aprovar').props.disabled, true)
  assert.equal(button('Rejeitar').props.disabled, true)
  await act(async () => harness.state.release())
  assert.equal(button('Aprovar'), undefined)
  assert.match(JSON.stringify(renderer.toJSON()), /Vitrine aprovada e publicada/)
  act(() => renderer.unmount())
})

test('falha da Function mantém a vitrine na fila e mostra erro', async () => {
  harness.state.pending = [
    {
      id: 'listing2',
      displayName: 'Bia',
      kind: 'professional',
      city: 'Recife',
      uf: 'PE',
      bio: 'Bio',
      version: 2,
    },
  ]
  harness.state.fail = true
  let renderer
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(harness.AdminProfessionalListings))
  })
  await act(async () => {
    renderer.root
      .findAllByType('button')
      .find((item) => item.children.join('') === 'Aprovar')
      .props.onClick()
  })
  assert.match(JSON.stringify(renderer.toJSON()), /Function indisponível/)
  assert.match(JSON.stringify(renderer.toJSON()), /Bia/)
  harness.state.fail = false
  act(() => renderer.unmount())
})
