import test from 'node:test'
import assert from 'node:assert/strict'
import { validateOfflineReleaseConfig } from './check-offline-release-config.mjs'

const base = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'public-anon-key',
}

test('build aceita flags mestras e rejeita percentuais VITE obsoletos', () => {
  assert.deepEqual(validateOfflineReleaseConfig(base), [])
  assert.deepEqual(validateOfflineReleaseConfig({ ...base, VITE_OFFLINE_WRITE_ENABLED: 'true' }), [])
  assert.match(validateOfflineReleaseConfig({ ...base, VITE_OFFLINE_WRITE_ROLLOUT_PERCENT: '5' }).join(' '), /obsoleta/)
  assert.match(validateOfflineReleaseConfig({ ...base, VITE_OFFLINE_COLD_START_ROLLOUT_PERCENT: '0' }).join(' '), /obsoleta/)
})

test('segredos VITE e valores inválidos são recusados', () => {
  assert.match(validateOfflineReleaseConfig({ ...base, VITE_SUPABASE_SERVICE_ROLE_KEY: 'bad' }).join(' '), /não pode ser exposta/)
  assert.match(validateOfflineReleaseConfig({ ...base, VITE_OFFLINE_WRITE_ENABLED: 'yes' }).join(' '), /true ou false/)
})
