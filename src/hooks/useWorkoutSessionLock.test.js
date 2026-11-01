import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { useWorkoutSessionLock } from './useWorkoutSessionLock.js'

test('only one tab may edit a sheet and the other can retry after release', async () => {
  const held = new Set()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: async (name, options, callback) => {
          if (held.has(name)) return callback(null)
          held.add(name)
          try {
            return await callback({ name })
          } finally {
            held.delete(name)
          }
        },
      },
    },
  })
  const states = [null, null]
  const retries = [null, null]
  function Tab({ index }) {
    const lock = useWorkoutSessionLock('user', 'sheet', '2026-10-30')
    states[index] = lock.state
    retries[index] = lock.retry
    return null
  }
  let first
  let second
  try {
    await act(async () => {
      first = TestRenderer.create(React.createElement(Tab, { index: 0 }))
    })
    assert.equal(states[0], 'owner')
    await act(async () => {
      second = TestRenderer.create(React.createElement(Tab, { index: 1 }))
    })
    assert.equal(states[1], 'blocked')
    await act(async () => {
      first.unmount()
    })
    await act(async () => {
      retries[1]()
    })
    assert.equal(states[1], 'owner')
  } finally {
    await act(async () => {
      second?.unmount()
      first?.unmount()
    })
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete globalThis.navigator
  }
})
