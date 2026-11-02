import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HEALTH_CONSENT_TEXT,
  HEALTH_CONSENT_TEXT_VERSION,
  isHealthConsentRequiredError,
  mapPrivacyConsents,
} from './privacyConsent.js'

test('texto do consentimento exibido é idêntico ao gravado no banco', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20261212000001_legal_acceptance_integrity.sql', import.meta.url),
    'utf8'
  )
  const match = sql.match(/'health_data', '([a-z0-9-]+)',\s*'([^']+)'/)
  assert.ok(match, 'insert do texto encontrado na migration')
  assert.equal(match[1], HEALTH_CONSENT_TEXT_VERSION)
  assert.equal(match[2], HEALTH_CONSENT_TEXT)
})

test('consentimento ausente nunca é presumido', () => {
  assert.equal(mapPrivacyConsents(null).healthData.granted, false)
  assert.equal(mapPrivacyConsents({ healthData: { granted: 'true' } }).healthData.granted, false)
  assert.equal(mapPrivacyConsents({ healthData: { granted: true } }).healthData.granted, true)
})

test('consentimento concedido sobre texto antigo é sinalizado', () => {
  const state = mapPrivacyConsents({
    healthData: { granted: true, textVersion: 'health-data-0', activeTextVersion: 'health-data-1' },
  })
  assert.equal(state.healthData.outdated, true)
})

test('erro do servidor é reconhecido', () => {
  assert.equal(isHealthConsentRequiredError(new Error('HEALTH_CONSENT_REQUIRED')), true)
  assert.equal(isHealthConsentRequiredError(new Error('OTHER')), false)
})
