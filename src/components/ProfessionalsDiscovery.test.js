import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let mount
let act

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'home-discovery-tests-'))
  const outfile = join(directory, 'discovery.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ProfessionalsDiscovery } from './ProfessionalsDiscovery.jsx'
        export { act }
        export const mount = () => TestRenderer.create(createElement(ProfessionalsDiscovery))
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
        name: 'home-discovery-dependencies',
        setup(buildApi) {
          const mocked = new Map([
            [
              '../services/professionalListingsService',
              'export const listPublishedProfessionalListings = (...args) => globalThis.__discoveryMocks.listPublishedProfessionalListings(...args)',
            ],
            ['./ProfessionalListingCard', 'export const ProfessionalListingCard = ({ listing }) => require("react").createElement("article", { "data-listing-id": listing.id }, listing.displayName)'],
            [
              'react-router-dom',
              `
            import { createElement } from 'react'
            export const Link = ({ children, to }) => createElement('a', { href: to }, children)
          `,
            ],
            [
              '@primer/react',
              `
            import { createElement } from 'react'
            export const Spinner = ({ 'aria-label': label }) => createElement('span', null, label)
          `,
            ],
          ])
          buildApi.onResolve({ filter: /.*/ }, (args) => {
            if (mocked.has(args.path)) return { path: args.path, namespace: 'home-discovery-mock' }
            return undefined
          })
          buildApi.onLoad({ filter: /.*/, namespace: 'home-discovery-mock' }, (args) => ({
            contents: mocked.get(args.path),
            loader: 'js',
            resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
          }))
        },
      },
    ],
  })
  ;({ mount, act } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  delete globalThis.__discoveryMocks
  if (directory) await rm(directory, { recursive: true, force: true })
})

async function renderWith(listPublishedProfessionalListings) {
  globalThis.__discoveryMocks = { listPublishedProfessionalListings }
  let view
  act(() => {
    view = mount()
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  act(() => {})
  return {
    view,
    close: () => act(() => view.unmount()),
  }
}

test('loads professionals by default, in a single query, and links "Ver todos" to the matching directory filter', async () => {
  const calls = []
  const page = await renderWith(async (filters, cursor, pageSize) => {
    calls.push({ filters, cursor, pageSize })
    return {
      items: [{ id: 'p1', displayName: 'Ana Treinadora' }],
      nextCursor: null,
    }
  })
  try {
    assert.equal(calls.length, 1)
    assert.equal(calls[0].filters.kind, 'professional')
    const html = JSON.stringify(page.view.toJSON())
    assert.match(html, /Ana Treinadora/)
    assert.match(html, /\/profissionais\?tipo=professional/)
  } finally {
    page.close()
  }
})

test('switching to the "Estabelecimentos" tab re-queries with kind: space and updates the directory link', async () => {
  const calls = []
  const page = await renderWith(async (filters) => {
    calls.push(filters.kind)
    return {
      items:
        filters.kind === 'space' ? [{ id: 's1', displayName: 'Espaço Movimento' }] : [],
      nextCursor: null,
    }
  })
  try {
    const toggle = page.view.root.findAllByProps({ 'aria-label': 'Tipo de vitrine' })[0]
    const spaceButton = toggle.findAllByType('button')[1]
    act(() => {
      spaceButton.props.onClick()
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    act(() => {})
    assert.deepEqual(calls, ['professional', 'space'])
    const html = JSON.stringify(page.view.toJSON())
    assert.match(html, /Espaço Movimento/)
    assert.match(html, /\/profissionais\?tipo=space/)
  } finally {
    page.close()
  }
})

test('shows a dedicated empty state instead of an empty grid', async () => {
  const page = await renderWith(async () => ({ items: [], nextCursor: null }))
  try {
    const html = JSON.stringify(page.view.toJSON())
    assert.match(html, /Ainda não há vitrines publicadas/)
  } finally {
    page.close()
  }
})

test('a failed query shows an error message instead of leaving a stuck spinner', async () => {
  const page = await renderWith(async () => {
    throw new Error('offline')
  })
  try {
    const html = JSON.stringify(page.view.toJSON())
    assert.match(html, /Não foi possível carregar/)
    assert.doesNotMatch(html, /Carregando profissionais/)
  } finally {
    page.close()
  }
})
