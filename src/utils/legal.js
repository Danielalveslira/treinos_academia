import { toMillis } from './date.js'
import manifest from '../../legal/manifest.json' with { type: 'json' }
import documents from '../../legal/documents.json' with { type: 'json' }
import approvedDigests from '../../legal/approved-digests.json' with { type: 'json' }
import archive13 from '../../legal/test-fixtures/1.3.0.json' with { type: 'json' }
import archive14 from '../../legal/test-fixtures/1.4.0.json' with { type: 'json' }

export const LEGAL_MANIFEST = manifest
export const LEGAL_DOCUMENTS = documents
export const APPROVED_LEGAL_DIGESTS = approvedDigests
export const SUPPORTED_LEGAL_VERSIONS = Object.keys(approvedDigests)
const approvedArchives = {
  // Versões anteriores continuam aceitas: a 1.4.0 nunca é editada (fixture imutável) e quem tem a 1.4.0 vigente no
  // banco segue funcionando até a 1.5.0 ser publicada em legal_policy.
  '1.3.0': archive13,
  '1.4.0': archive14,
  '1.5.0': { manifest, documents },
}

async function calculateLegalDigest(versionManifest, versionDocuments) {
  if (!globalThis.crypto?.subtle) throw new Error('LEGAL_CRYPTO_UNAVAILABLE')
  const payload = JSON.stringify({ manifest: versionManifest, documents: versionDocuments })
  const bytes = new TextEncoder().encode(payload)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function legalArchiveContentMatches(version, archive) {
  if (!Object.hasOwn(approvedArchives, version)) return false
  const approved = approvedArchives[version]
  if (!approved || !archive) return false
  return (
    canonicalJson({ manifest: archive.manifest, documents: archive.documents }) ===
    canonicalJson({ manifest: approved.manifest, documents: approved.documents })
  )
}

export async function resolveLegalBundle(policy, archive) {
  const version = policy?.version
  if (!Object.hasOwn(APPROVED_LEGAL_DIGESTS, version)) {
    throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  }
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
    archive.documents.length === 0 ||
    !legalArchiveContentMatches(version, archive)
  ) {
    throw new Error('LEGAL_POLICY_INCOMPATIBLE')
  }
  const approved = approvedArchives[version]
  if ((await calculateLegalDigest(approved.manifest, approved.documents)) !== expectedDigest) {
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
      Object.hasOwn(APPROVED_LEGAL_DIGESTS, bundle?.manifest?.version) &&
      bundle?.digest === APPROVED_LEGAL_DIGESTS[bundle.manifest.version] &&
      confirmed?.accepted === true &&
      confirmed?.healthDataConsent === true
  )
}

export function legalConsentDocumentLinks(bundle) {
  const version = bundle?.manifest?.version
  if (!version || !Object.hasOwn(APPROVED_LEGAL_DIGESTS, version)) return []
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
  const until = toMillis(restriction.until)
  return restriction.action === 'temporary_suspension' && until > now
}

// Estado de bloqueio da conta para fins de UI (gate), numa ordem de precedência fixa --
// 'deleting'/'disabled' (users.account_status) sempre primeiro, pois são mais definitivos que
// uma restrição que pode já ter expirado. Usa a MESMA checagem de restrição de
// isAccountRestricted (nunca reimplementada), só que distinguindo banida de suspensa (que
// isAccountRestricted colapsa num booleano só, suficiente para o LegalGate mas não para
// escolher qual aviso mostrar). null = conta sem bloqueio conhecido no momento.
export function resolveAccountBlockState({ profile, restriction, now = Date.now() }) {
  if (!profile) return null
  if (profile.accountStatus === 'deleting') return 'deleting'
  if (profile.accountStatus === 'disabled') return 'disabled'
  if (!isAccountRestricted(restriction, now)) return null
  return restriction.action === 'system_ban' ? 'banned' : 'suspended'
}

// LegalGate.jsx: a policy é considerada desatualizada quando a versão publicada em
// legalPolicy/current diverge da versão que este bundle espera, ou quando ela ainda
// não foi publicada -- nos dois casos, ninguém deveria conseguir aceitar (o servidor
// também recusaria, ver validateAcceptance em legalDigest.js). access null
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
