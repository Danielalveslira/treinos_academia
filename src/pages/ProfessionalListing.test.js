import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let render
let styles

before(async () => {
  styles = await readFile(new URL('../styles/app.css', import.meta.url), 'utf8')
  directory = await mkdtemp(join(tmpdir(), 'professional-listing-tests-'))
  const outfile = join(directory, 'listing.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ProfessionalListingView } from '../components/ProfessionalListingView.jsx'
        export const render = (listing, user = null) => renderToStaticMarkup(
          createElement(MemoryRouter, null,
            createElement(ProfessionalListingView, {
              listing,
              listingId: listing.id,
              user,
              notice: '',
              onShare() {},
            })
          )
        )
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
        name: 'professional-listing-stubs',
        setup(context) {
          context.onResolve(
            { filter: /^(react|react\/jsx-runtime|react-dom\/server|react-router-dom)$/ },
            ({ path }) => ({ path: require.resolve(path) })
          )
          context.onResolve({ filter: /^@primer\/react$/ }, () => ({
            path: 'primer',
            namespace: 'stub',
          }))
          context.onResolve({ filter: /^@primer\/octicons-react$/ }, () => ({
            path: 'icons',
            namespace: 'stub',
          }))
          context.onResolve({ filter: /StorefrontImage$/ }, () => ({
            path: 'avatar',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^primer$/, namespace: 'stub' }, () => ({
            contents: `
              export const Button = ({ as: Tag = 'button', children, leadingVisual: Icon, block, ...props }) =>
                <Tag data-block={block || undefined} {...props}>{Icon ? <Icon /> : null}{children}</Tag>
              export const Flash = ({ children }) => <div>{children}</div>
              export const Spinner = () => <span />
            `,
            loader: 'jsx',
          }))
          context.onLoad({ filter: /^icons$/, namespace: 'stub' }, () => ({
            contents: `
              export const LinkExternalIcon = () => <i />
              export const LocationIcon = () => <i />
              export const PeopleIcon = () => <i />
              export const ShareAndroidIcon = () => <i />
              export const ReportIcon = () => <i />
            `,
            loader: 'jsx',
          }))
          context.onLoad({ filter: /^avatar$/, namespace: 'stub' }, () => ({
            contents: 'export default function Image(){return null}',
            loader: 'jsx',
          }))
        },
      },
    ],
  })
  ;({ render } = require(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const BASE_LISTING = {
  id: 'listing-1',
  kind: 'professional',
  displayName: 'Ana Treinadora',
  categoryKey: 'personal_trainer',
  modalityKeys: ['musculacao'],
  specialties: [],
  bio: 'Acompanhamento individual.',
  city: 'São Paulo',
  uf: 'SP',
  serviceMode: 'hybrid',
  publicContacts: [],
  linkedCommunity: null,
  avatarPath: null,
}

const CONTACTS = [
  { type: 'whatsapp', url: 'https://wa.me/5511999999999' },
  { type: 'instagram', url: 'https://instagram.com/ana.treina' },
  { type: 'website', url: 'https://ana.example.com' },
]

test('a showcase without contacts renders no empty contact action', () => {
  const html = render(BASE_LISTING)
  assert.match(html, /Nenhum contato público informado/)
  assert.doesNotMatch(html, />WhatsApp<|>Instagram<|>Site</)
})

for (const count of [1, 2, 3]) {
  test(`a showcase with ${count} contact(s) renders exactly the available actions`, () => {
    const html = render({ ...BASE_LISTING, publicContacts: CONTACTS.slice(0, count) })
    assert.equal((html.match(/class="professional-contact-actions"/g) || []).length, 1)
    for (const contact of CONTACTS.slice(0, count)) assert.match(html, new RegExp(contact.url))
    for (const contact of CONTACTS.slice(count)) assert.doesNotMatch(html, new RegExp(contact.url))
  })
}

test('a long name and every modality remain inside wrapping layout containers', () => {
  const longName = 'Centro Integrado de Treinamento e Performance de Alta Intensidade'
  const modalities = [
    'musculacao',
    'corrida',
    'cross_training',
    'funcional',
    'ciclismo',
    'natacao',
    'lutas',
    'yoga',
    'pilates',
    'triatlo',
    'danca',
    'outros',
  ]
  const html = render({ ...BASE_LISTING, displayName: longName, modalityKeys: modalities })

  assert.match(html, new RegExp(longName))
  assert.match(html, /class="professional-detail-identity"/)
  assert.match(html, /class="professional-tags"/)
  assert.equal((html.match(/<span>/g) || []).length >= modalities.length, true)
})

test('mobile layout contract keeps safe gutters, wrapping content and full-width share action', () => {
  assert.match(styles, /\.professional-detail-page\s*\{[\s\S]*?env\(safe-area-inset-right\)/)
  assert.match(styles, /\.professional-detail-share\s*\{[^}]*width:\s*100%/)
  assert.match(styles, /\.professional-detail-hero h1\s*\{[^}]*overflow-wrap:\s*anywhere/)
  assert.match(
    styles,
    /\.professional-tags span\s*\{[^}]*max-width:\s*100%[^}]*overflow-wrap:\s*anywhere/
  )
  assert.match(styles, /@media \(max-width:\s*359px\)/)
})
