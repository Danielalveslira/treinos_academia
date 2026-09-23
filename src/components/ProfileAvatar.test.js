import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let ProfileAvatar

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'profile-avatar-'))
  const outfile = join(directory, 'avatar.cjs')
  await build({
    stdin: {
      contents: `export { ProfileAvatar } from './ProfileAvatar.jsx'`,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    plugins: [
      {
        name: 'avatar-dependencies',
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
          context.onResolve({ filter: /\/utils\/photoBlobCache$/ }, () => ({
            path: 'cache',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^icons$/, namespace: 'stub' }, () => ({
            contents: `export const PersonIcon = () => null`,
          }))
          context.onLoad({ filter: /^service$/, namespace: 'stub' }, () => ({
            contents: `export const loadAvatarBytes = async () => new Uint8Array([1])`,
          }))
          context.onLoad({ filter: /^cache$/, namespace: 'stub' }, () => ({
            contents: `export const getCachedPhotoUrl = (path) => path === 'old.webp' ? 'blob:old' : null; export const setCachedPhotoUrl = () => {}`,
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

test('a foto antiga desaparece imediatamente ao revogar ou trocar o caminho', () => {
  let renderer
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(ProfileAvatar, { path: 'old.webp', name: 'Ana' })
    )
  })
  assert.equal(renderer.root.findAllByType('img').length, 1)
  act(() => renderer.update(React.createElement(ProfileAvatar, { path: null, name: 'Ana' })))
  assert.equal(renderer.root.findAllByType('img').length, 0)
  act(() => renderer.unmount())
})
