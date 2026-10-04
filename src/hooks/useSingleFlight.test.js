import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let scenario

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'single-flight-tests-'))
  const outfile = join(directory, 'single-flight.cjs')
  await build({
    stdin: {
      contents: `
        import { useSingleFlight } from './useSingleFlight.js'
        export async function scenario(task) {
          const flight = useSingleFlight()
          return flight
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
        name: 'react-stub',
        setup(ctx) {
          ctx.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }))
          ctx.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
            contents: `
              export const useRef = (value) => ({ current: value })
              export const useState = (initial) => [
                typeof initial === 'function' ? initial() : initial,
                () => {},
              ]
              export const useCallback = (fn) => fn
            `,
          }))
        },
      },
    ],
  })
  ;({ scenario } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('duas chamadas com a mesma chave executam a tarefa uma única vez', async () => {
  const { run } = await scenario()
  let calls = 0
  let finish
  const pending = new Promise((resolve) => (finish = resolve))
  const task = async () => {
    calls += 1
    await pending
    return 'ok'
  }
  const first = run('delete:1', task)
  const second = run('delete:1', task)
  finish()
  assert.equal(await first, 'ok')
  assert.equal(await second, undefined)
  assert.equal(calls, 1)
})

test('chaves diferentes não se bloqueiam', async () => {
  const { run } = await scenario()
  let calls = 0
  await Promise.all([run('a', async () => calls++), run('b', async () => calls++)])
  assert.equal(calls, 2)
})

test('erro libera a chave para uma nova tentativa e continua propagando', async () => {
  const { run } = await scenario()
  await assert.rejects(
    run('a', async () => {
      throw new Error('falhou')
    }),
    /falhou/
  )
  assert.equal(await run('a', async () => 'depois'), 'depois')
})
