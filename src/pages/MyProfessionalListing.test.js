import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
let directory, mount, act
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'professional-owner-'))
  await build({
    stdin: {
      contents: `import React from 'react';import TestRenderer,{act} from 'react-test-renderer';import Page from './MyProfessionalListing.jsx';export {act};export const mount=()=>TestRenderer.create(<Page listingId="profile-1"/>);`,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'jsx',
    },
    outfile: join(directory, 'page.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    plugins: [
      {
        name: 'fixtures',
        setup(b) {
          const map = new Map([
            ['../hooks/useAuth', `export const useAuth=()=>globalThis.__fixture.auth`],
            ['../services/communitiesService', `export const listActiveCommunities=async()=>[]`],
            [
              '../services/professionalListingsService',
              `export const getMyProfessionalListing=(...a)=>globalThis.__fixture.get(...a);export const createProfessionalListing=(...a)=>globalThis.__fixture.create(...a);export const saveProfessionalListing=(...a)=>globalThis.__fixture.save(...a);export const setProfessionalListingEditorial=(...a)=>globalThis.__fixture.moderate(...a);export const listListingCommercialOrders=async()=>[];`,
            ],
            ['../services/usageProfileService', `export const setUsageProfile=async()=>{}`],
            [
              '../services/storefrontService',
              `export const uploadStorefrontImage=(...a)=>globalThis.__fixture.upload(...a)`,
            ],
            [
              '../components/ProfessionalListingForm',
              `import React from 'react';export default function Form(p){globalThis.__form=p;return <form onSubmit={p.onSubmit}><button type="submit">Salvar rascunho</button></form>}`,
            ],
            [
              '../components/CommercialLeasePurchase',
              `import React from 'react';export default function Lease(p){globalThis.__lease=p;return <div>Contratação autorizada</div>}`,
            ],
            [
              '../components/CommercialOrderHistory',
              `export default function History(){return null}`,
            ],
            ['../components/ListingLegalNotice', `export default function Notice(){return null}`],
            ['../components/StorefrontImage', `export default function Image(){return null}`],
            ['../components/UsageProfileField', `export const UsageProfileField=()=>null`],
            [
              'react-router-dom',
              `import React from 'react';export const Link=({to,children})=><a href={to}>{children}</a>`,
            ],
            [
              '@primer/react',
              `import React from 'react';export const Box=({as:Tag='div',children,...p})=><Tag {...p}>{children}</Tag>;export const Heading=({as:Tag='h1',children})=><Tag>{children}</Tag>;export const Button=({children,...p})=><button {...p}>{children}</button>;export const Text=({as:Tag='span',children})=><Tag>{children}</Tag>;export const Label=({children})=><span>{children}</span>;export const Flash=({children})=><div>{children}</div>;export const Spinner=()=>null;export const Dialog=({children})=><div>{children}</div>;`,
            ],
          ])
          b.onResolve({ filter: /^(react|react-test-renderer|react\/jsx-runtime)$/ }, (a) => ({
            path: createRequire(import.meta.url).resolve(a.path),
            external: true,
          }))
          b.onResolve({ filter: /.*/ }, (a) =>
            map.has(a.path) ? { path: a.path, namespace: 'fixture' } : null
          )
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
            contents: map.get(a.path),
            loader: 'jsx',
            resolveDir: new URL('.', import.meta.url).pathname,
          }))
        },
      },
    ],
  })
  ;({ mount, act } = createRequire(import.meta.url)(join(directory, 'page.cjs')))
})
after(async () => {
  await rm(directory, { recursive: true, force: true })
  delete globalThis.__fixture
  delete globalThis.__form
  delete globalThis.__lease
})
const record = () => ({
  id: 'profile-1',
  listing: { kind: 'professional', lifecycleState: 'published' },
  draft: {
    kind: 'professional',
    version: 2,
    reviewState: 'approved',
    displayName: 'Approved',
    bio: 'Previous bio',
    contacts: { website: 'https://example.invalid' },
    specialties: [],
    modalityKeys: [],
  },
  published: { displayName: 'Approved' },
  commercial: {
    canContract: true,
    state: 'private',
    publishedRevision: '2',
    tariff: { salesEnabled: false },
  },
})
async function start(row = record(), extra = {}) {
  globalThis.__lease = null
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const calls = []
  globalThis.__fixture = {
    auth: { user: { uid: 'owner' }, profile: { usageProfile: 'professional' } },
    get: async () => row,
    create: async (kind) => calls.push(['create', kind]),
    save: async (id, draft, revision) => {
      calls.push(['save', id, draft, revision])
      return { version: 3 }
    },
    moderate: async (...args) => calls.push(['moderate', ...args]),
    upload: async () => 'uploaded-private',
    ...extra,
  }
  let view
  await act(async () => {
    view = mount()
    await new Promise((r) => setTimeout(r, 5))
  })
  return {
    view,
    calls,
    text: () => JSON.stringify(view.toJSON()),
    button: (text) =>
      view.root.findAll((n) => n.type === 'button' && n.children.join('') === text)[0],
  }
}
async function stop(page) {
  await act(async () => page.view.unmount())
}
test('owner submits current edited fields with the saved revision and never publishes directly', async () => {
  const p = await start()
  try {
    await act(async () =>
      globalThis.__form.onChange({
        ...globalThis.__form.form,
        bio: 'Pending changes',
        contacts: { website: 'https://example.invalid/new' },
      })
    )
    await act(async () => p.button('Enviar para aprovação').props.onClick())
    assert.equal(p.calls[0][0], 'save')
    assert.equal(p.calls[0][2].bio, 'Pending changes')
    assert.equal(p.calls[0][3], 2)
    assert.deepEqual(p.calls[1], ['moderate', 'profile-1', 3, 'submitted'])
    assert.match(p.text(), /Nenhum EvoCash foi debitado/)
  } finally {
    await stop(p)
  }
})
test('failed save never submits or reports success just because an old publication exists', async () => {
  const p = await start(record(), {
    save: async () => {
      throw Error('EDITORIAL_REVISION_CONFLICT')
    },
  })
  try {
    await act(async () => p.button('Enviar para aprovação').props.onClick())
    assert.equal(p.calls.length, 0)
    assert.match(p.text(), /Atualize/)
    assert.doesNotMatch(p.text(), /Versão enviada para aprovação/)
  } finally {
    await stop(p)
  }
})
test('rapid repeated submit has one save and one moderation request', async () => {
  const p = await start()
  try {
    await act(async () => {
      const click = p.button('Enviar para aprovação').props.onClick
      click()
      click()
      await new Promise((r) => setTimeout(r, 5))
    })
    assert.equal(p.calls.filter((c) => c[0] === 'save').length, 1)
    assert.equal(p.calls.filter((c) => c[0] === 'moderate').length, 1)
  } finally {
    await stop(p)
  }
})
test('uploaded image changes draft form without automatically saving or publishing it', async () => {
  const p = await start()
  try {
    await act(async () => globalThis.__form.onUpload({ name: 'image.png' }))
    assert.equal(globalThis.__form.form.mediaId, 'uploaded-private')
    assert.equal(p.calls.length, 0)
    assert.match(p.text(), /Imagem enviada privadamente/)
  } finally {
    await stop(p)
  }
})
test('suspended resource has no purchase component and cannot be resubmitted by owner', async () => {
  const row = record()
  row.listing.lifecycleState = 'suspended'
  row.commercial.canContract = false
  row.commercial.state = 'suspended'
  const p = await start(row)
  try {
    assert.equal(globalThis.__lease, null)
    assert.equal(p.button('Enviar para aprovação').props.disabled, true)
    assert.match(p.text(), /pagamento não remove a suspensão/)
  } finally {
    await stop(p)
  }
})
test('archive keeps an explicit revision and never invokes a destructive delete', async () => {
  const p = await start()
  try {
    await act(async () => p.button('Arquivar cadastro').props.onClick())
    assert.deepEqual(p.calls, [['moderate', 'profile-1', 2, 'archived']])
    assert.match(p.text(), /Dados e contratos foram preservados/)
  } finally {
    await stop(p)
  }
})
test('new drafts with a null mode submit the visible default instead of an empty value', async () => {
  const row = record()
  row.draft.serviceMode = null
  const p = await start(row)
  try {
    await act(async () => p.button('Enviar para aprovação').props.onClick())
    assert.equal(p.calls[0][2].serviceMode, 'in_person')
  } finally {
    await stop(p)
  }
})

test('editor loads and reloads the exact scalar ID supplied by the central', async () => {
  const reads = [],
    row = record(),
    p = await start(row, {
      get: async (...args) => {
        reads.push(args)
        return row
      },
    })
  try {
    await act(async () => p.button('Enviar para aprovação').props.onClick())
    assert.ok(reads.length >= 2)
    for (const args of reads) assert.deepEqual(args, ['profile-1'])
  } finally {
    await stop(p)
  }
})
