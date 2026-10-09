import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let render

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sponsored-ad-form-tests-'))
  const outfile = join(directory, 'form.cjs')
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { SponsoredAdForm } from './SponsoredAdForm.jsx'
        export function render(initialValue) {
          return renderToStaticMarkup(
            React.createElement(SponsoredAdForm, {
              initialValue, communities: [], adCountByCommunityId: {}, globalAdCount: 0,
              onSubmit() {}, onCancel() {},
            })
          )
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'jsx',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    define: {
      'import.meta.env':
        '{"VITE_SUPABASE_URL":"https://t.supabase.co","VITE_SUPABASE_ANON_KEY":"k"}',
    },
  })
  ;({ render } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

// Linha do banco como o toDoc devolve: colunas opcionais (imagem, CTA, validade) vêm null.
const adFromDb = {
  id: 'a1',
  partnerName: 'Marca X',
  title: 'Oferta',
  description: '',
  imageUrl: null,
  ctaLabel: null,
  ctaType: null,
  ctaTarget: null,
  expiresAt: null,
  communityIds: [],
  isGlobal: true,
  displayMode: ['banner'],
}

test('editar campanha sem imagem/CTA/validade (valores null do banco) abre o formulário sem erro', () => {
  const html = render(adFromDb)
  assert.match(html, /Marca X/)
  assert.match(html, /Link da imagem/)
})

test('editar campanha com imagem externa mostra o aviso de rastreamento', () => {
  const html = render({ ...adFromDb, imageUrl: 'https://cdn.exemplo.com/a.png' })
  assert.match(html, /site externo/)
})

test('nova campanha (sem valor inicial) continua abrindo', () => {
  assert.match(render(undefined), /Link da imagem/)
})
