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
  directory = await mkdtemp(join(tmpdir(), 'my-showcase-tests-'))
  const outfile = join(directory, 'page.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import MyProfessionalListing from './MyProfessionalListing.jsx'
        export { act }
        export const mount = () => TestRenderer.create(createElement(MyProfessionalListing))
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
        name: 'showcase-page-dependencies',
        setup(buildApi) {
          const mocked = new Map([
            ['../hooks/useAuth', 'export const useAuth = () => globalThis.__showcaseAuth'],
            [
              '../services/communitiesService',
              'export const listActiveCommunities = () => globalThis.__showcaseMocks.listActiveCommunities()',
            ],
            [
              '../services/professionalListingsService',
              `
            export const getMyProfessionalListing = (...args) => globalThis.__showcaseMocks.getMyProfessionalListing(...args)
            export const getShowcaseLegalAcceptance = (...args) => globalThis.__showcaseMocks.getShowcaseLegalAcceptance(...args)
            export const createProfessionalListing = () => {}
            export const deleteProfessionalListing = () => {}
            export const saveProfessionalListing = () => {}
            export const publishProfessionalListing = () => {}
            export const unpublishProfessionalListing = () => {}
          `,
            ],
            [
              '../services/usageProfileService',
              'export const setUsageProfile = (...args) => globalThis.__showcaseMocks.setUsageProfile(...args)',
            ],
            [
              '../components/ProfessionalListingCard',
              'export const ProfessionalListingCard = () => null',
            ],
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
            export const Button = ({ children, onClick }) => createElement('button', { onClick }, children)
            export const Flash = ({ children }) => createElement('div', null, children)
            export const Spinner = ({ 'aria-label': label }) => createElement('span', null, label)
          `,
            ],
          ])
          buildApi.onResolve({ filter: /.*/ }, (args) => {
            if (mocked.has(args.path)) return { path: args.path, namespace: 'showcase-page-mock' }
            return undefined
          })
          buildApi.onLoad({ filter: /.*/, namespace: 'showcase-page-mock' }, (args) => ({
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
  delete globalThis.__showcaseAuth
  delete globalThis.__showcaseMocks
  if (directory) await rm(directory, { recursive: true, force: true })
})

async function renderWith(services, profile = {}) {
  globalThis.__showcaseAuth = { user: { uid: 'owner-1' }, profile }
  globalThis.__showcaseMocks = {
    getMyProfessionalListing: async () => null,
    getShowcaseLegalAcceptance: async () => null,
    listActiveCommunities: async () => [],
    setUsageProfile: async () => ({ usageProfile: 'professional' }),
    ...services,
  }
  const previousWindow = globalThis.window
  globalThis.window = { setTimeout, clearTimeout }
  let view
  act(() => {
    view = mount()
  })
  // Dois ciclos: o primeiro resolve as promises (getMyProfessionalListing etc.) e
  // aplica o setRecord/setForm que elas disparam; o segundo garante que esse
  // commit (e qualquer microtask que ele por sua vez agende) já foi refletido antes
  // de qualquer teste inspecionar a árvore.
  await new Promise((resolve) => setTimeout(resolve, 0))
  act(() => {})
  await new Promise((resolve) => setTimeout(resolve, 0))
  act(() => {})
  return {
    view,
    close() {
      act(() => view.unmount())
      globalThis.window = previousWindow
    },
  }
}

test('an optional communities failure does not prevent the owner from opening My Showcase', async () => {
  const page = await renderWith({
    listActiveCommunities: async () => {
      throw new Error('communities unavailable')
    },
  })
  try {
    const html = JSON.stringify(page.view.toJSON())
    assert.match(html, /Crie uma página pública/)
    assert.match(html, /Não foi possível carregar suas comunidades/)
    assert.doesNotMatch(html, /Carregando sua vitrine/)
  } finally {
    page.close()
  }
})

test('an acceptance lookup failure still opens the editor with a clear warning', async () => {
  const page = await renderWith({
    getShowcaseLegalAcceptance: async () => {
      throw new Error('acceptance unavailable')
    },
  })
  try {
    const html = JSON.stringify(page.view.toJSON())
    assert.match(html, /Crie uma página pública/)
    assert.match(html, /Não foi possível verificar seu aceite da Vitrine/)
  } finally {
    page.close()
  }
})

test('with no listing yet, an eligible usage profile shows the kind picker', async () => {
  const page = await renderWith({}, { usageProfile: 'professional' })
  try {
    const html = JSON.stringify(page.view.toJSON())
    assert.match(html, /Para personal trainers/)
    assert.match(html, /Para academias, boxes/)
  } finally {
    page.close()
  }
})

test('with no listing yet, usageProfile: common shows a pointer to Meu Perfil instead of the picker', async () => {
  const page = await renderWith({}, { usageProfile: 'common' })
  try {
    const html = JSON.stringify(page.view.toJSON())
    assert.doesNotMatch(html, /Para personal trainers/)
    assert.match(html, /Profissional e Responsável por estabelecimento/)
  } finally {
    page.close()
  }
})

test('with no listing yet, a legacy account (no usageProfile) is prompted to declare one contextually, not defaulted to common', async () => {
  const declared = []
  const page = await renderWith({ setUsageProfile: async (value) => declared.push(value) }, {})
  try {
    const html = JSON.stringify(page.view.toJSON())
    assert.doesNotMatch(html, /Para personal trainers/)
    assert.doesNotMatch(html, /Profissional e Responsável por estabelecimento/)
    assert.match(html, /Antes de continuar, diga como você pretende usar o Evolutus/)
    // A declaração em si (chamada ao serviço) é o que importa aqui -- o texto some
    // depois porque o AuthContext de verdade mantém um listener ao vivo em
    // users/{uid} e propaga profile.usageProfile sozinho; esse stub de useAuth() é
    // estático de propósito (ver renderWith), então não simula esse próximo passo.
    const professionalRadio = page.view.root.findAllByProps({ value: 'professional' })[0]
    act(() => {
      professionalRadio.props.onChange()
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    act(() => {})
    assert.deepEqual(declared, ['professional'])
  } finally {
    page.close()
  }
})

test('a complete draft renders a direct "Publicar" action, never the old review-queue wording', async () => {
  const page = await renderWith({
    getMyProfessionalListing: async () => ({
      id: 'listing-1',
      listing: { kind: 'professional', lifecycleState: 'draft', ownerId: 'owner-1' },
      draft: {
        kind: 'professional',
        version: 1,
        reviewState: 'draft',
        displayName: 'Ana Treinadora',
        categoryKey: 'personal_trainer',
        modalityKeys: ['musculacao'],
        specialties: [],
        bio: 'Acompanhamento individual.',
        city: 'São Paulo',
        uf: 'SP',
        serviceMode: 'in_person',
        contacts: {},
        useProfileAvatar: false,
      },
      published: null,
    }),
  })
  try {
    const html = JSON.stringify(page.view.toJSON())
    assert.match(html, /Publicar/)
    assert.doesNotMatch(html, /Enviar para revisão/)
    assert.doesNotMatch(html, /em revisão/i)
  } finally {
    page.close()
  }
})

test('a failed owner lookup shows a retry action instead of an endless spinner', async () => {
  const previousError = console.error
  console.error = () => {}
  let page
  try {
    page = await renderWith({
      getMyProfessionalListing: async () => {
        throw new Error('permission-denied')
      },
    })
    const html = JSON.stringify(page.view.toJSON())
    assert.match(html, /Não foi possível carregar sua vitrine/)
    assert.match(html, /Tentar novamente/)
    assert.doesNotMatch(html, /Carregando sua vitrine/)
  } finally {
    page?.close()
    console.error = previousError
  }
})
