import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

const require = createRequire(import.meta.url)
let directory
let moduleUnderTest

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'community-avatars-'))
  const outfile = join(directory, 'avatars.cjs')
  await build({
    stdin: {
      contents: `
        import { useCommunityAuthorAvatars } from './useCommunityAuthorAvatars.js'
        export { listeners } from 'firebase/firestore'
        export { useCommunityAuthorAvatars }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'firestore-listener-stub',
        setup(context) {
          context.onResolve({ filter: /^react$/ }, () => ({
            path: require.resolve('react'),
            external: true,
          }))
          context.onResolve({ filter: /^firebase\/firestore$/ }, () => ({
            path: 'firestore',
            namespace: 'stub',
          }))
          context.onResolve({ filter: /\/firebase\/config$/ }, () => ({
            path: 'config',
            namespace: 'stub',
          }))
          context.onLoad({ filter: /^config$/, namespace: 'stub' }, () => ({
            contents: `export const db = {}`,
          }))
          context.onLoad({ filter: /^firestore$/, namespace: 'stub' }, () => ({
            contents: `
            export const listeners = new Map()
            export const doc = (_db, _collection, uid) => uid
            export const onSnapshot = (uid, next) => {
              listeners.set(uid, next)
              return () => listeners.delete(uid)
            }
          `,
          }))
        },
      },
    ],
  })
  moduleUnderTest = require(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('acompanha um perfil por autor, inclusive troca e remoção da foto', () => {
  let current
  function Probe({ statuses }) {
    current = moduleUnderTest.useCommunityAuthorAvatars(true, statuses)
    return null
  }
  let renderer
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(Probe, {
        statuses: [{ authorId: 'ana' }, { authorId: 'ana' }, { authorId: 'bia' }],
      })
    )
  })
  assert.equal(moduleUnderTest.listeners.size, 2)
  act(() =>
    moduleUnderTest.listeners.get('ana')({
      data: () => ({ avatarPath: 'profileAvatars/ana/first.webp' }),
    })
  )
  assert.equal(current.ana, 'profileAvatars/ana/first.webp')
  act(() =>
    moduleUnderTest.listeners.get('ana')({
      data: () => ({ avatarPath: 'profileAvatars/ana/new.webp' }),
    })
  )
  assert.equal(current.ana, 'profileAvatars/ana/new.webp')
  act(() => moduleUnderTest.listeners.get('ana')({ data: () => ({}) }))
  assert.equal(current.ana, null)
  act(() => renderer.unmount())
  assert.equal(moduleUnderTest.listeners.size, 0)
})
