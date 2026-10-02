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
            export const getActiveShowcasePolicy = (...args) => globalThis.__showcaseMocks.getActiveShowcasePolicy(...args)
            export const getShowcaseLegalAcknowledgement = (...args) => globalThis.__showcaseMocks.getShowcaseLegalAcknowledgement(...args)
            export const getShowcaseLegalVersion = (...args) => globalThis.__showcaseMocks.getShowcaseLegalVersion(...args)
            export const acknowledgeShowcaseTerms = (...args) => globalThis.__showcaseMocks.acknowledgeShowcaseTerms(...args)
            export const createProfessionalListing = () => {}
            export const deleteProfessionalListing = () => {}
            export const saveProfessionalListing = () => {}
            export const publishProfessionalListing = (...args) => globalThis.__showcaseMocks.publishProfessionalListing(...args)
            export const finalizeProfessionalListingPublish = (...args) => globalThis.__showcaseMocks.finalizeProfessionalListingPublish(...args)
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
            export const Button = ({ children, onClick, ...props }) => createElement('button', { onClick, ...props }, children)
            export const Flash = ({ children }) => createElement('div', null, children)
            export const Spinner = ({ 'aria-label': label }) => createElement('span', null, label)
            export const Dialog = ({ title, children, onClose }) => createElement('div', { 'data-dialog-title': title },
              createElement('button', { 'data-dialog-close': true, onClick: onClose }, 'fechar'),
              children
            )
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
    getActiveShowcasePolicy: async () => ({
      documentId: null,
      version: null,
      digest: null,
      published: false,
      publishedAt: null,
    }),
    getShowcaseLegalAcknowledgement: async () => null,
    getShowcaseLegalVersion: async () => null,
    acknowledgeShowcaseTerms: async () => ({ version: null, acknowledged: true }),
    publishProfessionalListing: async () => ({ repeated: false, version: 1, avatarMediaId: null, avatarPath: null }),
    finalizeProfessionalListingPublish: async () => ({ listingId: 'listing-1', state: 'published', version: 1 }),
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

// Decisão de produto: ciência dos Termos nunca bloqueia nada, então uma falha ao
// consultá-la também não pode virar um aviso pro titular -- só loga e segue (ver
// loadShowcaseTermsState em MyProfessionalListing.jsx).
test('a showcase terms lookup failure never surfaces a warning -- it is not a gate', async () => {
  const page = await renderWith({
    getActiveShowcasePolicy: async () => {
      throw new Error('policy unavailable')
    },
  })
  try {
    const html = JSON.stringify(page.view.toJSON())
    assert.match(html, /Crie uma página pública/)
    assert.doesNotMatch(html, /Termos/)
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

const COMPLETE_DRAFT_RECORD = {
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
}

const PUBLISHED_RECORD = {
  ...COMPLETE_DRAFT_RECORD,
  listing: { ...COMPLETE_DRAFT_RECORD.listing, lifecycleState: 'published', publishedVersion: 1 },
  draft: { ...COMPLETE_DRAFT_RECORD.draft, publishOperationId: 'completed-operation' },
  published: { id: 'listing-1', publishedVersion: 1 },
}

// Decisão de produto: uma versão nova dos Termos nunca bloqueia Salvar/Publicar -- só
// mostra o aviso. Sem nenhum acknowledgement mockado, "Publicar" continua presente (não
// escondido nem substituído por nada que dependa de aceite).
test('publishing stays available with no acknowledgement at all -- never gated by terms', async () => {
  const page = await renderWith({
    getMyProfessionalListing: async () => COMPLETE_DRAFT_RECORD,
    getActiveShowcasePolicy: async () => ({
      documentId: 'showcase-publication-terms',
      version: '1.1.0',
      digest: 'abc',
      published: true,
      publishedAt: '2026-10-01T00:00:00Z',
    }),
    getShowcaseLegalAcknowledgement: async () => null,
  })
  try {
    const html = JSON.stringify(page.view.toJSON())
    assert.match(html, /Publicar/)
    assert.match(html, /Termos da Vitrine atualizados/)
  } finally {
    page.close()
  }
})

// Fase 1 (prepare) sozinha nunca é "sucesso" -- só depois que a Fase 2 (Edge Function,
// finalize) também termina é que a tela mostra "Vitrine publicada.".
test('"Vitrine publicada" only shows after phase 2 (finalize) succeeds, never from phase 1 alone', async () => {
  const calls = []
  let reads = 0
  const page = await renderWith({
    getMyProfessionalListing: async () => (++reads === 1 ? COMPLETE_DRAFT_RECORD : PUBLISHED_RECORD),
    publishProfessionalListing: async (...args) => {
      calls.push(['prepare', ...args])
      return { repeated: false, version: 1, avatarMediaId: null, avatarPath: null }
    },
    finalizeProfessionalListingPublish: async (...args) => {
      calls.push(['finalize', ...args])
      return { listingId: 'listing-1', state: 'published', version: 1 }
    },
  })
  try {
    act(() => {
      findButtonByText(page.view.root, 'Publicar').props.onClick()
    })
    await flush(act)
    assert.deepEqual(
      calls.map((call) => call[0]),
      ['prepare', 'finalize']
    )
    assert.match(JSON.stringify(page.view.toJSON()), /Vitrine publicada/)
  } finally {
    page.close()
  }
})

// `repeated: true` (uma chamada anterior com o MESMO operationId já publicou de
// verdade) -- nada a finalizar de novo; chamar a Edge Function outra vez seria
// redundante (e falharia, já que o rascunho não está mais em 'publishing').
test('a repeated prepare (same operationId already published) skips calling finalize again', async () => {
  const calls = []
  let reads = 0
  const page = await renderWith({
    getMyProfessionalListing: async () => (++reads === 1 ? COMPLETE_DRAFT_RECORD : PUBLISHED_RECORD),
    publishProfessionalListing: async () => {
      calls.push('prepare')
      return { repeated: true, version: 1 }
    },
    finalizeProfessionalListingPublish: async () => {
      calls.push('finalize')
      return { listingId: 'listing-1', state: 'published', version: 1 }
    },
  })
  try {
    act(() => {
      findButtonByText(page.view.root, 'Publicar').props.onClick()
    })
    await flush(act)
    assert.deepEqual(calls, ['prepare'])
    assert.match(JSON.stringify(page.view.toJSON()), /Vitrine publicada/)
  } finally {
    page.close()
  }
})

// Se a Fase 2 falhar depois que a Fase 1 já travou o rascunho, a tela nunca mostra
// sucesso -- só um erro, sem considerar a publicação concluída.
test('a phase 2 (finalize) failure after a successful phase 1 never shows success', async () => {
  const page = await renderWith({
    getMyProfessionalListing: async () => COMPLETE_DRAFT_RECORD,
    publishProfessionalListing: async () => ({ repeated: false, version: 1 }),
    finalizeProfessionalListingPublish: async () => {
      throw new Error('PUBLISH_STATE_CHANGED')
    },
  })
  try {
    act(() => {
      findButtonByText(page.view.root, 'Publicar').props.onClick()
    })
    await flush(act)
    const html = JSON.stringify(page.view.toJSON())
    assert.doesNotMatch(html, /Vitrine publicada/)
    assert.match(html, /Não foi possível publicar/)
  } finally {
    page.close()
  }
})

test('no acknowledgement banner when the server has no published showcase terms yet', async () => {
  const page = await renderWith({ getMyProfessionalListing: async () => COMPLETE_DRAFT_RECORD })
  try {
    const html = JSON.stringify(page.view.toJSON())
    assert.doesNotMatch(html, /Termos da Vitrine atualizados/)
  } finally {
    page.close()
  }
})

function findButtonByText(root, text) {
  return root.findAllByType('button').find((node) => node.children.join('') === text)
}

async function flush(act) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  act(() => {})
}

// "Ler o que mudou" só abre o diálogo com o resumo -- nunca registra ciência sozinho.
test('opening "Ler o que mudou" shows the changes summary but does not acknowledge anything', async () => {
  const acknowledged = []
  const page = await renderWith({
    getMyProfessionalListing: async () => COMPLETE_DRAFT_RECORD,
    getActiveShowcasePolicy: async () => ({
      documentId: 'showcase-publication-terms',
      version: '1.1.0',
      digest: 'abc',
      published: true,
      publishedAt: '2026-10-01T00:00:00Z',
    }),
    getShowcaseLegalAcknowledgement: async () => null,
    getShowcaseLegalVersion: async () => ({
      version: '1.1.0',
      manifest: { changes: ['Publicação passa a ser direta pelo titular.'] },
    }),
    acknowledgeShowcaseTerms: async () => {
      acknowledged.push('1.1.0')
      return { version: '1.1.0', acknowledged: true }
    },
  })
  try {
    act(() => {
      findButtonByText(page.view.root, 'Ler alterações').props.onClick()
    })
    await flush(act)
    const html = JSON.stringify(page.view.toJSON())
    assert.match(html, /Publicação passa a ser direta pelo titular/)
    assert.deepEqual(acknowledged, [])
    // Fechar sem clicar em "OK, entendi" mantém o aviso.
    act(() => {
      findButtonByText(page.view.root, 'fechar').props.onClick()
    })
    assert.deepEqual(acknowledged, [])
    assert.match(JSON.stringify(page.view.toJSON()), /Termos da Vitrine atualizados/)
  } finally {
    page.close()
  }
})

test('clicking "OK, entendi" inside the dialog acknowledges the current version and the banner disappears', async () => {
  const acknowledged = []
  const page = await renderWith({
    getMyProfessionalListing: async () => COMPLETE_DRAFT_RECORD,
    getActiveShowcasePolicy: async () => ({
      documentId: 'showcase-publication-terms',
      version: '1.1.0',
      digest: 'abc',
      published: true,
      publishedAt: '2026-10-01T00:00:00Z',
    }),
    getShowcaseLegalAcknowledgement: async () => null,
    getShowcaseLegalVersion: async () => ({ version: '1.1.0', manifest: { changes: [] } }),
    acknowledgeShowcaseTerms: async () => {
      acknowledged.push('1.1.0')
      return { version: '1.1.0', acknowledged: true }
    },
  })
  try {
    assert.match(JSON.stringify(page.view.toJSON()), /Termos da Vitrine atualizados/)
    act(() => {
      findButtonByText(page.view.root, 'Ler alterações').props.onClick()
    })
    await flush(act)
    act(() => {
      findButtonByText(page.view.root, 'OK, entendi').props.onClick()
    })
    await flush(act)
    assert.deepEqual(acknowledged, ['1.1.0'])
    assert.doesNotMatch(
      JSON.stringify(page.view.toJSON()),
      /Termos da Vitrine atualizados/
    )
  } finally {
    page.close()
  }
})

test('the compact banner acknowledges directly through "Entendi" and disappears immediately', async () => {
  const acknowledged = []
  const page = await renderWith({
    getMyProfessionalListing: async () => COMPLETE_DRAFT_RECORD,
    getActiveShowcasePolicy: async () => ({
      documentId: 'showcase-publication-terms',
      version: '1.1.0',
      digest: 'abc',
      published: true,
      publishedAt: '2026-10-01T00:00:00Z',
    }),
    getShowcaseLegalAcknowledgement: async () => null,
    acknowledgeShowcaseTerms: async () => {
      acknowledged.push('1.1.0')
      return { version: '1.1.0', acknowledged: true }
    },
  })
  try {
    assert.match(JSON.stringify(page.view.toJSON()), /Veja o que mudou nesta versão/)
    act(() => {
      findButtonByText(page.view.root, 'Entendi').props.onClick()
    })
    await flush(act)
    assert.deepEqual(acknowledged, ['1.1.0'])
    assert.doesNotMatch(JSON.stringify(page.view.toJSON()), /Termos da Vitrine atualizados/)
  } finally {
    page.close()
  }
})

test('an interrupted phase 2 retries with the same operation and only reports success after finalize', async () => {
  const prepareOperations = []
  const finalizeOperations = []
  let reads = 0
  const page = await renderWith({
    getMyProfessionalListing: async () => {
      reads += 1
      return reads >= 3 ? PUBLISHED_RECORD : COMPLETE_DRAFT_RECORD
    },
    publishProfessionalListing: async (_listingId, operationId) => {
      prepareOperations.push(operationId)
      return { repeated: false, version: 1 }
    },
    finalizeProfessionalListingPublish: async (_listingId, operationId) => {
      finalizeOperations.push(operationId)
      if (finalizeOperations.length === 1) throw new Error('NETWORK_INTERRUPTED')
      return { listingId: 'listing-1', state: 'published', version: 1 }
    },
  })
  try {
    act(() => findButtonByText(page.view.root, 'Publicar').props.onClick())
    await flush(act)
    assert.doesNotMatch(JSON.stringify(page.view.toJSON()), /Vitrine publicada/)

    act(() => findButtonByText(page.view.root, 'Publicar').props.onClick())
    await flush(act)
    assert.equal(prepareOperations.length, 2)
    assert.equal(finalizeOperations.length, 2)
    assert.equal(prepareOperations[0], prepareOperations[1])
    assert.equal(finalizeOperations[0], finalizeOperations[1])
    assert.match(JSON.stringify(page.view.toJSON()), /Vitrine publicada/)
  } finally {
    page.close()
  }
})

test('a loaded publishing state can resume the stored operation instead of staying locked', async () => {
  const operations = []
  let reads = 0
  const publishingRecord = {
    ...COMPLETE_DRAFT_RECORD,
    draft: {
      ...COMPLETE_DRAFT_RECORD.draft,
      reviewState: 'publishing',
      publishingOperationId: 'stale-operation',
      publishingStartedAt: '2026-10-01T19:31:09.647Z',
    },
  }
  const publishedRecord = {
    ...COMPLETE_DRAFT_RECORD,
    listing: { ...COMPLETE_DRAFT_RECORD.listing, lifecycleState: 'published', publishedVersion: 1 },
    draft: { ...COMPLETE_DRAFT_RECORD.draft, publishOperationId: 'stale-operation' },
    published: { id: 'listing-1', publishedVersion: 1 },
  }
  const page = await renderWith({
    getMyProfessionalListing: async () => {
      reads += 1
      return reads === 1 ? publishingRecord : publishedRecord
    },
    publishProfessionalListing: async (_listingId, operationId) => {
      operations.push(['prepare', operationId])
      return { repeated: false, resumed: true, version: 1 }
    },
    finalizeProfessionalListingPublish: async (_listingId, operationId) => {
      operations.push(['finalize', operationId])
      return { listingId: 'listing-1', state: 'published', version: 1 }
    },
  })
  try {
    assert.match(JSON.stringify(page.view.toJSON()), /Retomar publicação/)
    act(() => findButtonByText(page.view.root, 'Retomar publicação').props.onClick())
    await flush(act)
    assert.deepEqual(operations, [
      ['prepare', 'stale-operation'],
      ['finalize', 'stale-operation'],
    ])
    assert.match(JSON.stringify(page.view.toJSON()), /Vitrine publicada/)
  } finally {
    page.close()
  }
})

test('nullable draft fields are normalized before reaching controlled inputs', async () => {
  const page = await renderWith({
    getMyProfessionalListing: async () => ({
      ...COMPLETE_DRAFT_RECORD,
      draft: {
        ...COMPLETE_DRAFT_RECORD.draft,
        displayName: null,
        categoryKey: null,
        modalityKeys: null,
        specialties: null,
        bio: null,
        city: null,
        uf: null,
        serviceMode: null,
        contacts: { whatsapp: null, instagram: null, website: null },
        linkedCommunityId: null,
        useProfileAvatar: null,
      },
    }),
  })
  try {
    const controls = [
      ...page.view.root.findAllByType('input'),
      ...page.view.root.findAllByType('select'),
      ...page.view.root.findAllByType('textarea'),
    ]
    for (const control of controls) {
      if ('value' in control.props) assert.notEqual(control.props.value, null)
      if ('checked' in control.props) assert.equal(typeof control.props.checked, 'boolean')
    }
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
