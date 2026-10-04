// O Supabase reemite eventos de auth da MESMA sessão (SIGNED_IN ao voltar para a aba,
// TOKEN_REFRESHED, USER_UPDATED, INITIAL_SESSION duplicado). Só uma troca real de identidade --
// login, logout ou outro usuário -- justifica zerar e recarregar o estado privado do app.
// `loadedUserId`: undefined = nada carregado ainda; null = carregado como anônimo.
export function isSameSessionIdentity(loadedUserId, nextUser) {
  return loadedUserId !== undefined && (nextUser?.id ?? null) === loadedUserId
}
