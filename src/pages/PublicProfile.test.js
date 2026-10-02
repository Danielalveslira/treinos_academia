import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Regressão do crash "n.toDate is not a function" em PublicProfile (aberto a partir de "Quem curtiu"):
// public_profile_statistics.updated_at chega como string ISO do Supabase, nunca como Timestamp.
// renderToStaticMarkup só (nunca act()/TestRenderer -- ver o aviso em PostSupportersDialog.test.js).
let directory
async function bundle() {
  directory = await mkdtemp(join(tmpdir(), 'public-profile-tests-'))
  const outfile = join(directory, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { PublicProfileView } from './PublicProfile.jsx'
        export const render = (props) => renderToStaticMarkup(createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(MemoryRouter, null,
            createElement(PublicProfileView, { onRetry() {}, ...props })))))
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [
      {
        name: 'service-fixtures',
        setup(pluginBuild) {
          pluginBuild.onResolve(
            { filter: /\/services\/(publicProfilesService|profileAvatarService)$/ },
            (args) => ({
              path: args.path,
              namespace: 'fixture',
            })
          )
          pluginBuild.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: `
              export const getPublicProfile = async () => null
              export const getPublicStatistics = async () => null
              export const loadAvatarBytes = async () => new Uint8Array()
            `,
          }))
        },
      },
    ],
    logLevel: 'silent',
  })
  return createRequire(import.meta.url)(outfile)
}

const { render } = await bundle()
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const PROFILE = {
  id: 'u1',
  username: 'maria',
  bio: 'Treino de manhã',
  shareStatistics: true,
  avatarPath: null,
}
const STATS = { entries: 1200, sets: 3400.5, updatedAt: '2026-10-02T12:41:00.000Z' }
const ready = (result) => ({ ready: true, result: { userId: 'u1', attempt: 0, ...result } })

test('does not crash when statistics.updatedAt is an ISO string (the toDate bug) and shows the date', () => {
  const html = render(ready({ profile: PROFILE, statistics: STATS }))
  assert.match(html, /@maria/)
  assert.match(html, /Atualizado em/)
  assert.match(html, /2026|26/)
  assert.doesNotMatch(html, /Invalid Date/)
})

test('statistics.updatedAt null or invalid degrades to "—", never throws', () => {
  for (const updatedAt of [null, undefined, 'lixo']) {
    const html = render(ready({ profile: PROFILE, statistics: { ...STATS, updatedAt } }))
    assert.match(html, /Atualizado em —/)
  }
})

test('a legacy Timestamp-like updatedAt still renders (compatibility), through the single date helper', () => {
  const html = render(
    ready({
      profile: PROFILE,
      statistics: { ...STATS, updatedAt: { toDate: () => new Date('2026-10-02T12:41:00Z') } },
    })
  )
  assert.match(html, /Atualizado em/)
  assert.doesNotMatch(html, /Atualizado em —/)
})

test('deleted account or missing public_profiles row: "Perfil ainda indisponível", no crash', () => {
  const html = render(ready({ profile: null }))
  assert.match(html, /Perfil ainda indisponível/)
})

test('null username, bio and avatar degrade to "Membro" and the default bio', () => {
  const html = render(
    ready({
      profile: { ...PROFILE, username: null, bio: null, avatarPath: null, shareStatistics: false },
    })
  )
  assert.match(html, /Membro/)
  assert.match(html, /Este membro ainda não adicionou uma descrição\./)
  assert.match(html, /prefere manter suas estatísticas privadas/)
})

test('shared statistics not published yet and load errors have their own fallbacks', () => {
  assert.match(
    render(ready({ profile: PROFILE, statistics: null })),
    /Nenhum resumo compartilhado ainda/
  )
  assert.match(
    render(ready({ profile: PROFILE, statistics: null, statisticsError: true })),
    /Estatísticas indisponíveis/
  )
  assert.match(render(ready({ error: true })), /Não foi possível carregar o perfil/)
  assert.match(render({ ready: false, result: null }), /Carregando perfil/)
})
