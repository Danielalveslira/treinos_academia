// Mensagens para os códigos de erro relacionados ao ESTADO DA CONTA (não específicos de
// nenhum domínio) que RPCs atrás de has_app_access()/private.has_account_standing() podem
// lançar, em qualquer tela: set_username, update_user_profile, allocate_profile_avatar, as
// RPCs de vitrine profissional, cast_vote, create_promotion. Antes desta centralização, cada
// tela tinha seu próprio mapa de código->mensagem (KNOWN_ERRORS) e cada um esquecia um
// subconjunto diferente desses códigos, caindo num fallback genérico que nunca explica que a
// conta está bloqueada. Um chamador usa isto como o ÚLTIMO recurso, depois do seu próprio mapa
// de códigos de domínio: `meuMapa[err.message] || describeAccountAccessError(err.message) || 'fallback genérico'`.
export const ACCOUNT_ACCESS_ERROR_MESSAGES = {
  NOT_AUTHENTICATED: 'Você precisa estar conectado para fazer isso. Entre na conta e tente novamente.',
  PERMISSION_DENIED: 'Sua conta não está com acesso liberado para esta ação agora.',
  ACCOUNT_DELETING: 'Sua conta está em processo de exclusão e não pode mais fazer isso.',
  ACCOUNT_DISABLED: 'Sua conta foi desativada por um administrador.',
  ACCOUNT_RESTRICTED: 'Sua conta está com uma restrição ativa.',
}

export function describeAccountAccessError(code) {
  return ACCOUNT_ACCESS_ERROR_MESSAGES[code] || null
}
