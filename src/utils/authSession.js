// O Supabase reemite eventos de auth da MESMA sessão (SIGNED_IN ao voltar para a aba,
// TOKEN_REFRESHED, USER_UPDATED, INITIAL_SESSION duplicado). Só uma troca real de identidade --
// login, logout ou outro usuário -- justifica zerar e recarregar o estado privado do app.
// `loadedUserId`: undefined = nada carregado ainda; null = carregado como anônimo.
export function isSameSessionIdentity(loadedUserId, nextUser) {
  return loadedUserId !== undefined && (nextUser?.id ?? null) === loadedUserId
}

// Apenas orientação de UI. O JWT é validado pelo GoTrue/PostgREST; esta leitura local
// nunca autoriza dados ou operações. Roles transitórias não devem carregar perfil,
// Realtime ou bootstrap offline enquanto o backend decide o acesso.
export function restrictedAuthScope(session) {
  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return ['auth_signup', 'auth_recovery', 'auth_setup'].includes(payload.role)
      ? payload.role
      : null
  } catch {
    return null
  }
}
