import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listPixPaymentMethods,
  savePixPaymentMethod,
  setActivePixPaymentMethod,
  deletePixPaymentMethod,
  setPixPaymentsEnabled,
} from '../services/pixPaymentAdminService'

// Administração de chaves PIX (aba "Configuração PIX" de /admin/compras-evocash, ver
// PixPaymentSettings.jsx) -- mesmo padrão de useCashPurchases.js (revision descarta
// respostas atrasadas). Toda mutação (save/setActive/delete/setEnabled) sempre recarrega
// do servidor depois -- nunca aplica um update otimista local, já que o próprio backend
// decide createdAt/updatedAt e a projeção pública.
export function usePixPaymentMethods() {
  const revision = useRef(0)
  const invalidate = useCallback(() => {
    revision.current++
  }, [])
  const [enabled, setEnabled] = useState(false)
  const [activeMethodId, setActiveMethodId] = useState(null)
  const [methods, setMethods] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    const current = ++revision.current
    setLoading(true)
    setError('')
    try {
      const result = await listPixPaymentMethods()
      if (current !== revision.current) return
      setEnabled(result.enabled)
      setActiveMethodId(result.activeMethodId)
      setMethods(result.methods)
    } catch {
      if (current === revision.current) setError('Não foi possível carregar as chaves PIX.')
    } finally {
      if (current === revision.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    return () => {
      invalidate()
    }
  }, [refresh, invalidate])

  async function save(payload) {
    await savePixPaymentMethod(payload)
    await refresh()
  }
  async function activate(methodId) {
    await setActivePixPaymentMethod(methodId)
    await refresh()
  }
  async function remove(methodId) {
    await deletePixPaymentMethod(methodId)
    await refresh()
  }
  async function toggleEnabled(nextEnabled) {
    await setPixPaymentsEnabled(nextEnabled)
    await refresh()
  }

  return { enabled, activeMethodId, methods, loading, error, refresh, save, activate, remove, toggleEnabled }
}
