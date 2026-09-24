import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

// Diferente de ProfileAvatar.test.js (que troca utils/photoBlobCache por um duplo de
// teste simples), este arquivo usa o módulo de cache DE VERDADE -- é exatamente o
// mecanismo de deduplicação (loadPhotoOnce) que está sendo verificado aqui: duas
// montagens concorrentes do MESMO path (o cenário do print -- o mesmo autor duas
// vezes na tela) devem resultar em UMA única chamada a loadAvatarBytes.
const require = createRequire(import.meta.url)
let directory
let ProfileAvatar
let calls

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'profile-avatar-dedup-'))
  const outfile = join(directory, 'avatar.cjs')
  await build({
    stdin: {
      contents: `export { ProfileAvatar } from './ProfileAvatar.jsx'`,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    plugins: [
      {
        name: 'avatar-dedup-dependencies',
        setup(context) {
          context.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, ({ path }) => ({
            path: require.resolve(path),
            external: true,
          }))
          context.onResolve({ filter: /^@primer\/octicons-react$/ }, () => ({
            path: 'icons',
            namespace: 'stub',
          }))
          context.onResolve({ filter: /\/services\/profileAvatarService$/ }, () => ({
            path: 'service',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^icons$/, namespace: 'stub' }, () => ({
            contents: `export const PersonIcon = () => null`,
          }))
          context.onLoad({ filter: /^service$/, namespace: 'stub' }, () => ({
            contents: `
              export const loadAvatarBytes = (path) => globalThis.__loadAvatarBytes(path)
            `,
          }))
        },
      },
    ],
  })
  ;({ ProfileAvatar } = require(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('two ProfileAvatar mounted at the same time with the same path fetch it only once', async () => {
  calls = 0
  let resolveFetch
  globalThis.__loadAvatarBytes = () => {
    calls += 1
    return new Promise((resolve) => {
      resolveFetch = resolve
    })
  }

  let renderer
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(ProfileAvatar, { path: 'profileAvatars/u1/dedup.webp', name: 'A' }),
        React.createElement(ProfileAvatar, { path: 'profileAvatars/u1/dedup.webp', name: 'A' })
      )
    )
  })

  assert.equal(calls, 1, 'both cards share one in-flight fetch for the same path')

  await act(async () => resolveFetch(new Uint8Array([1, 2, 3])))
  assert.equal(renderer.root.findAllByType('img').length, 2, 'both cards render the resolved image')

  delete globalThis.__loadAvatarBytes
  renderer.unmount()
})
