import { Buffer } from 'node:buffer'
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

let getMyProfessionalListing

before(async () => {
  const { outputFiles } = await build({
    stdin: {
      contents:
        "export { getMyProfessionalListing } from './services/professionalListingsService.js'",
      resolveDir: 'src',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'firestore-listing-fixture',
        setup(pluginBuild) {
          pluginBuild.onResolve(
            { filter: /firebase\/firestore|firebase\/functions|firebase\/config$/ },
            (args) => ({ path: args.path, namespace: 'fixture' })
          )
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
            if (path.endsWith('config'))
              return { contents: 'export const db = {}; export const functions = {}' }
            if (path.endsWith('functions'))
              return {
                contents:
                  'export const httpsCallable = () => () => Promise.resolve({ data: null })',
              }
            return {
              contents: `
              export const doc = (_db, ...parts) => ({ path: parts.join('/') })
              export const collection = (_db, path) => ({ path })
              export const getDoc = async (ref) => {
                globalThis.__listingReads.push(ref.path)
                const value = globalThis.__listingDocs[ref.path]
                if (value instanceof Error) throw value
                return { exists: () => value !== undefined, data: () => value }
              }
              export const getDocs = async () => ({ docs: [], size: 0 })
              export const limit = () => null
              export const orderBy = () => null
              export const query = () => null
              export const startAfter = () => null
              export const where = () => null
            `,
            }
          })
        },
      },
    ],
  })
  ;({ getMyProfessionalListing } = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
  ))
})

function fixture(lifecycleState = 'draft') {
  globalThis.__listingReads = []
  globalThis.__listingDocs = {
    'professionalListingOwnerLocks/owner': { listingId: 'listing-1' },
    'professionalListings/listing-1': { ownerId: 'owner', kind: 'professional', lifecycleState },
    'professionalListingDrafts/listing-1': { ownerId: 'owner', reviewState: 'draft' },
  }
}

test('the draft editor never reads a public projection that does not exist yet', async () => {
  fixture()
  const record = await getMyProfessionalListing('owner')
  assert.equal(record.published, null)
  assert.deepEqual(globalThis.__listingReads, [
    'professionalListingOwnerLocks/owner',
    'professionalListings/listing-1',
    'professionalListingDrafts/listing-1',
  ])
})

test('a published listing includes its readable public projection', async () => {
  fixture('published')
  globalThis.__listingDocs['publishedProfessionalListings/listing-1'] = {
    publicationStatus: 'published',
    displayName: 'Vitrine pública',
  }
  const record = await getMyProfessionalListing('owner')
  assert.equal(record.published.displayName, 'Vitrine pública')
  assert.equal(globalThis.__listingReads.at(-1), 'publishedProfessionalListings/listing-1')
})

test('a projection removed during loading cannot block the private editor', async () => {
  fixture('published')
  globalThis.__listingDocs['publishedProfessionalListings/listing-1'] = Object.assign(
    new Error('Missing or insufficient permissions.'),
    { code: 'permission-denied' }
  )
  const record = await getMyProfessionalListing('owner')
  assert.equal(record.listing.lifecycleState, 'published')
  assert.equal(record.published, null)
})
