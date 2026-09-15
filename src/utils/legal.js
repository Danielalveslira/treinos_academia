import manifest from '../../functions/legal/manifest.json' with { type: 'json' }
import documents from '../../functions/legal/documents.json' with { type: 'json' }

export const LEGAL_MANIFEST = manifest
export const LEGAL_DOCUMENTS = documents

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
export function isLegalPolicyOutdated(access, version = manifest.version) {
  return Boolean(
    access &&
    (access.policy?.version !== version ||
      access.policy?.published !== true ||
      typeof access.policy?.digest !== 'string' ||
      !access.policy.digest)
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

  const policyUnavailable =
    LEGAL_MANIFEST.published !== true || isLegalPolicyOutdated(access, LEGAL_MANIFEST.version)
  // O superadmin precisa alcançar o painel que publica/corrige legalPolicy/current.
  // Assim que a policy fica válida, ele volta ao mesmo requisito de aceite dos demais.
  if (policyUnavailable) return profile.role === 'superadmin' ? 'allowed' : 'policy-unavailable'

  return needsLegalAcceptance(profile.legalAcceptance, access.policy)
    ? 'acceptance-required'
    : 'allowed'
}
