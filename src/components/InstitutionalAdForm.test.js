import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let render
let roundTripPlacements
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'institutional-ad-form-'))
  const outfile = join(directory, 'form.cjs')
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { InstitutionalAdForm, initialInstitutionalAdValues, institutionalPlacementsFromValues } from './InstitutionalAdForm.jsx'
        export function render(initialValue) {
          return renderToStaticMarkup(React.createElement(InstitutionalAdForm, {
            initialValue, communities: [{ id: 'c1', name: 'Corrida', isActive: true }],
            onSubmit() {}, onCancel() {},
          }))
        }
        export function roundTripPlacements(initialValue) {
          return institutionalPlacementsFromValues(initialInstitutionalAdValues(initialValue))
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
  ;({ render, roundTripPlacements } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const ad = {
  id: 'a1',
  partnerName: 'Evolutus',
  title: 'Treine junto',
  description: 'Descrição do feed',
  imageUrl: 'https://t.supabase.co/image.png',
  ctaLabel: 'Participar',
  ctaType: 'internal',
  ctaTarget: '/app',
  expiresAt: null,
}

test('criação mostra quatro posicionamentos e oculta campos sem uso', () => {
  const html = render()
  for (const label of ['Página inicial', 'Progresso', 'Comunidade', 'Feed da comunidade'])
    assert.match(html, new RegExp(label))
  assert.doesNotMatch(html, /Descrição do card|Imagem do card|>Corrida</)
  assert.match(html, /sem cobrança de EvoCash/)
})

test('edição só do Progresso usa prévia compacta e omite imagem e descrição', () => {
  const html = render({ ...ad, placements: [{ code: 'progress_banner', contextId: null }] })
  assert.match(html, /sponsored-ad-banner--progress/)
  assert.doesNotMatch(html, /Descrição do card|Imagem do card|sponsored-ad-media|Descrição do feed/)
  assert.doesNotMatch(html, />Corrida</)
})

test('card de comunidade mostra seleção de contexto, imagem, descrição e botão real', () => {
  const html = render({ ...ad, placements: [{ code: 'community_feed', contextId: 'c1' }] })
  assert.match(html, /Corrida|Descrição do card|Imagem do card|sponsored-ad-media/)
  assert.match(html, /Descrição do feed|Participar/)
  assert.doesNotMatch(html, /sponsored-ad-banner--progress/)
})

test('edição preserva associações diferentes para banner e feed da comunidade', () => {
  const placements = [
    { code: 'home_banner', contextId: null },
    { code: 'progress_banner', contextId: null },
    { code: 'community_banner', contextId: 'c1' },
    { code: 'community_feed', contextId: 'c2' },
  ]
  assert.deepEqual(roundTripPlacements({ ...ad, placements }), placements)
  const html = render({ ...ad, placements })
  assert.match(html, /Comunidades do banner/)
  assert.match(html, /Comunidades do feed/)
})
