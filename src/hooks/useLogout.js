import { useCallback, useEffect, useRef, useState } from 'react'
import { logoutAllDevices, logoutUser } from '../services/authService'
import { consumeLogoutReason, setLogoutReason } from '../utils/logoutReason'
import { disablePushNotifications } from '../features/notifications/services/pushService'

export function logoutErrorMessage(online = globalThis.navigator?.onLine !== false) {
  return online
    ? 'Não foi possível sair. Tente novamente.'
    : 'Sem conexão. Conecte-se à internet para sair da conta com segurança.'
}

export const LOGOUT_ALL_OTHERS_ERROR =
  'Não foi possível sair dos outros dispositivos. Tente novamente.'

// Falha na etapa 1 (revogar as outras sessões): continua logado, mensagem específica. Falha só na
// etapa 2 (sair deste aparelho): mensagem do logout comum.
export function logoutAllErrorMessage(err) {
  return err?.logoutStep === 'others' ? LOGOUT_ALL_OTHERS_ERROR : logoutErrorMessage()
}

// Confirmação explícita antes do logout em todos os dispositivos: cancelar não faz requisição nenhuma.
export async function confirmAndLogoutAll(confirm, logoutAll) {
  const confirmed = await confirm({
    title: 'Sair de todos os dispositivos?',
    content:
      'Sua conta será desconectada em todos os aparelhos e navegadores, inclusive neste. Será preciso entrar de novo em cada um. Use isto se perdeu um aparelho ou suspeita de acesso indevido.',
    confirmButtonContent: 'Sair de todos',
    confirmButtonType: 'danger',
    cancelButtonContent: 'Cancelar',
  })
  if (confirmed) await logoutAll()
  return Boolean(confirmed)
}

// Estado de UI do logout (Saindo… / erro) sobre o fluxo único de authService.logoutUser.
// O ref bloqueia o segundo toque no mesmo frame; o botão fica travado até o desfecho. Em caso
// de erro (sem rede, Supabase fora) o estado volta a "idle" com a mensagem -- nunca fica preso
// em "Saindo…". Em sucesso o componente é desmontado pelo redirecionamento do ProtectedRoute.
export function useLogout() {
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Mesmo fluxo para os dois escopos (um único `inFlight` trava ambos os botões).
  const run = useCallback(async ({ reason, action, failureMessage }) => {
    if (inFlight.current) return
    inFlight.current = true
    setSigningOut(true)
    setError('')
    // Lida pelo Login logo depois do redirecionamento ("Você saiu da conta.").
    setLogoutReason(reason)
    try {
      await action()
    } catch (err) {
      console.error('[Auth] logout:', err)
      consumeLogoutReason() // a sessão continua válida: não deixar o aviso para um login futuro
      if (mounted.current) setError(failureMessage(err))
    } finally {
      inFlight.current = false
      if (mounted.current) setSigningOut(false)
    }
  }, [])

  // Padrão: encerra só esta sessão (scope local).
  const logout = useCallback(
    () => run({
      reason: 'signed-out',
      action: async () => {
        await disablePushNotifications().catch(() => console.warn('[Push] logout revoke failed'))
        return logoutUser()
      },
      failureMessage: logoutErrorMessage,
    }),
    [run]
  )

  // Ação de segurança: revoga as outras sessões e, só se isso der certo, sai deste aparelho
  // (duas etapas em authService, uma única ação para o usuário). Quem chama deve confirmar antes.
  const logoutAll = useCallback(
    () =>
      run({
        reason: 'signed-out-all',
        action: async () => {
          await disablePushNotifications({ allDevices: true }).catch(() => console.warn('[Push] global logout revoke failed'))
          return logoutAllDevices()
        },
        failureMessage: logoutAllErrorMessage,
      }),
    [run]
  )

  return { logout, logoutAll, signingOut, error }
}
