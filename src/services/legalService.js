import { supabase } from '../supabase/config'
import { resolveLegalBundle } from '../utils/legal'

function mapPolicy(row) {
  return row && { version: row.version, published: row.published, digest: row.digest, publishedAt: row.published_at }
}

function mapArchive(row) {
  return row && { manifest: row.manifest, documents: row.documents, digest: row.digest }
}

async function readLegalBundle(policy) {
  if (!policy?.version) throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  const { data, error } = await supabase.from('legal_versions').select('*').eq('version', policy.version).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  return resolveLegalBundle(policy, mapArchive(data))
}

export async function getActiveLegalBundle() {
  const { data, error } = await supabase.from('legal_policy').select('*').maybeSingle()
  if (error) throw error
  const policy = mapPolicy(data)
  if (!policy?.version) throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  return { policy, ...(await readLegalBundle(policy)) }
}

export async function getLegalAccess(userId) {
  const [{ data: policyRow, error: policyError }, { data: restrictionRow, error: restrictionError }] =
    await Promise.all([
      supabase.from('legal_policy').select('*').maybeSingle(),
      supabase.from('account_restrictions').select('*').eq('user_id', userId).maybeSingle(),
    ])
  if (policyError) throw policyError
  if (restrictionError) throw restrictionError
  const policy = mapPolicy(policyRow)
  let legalBundle = null
  if (policy?.version) {
    try {
      legalBundle = await readLegalBundle(policy)
    } catch (error) {
      if (error?.message !== 'LEGAL_POLICY_INCOMPATIBLE') throw error
    }
  }
  const restriction = restrictionRow && { action: restrictionRow.action, until: restrictionRow.until }
  return { policy, restriction, legalBundle }
}

export async function acceptLegalDocuments(confirmations, legalBundle) {
  if (!legalBundle?.manifest?.version || !legalBundle?.digest) {
    throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  }
  const { error } = await supabase.rpc('accept_legal_documents', {
    payload: {
      version: legalBundle.manifest.version,
      digest: legalBundle.digest,
      manifest: legalBundle.manifest,
      documents: legalBundle.documents,
      ...confirmations,
    },
  })
  if (error) throw error
}

export function isLegalPolicyChangedError(error) {
  return String(error?.message || '').includes('POLICY_MISMATCH')
}
