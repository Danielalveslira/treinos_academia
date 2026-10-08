// Como um membro aparece em listas: sempre o @usuário; sem perfil público (ou com valor inesperado),
// "Membro". NUNCA o id da conta (uuid), nem como texto de link ou de botão.
export function memberHandle(username) {
  return typeof username === 'string' && username.trim() ? `@${username.trim()}` : 'Membro'
}
