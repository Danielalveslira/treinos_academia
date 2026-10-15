import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchAccountCommunities,
  fetchAccountFinancial,
  fetchAuditLog,
} from '../api/adminAccounts.api'

const FETCHERS = {
  communities: (id) => fetchAccountCommunities(id),
  financial: (id) => fetchAccountFinancial(id),
  audit: (id) => fetchAuditLog({ targetUserId: id, limit: 50 }),
}

// Dados pesados do painel (Comunidades / Financeiro / Auditoria): 1 chamada na primeira vez
// que a aba abre; reabrir usa o cache. Um novo snapshot (Atualizar) limpa o cache, assim
// "Atualizar" continua sendo o único jeito de sincronizar tudo de novo.
export function useAccountDetails(syncedVersion, openId) {
  const [entries, setEntries] = useState({})
  const requested = useRef(new Set())
  const epoch = useRef(0)
  const versions = useRef(new Map())

  useEffect(() => {
    epoch.current += 1
    requested.current = new Set()
    setEntries({})
    return () => {
      epoch.current += 1
    }
  }, [syncedVersion])

  useEffect(() => {
    epoch.current += 1
    setEntries((previous) => {
      const ready = Object.fromEntries(
        Object.entries(previous).filter(([, entry]) => entry.status === 'ready')
      )
      requested.current = new Set(Object.keys(ready))
      return ready
    })
    return () => {
      epoch.current += 1
    }
  }, [openId])

  const load = useCallback((id, section, { force = false } = {}) => {
    const key = `${id}:${section}`
    if (!force && requested.current.has(key)) return
    requested.current.add(key)
    const current = epoch.current
    const version = (versions.current.get(key) || 0) + 1
    versions.current.set(key, version)
    setEntries((previous) => ({
      ...previous,
      [key]: { status: 'loading', data: previous[key]?.data },
    }))
    FETCHERS[section](id).then(
      (data) => {
        if (current !== epoch.current || versions.current.get(key) !== version) return
        setEntries((previous) => ({ ...previous, [key]: { status: 'ready', data } }))
      },
      () => {
        if (current !== epoch.current || versions.current.get(key) !== version) return
        requested.current.delete(key)
        setEntries((previous) => ({
          ...previous,
          [key]: { status: 'error', data: previous[key]?.data },
        }))
      }
    )
  }, [])

  // Uma ação do admin (ex.: desativar) cria registro novo de auditoria: a aba recarrega
  // só quando for aberta de novo, não imediatamente.
  const invalidate = useCallback((id, section) => {
    const key = `${id}:${section}`
    versions.current.set(key, (versions.current.get(key) || 0) + 1)
    requested.current.delete(key)
    setEntries((previous) => {
      const { [key]: _removed, ...rest } = previous
      return rest
    })
  }, [])

  return { entries, load, invalidate }
}
