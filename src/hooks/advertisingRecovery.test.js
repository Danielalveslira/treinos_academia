import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

for (const kind of ['Selection', 'Validity']) {
  test(`advertising ${kind}: bounded backend recovery, old responses and teardown`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'ad-recovery-'))
    try {
      await build({
        stdin: {
          contents: `export { useAdvertising${kind} as useHook } from './useAdvertising${kind}.js'; export * from 'react'; export * from '../supabase/config';`,
          resolveDir: new URL('.', import.meta.url).pathname,
        },
        outfile: join(directory, 'test.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        plugins: [
          {
            name: 'environment',
            setup(b) {
              b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }))
              b.onResolve({ filter: /supabase\/config$/ }, () => ({
                path: 'backend',
                namespace: 'stub',
              }))
              b.onResolve({ filter: /useAuth$/ }, () => ({ path: 'auth', namespace: 'stub' }))
              b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
                contents:
                  path === 'react'
                    ? `
            export const updates = []; export const effects = [];
            export const useState = value => [value, next => updates.push(next)];
            export const useEffect = effect => effects.push(effect);
          `
                    : path === 'auth'
                      ? `export const useAuth = () => ({user: {uid: 'viewer'}})`
                      : `
            export const callbacks = {};
            export const supabase = { channel: () => ({
              on(_event, _filter, fn) { callbacks.invalidate = fn; return this },
              subscribe(fn) { callbacks.status = fn; return this }
            }), removeChannel() {} };
          `,
              }))
            },
          },
        ],
      })
      const env = createRequire(import.meta.url)(join(directory, 'test.cjs'))
      const timers = new Map()
      let sequence = 0
      const windowListeners = {}
      const operations = []
      t.mock.method(globalThis, 'setTimeout', (fn, delay) => {
        assert.ok(delay > 0)
        timers.set(++sequence, fn)
        return sequence
      })
      t.mock.method(globalThis, 'clearTimeout', (id) => timers.delete(id))
      globalThis.window = {
        addEventListener: (name, fn) => {
          windowListeners[name] = fn
        },
        removeEventListener: () => {},
        dispatchEvent: (event) => operations.push(event.detail),
      }
      globalThis.document = {
        hidden: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }
      const pending = []
      let calls = 0
      const fetchValue = () => {
        calls++
        return new Promise((resolve, reject) => pending.push({ resolve, reject }))
      }
      const flush = async () => {
        for (let i = 0; i < 8; i++) await Promise.resolve()
      }
      let commits = 0
      const response =
        kind === 'Selection'
          ? [{ id: 'paid', authorizationUntil: Infinity }]
          : {
              deadline: Infinity,
              commit() {
                commits++
              },
            }
      env.useHook('test', true, fetchValue)
      const cleanup = env.effects[0]()
      await flush()
      env.callbacks.status('SUBSCRIBED')
      const old = pending.shift()
      // Selection starts one initial query before subscription; validity does not.
      const current = pending.shift() || old
      current.resolve(response)
      await flush()
      const isVisible = () =>
        kind === 'Selection' ? env.updates.at(-1)?.data?.length > 0 : env.updates.at(-1)?.valid
      assert.equal(isVisible(), true)
      env.callbacks.status('CHANNEL_ERROR')
      assert.equal(isVisible(), false)
      pending.shift().resolve(response)
      await flush()
      assert.equal(isVisible(), true, 'fresh backend decision bridges a transient channel outage')
      for (let i = 0; i < 2; i++) {
        const timer = timers.entries().next().value
        assert.ok(timer, 'bounded recovery schedules its expiry')
        timers.delete(timer[0])
        timer[1]()
        pending.shift().resolve(response)
        await flush()
      }
      const before = calls
      env.callbacks.status('TIMED_OUT')
      windowListeners.focus()
      assert.equal(calls, before, 'repeated errors and focus cannot replenish recovery budget')
      assert.equal(isVisible(), false)
      const committedBefore = commits
      if (old !== current) old.resolve(response)
      await flush()
      assert.equal(isVisible(), false, 'old response cannot restore advertising')
      assert.equal(commits, committedBefore, 'obsolete data cannot overwrite the page')
      env.callbacks.status('SUBSCRIBED')
      pending.shift().reject(Object.assign(new Error('backend unavailable'), { code: '42501' }))
      await flush()
      assert.equal(isVisible(), false)
      assert.equal(operations.at(-1).type, 'backend_authorization_failed')
      windowListeners.focus()
      const last = pending.shift()
      cleanup()
      const updateCount = env.updates.length
      last.resolve(response)
      env.callbacks.status('CLOSED')
      await flush()
      assert.equal(
        env.updates.length,
        updateCount,
        'teardown discards late callbacks and responses'
      )
      assert.equal(timers.size, 0)
    } finally {
      delete globalThis.window
      delete globalThis.document
      await rm(directory, { recursive: true, force: true })
    }
  })
}
