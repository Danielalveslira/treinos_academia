import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let render

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'professional-card-tests-'))
  const outfile = join(directory, 'card.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ProfessionalListingCard } from './ProfessionalListingCard.jsx'
        export const render = (listing) => renderToStaticMarkup(
          createElement(MemoryRouter, null, createElement(ProfessionalListingCard, { listing }))
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
    plugins: [{
      name: 'professional-card-stubs',
      setup(context) {
        context.onResolve({ filter: /^(react|react\/jsx-runtime|react-router-dom)$/ }, ({ path }) => ({ path: require.resolve(path) }))
        context.onResolve({ filter: /^@primer\/react$/ }, () => ({ path: 'primer', namespace: 'stub' }))
        context.onResolve({ filter: /^@primer\/octicons-react$/ }, () => ({ path: 'icons', namespace: 'stub' }))
        context.onResolve({ filter: /ProfileAvatar$/ }, () => ({ path: 'avatar', namespace: 'stub' }))
        context.onLoad({ filter: /^primer$/, namespace: 'stub' }, () => ({ contents: `export const Button = ({as: Tag='button', children, ...props}) => <Tag {...props}>{children}</Tag>; export const Label = ({children}) => <span>{children}</span>`, loader: 'jsx' }))
        context.onLoad({ filter: /^icons$/, namespace: 'stub' }, () => ({ contents: `export const LocationIcon = () => <i>local</i>`, loader: 'jsx' }))
        context.onLoad({ filter: /^avatar$/, namespace: 'stub' }, () => ({ contents: `export const ProfileAvatar = ({path, professional}) => <span data-path={path || ''} data-professional={professional}>avatar</span>`, loader: 'jsx' }))
      },
    }],
  })
  ;({ render } = require(outfile))
})

after(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

const listing = {
  id: 'listing-1',
  kind: 'professional',
  displayName: 'Ana Treinadora',
  categoryKey: 'personal_trainer',
  modalityKeys: ['musculacao'],
  city: 'Recife',
  uf: 'PE',
  serviceMode: 'hybrid',
}

test('professional card renders approved avatar slot and public business data', () => {
  const html = render({ ...listing, avatarPath: 'approved/avatar.webp' })
  assert.match(html, /approved\/avatar.webp/)
  assert.match(html, /Ana Treinadora/)
  assert.match(html, /Recife, PE/)
  assert.match(html, /\/profissionais\/listing-1/)
})

test('space card requests the neutral icon fallback instead of a member avatar', () => {
  const html = render({ ...listing, kind: 'space', avatarPath: null })
  assert.match(html, /data-professional="false"/)
})
