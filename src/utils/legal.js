import manifest from '../../functions/legal/manifest.json' with { type: 'json' }
import documents from '../../functions/legal/documents.json' with { type: 'json' }

export const LEGAL_MANIFEST = manifest
export const LEGAL_DOCUMENTS = documents

export function needsLegalAcceptance(acceptance, version = manifest.version) {
  return !acceptance || acceptance.version !== version || !acceptance.acceptedAt
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
    access && (access.policy?.version !== version || access.policy?.published !== true)
  )
}

// LegalGate.jsx: um cache (sessionStorage) só é seguro como estado inicial enquanto
// reflete a MESMA versão do manifest que este bundle está executando agora. Um cache
// escrito por um deploy anterior (versão diferente) não deve ser tratado como uma
// resposta válida -- nem "ok" nem "desatualizado" -- e sim como se não existisse
// (LegalGate volta a mostrar o carregamento neutro até a consulta fresca decidir).
// Sem isso, um usuário nesta mesma aba desde antes de um novo deploy via a mensagem
// de "documentos sendo atualizados" piscar a partir de um dado que já não descreve
// a versão atual, mesmo quando ele nunca chegou a ser realmente aplicável.
export function isCachedAccessValid(cached, version = manifest.version) {
  return Boolean(cached?.policy?.version === version)
}
