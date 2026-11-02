import { supabase } from '../supabase/config'
import {
  buildLegalAcceptancePayload,
  isValidLegalVersionParam,
  resolveHistoricalLegalBundle,
  resolveLegalBundle,
  selectLegalDocument,
} from '../utils/legal'
import { HEALTH_CONSENT_TEXT_VERSION } from '../utils/privacyConsent'

function mapPolicy(row) {
  return (
    row && {
      version: row.version,
      published: row.published,
      digest: row.digest,
      publishedAt: row.published_at,
    }
  )
}

function mapArchive(row) {
  return row && { manifest: row.manifest, documents: row.documents, digest: row.digest }
}

async function readLegalBundle(policy) {
  if (!policy?.version) throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  const { data, error } = await supabase
    .from('legal_versions')
    .select('*')
    .eq('version', policy.version)
    .maybeSingle()
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
  const [
    { data: policyRow, error: policyError },
    { data: restrictionRow, error: restrictionError },
  ] = await Promise.all([
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
  const restriction = restrictionRow && {
    action: restrictionRow.action,
    until: restrictionRow.until,
  }
  return { policy, restriction, legalBundle }
}

// source: 'signup' (cadastro) ou 'reacceptance' (LegalGate).
export async function acceptLegalDocuments(confirmations, legalBundle, source = 'reacceptance') {
  if (!legalBundle?.manifest?.version || !legalBundle?.digest) {
    throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  }
  const { error } = await supabase.rpc('accept_legal_documents', {
    payload: buildLegalAcceptancePayload({
      bundle: legalBundle,
      confirmed: confirmations,
      source,
      healthTextVersion: HEALTH_CONSENT_TEXT_VERSION,
    }),
  })
  if (error) throw error
}

// Leitura pública de uma versão publicada dos documentos gerais (inclusive antigas).
// Versões nunca publicadas não são retornadas pelo banco (RLS).
export async function getLegalVersionBundle(version) {
  if (!isValidLegalVersionParam(version)) return null
  const { data, error } = await supabase
    .from('legal_versions')
    .select('version, manifest, documents, digest, published_at')
    .eq('version', version)
    .maybeSingle()
  if (error) throw error
  return resolveHistoricalLegalBundle(version, data)
}

// Política vigente para LEITURA, mesmo quando este bundle do app ainda não conhece a versão
// (cliente com cache antigo). O aceite continua exigindo getActiveLegalBundle (estrito).
export async function getPublishedLegalPolicyForReading() {
  const { data, error } = await supabase.from('legal_policy').select('*').maybeSingle()
  if (error) throw error
  const policy = mapPolicy(data)
  if (!policy?.version || policy.published !== true) return null
  const bundle = await getLegalVersionBundle(policy.version)
  return bundle && bundle.digest === policy.digest ? { policy, ...bundle } : null
}

// Documentos comerciais específicos (registro único legal_document_*).
export async function getCommercialDocument(documentId, version = '') {
  let targetVersion = version
  let current = null
  const { data: policy, error: policyError } = await supabase
    .from('legal_document_policy')
    .select('document_id, version, digest, published_at')
    .eq('document_id', documentId)
    .maybeSingle()
  if (policyError) throw policyError
  current = policy?.version || null
  if (!targetVersion) targetVersion = current
  if (!targetVersion || !isValidLegalVersionParam(targetVersion)) return { current, document: null }
  const { data, error } = await supabase
    .from('legal_document_versions')
    .select('document_id, version, title, content, digest, published_at')
    .eq('document_id', documentId)
    .eq('version', targetVersion)
    .maybeSingle()
  if (error) throw error
  return { current, document: data || null }
}

export function isLegalPolicyChangedError(error) {
  return String(error?.message || '').includes('POLICY_MISMATCH')
}

async function readShowcaseLegacy(version) {
  const { data: policy, error: policyError } = await supabase
    .from('showcase_legal_policy')
    .select('version, published')
    .maybeSingle()
  if (policyError) throw policyError
  const current = policy?.published ? policy.version : null
  const target = version || current
  if (!target) return { current, document: null }
  const { data, error } = await supabase
    .from('showcase_legal_versions')
    .select('version, manifest, document')
    .eq('version', target)
    .maybeSingle()
  if (error) throw error
  // Versões legadas só são exibidas se já foram ativadas alguma vez (manifesto publicado).
  if (!data || data.manifest?.published !== true) return { current, document: null }
  return { current, legacy: data }
}

async function contactManifest() {
  try {
    return (await getPublishedLegalPolicyForReading())?.manifest || null
  } catch {
    return null
  }
}

// Monta a visão de leitura de qualquer documento jurídico. Nunca exibe minuta: o conteúdo
// vem apenas de versões publicadas no servidor (RLS) ou do pacote aprovado deste app.
export async function loadLegalDocumentView(
  documentId,
  requestedVersion,
  { generalIds, commercialIds }
) {
  const version = isValidLegalVersionParam(requestedVersion) ? requestedVersion : ''
  if (commercialIds.includes(documentId)) {
    let result = await getCommercialDocument(documentId, version)
    if (!result.document && documentId === 'showcase-publication-terms' && !result.current) {
      result = await readShowcaseLegacy(version)
    }
    const contact = await contactManifest()
    if (result.legacy) {
      return {
        status: 'ok',
        document: result.legacy.document,
        manifest: { ...result.legacy.manifest, published: true },
        currentVersion: result.current,
        contact,
      }
    }
    if (!result.document) {
      return {
        status: version ? 'version-not-found' : 'not-published',
        currentVersion: result.current,
        contact,
      }
    }
    const content = result.document.content
    return {
      status: 'ok',
      document: { ...content, id: documentId },
      manifest: {
        version: result.document.version,
        date: content.date || String(result.document.published_at || '').slice(0, 10),
        changes: content.changes || [],
        published: true,
      },
      currentVersion: result.current,
      contact,
    }
  }
  if (!generalIds.includes(documentId)) return { status: 'not-found' }

  let active = null
  try {
    active = await getActiveLegalBundle()
  } catch (error) {
    if (error?.message !== 'LEGAL_POLICY_INCOMPATIBLE') throw error
    // Cliente com cache antigo: lê a versão vigente diretamente do arquivo do servidor.
    active = await getPublishedLegalPolicyForReading()
  }
  if (!active) return { status: 'not-published' }
  let shown = active
  if (version && version !== active.manifest.version) {
    shown = await getLegalVersionBundle(version)
    if (!shown)
      return {
        status: 'version-not-found',
        currentVersion: active.manifest.version,
        contact: active.manifest,
      }
  }
  const document = selectLegalDocument(shown, documentId)
  if (!document) return { status: 'not-found' }
  return {
    status: 'ok',
    document,
    manifest: shown.manifest,
    currentVersion: active.manifest.version,
    contact: active.manifest,
    related: active.documents
      .filter((item) => item.id !== documentId)
      .map((item) => ({ id: item.id, title: item.title, path: item.path })),
  }
}
