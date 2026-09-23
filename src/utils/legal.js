import manifest from '../../functions/legal/manifest.json' with { type: 'json' }
import documents from '../../functions/legal/documents.json' with { type: 'json' }
import approvedDigests from '../../functions/legal/approved-digests.json' with { type: 'json' }

export const LEGAL_MANIFEST = manifest
export const LEGAL_DOCUMENTS = documents
export const APPROVED_LEGAL_DIGESTS = approvedDigests
export const SUPPORTED_LEGAL_VERSIONS = Object.keys(approvedDigests)

export async function calculateLegalDigest(versionManifest, versionDocuments) {
  if (!globalThis.crypto?.subtle) throw new Error('LEGAL_CRYPTO_UNAVAILABLE')
  const payload = JSON.stringify({ manifest: versionManifest, documents: versionDocuments })
  const bytes = new TextEncoder().encode(payload)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function resolveLegalBundle(policy, archive) {
  const version = policy?.version
  const expectedDigest = APPROVED_LEGAL_DIGESTS[version]
  if (
    !expectedDigest ||
    policy?.published !== true ||
    policy.digest !== expectedDigest ||
    !archive ||
    archive.digest !== expectedDigest ||
    archive.manifest?.version !== version ||
    archive.manifest?.published !== true ||
    !Array.isArray(archive.documents) ||
    archive.documents.length === 0
  ) {
    throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  }
  if ((await calculateLegalDigest(archive.manifest, archive.documents)) !== expectedDigest) {
    throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  }
  return {
    manifest: archive.manifest,
    documents: archive.documents,
    digest: expectedDigest,
  }
}

export function selectLegalDocument(bundle, documentId, requestedVersion = '') {
  if (!bundle?.manifest || (requestedVersion && requestedVersion !== bundle.manifest.version)) {
    return null
  }
  return bundle.documents.find((document) => document.id === documentId) || null
}

export function canSubmitLegalRegistration({ bundle, loading, confirmed }) {
  return Boolean(
    !loading &&
      bundle?.manifest?.published === true &&
      bundle?.digest === APPROVED_LEGAL_DIGESTS[bundle.manifest.version] &&
      confirmed?.accepted === true &&
      confirmed?.healthDataConsent === true
  )
}

export function legalConsentDocumentLinks(bundle) {
  const version = bundle?.manifest?.version
  if (!version || !APPROVED_LEGAL_DIGESTS[version]) return []
  return [
    { label: 'Termos de Uso', to: `/termos-de-uso?version=${version}` },
    { label: 'Regras da Comunidade', to: `/regras-da-comunidade?version=${version}` },
    { label: 'Política de Privacidade', to: `/politica-de-privacidade?version=${version}` },
  ]
}

export function needsLegalAcceptance(acceptance, policy) {
  return (
    !acceptance ||
    !policy?.version ||
    !policy?.digest ||
    acceptance.version !== policy.version ||
    acceptance.digest !== policy.digest ||
    !acceptance.acceptedAt
  )
}

export function isAccountRestricted(restriction, now = Date.now()) {
  if (!restriction) return false
  if (restriction.action === 'system_ban') return true
  const until = restriction.until?.toMillis?.() ?? new Date(restriction.until).getTime()
  return restriction.action === 'temporary_suspension' && until > now
}

// LegalGate.jsx: a policy é considerada desatualizada quando a versão publicada em
// legalPolicy/current diverge da versão que este bundle espera, ou quando ela ainda
// não foi publicada -- nos dois casos, ninguém deveria conseguir aceitar (o servidor
// também recusaria, ver validateAcceptance em functions/legal-core.js). access null
// (ainda carregando) nunca é "desatualizado": é "desconhecido".
export function isLegalPolicyOutdated(access) {
  return Boolean(
    access &&
    (!access.legalBundle ||
      access.policy?.version !== access.legalBundle.manifest.version ||
      access.policy?.digest !== access.legalBundle.digest ||
      access.policy?.published !== true)
  )
}

// Versões anteriores guardavam policy + ausência de restrição em sessionStorage e
// chegavam a liberar o app antes da leitura fresca. Como uma restrição pode ser criada
// depois desse registro, nenhum cache do navegador é autoritativo para acesso legal.
// A limpeza acontece em toda troca de autenticação e remove também chaves deixadas por
// bundles antigos, sem tocar nos demais dados da sessão.
export function clearCachedLegalAccess(storage = globalThis.sessionStorage) {
  try {
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index)
      if (key?.startsWith('legalAccess:')) storage.removeItem(key)
    }
  } catch {
    // sessionStorage pode não existir ou estar bloqueado; o acesso fresco não depende dele.
  }
}

export function resolveLegalGateState({ profile, access, loading, error }) {
  if (!profile || loading || (!access && !error)) return 'loading'
  if (error) return 'error'
  if (isAccountRestricted(access.restriction)) return 'restricted'

  const policyUnavailable = isLegalPolicyOutdated(access)
  // O superadmin precisa alcançar o painel que publica/corrige legalPolicy/current.
  // Assim que a policy fica válida, ele volta ao mesmo requisito de aceite dos demais.
  if (policyUnavailable) return profile.role === 'superadmin' ? 'allowed' : 'policy-unavailable'

  return needsLegalAcceptance(profile.legalAcceptance, access.policy)
    ? 'acceptance-required'
    : 'allowed'
}
