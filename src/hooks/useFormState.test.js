import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let exerciseConcurrentSubmit

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'form-state-tests-'))
  const outfile = join(directory, 'form-state.cjs')

  await build({
    stdin: {
      contents: `
        import { useFormState } from './useFormState.js'

        export async function exerciseConcurrentSubmit() {
          let calls = 0
          let finish
          const pending = new Promise((resolve) => { finish = resolve })
          const form = useFormState({
            initialValues: { name: 'Treino' },
            validate: () => ({}),
            onSubmit: async () => { calls += 1; await pending },
          })
          const event = { preventDefault() {} }
          const first = form.handleSubmit(event)
          const second = form.handleSubmit(event)
          finish()
          await Promise.all([first, second])
          return calls
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'react-hook-stub',
        setup(buildContext) {
          buildContext.onResolve({ filter: /^react$/ }, () => ({
            path: 'react',
            namespace: 'stub',
          }))
          buildContext.onResolve({ filter: /utils\/validators$/ }, () => ({
            path: 'validators',
            namespace: 'stub',
          }))
          buildContext.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
            contents: `
              export const useRef = (value) => ({ current: value })
              export const useState = (initial) => [
                typeof initial === 'function' ? initial() : initial,
                () => {},
              ]
            `,
          }))
          buildContext.onLoad({ filter: /^validators$/, namespace: 'stub' }, () => ({
            contents: `export const hasErrors = (errors) => Object.keys(errors).length > 0`,
          }))
        },
      },
    ],
  })

  ;({ exerciseConcurrentSubmit } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('shared form state ignores a concurrent submit while the first save is pending', async () => {
  assert.equal(await exerciseConcurrentSubmit(), 1)
})
